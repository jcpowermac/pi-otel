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

Configure `pi-otel` in `~/.pi/agent/pi-learner.json` (the `otel` section; the
file is shared with `pi-learner`, whose settings live in the `learner` section).
The config directory follows `PI_CODING_AGENT_DIR` when set.

| Key (`otel.*`) | Default | Description |
| :--- | :--- | :--- |
| `disabled` | `false` | Set to `true` to disable telemetry |
| `exporters` | `["otlp"]` | List of exporters, one span processor each: `otlp`, `file`, `console`, `memory` (a comma-separated string is also accepted) |
| `endpoint` | `http://localhost:4318/v1/traces` | OTLP HTTP receiver endpoint (a collector base URL is also accepted) |
| `headers` | — | OTLP request headers, e.g. `{ "Authorization": "Basic <base64-keys>" }` |
| `serviceName` | `pi-coding-agent` | Service name in exported traces |
| `filePath` | `.pi/traces.jsonl` (per-session `traces-<id>.jsonl` when unset) | Output file path when using the `file` exporter |
| `captureContent` | `false` | Set to `true` to capture tool parameters and output sizes |

---

## Quickstart Examples

### 1. Local File Export (No Collector Required)

```json
{ "otel": { "exporters": ["file"] } }
```

Write to `~/.pi/agent/pi-learner.json`, then run Pi:

```bash
pi -e ~/Development/pi-otel "List files in src/ and check tests"
```

Traces are written to `.pi/traces-<session>.jsonl` in the current directory
(one file per session unless `otel.filePath` is set).

### 2. Export to Jaeger via OTLP
Run Jaeger with OTLP receiver enabled:

```bash
docker run -d --name jaeger \
  -e COLLECTOR_OTLP_ENABLED=true \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

Then configure:

```json
{ "otel": { "exporters": ["otlp"], "endpoint": "http://localhost:4318/v1/traces" } }
```

Open `http://localhost:16686` in your browser to view the trace waterfall.

### 3. Export to Langfuse

```json
{
  "otel": {
    "exporters": ["otlp"],
    "endpoint": "https://cloud.langfuse.com/api/public/otel/v1/traces",
    "headers": { "Authorization": "Basic <base64-keys>" }
  }
}
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
