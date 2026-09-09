import type { Tracer } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { BatchSpanProcessor, SimpleSpanProcessor, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { PiOtelConfig, ExporterKind } from "./types.js";
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
  const env = process.env;
  // PI_OTEL_EXPORTERS (comma list) wins over legacy single-value PI_OTEL_EXPORTER.
  const rawExporters =
    overrides?.exporters?.join(",") ??
    overrides?.exporter ??
    env.PI_OTEL_EXPORTERS ??
    env.PI_OTEL_EXPORTER ??
    "otlp";
  const exporters = parseExporterList(rawExporters);
  // OTEL_EXPORTER_OTLP_ENDPOINT is a base URL per spec, but many users set
  // the full traces path — accept both.
  // ponytail: endsWith heuristic; strict spec behavior would always append.
  const baseEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const endpointDefault = baseEndpoint
    ? baseEndpoint.endsWith("/v1/traces")
      ? baseEndpoint
      : `${baseEndpoint.replace(/\/+$/, "")}/v1/traces`
    : "http://localhost:4318/v1/traces";
  return {
    disabled: overrides?.disabled ?? (env.PI_OTEL_DISABLED === "true" || env.PI_OTEL_DISABLED === "1"),
    exporter: exporters[0],
    exporters,
    endpoint:
      overrides?.endpoint ??
      env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
      endpointDefault,
    serviceName: overrides?.serviceName ?? env.OTEL_SERVICE_NAME ?? "pi-coding-agent",
    filePath: overrides?.filePath ?? env.PI_OTEL_FILE_PATH ?? ".pi/traces.jsonl",
    captureContent: overrides?.captureContent ?? (env.PI_OTEL_CAPTURE_CONTENT === "true" || env.PI_OTEL_CAPTURE_CONTENT === "1"),
  };
}

export function initTracer(overrides?: Partial<PiOtelConfig>) {
  const config = resolveConfig(overrides);
  if (
    config.exporters.includes("otlp") &&
    !process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT &&
    !process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  ) {
    console.warn(
      `[pi-otel] No OTLP endpoint configured; defaulting to ${config.endpoint}. ` +
        `Set PI_OTEL_EXPORTERS=${[...config.exporters].filter((k) => k !== "otlp").join(",") || "file"} to also write locally, ` +
        "or point OTEL_EXPORTER_OTLP_ENDPOINT at a collector."
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
