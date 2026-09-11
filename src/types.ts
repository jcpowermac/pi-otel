export type ExporterKind = "otlp" | "file" | "console" | "memory";

export interface PiOtelConfig {
  disabled: boolean;
  /** Primary exporter (first in `exporters`); kept for backward compat. */
  exporter: ExporterKind;
  /** One span processor per entry. */
  exporters: ExporterKind[];
  endpoint: string;
  /** OTLP request headers (e.g. { "Authorization": "Bearer ..." }). */
  headers?: Record<string, string>;
  serviceName: string;
  filePath: string;
  captureContent: boolean;
}
