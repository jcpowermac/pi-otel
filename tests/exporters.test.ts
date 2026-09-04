import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { createSpanExporter } from "../src/exporters/index.js";
import { InMemorySpanExporter, ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { FileSpanExporter } from "../src/exporters/file.js";

test("creates InMemorySpanExporter when exporter is 'memory'", () => {
  const exporter = createSpanExporter({
    disabled: false,
    exporter: "memory",
    endpoint: "http://localhost:4318/v1/traces",
    serviceName: "pi-test",
    filePath: ".pi/traces.jsonl",
    captureContent: false,
  });
  assert.ok(exporter instanceof InMemorySpanExporter);
});

test("creates ConsoleSpanExporter when exporter is 'console'", () => {
  const exporter = createSpanExporter({
    disabled: false,
    exporter: "console",
    endpoint: "http://localhost:4318/v1/traces",
    serviceName: "pi-test",
    filePath: ".pi/traces.jsonl",
    captureContent: false,
  });
  assert.ok(exporter instanceof ConsoleSpanExporter);
});

test("creates FileSpanExporter when exporter is 'file'", () => {
  const exporter = createSpanExporter({
    disabled: false,
    exporter: "file",
    endpoint: "http://localhost:4318/v1/traces",
    serviceName: "pi-test",
    filePath: ".pi/test-traces.jsonl",
    captureContent: false,
  });
  assert.ok(exporter instanceof FileSpanExporter);
});

test("creates OTLPTraceExporter when exporter is 'otlp' or default", () => {
  const exporter = createSpanExporter({
    disabled: false,
    exporter: "otlp",
    endpoint: "http://localhost:4318/v1/traces",
    serviceName: "pi-test",
    filePath: ".pi/traces.jsonl",
    captureContent: false,
  });
  assert.ok(exporter instanceof OTLPTraceExporter);
});

test("FileSpanExporter writes spans to file in JSON lines format", async (t) => {
  const tempPath = path.resolve(process.cwd(), ".pi/test-run-traces.jsonl");
  if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

  t.after(() => {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  });

  const exporter = new FileSpanExporter({
    disabled: false,
    exporter: "file",
    endpoint: "",
    serviceName: "pi-test",
    filePath: ".pi/test-run-traces.jsonl",
    captureContent: false,
  });

  const dummySpan: any = {
    spanContext: () => ({ traceId: "t123", spanId: "s456" }),
    parentSpanId: "p000",
    name: "test-span",
    kind: 0,
    startTime: [1000, 0],
    endTime: [1001, 0],
    duration: [1, 0],
    attributes: { "test.key": "val" },
    status: { code: 0 },
    events: [],
  };

  await new Promise<void>((resolve, reject) => {
    exporter.export([dummySpan], (result) => {
      if (result.error) reject(result.error);
      else resolve();
    });
  });

  assert.ok(fs.existsSync(tempPath));
  const content = fs.readFileSync(tempPath, "utf8");
  const parsed = JSON.parse(content.trim());
  assert.equal(parsed.traceId, "t123");
  assert.equal(parsed.spanId, "s456");
  assert.equal(parsed.parentSpanId, "p000");
  assert.equal(parsed.name, "test-span");
});

test("FileSpanExporter handles empty spans array as immediate success", async () => {
  const exporter = new FileSpanExporter({
    disabled: false,
    exporter: "file",
    endpoint: "",
    serviceName: "pi-test",
    filePath: ".pi/test-empty-spans.jsonl",
    captureContent: false,
  });

  const res = await new Promise<{ code: number }>((resolve) => {
    exporter.export([], (result) => resolve(result));
  });

  assert.equal(res.code, 0); // ExportResultCode.SUCCESS === 0
});
