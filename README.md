# pi-otel

OpenTelemetry (OTel) instrumentation extension for the [Pi coding agent](https://github.com/earendil-works/pi-coding-agent).

`pi-otel` instruments Pi's internal execution loop—agent sessions, interactive turns, LLM model requests, tool executions, and subagents—**with zero external reverse proxy required**.

---

## Architecture

Pi has native in-process extension lifecycle hooks (`agent_start/end`, `turn_start/end`, `before_provider_request`, `message_end`, `tool_execution_start/end`). `pi-otel` hooks directly into these events to construct hierarchical distributed traces conforming to OpenTelemetry GenAI semantic conventions:

```text
[Trace: agent_run (agent_start -> agent_end)]
   │
   ├─ [Span: turn_0 (turn_start -> turn_end)]
   │     │
   │     ├─ [Span: gen_ai.chat (before_provider_request -> message_end)]
   │     │     ├─ gen_ai.system: "anthropic" / "openai" / "google"
   │     │     ├─ gen_ai.request.model: "claude-3-7-sonnet"
   │     │     ├─ gen_ai.usage.input_tokens: 1420
   │     │     └─ gen_ai.usage.output_tokens: 85
   │     │
   │     ├─ [Span: tool:bash (tool_execution_start -> tool_execution_end)]
   │     │     ├─ tool.name: "bash"
   │     │     ├─ tool.call_id: "call_abc123"
   │     │     ├─ tool.duration_ms: 42
   │     │     └─ tool.is_error: false
   │     │
   │     └─ [Span: tool:read (tool_execution_start -> tool_execution_end)]
   │           ├─ tool.name: "read"
   │           ├─ tool.call_id: "call_def456"
   │           └─ tool.duration_ms: 12
   │
   └─ [Span: turn_1 (turn_start -> turn_end)]
         └─ ...
```

---

## Features

- **Waterfall Flamegraphs**: Pinpoint exactly how much time is spent on LLM time-to-first-token vs. tool executions (e.g. bash commands, file edits, git operations).
- **GenAI Semantic Conventions**: Standardized attributes (`gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read_tokens`).
- **Tool Profiling**: Captures tool duration, error status, output byte sizes, and optional arguments.
- **Multiple Exporters**:
  - `otlp`: Standard OTLP/HTTP exporter compatible with Jaeger, Langfuse, Arize Phoenix, SigNoz, OpenLIT, or an OTel Collector.
  - `file`: Appends JSON-formatted spans to a local file (`.pi/traces.jsonl`) for offline analysis.
  - `console`: Pretty-prints completed spans to stdout/stderr.
- **Non-Interference**: Defensive error boundaries ensure telemetry never crashes or interrupts your Pi coding session.

---

## Installation

### Permanent Installation (User or Project)
Install directly into Pi using Pi's package manager:

```bash
# Global user installation
pi install ~/Development/pi-otel

# Or project-local installation (-l)
pi install -l ~/Development/pi-otel
```

### Ad-Hoc / Testing
Load the extension for a single session:

```bash
pi -e ~/Development/pi-otel
```

---

## Configuration

Configure `pi-otel` using standard OpenTelemetry and Pi environment variables:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PI_OTEL_EXPORTER` | `otlp` | Active exporter (legacy single value): `otlp`, `file`, `console` | `memory` |
| `PI_OTEL_EXPORTERS` | — | Comma-separated list of exporters, one span processor each, e.g. `otlp,file` (wins over `PI_OTEL_EXPORTER`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318/v1/traces` | OTLP HTTP receiver endpoint |
| `OTEL_SERVICE_NAME` | `pi-coding-agent` | Service name in exported traces |
| `PI_OTEL_FILE_PATH` | `.pi/traces.jsonl` | Output file path when using `file` exporter |
| `PI_OTEL_DISABLED` | `false` | Set to `true` or `1` to disable telemetry |
| `PI_OTEL_CAPTURE_CONTENT` | `false` | Set to `true` to capture tool parameters and output sizes |

---

## Quickstart Examples

### 1. Local File Export (No Collector Required)
Export traces directly to `.pi/traces.jsonl`:

```bash
export PI_OTEL_EXPORTER=file
export PI_OTEL_FILE_PATH=.pi/traces.jsonl

pi -e ~/Development/pi-otel "List files in src/ and check tests"
```

### 2. Export to Jaeger via OTLP
Run Jaeger with OTLP receiver enabled:

```bash
docker run -d --name jaeger \
  -e COLLECTOR_OTLP_ENABLED=true \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

Then run Pi:
```bash
export PI_OTEL_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces

pi -e ~/Development/pi-otel
```
Open `http://localhost:16686` in your browser to view the trace waterfall.

### 3. Export to Langfuse
```bash
export PI_OTEL_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_ENDPOINT=https://cloud.langfuse.com/api/public/otel/v1/traces
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic <base64-keys>"

pi -e ~/Development/pi-otel
```

---

## Development & Testing

### Build
```bash
npm install
npm run build
```

### Run Tests
```bash
npm test
```

---

## License

MIT
