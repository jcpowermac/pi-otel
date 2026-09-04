import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";

export function createConsoleExporter() {
  return new ConsoleSpanExporter();
}
