import type { Tracer } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { BatchSpanProcessor, SimpleSpanProcessor, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { configFilePath } from "./config.js";
import type { PiOtelConfig, ExporterKind } from "./types.js";
import { readOtelConfig } from "./config.js";
import { createSpanExporter } from "./exporters/index.js";

const EXPORTER_KINDS: readonly ExporterKind[] = ["otlp", "file", "console", "memory"];

function parseExporterList(raw: string): ExporterKind[] {
  const seen = new Set<ExporterKind>();
  for (const part of raw.split(",")) {
    const v = part.trim().toLowerCase() as ExporterKind;
    if (!v) continue;
    if (!EXPORTER_KINDS.includes(v)) {
      console.warn(`[pi-otel] Unknown exporter "${v}"; skipping.`);
      continue;
    }
    seen.add(v);
  }
  return seen.size > 0 ? [...seen] : ["otlp"];
}

export function resolveConfig(overrides?: Partial<PiOtelConfig>): PiOtelConfig {
  const file = readOtelConfig() ?? {};
  const rawExporters =
    overrides?.exporters?.join(",") ??
    overrides?.exporter ??
    (Array.isArray(file.exporters) ? file.exporters.join(",") : file.exporters ?? file.exporter) ??
    "otlp";
  const exporters = parseExporterList(rawExporters);
  // Base URLs are common in configs — accept both a collector base and a
  // full traces path.
  // ponytail: endsWith heuristic; strict spec behavior would always append.
  const rawEndpoint = overrides?.endpoint ?? file.endpoint;
  const endpoint = rawEndpoint
    ? rawEndpoint.endsWith("/v1/traces")
      ? rawEndpoint
      : `${rawEndpoint.replace(/\/+$/, "")}/v1/traces`
    : "http://localhost:4318/v1/traces";
  return {
    disabled: overrides?.disabled ?? file.disabled ?? false,
    exporter: exporters[0],
    exporters,
    endpoint,
    headers: overrides?.headers ?? file.headers,
    serviceName: overrides?.serviceName ?? file.serviceName ?? "pi-coding-agent",
    filePath: overrides?.filePath ?? file.filePath ?? ".pi/traces.jsonl",
    captureContent: overrides?.captureContent ?? file.captureContent ?? false,
  };
}

export function initTracer(overrides?: Partial<PiOtelConfig>) {
  const config = resolveConfig(overrides);
  if (config.exporters.includes("otlp") && config.endpoint === "http://localhost:4318/v1/traces") {
    console.warn(
      `[pi-otel] No OTLP endpoint configured; defaulting to ${config.endpoint}. ` +
        `Set otel.exporters in ${configFilePath()} to also write locally, ` +
        "or set otel.endpoint to your collector."
    );
  }
  // One span processor per configured exporter. OTel 2.x removed the
  // BatchSpanProcessor onExport hook; wrap each exporter to surface the first
  // export failure instead of silently dropping spans.
  const exporters: SpanExporter[] = [];
  const processors: SpanProcessor[] = [];
  for (const kind of config.exporters) {
    const exporter = createSpanExporter({ ...config, exporter: kind });
    let warnedExportFailure = false;
    const target = kind === "file" ? config.filePath : config.endpoint;
    const wrappedExport = exporter.export.bind(exporter);
    exporter.export = (spans, resultCallback) => {
      wrappedExport(spans, (result) => {
        if (result?.error && !warnedExportFailure) {
          warnedExportFailure = true;
          console.warn(
            `[pi-otel] Trace export failed (${kind} -> ${target}): ` +
              `${(result.error as Error)?.message ?? result.error}. Further failures suppressed.`
          );
        }
        resultCallback(result);
      });
    };
    exporters.push(exporter);
    processors.push(
      kind === "memory"
        ? new SimpleSpanProcessor(exporter)
        : new BatchSpanProcessor(exporter, {
            maxQueueSize: 2048,
            scheduledDelayMillis: 500,
          })
    );
  }

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
    }),
    spanProcessors: processors,
  });

    provider.register();

  const tracer: Tracer = provider.getTracer("pi-otel", "0.2.0");

  const forceFlush = async (timeoutMs = 1000): Promise<void> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        provider.forceFlush(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Flush timeout")), timeoutMs);
          timer.unref?.();
        }),
      ]);
    } catch {
      // Best-effort flush; ignore timeouts on exit
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  };

  const shutdown = async (): Promise<void> => {
    try {
      await provider.shutdown();
    } catch {
      // Ignore shutdown errors
    }
  };

  return { tracer, provider, exporter: exporters[0], exporters, forceFlush, shutdown };
}
