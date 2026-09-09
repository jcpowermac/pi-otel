export const PI_OTEL_ENV_KEYS = [
  "PI_OTEL_EXPORTER",
  "PI_OTEL_DISABLED",
  "PI_OTEL_FILE_PATH",
  "PI_OTEL_CAPTURE_CONTENT",
  "OTEL_SERVICE_NAME",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
];

// Run fn with pi-otel env vars scrubbed (saved and restored around it),
// so tests are hermetic regardless of the surrounding shell.
export async function withCleanEnv<T>(fn: () => T | Promise<T>): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const k of PI_OTEL_ENV_KEYS) {
    saved.set(k, process.env[k]);
    delete process.env[k];
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
