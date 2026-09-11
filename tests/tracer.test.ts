import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { initTracer, resolveConfig } from "../src/tracer.js";
import { withCleanEnv, withConfigFile } from "./env-utils.js";

test("resolveConfig resolves defaults when no config file exists", () =>
  withConfigFile(null, () => {
    const config = resolveConfig();
    assert.equal(config.serviceName, "pi-coding-agent");
    assert.equal(config.disabled, false);
    assert.equal(config.exporter, "otlp");
    assert.equal(config.endpoint, "http://localhost:4318/v1/traces");
    assert.equal(config.filePath, ".pi/traces.jsonl");
    assert.equal(config.captureContent, false);
  })
);

test("resolveConfig normalizes otel.endpoint (base or full path)", () =>
  withConfigFile({ otel: { endpoint: "http://localhost:4318/" } }, () => {
    assert.equal(resolveConfig().endpoint, "http://localhost:4318/v1/traces");
  }).then(() =>
    withConfigFile({ otel: { endpoint: "http://localhost:4318/v1/traces" } }, () => {
      assert.equal(resolveConfig().endpoint, "http://localhost:4318/v1/traces");
    })
  )
);

test("resolveConfig falls back to otlp for unknown exporter value", () =>
  withConfigFile({ otel: { exporters: "otel" } }, () => {
    assert.equal(resolveConfig().exporter, "otlp");
  })
);

test("resolveConfig reads otel section values from the config file", () =>
  withConfigFile(
    {
      otel: {
        disabled: true,
        exporters: ["otlp", "file", "bogus", "memory"],
        serviceName: "svc",
        filePath: "/tmp/x.jsonl",
        captureContent: true,
        headers: { Authorization: "Bearer token" },
      },
    },
    () => {
      const config = resolveConfig();
      assert.equal(config.disabled, true);
      assert.deepEqual(config.exporters, ["otlp", "file", "memory"]);
      assert.equal(config.exporter, "otlp"); // primary = first
      assert.equal(config.serviceName, "svc");
      assert.equal(config.filePath, "/tmp/x.jsonl");
      assert.equal(config.captureContent, true);
      assert.deepEqual(config.headers, { Authorization: "Bearer token" });
    }
  )
);

test("resolveConfig respects custom overrides over the config file", () =>
  withConfigFile({ otel: { serviceName: "from-file", disabled: true } }, () => {
    const config = resolveConfig({
      serviceName: "custom-agent",
      disabled: false,
      exporter: "console",
      endpoint: "http://example.com/v1/traces",
      filePath: "custom.jsonl",
      captureContent: true,
    });
    assert.equal(config.serviceName, "custom-agent");
    assert.equal(config.disabled, false);
    assert.equal(config.exporter, "console");
    assert.equal(config.endpoint, "http://example.com/v1/traces");
    assert.equal(config.filePath, "custom.jsonl");
    assert.equal(config.captureContent, true);
  })
);

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

test("initTracer sends spans to every configured processor", async () => {
  const os = await import("node:os");
  const { InMemorySpanExporter } = await import("@opentelemetry/sdk-trace-base");
  await withConfigFile({ otel: { exporters: ["memory", "file"] } }, async (cfgDir) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-otel-multi-"));
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
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
