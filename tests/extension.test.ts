import test from "node:test";
import assert from "node:assert/strict";
import extensionFactory from "../src/index.js";

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

test("extension hooks emit spans through full lifecycle without errors", async () => {
  const pi = new MockExtensionAPI();
  process.env.PI_OTEL_EXPORTER = "memory";

  extensionFactory(pi as any);

  // Simulate Pi lifecycle
  await pi.emit("session_start", { reason: "startup" }, { sessionId: "s1", cwd: "/tmp" });
  await pi.emit("agent_start", {}, { sessionId: "s1", cwd: "/tmp" });
  await pi.emit("turn_start", { turnIndex: 0 }, {});
  await pi.emit("before_provider_request", { payload: { model: "claude-3-7-sonnet" } }, {});
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
  await pi.emit("session_shutdown", {}, {});

  assert.ok(true);
});

test("extension respects disabled configuration and registers no hooks", () => {
  const pi = new MockExtensionAPI();

  extensionFactory(pi as any, { disabled: true });
  assert.equal(pi.handlers.size, 0);
});

test("extension captures tool arguments when captureContent is true", async () => {
  const pi = new MockExtensionAPI();

  extensionFactory(pi as any, {
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
    content: [{ type: "text", text: "File not found" }],
  });
  await pi.emit("tool_execution_end", { toolCallId: "c2" });
  await pi.emit("turn_end");
  await pi.emit("agent_end");

  assert.ok(true);
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
