export type ExporterKind = "otlp" | "file" | "console" | "memory";

export interface PiOtelConfig {
  disabled: boolean;
  exporter: ExporterKind;
  endpoint: string;
  serviceName: string;
  filePath: string;
  captureContent: boolean;
}
