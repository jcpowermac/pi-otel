# Pi OpenTelemetry Extension (`pi-otel`) Design Specification

**Date:** 2026-09-04  
**Status:** Approved  
**Repository:** `~/Development/pi-otel`

---

## 1. Overview & Goals

`pi-otel` is an OpenTelemetry (OTel) instrumentation extension for the [Pi coding agent](https://github.com/earendil-works/pi-coding-agent). It instruments Pi's internal execution loop—agent runs, interactive turns, model inference requests, tool executions, and subagents—without requiring an external network reverse proxy.

### Primary Goals
1. **Tool Performance & Bottleneck Analysis**: Deliver waterfall flamegraphs pinpointing latency across model inference vs. tool executions (e.g. bash commands, file I/O, search).
2. **GenAI Semantic Conventions**: Conform to OpenTelemetry GenAI semantic conventions (`gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.*`) and OpenInference standards for LLM agents.
3. **Multi-Turn Trace Hierarchy**: Map nested spans: Root Agent Run -> Turn -> Model Inference & Tool Executions.
4. **Flexible Exporters**: Support standard OTLP/HTTP export (for Jaeger, Langfuse, Arize Phoenix, Honeycomb, Datadog), local JSON lines file export (`.jsonl`), and console debugging.
5. **Zero Impact on Stability**: Never crash, throw, or add blocking overhead to Pi's interactive coding sessions.

### Non-Goals
- **Inference Proxying**: Does not run a reverse proxy or intercept network traffic outside of Pi.
- **Model Evaluation Engine**: Does not replace offline evaluation frameworks like MLflow; focuses on live runtime telemetry and trace data collection.

---

## 2. Architecture & Span Hierarchy

```text
[Trace: agent_run (agent_start -> agent_end)]
   │
   ├─ [Span: turn (turn_start -> turn_end)]
   │     │
   │     ├─ [Span: gen_ai.client.operation: chat]
   │     │     ├─ gen_ai.system: "anthropic" | "openai" | ...
   │     │     ├─ gen_ai.request.model: "claude-3-7-sonnet"
   │     │     ├─ gen_ai.usage.input_tokens: 1420
   │     │     └─ gen_ai.usage.output_tokens: 85
   │     │
   │     ├─ [Span: tool:bash (tool_execution_start -> tool_execution_end)]
   │     │     ├─ tool.name: "bash"
   │     │     ├─ tool.call_id: "call_abc123"
   │     │     ├─ tool.input.command: "git status"
   │     │     ├─ tool.is_error: false
   │     │     └─ tool.duration_ms: 42
   │     │
   │     └─ [Span: tool:read (tool_execution_start -> tool_execution_end)]
   │           ├─ tool.name: "read"
   │           ├─ tool.call_id: "call_def456"
   │           ├─ tool.input.path: "package.json"
   │           └─ tool.is_error: false
   │
   └─ [Span: turn (turn_start -> turn_end)]
         └─ ...
```

---

## 3. Package Structure

The repository is structured as a standard Pi extension package:

```text
pi-otel/
├── package.json               # Package config with "pi": { "extensions": ["./dist/index.js"] }
├── tsconfig.json              # TypeScript target Node 20+ (ES2022)
├── src/
│   ├── index.ts               # Extension entrypoint (registers Pi lifecycle hooks)
│   ├── tracer.ts              # TracerProvider setup and lifecycle management
│   ├── context-manager.ts     # In-memory active span hierarchy tracker
│   ├── conventions.ts         # GenAI & OpenInference attribute constants
│   ├── exporters/             # Exporter factories
│   │   ├── index.ts           # Exporter resolver
│   │   ├── otlp.ts            # OTLP/HTTP exporter factory
│   │   ├── console.ts         # Diagnostic console span exporter
│   │   └── file.ts            # Local JSONL file exporter
│   └── types.ts               # Configuration and event mapping types
├── tests/
│   ├── tracer.test.ts         # TracerProvider & exporter unit tests
│   ├── context-manager.test.ts# Span parenting & hierarchy tests
│   └── extension.test.ts      # End-to-end lifecycle simulation tests
├── README.md                  # Installation, configuration, and backend guides
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-09-04-pi-otel-design.md
```

---

## 4. Lifecycle Hook Mappings

Pi's `ExtensionAPI` events map to OpenTelemetry spans as follows:

| Pi Event | Trigger / Meaning | OpenTelemetry Action |
| :--- | :--- | :--- |
| `session_start` | Session initialized / loaded | Initializes `TracerProvider`, configures exporters |
| `agent_start` | Agent run begins | Starts root `agent_run` trace span with session metadata |
| `turn_start` | User/model turn begins | Starts child `turn` span under active agent run |
| `before_provider_request` | Model payload constructed | Starts `gen_ai.chat` span under active turn; injects `traceparent` |
| `message_end` | Assistant response finalized | Enriches `gen_ai.chat` span with token usage (`input_tokens`, `output_tokens`) and ends it |
| `tool_execution_start` | Tool call initiated | Starts child `tool:<toolName>` span under active turn |
| `tool_result` | Tool execution finished | Records `tool.is_error`, execution details, and partial output |
| `tool_execution_end` | Tool finalized | Ends the `tool:<toolName>` span |
| `turn_end` | Turn completed | Ends active `turn` span |
| `agent_end` | Agent run finished | Ends root `agent_run` span |
| `session_shutdown` | Process exit / session close | Flushes span processor (`forceFlush`) and tears down tracer |

---

## 5. Semantic Conventions & Attributes

### Agent Attributes (`agent_run` span)
- `session.id`: Pi session ID
- `session.cwd`: Project working directory
- `pi.version`: Pi coding agent version

### Turn Attributes (`turn` span)
- `pi.turn_index`: Integer turn sequence index

### Model Attributes (`gen_ai.chat` span)
- `gen_ai.system`: Provider identifier (`anthropic`, `openai`, `google`, `ollama`, etc.)
- `gen_ai.request.model`: Model pattern or ID
- `gen_ai.usage.input_tokens`: Prompt token count
- `gen_ai.usage.output_tokens`: Completion token count
- `gen_ai.usage.cache_read_tokens`: Cache read token count (when available)
- `gen_ai.usage.cache_write_tokens`: Cache write token count (when available)

### Tool Attributes (`tool:<name>` span)
- `tool.name`: Tool name (`bash`, `read`, `edit`, `write`, `subagent`, etc.)
- `tool.call_id`: Unique invocation ID
- `tool.is_error`: Boolean error flag
- `tool.duration_ms`: Execution time in milliseconds
- Optional (when `PI_OTEL_CAPTURE_CONTENT=true`):
  - `tool.parameters`: Serialized arguments
  - `tool.output.bytes`: Output byte length

---

## 6. Configuration & Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318/v1/traces` | OTLP HTTP receiver endpoint |
| `OTEL_SERVICE_NAME` | `pi-coding-agent` | OpenTelemetry service name |
| `PI_OTEL_EXPORTER` | `otlp` | Active exporter: `otlp`, `file`, `console` |
| `PI_OTEL_FILE_PATH` | `.pi/traces.jsonl` | File path for `file` exporter |
| `PI_OTEL_DISABLED` | `false` | When `true`, disables telemetry collection entirely |
| `PI_OTEL_CAPTURE_CONTENT` | `false` | When `true`, logs message contents and tool arguments |

---

## 7. Error Handling & Non-Interference

1. **Defensive Wrappers**: Every event listener is wrapped in `try/catch`. If telemetry initialization, span creation, or attribute extraction throws, it logs a warning via `console.warn` (or silent failure) and never interrupts the Pi session.
2. **Background Batching**: All spans use `BatchSpanProcessor` with non-blocking flushes.
3. **Shutdown Timeout**: `forceFlush()` during `session_shutdown` is capped at 1,000ms using an abort controller / timeout race to prevent hanging Pi exits.

---

## 8. Verification & Testing

1. **Unit Testing**:
   - Validate tracer initialization and custom configuration overrides.
   - Validate span context management (parallel tool calls parenting correctly under the active turn).
2. **Mock Integration Testing**:
   - Synthesize a complete agent turn using mock `ExtensionAPI` and verify spans exported to an in-memory exporter (`InMemorySpanExporter`).
3. **End-to-End Testing**:
   - Run a test session with `pi -e ~/Development/pi-otel` and `PI_OTEL_EXPORTER=file`, verifying generated `.jsonl` trace output.
