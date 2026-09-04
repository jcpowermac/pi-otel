import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import type { PiOtelConfig } from "../types.js";
import { createOtlpExporter } from "./otlp.js";
import { createConsoleExporter } from "./console.js";
import { FileSpanExporter } from "./file.js";

export { FileSpanExporter } from "./file.js";
export { createOtlpExporter } from "./otlp.js";
export { createConsoleExporter } from "./console.js";

export function createSpanExporter(config: PiOtelConfig): SpanExporter {
  switch (config.exporter) {
    case "memory":
      return new InMemorySpanExporter();
    case "console":
      return createConsoleExporter();
    case "file":
      return new FileSpanExporter(config);
    case "otlp":
    default:
      return createOtlpExporter(config);
  }
}
