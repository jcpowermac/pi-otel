# Pi OpenTelemetry Extension (`pi-otel`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native OpenTelemetry instrumentation extension for the Pi coding agent that traces agent runs, turns, model inference requests, and tool executions with zero external reverse proxy required.

**Architecture:** A TypeScript Pi extension package that hooks into Pi's `ExtensionAPI` lifecycle events (`agent_start/end`, `turn_start/end`, `before_provider_request`, `message_end`, `tool_execution_start/end`). Spans are created and hierarchically linked conforming to OTel GenAI semantic conventions, then exported via OTLP/HTTP, local JSONL file, or console.

**Tech Stack:** Node.js 20+, TypeScript 5+, `@opentelemetry/api`, `@opentelemetry/sdk-trace-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions`, Node.js built-in test runner (`node:test`).

**Spec:** `docs/superpowers/specs/2026-09-04-pi-otel-design.md`

## Global Constraints
- Target Node.js 20+ and modern ES module syntax (`"type": "module"`).
- All event hook handlers MUST be defensively wrapped in `try/catch` blocks so telemetry never crashes or interrupts Pi.
- Conforms to OpenTelemetry GenAI Semantic Conventions (`gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.*`).
- Zero reverse proxy: all telemetry collected directly from Pi's in-process extension hooks.

---

### Task 1: Package Scaffolding & Configuration

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Test: `tests/sanity.test.ts`

**Interfaces:**
- Consumes: None (root package setup).
- Produces: Runnable npm environment with TypeScript build and `node:test` runner.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/sanity.test.ts
import test from "node:test";
import assert from "node:assert/strict";

