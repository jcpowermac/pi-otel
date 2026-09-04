import test from "node:test";
import assert from "node:assert/strict";
import { initTracer, resolveConfig } from "../src/tracer.js";

test("resolveConfig resolves default environment values", () => {
  const config = resolveConfig();
  assert.equal(config.serviceName, "pi-coding-agent");
  assert.equal(config.disabled, false);
  assert.equal(config.exporter, "otlp");
  assert.equal(config.endpoint, "http://localhost:4318/v1/traces");
  assert.equal(config.filePath, ".pi/traces.jsonl");
  assert.equal(config.captureContent, false);
});

test("resolveConfig respects OTEL_EXPORTER_OTLP_TRACES_ENDPOINT precedence over OTEL_EXPORTER_OTLP_ENDPOINT", () => {
  const origTraces = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  const origBase = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  try {
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "http://traces.custom/v1/traces";
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://base.custom/v1/traces";

    const config = resolveConfig();
    assert.equal(config.endpoint, "http://traces.custom/v1/traces");
  } finally {
    if (origTraces !== undefined) process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = origTraces;
    else delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;

    if (origBase !== undefined) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = origBase;
    else delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  }
});

test("resolveConfig respects custom overrides", () => {
  const config = resolveConfig({
    serviceName: "custom-agent",
    disabled: true,
    exporter: "console",
    endpoint: "http://example.com/traces",
    filePath: "custom.jsonl",
    captureContent: true,
  });
  assert.equal(config.serviceName, "custom-agent");
  assert.equal(config.disabled, true);
  assert.equal(config.exporter, "console");
  assert.equal(config.endpoint, "http://example.com/traces");
  assert.equal(config.filePath, "custom.jsonl");
  assert.equal(config.captureContent, true);
});

test("initTracer returns active tracer, provider, and lifecycle helpers", async () => {
  const { tracer, provider, exporter, forceFlush, shutdown } = initTracer({ exporter: "memory" });
  assert.ok(tracer);
  assert.ok(provider);
  assert.ok(exporter);
  const span = tracer.startSpan("test-span");
  span.end();
  await forceFlush();
  await shutdown();
});

test("initTracer forceFlush handles timeout gracefully", async () => {
  const { tracer, forceFlush, shutdown } = initTracer({ exporter: "memory" });
  assert.ok(tracer);
  // Calling with 0ms timeout should not throw
  await assert.doesNotReject(async () => {
    await forceFlush(0);
  });
  await shutdown();
});
