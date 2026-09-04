import * as fs from "node:fs";
import * as path from "node:path";
import type { SpanExporter, ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { PiOtelConfig } from "../types.js";

export class FileSpanExporter implements SpanExporter {
  private filePath: string;

  constructor(config: PiOtelConfig) {
    this.filePath = path.resolve(process.cwd(), config.filePath);
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    try {
      const lines = spans.map((span) =>
        JSON.stringify({
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
          name: span.name,
          kind: span.kind,
          startTime: span.startTime,
          endTime: span.endTime,
          duration: span.duration,
          attributes: span.attributes,
          status: span.status,
          events: span.events,
        })
      );
      fs.appendFileSync(this.filePath, lines.join("\n") + "\n", "utf8");
      resultCallback({ code: ExportResultCode.SUCCESS });
    } catch (err) {
      resultCallback({ code: ExportResultCode.FAILED, error: err as Error });
    }
  }

  async shutdown(): Promise<void> {}
}