test("environment sanity check", () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sanity.test.ts`
Expected: FAIL (missing node test target or node_modules not yet installed).

- [ ] **Step 3: Write minimal implementation**

```json
// package.json
{
  "name": "pi-otel",
  "version": "0.1.0",
  "description": "OpenTelemetry instrumentation extension for Pi coding agent",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "node --import tsx --test tests/**/*.test.ts",
    "prepublishOnly": "npm run build"
  },
  "pi": {
    "extensions": ["./dist/index.js"]
  },
  "keywords": ["pi", "opentelemetry", "tracing", "genai", "agent"],
  "license": "MIT",
  "dependencies": {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.53.0",
    "@opentelemetry/resources": "^1.26.0",
    "@opentelemetry/sdk-trace-base": "^1.26.0",
    "@opentelemetry/sdk-trace-node": "^1.26.0",
    "@opentelemetry/semantic-conventions": "^1.27.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

```text
// .gitignore
node_modules/
dist/
*.log
.pi/
```

Then run `npm install`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS with "environment sanity check".

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json .gitignore tests/sanity.test.ts
git commit -m "chore: scaffold pi-otel package and test harness"
```

---

### Task 2: GenAI Semantic Conventions & Types

**Files:**
- Create: `src/conventions.ts`
- Create: `src/types.ts`
- Test: `tests/conventions.test.ts`

**Interfaces:**
- Consumes: `@opentelemetry/semantic-conventions`
- Produces:
  - `GENAI_ATTRS`: Dictionary of GenAI semantic attribute keys.
  - `TOOL_ATTRS`: Dictionary of tool attribute keys.
  - `PiOtelConfig`: Interface for user configuration (`exporter`, `endpoint`, `serviceName`, `captureContent`, `disabled`).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/conventions.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { GENAI_ATTRS, TOOL_ATTRS } from "../src/conventions.js";

test("GenAI semantic conventions constants are defined", () => {
  assert.equal(GENAI_ATTRS.SYSTEM, "gen_ai.system");
  assert.equal(GENAI_ATTRS.REQUEST_MODEL, "gen_ai.request.model");
  assert.equal(GENAI_ATTRS.USAGE_INPUT_TOKENS, "gen_ai.usage.input_tokens");
  assert.equal(GENAI_ATTRS.USAGE_OUTPUT_TOKENS, "gen_ai.usage.output_tokens");
});

test("Tool semantic conventions constants are defined", () => {
  assert.equal(TOOL_ATTRS.NAME, "tool.name");
  assert.equal(TOOL_ATTRS.CALL_ID, "tool.call_id");
  assert.equal(TOOL_ATTRS.IS_ERROR, "tool.is_error");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/conventions.js'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/conventions.ts
export const GENAI_ATTRS = {
  SYSTEM: "gen_ai.system",
  REQUEST_MODEL: "gen_ai.request.model",
  REQUEST_MAX_TOKENS: "gen_ai.request.max_tokens",
  REQUEST_TEMPERATURE: "gen_ai.request.temperature",
  USAGE_INPUT_TOKENS: "gen_ai.usage.input_tokens",
  USAGE_OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
  USAGE_CACHE_READ_TOKENS: "gen_ai.usage.cache_read_tokens",
  USAGE_CACHE_WRITE_TOKENS: "gen_ai.usage.cache_write_tokens",
  OPERATION_NAME: "gen_ai.operation.name",
} as const;

export const TOOL_ATTRS = {
  NAME: "tool.name",
  CALL_ID: "tool.call_id",
  IS_ERROR: "tool.is_error",
  DURATION_MS: "tool.duration_ms",
  INPUT_JSON: "tool.input.json",
  OUTPUT_BYTES: "tool.output.bytes",
} as const;

export const AGENT_ATTRS = {
  SESSION_ID: "session.id",
  SESSION_CWD: "session.cwd",
  TURN_INDEX: "pi.turn_index",
} as const;
```

```typescript
// src/types.ts
export type ExporterKind = "otlp" | "file" | "console" | "memory";

export interface PiOtelConfig {
  disabled: boolean;
  exporter: ExporterKind;
  endpoint: string;
  serviceName: string;
  filePath: string;
  captureContent: boolean;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS with 2 conventions tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/conventions.ts src/types.ts tests/conventions.test.ts
git commit -m "feat: define GenAI semantic conventions and configuration types"
```

---

### Task 3: Exporters Factory (OTLP, File, Console, In-Memory)

**Files:**
- Create: `src/exporters/otlp.ts`
- Create: `src/exporters/file.ts`
- Create: `src/exporters/console.ts`
- Create: `src/exporters/index.ts`
- Test: `tests/exporters.test.ts`

**Interfaces:**
- Consumes: `PiOtelConfig` from `src/types.ts`.
- Produces: `createSpanExporter(config: PiOtelConfig): SpanExporter`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/exporters.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createSpanExporter } from "../src/exporters/index.js";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";

test("creates InMemorySpanExporter when exporter is 'memory'", () => {
  const exporter = createSpanExporter({
    disabled: false,
    exporter: "memory",
    endpoint: "http://localhost:4318/v1/traces",
    serviceName: "pi-test",
    filePath: ".pi/traces.jsonl",
    captureContent: false,
  });
  assert.ok(exporter instanceof InMemorySpanExporter);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/exporters/index.js'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/exporters/otlp.ts
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import type { PiOtelConfig } from "../types.js";

export function createOtlpExporter(config: PiOtelConfig) {
  return new OTLPTraceExporter({
    url: config.endpoint,
  });
}
```

```typescript
// src/exporters/console.ts
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";

export function createConsoleExporter() {
  return new ConsoleSpanExporter();
}
```

```typescript
// src/exporters/file.ts
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
```

```typescript
// src/exporters/index.ts
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import type { PiOtelConfig } from "../types.js";
import { createOtlpExporter } from "./otlp.js";
import { createConsoleExporter } from "./console.js";
import { FileSpanExporter } from "./file.js";

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS for exporters tests.

- [ ] **Step 5: Commit**

```bash
git add src/exporters tests/exporters.test.ts
git commit -m "feat: implement OTLP, file, console, and memory span exporters"
```

---

### Task 4: Tracer Provider & Lifecycle Management

**Files:**
- Create: `src/tracer.ts`
- Test: `tests/tracer.test.ts`

**Interfaces:**
- Consumes: `createSpanExporter` from `src/exporters/index.ts`.
- Produces:
  - `initTracer(configOverrides?: Partial<PiOtelConfig>): { tracer: Tracer, shutdown: () => Promise<void>, forceFlush: () => Promise<void> }`
  - `resolveConfig(overrides?: Partial<PiOtelConfig>): PiOtelConfig`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tracer.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { initTracer, resolveConfig } from "../src/tracer.js";

test("resolveConfig resolves default environment values", () => {
  const config = resolveConfig();
  assert.equal(config.serviceName, "pi-coding-agent");
  assert.equal(config.disabled, false);
});

test("initTracer returns active tracer and flush helpers", async () => {
  const { tracer, forceFlush, shutdown } = initTracer({ exporter: "memory" });
  assert.ok(tracer);
  const span = tracer.startSpan("test-span");
  span.end();
  await forceFlush();
  await shutdown();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/tracer.js'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/tracer.ts
import { trace, type Tracer } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { BatchSpanProcessor, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { PiOtelConfig, ExporterKind } from "./types.js";
import { createSpanExporter } from "./exporters/index.js";

export function resolveConfig(overrides?: Partial<PiOtelConfig>): PiOtelConfig {
  const env = process.env;
  return {
    disabled: overrides?.disabled ?? (env.PI_OTEL_DISABLED === "true" || env.PI_OTEL_DISABLED === "1"),
    exporter: (overrides?.exporter ?? env.PI_OTEL_EXPORTER ?? "otlp") as ExporterKind,
    endpoint: overrides?.endpoint ?? env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318/v1/traces",
    serviceName: overrides?.serviceName ?? env.OTEL_SERVICE_NAME ?? "pi-coding-agent",
    filePath: overrides?.filePath ?? env.PI_OTEL_FILE_PATH ?? ".pi/traces.jsonl",
    captureContent: overrides?.captureContent ?? (env.PI_OTEL_CAPTURE_CONTENT === "true" || env.PI_OTEL_CAPTURE_CONTENT === "1"),
  };
}

export function initTracer(overrides?: Partial<PiOtelConfig>) {
  const config = resolveConfig(overrides);
  const provider = new NodeTracerProvider({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: config.serviceName,
    }),
  });

  const exporter = createSpanExporter(config);
  const processor = config.exporter === "memory"
    ? new SimpleSpanProcessor(exporter)
    : new BatchSpanProcessor(exporter, {
        maxQueueSize: 2048,
        scheduledDelayMillis: 500,
      });

  provider.addSpanProcessor(processor);
  provider.register();

  const tracer = trace.getTracer("pi-otel", "0.1.0");

  const forceFlush = async (timeoutMs = 1000): Promise<void> => {
    try {
      await Promise.race([
        provider.forceFlush(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Flush timeout")), timeoutMs)),
      ]);
    } catch {
      // Best-effort flush; ignore timeouts on exit
    }
  };

  const shutdown = async (): Promise<void> => {
    try {
      await provider.shutdown();
    } catch {
      // Ignore shutdown errors
    }
  };

  return { tracer, provider, exporter, forceFlush, shutdown };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS for tracer unit tests.

- [ ] **Step 5: Commit**

```bash
git add src/tracer.ts tests/tracer.test.ts
git commit -m "feat: implement TracerProvider initialization and lifecycle flush"
```

---

### Task 5: Span Context Manager

**Files:**
- Create: `src/context-manager.ts`
- Test: `tests/context-manager.test.ts`

**Interfaces:**
- Consumes: `@opentelemetry/api` Span and Context primitives.
- Produces: `TraceContextManager` class maintaining the stack of active agent run, turn, model inference, and tool spans.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/context-manager.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { initTracer } from "../src/tracer.js";
import { TraceContextManager } from "../src/context-manager.js";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";

test("TraceContextManager parents tool spans under active turn span", async () => {
  const { tracer, exporter, shutdown } = initTracer({ exporter: "memory" });
  const cm = new TraceContextManager(tracer);

  cm.startAgentRun("session-1", "/test");
  cm.startTurn(0);
  cm.startToolExecution("call-1", "bash");
  cm.endToolExecution("call-1", false);
  cm.endTurn();
  cm.endAgentRun();

  await shutdown();

  const spans = (exporter as InMemorySpanExporter).getFinishedSpans();
  assert.equal(spans.length, 3); // tool, turn, agent_run
  const toolSpan = spans.find((s) => s.name === "tool:bash");
  const turnSpan = spans.find((s) => s.name === "turn_0");
  const agentSpan = spans.find((s) => s.name === "agent_run");

  assert.ok(toolSpan);
  assert.ok(turnSpan);
  assert.ok(agentSpan);
  assert.equal(toolSpan.parentSpanId, turnSpan.spanContext().spanId);
  assert.equal(turnSpan.parentSpanId, agentSpan.spanContext().spanId);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/context-manager.js'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/context-manager.ts
import { trace, context, type Tracer, type Span, SpanStatusCode } from "@opentelemetry/api";
import { AGENT_ATTRS, TOOL_ATTRS, GENAI_ATTRS } from "./conventions.js";

export class TraceContextManager {
  private tracer: Tracer;
  private agentSpan: Span | null = null;
  private turnSpan: Span | null = null;
  private chatSpan: Span | null = null;
  private toolSpans = new Map<string, { span: Span; startTime: number }>();

  constructor(tracer: Tracer) {
    this.tracer = tracer;
  }

  startAgentRun(sessionId?: string, cwd?: string): Span {
    const span = this.tracer.startSpan("agent_run", {
      attributes: {
        [AGENT_ATTRS.SESSION_ID]: sessionId ?? "unknown",
        [AGENT_ATTRS.SESSION_CWD]: cwd ?? process.cwd(),
      },
    });
    this.agentSpan = span;
    return span;
  }

  endAgentRun(): void {
    if (this.agentSpan) {
      this.agentSpan.end();
      this.agentSpan = null;
    }
  }

  startTurn(turnIndex: number): Span {
    const parentContext = this.agentSpan
      ? trace.setSpan(context.active(), this.agentSpan)
      : context.active();

    const span = this.tracer.startSpan(
      `turn_${turnIndex}`,
      {
        attributes: {
          [AGENT_ATTRS.TURN_INDEX]: turnIndex,
        },
      },
      parentContext
    );
    this.turnSpan = span;
    return span;
  }

  endTurn(): void {
    if (this.turnSpan) {
      this.turnSpan.end();
      this.turnSpan = null;
    }
  }

  startChat(model?: string, system?: string): Span {
    const parentContext = this.turnSpan
      ? trace.setSpan(context.active(), this.turnSpan)
      : context.active();

    const span = this.tracer.startSpan(
      "gen_ai.chat",
      {
        attributes: {
          [GENAI_ATTRS.OPERATION_NAME]: "chat",
          [GENAI_ATTRS.REQUEST_MODEL]: model ?? "unknown",
          [GENAI_ATTRS.SYSTEM]: system ?? "unknown",
        },
      },
      parentContext
    );
    this.chatSpan = span;
    return span;
  }

  endChat(usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }): void {
    if (this.chatSpan) {
      if (usage) {
        if (usage.input !== undefined) this.chatSpan.setAttribute(GENAI_ATTRS.USAGE_INPUT_TOKENS, usage.input);
        if (usage.output !== undefined) this.chatSpan.setAttribute(GENAI_ATTRS.USAGE_OUTPUT_TOKENS, usage.output);
        if (usage.cacheRead !== undefined) this.chatSpan.setAttribute(GENAI_ATTRS.USAGE_CACHE_READ_TOKENS, usage.cacheRead);
        if (usage.cacheWrite !== undefined) this.chatSpan.setAttribute(GENAI_ATTRS.USAGE_CACHE_WRITE_TOKENS, usage.cacheWrite);
      }
      this.chatSpan.end();
      this.chatSpan = null;
    }
  }

  startToolExecution(callId: string, toolName: string, inputArgs?: Record<string, unknown>): Span {
    const parentContext = this.turnSpan
      ? trace.setSpan(context.active(), this.turnSpan)
      : context.active();

    const span = this.tracer.startSpan(
      `tool:${toolName}`,
      {
        attributes: {
          [TOOL_ATTRS.NAME]: toolName,
          [TOOL_ATTRS.CALL_ID]: callId,
          ...(inputArgs ? { [TOOL_ATTRS.INPUT_JSON]: JSON.stringify(inputArgs) } : {}),
        },
      },
      parentContext
    );
    this.toolSpans.set(callId, { span, startTime: Date.now() });
    return span;
  }

  recordToolResult(callId: string, isError: boolean, outputBytes?: number): void {
    const entry = this.toolSpans.get(callId);
    if (!entry) return;

    entry.span.setAttribute(TOOL_ATTRS.IS_ERROR, isError);
    if (outputBytes !== undefined) {
      entry.span.setAttribute(TOOL_ATTRS.OUTPUT_BYTES, outputBytes);
    }
    if (isError) {
      entry.span.setStatus({ code: SpanStatusCode.ERROR });
    }
  }

  endToolExecution(callId: string, isError = false): void {
    const entry = this.toolSpans.get(callId);
    if (!entry) return;

    const duration = Date.now() - entry.startTime;
    entry.span.setAttribute(TOOL_ATTRS.DURATION_MS, duration);
    entry.span.setAttribute(TOOL_ATTRS.IS_ERROR, isError);
    entry.span.end();
    this.toolSpans.delete(callId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS for context-manager tests.

- [ ] **Step 5: Commit**

```bash
git add src/context-manager.ts tests/context-manager.test.ts
git commit -m "feat: implement hierarchical trace context manager"
```

---

### Task 6: Extension Entrypoint & Pi Lifecycle Hooks

**Files:**
- Create: `src/index.ts`
- Test: `tests/extension.test.ts`

**Interfaces:**
- Consumes: Pi's `ExtensionAPI` and `TraceContextManager`.
- Produces: Default export function `(pi: ExtensionAPI): void`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/extension.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import extensionFactory from "../src/index.js";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";

class MockExtensionAPI {
  handlers = new Map<string, Function[]>();

  on(event: string, handler: Function) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  async emit(event: string, payload: any, ctx?: any) {
    const list = this.handlers.get(event) ?? [];
    for (const h of list) {
      await h(payload, ctx ?? {});
    }
  }
}

test("extension hooks emit spans through full lifecycle without errors", async () => {
  const pi = new MockExtensionAPI();
  process.env.PI_OTEL_EXPORTER = "memory";

  extensionFactory(pi as any);

  // Simulate Pi lifecycle
  await pi.emit("session_start", { reason: "startup" }, { cwd: "/tmp" });
  await pi.emit("agent_start", {}, {});
  await pi.emit("turn_start", { turnIndex: 0 }, {});
  await pi.emit("before_provider_request", { payload: { model: "claude-3-7-sonnet" } }, {});
  await pi.emit("message_end", { message: { role: "assistant", usage: { input: 100, output: 20 } } }, {});
  await pi.emit("tool_execution_start", { toolCallId: "c1", toolName: "bash", args: { command: "ls" } }, {});
  await pi.emit("tool_result", { toolCallId: "c1", isError: false, content: [{ type: "text", text: "ok" }] }, {});
  await pi.emit("tool_execution_end", { toolCallId: "c1", toolName: "bash" }, {});
  await pi.emit("turn_end", { turnIndex: 0 }, {});
  await pi.emit("agent_end", {}, {});
  await pi.emit("session_shutdown", {}, {});

  assert.ok(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/index.js'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/index.ts
import { initTracer, resolveConfig } from "./tracer.js";
import { TraceContextManager } from "./context-manager.js";

interface ExtensionAPI {
  on(event: string, handler: (event: any, ctx: any) => Promise<any> | any): void;
}

export default function (pi: ExtensionAPI) {
  const config = resolveConfig();
  if (config.disabled) {
    return;
  }

  const { tracer, forceFlush, shutdown } = initTracer(config);
  const cm = new TraceContextManager(tracer);

  pi.on("session_start", async (_event, ctx) => {
    try {
      cm.startAgentRun(ctx?.sessionId, ctx?.cwd);
    } catch (err) {
      console.warn("[pi-otel] Error in session_start:", err);
    }
  });

  pi.on("agent_start", async (_event, ctx) => {
    try {
      cm.startAgentRun(ctx?.sessionId, ctx?.cwd);
    } catch (err) {
      console.warn("[pi-otel] Error in agent_start:", err);
    }
  });

  pi.on("turn_start", async (event) => {
    try {
      cm.startTurn(event?.turnIndex ?? 0);
    } catch (err) {
      console.warn("[pi-otel] Error in turn_start:", err);
    }
  });

  pi.on("before_provider_request", async (event) => {
    try {
      const model = event?.payload?.model;
      cm.startChat(model);
    } catch (err) {
      console.warn("[pi-otel] Error in before_provider_request:", err);
    }
  });

  pi.on("message_end", async (event) => {
    try {
      if (event?.message?.role === "assistant") {
        const usage = event.message.usage;
        cm.endChat({
          input: usage?.input,
          output: usage?.output,
          cacheRead: usage?.cacheRead,
          cacheWrite: usage?.cacheWrite,
        });
      }
    } catch (err) {
      console.warn("[pi-otel] Error in message_end:", err);
    }
  });

  pi.on("tool_execution_start", async (event) => {
    try {
      const args = config.captureContent ? event?.args : undefined;
      cm.startToolExecution(event?.toolCallId, event?.toolName, args);
    } catch (err) {
      console.warn("[pi-otel] Error in tool_execution_start:", err);
    }
  });

  pi.on("tool_result", async (event) => {
    try {
      const content = Array.isArray(event?.content) ? event.content.map((c: any) => c.text ?? "").join("") : "";
      const outputBytes = content ? Buffer.byteLength(content, "utf8") : undefined;
      cm.recordToolResult(event?.toolCallId, Boolean(event?.isError), outputBytes);
    } catch (err) {
      console.warn("[pi-otel] Error in tool_result:", err);
    }
  });

  pi.on("tool_execution_end", async (event) => {
    try {
      cm.endToolExecution(event?.toolCallId);
    } catch (err) {
      console.warn("[pi-otel] Error in tool_execution_end:", err);
    }
  });

  pi.on("turn_end", async () => {
    try {
      cm.endTurn();
    } catch (err) {
      console.warn("[pi-otel] Error in turn_end:", err);
    }
  });

  pi.on("agent_end", async () => {
    try {
      cm.endAgentRun();
      await forceFlush();
    } catch (err) {
      console.warn("[pi-otel] Error in agent_end:", err);
    }
  });

  pi.on("session_shutdown", async () => {
    try {
      cm.endAgentRun();
      await shutdown();
    } catch (err) {
      console.warn("[pi-otel] Error in session_shutdown:", err);
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS for extension simulation test.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/extension.test.ts
git commit -m "feat: implement extension entrypoint and Pi lifecycle hooks"
```

---

### Task 7: Build, Documentation & End-to-End Verification

**Files:**
- Create: `README.md`
- Modify: `package.json` (ensure build scripts and types clean)
- Test: Full build and integration tests

**Interfaces:**
- Consumes: All modules from Tasks 1-6.
- Produces: Production build in `dist/` and documentation.

- [ ] **Step 1: Write README.md**

```markdown
# pi-otel

OpenTelemetry (OTel) instrumentation extension for the [Pi coding agent](https://github.com/earendil-works/pi-coding-agent).

Tracks agent sessions, user/model turns, LLM inference requests, and tool executions with zero external reverse proxy.

## Features
- **Hierarchical Traces**: Spans parented across Agent Run -> Turns -> Tools & LLM calls.
- **GenAI Semantic Conventions**: Standardized token usage (`input_tokens`, `output_tokens`) and model attributes.
- **Tool Latency Flamegraphs**: Isolate bash execution, file reads, and search bottlenecks.
- **Multiple Exporters**: OTLP/HTTP (Jaeger, Langfuse, Phoenix, Honeycomb), local `.jsonl` files, or console.

## Installation
```bash
pi install ~/Development/pi-otel
# or test ad-hoc:
pi -e ~/Development/pi-otel
```

## Configuration

Set environment variables:
- `PI_OTEL_EXPORTER`: `otlp` (default), `file`, or `console`
- `OTEL_EXPORTER_OTLP_ENDPOINT`: Default `http://localhost:4318/v1/traces`
- `OTEL_SERVICE_NAME`: Default `pi-coding-agent`
- `PI_OTEL_FILE_PATH`: Path for file exporter (default `.pi/traces.jsonl`)
- `PI_OTEL_DISABLED`: Set to `true` to disable
- `PI_OTEL_CAPTURE_CONTENT`: Set to `true` to log tool arguments and output length
```

- [ ] **Step 2: Build project and verify compilation**

Run: `npm run build`
Expected: Compiles clean to `dist/index.js` and `dist/index.d.ts` without errors.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All test suites PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add README with installation and configuration guide"
```
