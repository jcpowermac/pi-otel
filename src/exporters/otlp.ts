import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import type { PiOtelConfig } from "../types.js";

export function createOtlpExporter(config: PiOtelConfig) {
  const headers =
    config.headers && Object.keys(config.headers).length > 0 ? config.headers : undefined;
  return new OTLPTraceExporter({
    url: config.endpoint,
    ...(headers ? { headers } : {}),
  });
}
