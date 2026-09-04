import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import type { PiOtelConfig } from "../types.js";

export function createOtlpExporter(config: PiOtelConfig) {
  return new OTLPTraceExporter({
    url: config.endpoint,
  });
}
