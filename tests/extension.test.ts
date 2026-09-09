import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import extensionFactory from "../src/index.js";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { GENAI_ATTRS, TOOL_ATTRS, AGENT_ATTRS } from "../src/conventions.js";
import { withCleanEnv } from "./env-utils.js";

class MockExtensionAPI {
  handlers = new Map<string, Function[]>();

  on(event: string, handler: Function) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  async emit(event: string, payload: any, ctx?: any) {
    const list = this.handlers.get(event) ?? [];
    for (const h of list) {
      await h(payload, ctx ?? {});
    }
  }
}

test("extension hooks emit spans through full lifecycle without errors", async () =>
  withCleanEnv(async () => {
  const pi = new MockExtensionAPI();
  const context = extensionFactory(pi as any, { exporter: "memory" });

  // Simulate Pi lifecycle
  await pi.emit("session_start", { reason: "startup" }, { sessionId: "s1", cwd: "/tmp" });
  await pi.emit("agent_start", {}, { sessionId: "s1", cwd: "/tmp" });
  await pi.emit("turn_start", { turnIndex: 0 }, {});
  await pi.emit("before_provider_request", { provider: "anthropic", payload: { model: "claude-3-7-sonnet" } }, {});
  await pi.emit(
    "message_end",
    {
      message: {
        role: "assistant",
        usage: { input: 100, output: 20, cacheRead: 50, cacheWrite: 10 },
      },
    },
    {}
  );
  await pi.emit("tool_execution_start", { toolCallId: "c1", toolName: "bash", args: { command: "ls" } }, {});
  await pi.emit("tool_result", { toolCallId: "c1", isError: false, content: [{ type: "text", text: "ok" }] }, {});
  await pi.emit("tool_execution_end", { toolCallId: "c1", toolName: "bash" }, {});
  await pi.emit("turn_end", { turnIndex: 0 }, {});
  await pi.emit("agent_end", {}, {});

  const spans = (context!.exporter as InMemorySpanExporter).getFinishedSpans();
  assert.equal(spans.length, 4); // tool:bash, gen_ai.chat, turn_0, agent_run
  const toolSpan = spans.find((s) => s.name === "tool:bash");
  const chatSpan = spans.find((s) => s.name === "gen_ai.chat");
  const turnSpan = spans.find((s) => s.name === "turn_0");
  const agentSpan = spans.find((s) => s.name === "agent_run");

  assert.ok(toolSpan);
  assert.ok(chatSpan);
  assert.ok(turnSpan);
  assert.ok(agentSpan);

  // Hierarchy assertions
  assert.equal(toolSpan.parentSpanContext?.spanId, turnSpan.spanContext().spanId);
  assert.equal(chatSpan.parentSpanContext?.spanId, turnSpan.spanContext().spanId);
  assert.equal(turnSpan.parentSpanContext?.spanId, agentSpan.spanContext().spanId);

  // Attributes assertions
  assert.equal(toolSpan.attributes[TOOL_ATTRS.NAME], "bash");
  assert.equal(toolSpan.attributes[TOOL_ATTRS.OUTPUT], undefined); // captureContent off by default
  assert.equal(toolSpan.attributes[TOOL_ATTRS.IS_ERROR], false);
  assert.equal(chatSpan.attributes[GENAI_ATTRS.REQUEST_MODEL], "claude-3-7-sonnet");
  assert.equal(chatSpan.attributes[GENAI_ATTRS.SYSTEM], "anthropic");
  assert.equal(chatSpan.attributes[GENAI_ATTRS.USAGE_INPUT_TOKENS], 100);
  assert.equal(chatSpan.attributes[GENAI_ATTRS.USAGE_OUTPUT_TOKENS], 20);
  assert.equal(agentSpan.attributes[AGENT_ATTRS.SESSION_ID], "s1");
  assert.equal(agentSpan.attributes[AGENT_ATTRS.SESSION_CWD], "/tmp");

  await pi.emit("session_shutdown", {}, {});
  })
);

test("extension respects disabled configuration and registers no hooks", () => {
  const pi = new MockExtensionAPI();

  extensionFactory(pi as any, { disabled: true });
  assert.equal(pi.handlers.size, 0);
});

