import test from "node:test";
import assert from "node:assert/strict";
import { initTracer, resolveConfig } from "../src/tracer.js";
import { withCleanEnv } from "./env-utils.js";

test("resolveConfig resolves default environment values", () =>
  withCleanEnv(() => {
    const config = resolveConfig();
    assert.equal(config.serviceName, "pi-coding-agent");
    assert.equal(config.disabled, false);
    assert.equal(config.exporter, "otlp");
    assert.equal(config.endpoint, "http://localhost:4318/v1/traces");
    assert.equal(config.filePath, ".pi/traces.jsonl");
    assert.equal(config.captureContent, false);
  })
);

test("resolveConfig normalizes OTEL_EXPORTER_OTLP_ENDPOINT (base or full path)", () =>
  withCleanEnv(() => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318/";
    assert.equal(resolveConfig().endpoint, "http://localhost:4318/v1/traces");
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318/v1/traces";
    assert.equal(resolveConfig().endpoint, "http://localhost:4318/v1/traces");
  })
);

test("resolveConfig falls back to otlp for unknown exporter value", () =>
  withCleanEnv(() => {
    process.env.PI_OTEL_EXPORTER = "otel"; // typo'd value must not pass through
    assert.equal(resolveConfig().exporter, "otlp");
  })
);

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

test("resolveConfig parses PI_OTEL_EXPORTERS comma list", () =>
  withCleanEnv(() => {
    process.env.PI_OTEL_EXPORTERS = "otlp, file ,bogus,memory";
    const config = resolveConfig();
    assert.deepEqual(config.exporters, ["otlp", "file", "memory"]);
    assert.equal(config.exporter, "otlp"); // primary = first
  })
);

test("resolveConfig: PI_OTEL_EXPORTERS wins over legacy PI_OTEL_EXPORTER", () =>
  withCleanEnv(() => {
    process.env.PI_OTEL_EXPORTERS = "file,otlp";
    process.env.PI_OTEL_EXPORTER = "console";
    assert.deepEqual(resolveConfig().exporters, ["file", "otlp"]);
  })
);

test("initTracer sends spans to every configured processor", async () => {
  const os = await import("node:os");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { InMemorySpanExporter } = await import("@opentelemetry/sdk-trace-base");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-otel-multi-"));
  process.env.PI_OTEL_EXPORTERS = "memory,file";
  try {
    const config = resolveConfig({ filePath: path.join(dir, "traces.jsonl") });
    const { tracer, exporters, forceFlush, shutdown } = initTracer(config);
    const span = tracer.startSpan("multi-check");
    span.end();
    await forceFlush();
    const mem = exporters[0] as InMemorySpanExporter;
    assert.ok(mem.getFinishedSpans().some((s) => s.name === "multi-check"), "memory processor got the span");
    const fileContent = fs.readFileSync(config.filePath, "utf8");
    assert.ok(fileContent.includes("multi-check"), "file processor got the span");
    await shutdown();
  } finally {
    delete process.env.PI_OTEL_EXPORTERS;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
