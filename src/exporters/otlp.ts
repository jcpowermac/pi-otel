import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import type { PiOtelConfig } from "../types.js";

// OTEL_EXPORTER_OTLP_HEADERS: comma-separated key=value pairs (OTel spec).
export function parseHeaders(raw?: string): Record<string, string> | undefined {
  if (!raw) return undefined;
  const out: Record<string, string> = {};
  for (const part of raw.split(",")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function createOtlpExporter(config: PiOtelConfig) {
  const headers = parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);
  return new OTLPTraceExporter({
    url: config.endpoint,
    ...(headers ? { headers } : {}),
  });
}
