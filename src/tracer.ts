import { trace, type Tracer } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { BatchSpanProcessor, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { PiOtelConfig, ExporterKind } from "./types.js";
import { createSpanExporter } from "./exporters/index.js";

export function resolveConfig(overrides?: Partial<PiOtelConfig>): PiOtelConfig {
  const env = process.env;
  return {
    disabled: overrides?.disabled ?? (env.PI_OTEL_DISABLED === "true" || env.PI_OTEL_DISABLED === "1"),
    exporter: (overrides?.exporter ?? env.PI_OTEL_EXPORTER ?? "otlp") as ExporterKind,
    endpoint:
      overrides?.endpoint ??
      env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
      env.OTEL_EXPORTER_OTLP_ENDPOINT ??
      "http://localhost:4318/v1/traces",
    serviceName: overrides?.serviceName ?? env.OTEL_SERVICE_NAME ?? "pi-coding-agent",
    filePath: overrides?.filePath ?? env.PI_OTEL_FILE_PATH ?? ".pi/traces.jsonl",
    captureContent: overrides?.captureContent ?? (env.PI_OTEL_CAPTURE_CONTENT === "true" || env.PI_OTEL_CAPTURE_CONTENT === "1"),
  };
}

export function initTracer(overrides?: Partial<PiOtelConfig>) {
  const config = resolveConfig(overrides);
  const exporter = createSpanExporter(config);
  if (
    config.exporter === "otlp" &&
    !process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT &&
    !process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  ) {
    console.warn(
      `[pi-otel] No OTLP endpoint configured; defaulting to ${config.endpoint}. ` +
        "Set PI_OTEL_EXPORTER=file to write .pi/traces.jsonl, or point OTEL_EXPORTER_OTLP_ENDPOINT at a collector."
    );
  }
  // OTel 2.x removed the BatchSpanProcessor onExport hook; wrap the exporter
  // to surface the first export failure instead of silently dropping spans.
  let warnedExportFailure = false;
  const target = config.exporter === "file" ? config.filePath : config.endpoint;
  const wrappedExport = exporter.export.bind(exporter);
  exporter.export = (spans, resultCallback) => {
    wrappedExport(spans, (result) => {
      if (result?.error && !warnedExportFailure) {
        warnedExportFailure = true;
        console.warn(
          `[pi-otel] Trace export failed (${config.exporter} -> ${target}): ` +
            `${(result.error as Error)?.message ?? result.error}. Further failures suppressed.`
        );
      }
      resultCallback(result);
    });
  };
  const processor = config.exporter === "memory"
    ? new SimpleSpanProcessor(exporter)
    : new BatchSpanProcessor(exporter, {
        maxQueueSize: 2048,
        scheduledDelayMillis: 500,
      });

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
    }),
    spanProcessors: [processor],
  });

    provider.register();

  const tracer: Tracer = provider.getTracer("pi-otel", "0.1.0");

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

  return { tracer, provider, exporter, forceFlush, shutdown };
}