test("extension captures tool arguments when captureContent is true", async () => {
  const pi = new MockExtensionAPI();

  const context = extensionFactory(pi as any, {
    exporter: "memory",
    captureContent: true,
  });

  assert.ok(pi.handlers.has("tool_execution_start"));
  await pi.emit("session_start", {}, { sessionId: "s2" });
  await pi.emit("turn_start", { turnIndex: 1 });
  await pi.emit("tool_execution_start", {
    toolCallId: "c2",
    toolName: "read",
    args: { path: "package.json" },
  });
  await pi.emit("tool_result", {
    toolCallId: "c2",
    isError: true,
    content: "File not found as string",
  });
  await pi.emit("tool_execution_end", { toolCallId: "c2" });
  await pi.emit("turn_end");
  await pi.emit("agent_end");

  const spans = (context!.exporter as InMemorySpanExporter).getFinishedSpans();
  const failedToolSpan = spans.find((s) => s.name === "tool:read");
  assert.ok(failedToolSpan);
  assert.equal(failedToolSpan.attributes[TOOL_ATTRS.NAME], "read");
  assert.equal(failedToolSpan.attributes[TOOL_ATTRS.CALL_ID], "c2");
  assert.equal(failedToolSpan.attributes[TOOL_ATTRS.IS_ERROR], true);
  assert.equal(failedToolSpan.attributes[TOOL_ATTRS.INPUT_JSON], JSON.stringify({ path: "package.json" }));
  assert.equal(failedToolSpan.attributes[TOOL_ATTRS.OUTPUT_BYTES], Buffer.byteLength("File not found as string", "utf8"));
  assert.equal(failedToolSpan.attributes[TOOL_ATTRS.OUTPUT], "File not found as string");
  assert.equal(failedToolSpan.status.code, 2); // SpanStatusCode.ERROR
});

test("extension caches session metadata from session_start and avoids duplicate root spans on agent_start", async () => {
  const pi = new MockExtensionAPI();
  const context = extensionFactory(pi as any, { exporter: "memory" });

  // session_start provides sessionId and cwd but does not create an active agent span yet
  await pi.emit("session_start", { reason: "startup" }, { sessionId: "session-persistent", cwd: "/workspace" });
  assert.equal(context!.contextManager.hasActiveAgentRun(), false);

  // agent_start without metadata uses cached sessionId and cwd without creating another root span
  await pi.emit("agent_start", {}, {});
  assert.equal(context!.contextManager.hasActiveAgentRun(), true);
  await pi.emit("turn_start", { turnIndex: 0 });
  await pi.emit("turn_end");
  await pi.emit("agent_end");

  const spans = (context!.exporter as InMemorySpanExporter).getFinishedSpans();
  const agentSpans = spans.filter((s) => s.name === "agent_run");
  assert.equal(agentSpans.length, 1);
  assert.equal(agentSpans[0].attributes[AGENT_ATTRS.SESSION_ID], "session-persistent");
  assert.equal(agentSpans[0].attributes[AGENT_ATTRS.SESSION_CWD], "/workspace");
});

test("extension handles errors inside hooks gracefully without throwing", async () => {
  const pi = new MockExtensionAPI();

  extensionFactory(pi as any, { exporter: "memory" });

  // Pass malformed events to verify try/catch error boundaries
  await pi.emit("session_start", null, null);
  await pi.emit("agent_start", null, null);
  await pi.emit("turn_start", null, null);
  await pi.emit("before_provider_request", null, null);
  await pi.emit("message_end", null, null);
  await pi.emit("tool_execution_start", null, null);
  await pi.emit("tool_result", null, null);
  await pi.emit("tool_execution_end", null, null);
  await pi.emit("turn_end", null, null);
  await pi.emit("agent_end", null, null);
  await pi.emit("session_shutdown", null, null);

  assert.ok(true);
});

test("default file exporter uses per-session path; explicit path stays shared", async (t) =>
  withCleanEnv(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-otel-"));
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    // Use the real ExtensionContext shape: sessionId lives on ctx.sessionManager,
    // not directly on ctx.
    const ctx = { cwd: dir, sessionManager: { getSessionId: () => "abcdef1234567890" } };
    const pi = new MockExtensionAPI();
    extensionFactory(pi as any, { exporter: "file" });
    await pi.emit("session_start", {}, ctx);
    await pi.emit("agent_start", {}, ctx);
    assert.ok(fs.existsSync(path.join(dir, ".pi")), "per-session default dir created at agent_start");
    await pi.emit("turn_end", {}, {});
    await pi.emit("agent_end", null, null);
    await pi.emit("session_shutdown", null, null);
    const file = path.join(dir, ".pi", "traces-abcdef12.jsonl");
    assert.ok(fs.existsSync(file), "per-session default file created");
    const spans = fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);
    const agentSpan = spans.find((s) => s.name === "agent_run");
    assert.equal(agentSpan.attributes["session.id"], "abcdef1234567890");

    const explicit = path.join(dir, "shared.jsonl");
    const pi2 = new MockExtensionAPI();
    extensionFactory(pi2 as any, { exporter: "file", filePath: explicit });
    const ctx2 = { cwd: dir, sessionManager: { getSessionId: () => "ffffffff00001111" } };
    await pi2.emit("session_start", {}, ctx2);
    await pi2.emit("agent_start", {}, ctx2);
    await pi2.emit("agent_end", null, null);
    await pi2.emit("session_shutdown", null, null);
    assert.ok(fs.existsSync(explicit), "explicit filePath respected");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  })
);
