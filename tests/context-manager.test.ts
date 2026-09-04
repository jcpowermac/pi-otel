import test from "node:test";
import assert from "node:assert/strict";
import { initTracer } from "../src/tracer.js";
import { TraceContextManager } from "../src/context-manager.js";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { GENAI_ATTRS, TOOL_ATTRS } from "../src/conventions.js";

test("TraceContextManager parents tool spans under active turn span", async () => {
  const { tracer, exporter, forceFlush, shutdown } = initTracer({ exporter: "memory" });
  const cm = new TraceContextManager(tracer);

  cm.startAgentRun("session-1", "/test");
  cm.startTurn(0);
  cm.startToolExecution("call-1", "bash");
  cm.endToolExecution("call-1", false);
  cm.endTurn();
  cm.endAgentRun();

  await forceFlush();
  const spans = (exporter as InMemorySpanExporter).getFinishedSpans();
  await shutdown();

  assert.equal(spans.length, 3); // tool, turn, agent_run
  const toolSpan = spans.find((s) => s.name === "tool:bash");
  const turnSpan = spans.find((s) => s.name === "turn_0");
  const agentSpan = spans.find((s) => s.name === "agent_run");

  assert.ok(toolSpan);
  assert.ok(turnSpan);
  assert.ok(agentSpan);
  assert.equal(toolSpan.parentSpanId, turnSpan.spanContext().spanId);
  assert.equal(turnSpan.parentSpanId, agentSpan.spanContext().spanId);
});

test("TraceContextManager records chat span with GenAI usage attributes", async () => {
  const { tracer, exporter, forceFlush, shutdown } = initTracer({ exporter: "memory" });
  const cm = new TraceContextManager(tracer);

  cm.startAgentRun("session-2", "/app");
  cm.startTurn(1);
  cm.startChat("claude-3-7-sonnet", "anthropic");
  cm.endChat({
    input: 1200,
    output: 80,
    cacheRead: 300,
    cacheWrite: 100,
  });
  cm.endTurn();
  cm.endAgentRun();

  await forceFlush();
  const spans = (exporter as InMemorySpanExporter).getFinishedSpans();
  await shutdown();

  const chatSpan = spans.find((s) => s.name === "gen_ai.chat");
  const turnSpan = spans.find((s) => s.name === "turn_1");

  assert.ok(chatSpan);
  assert.ok(turnSpan);
  assert.equal(chatSpan.parentSpanId, turnSpan.spanContext().spanId);
  assert.equal(chatSpan.attributes[GENAI_ATTRS.REQUEST_MODEL], "claude-3-7-sonnet");
  assert.equal(chatSpan.attributes[GENAI_ATTRS.SYSTEM], "anthropic");
  assert.equal(chatSpan.attributes[GENAI_ATTRS.USAGE_INPUT_TOKENS], 1200);
  assert.equal(chatSpan.attributes[GENAI_ATTRS.USAGE_OUTPUT_TOKENS], 80);
  assert.equal(chatSpan.attributes[GENAI_ATTRS.USAGE_CACHE_READ_TOKENS], 300);
  assert.equal(chatSpan.attributes[GENAI_ATTRS.USAGE_CACHE_WRITE_TOKENS], 100);
});

test("TraceContextManager records tool result errors and output byte size", async () => {
  const { tracer, exporter, forceFlush, shutdown } = initTracer({ exporter: "memory" });
  const cm = new TraceContextManager(tracer);

  cm.startTurn(0);
  cm.startToolExecution("call-err", "read", { path: "missing.txt" });
  cm.recordToolResult("call-err", true, 42);
  cm.endToolExecution("call-err", true);
  cm.endTurn();

  await forceFlush();
  const spans = (exporter as InMemorySpanExporter).getFinishedSpans();
  await shutdown();

  const toolSpan = spans.find((s) => s.name === "tool:read");

  assert.ok(toolSpan);
  assert.equal(toolSpan.attributes[TOOL_ATTRS.NAME], "read");
  assert.equal(toolSpan.attributes[TOOL_ATTRS.CALL_ID], "call-err");
  assert.equal(toolSpan.attributes[TOOL_ATTRS.IS_ERROR], true);
  assert.equal(toolSpan.attributes[TOOL_ATTRS.OUTPUT_BYTES], 42);
  assert.equal(toolSpan.attributes[TOOL_ATTRS.INPUT_JSON], JSON.stringify({ path: "missing.txt" }));
  assert.equal(toolSpan.status.code, 2); // SpanStatusCode.ERROR === 2
});

test("TraceContextManager handles circular/unserializable tool input args gracefully", async () => {
  const { tracer, exporter, forceFlush, shutdown } = initTracer({ exporter: "memory" });
  const cm = new TraceContextManager(tracer);

  const circular: any = {};
  circular.self = circular;

  cm.startTurn(0);
  cm.startToolExecution("call-circ", "custom", circular);
  cm.endToolExecution("call-circ", false);
  cm.endTurn();

  await forceFlush();
  const spans = (exporter as InMemorySpanExporter).getFinishedSpans();
  await shutdown();

  const toolSpan = spans.find((s) => s.name === "tool:custom");
  assert.ok(toolSpan);
  assert.equal(toolSpan.attributes[TOOL_ATTRS.INPUT_JSON], "[Unserializable input]");
});
