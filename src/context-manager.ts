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
    if (this.agentSpan) {
      if (sessionId) this.agentSpan.setAttribute(AGENT_ATTRS.SESSION_ID, sessionId);
      if (cwd) this.agentSpan.setAttribute(AGENT_ATTRS.SESSION_CWD, cwd);
      return this.agentSpan;
    }
    const span = this.tracer.startSpan("agent_run", {
      attributes: {
        [AGENT_ATTRS.SESSION_ID]: sessionId ?? "unknown",
        [AGENT_ATTRS.SESSION_CWD]: cwd ?? process.cwd(),
      },
    });
    this.agentSpan = span;
    return span;
  }

  hasActiveAgentRun(): boolean {
    return this.agentSpan !== null;
  }

  endAgentRun(): void {
    if (this.chatSpan) {
      this.chatSpan.end();
      this.chatSpan = null;
    }
    if (this.turnSpan) {
      this.turnSpan.end();
      this.turnSpan = null;
    }
    for (const [, entry] of this.toolSpans) {
      entry.span.end();
    }
    this.toolSpans.clear();
    if (this.agentSpan) {
      this.agentSpan.end();
      this.agentSpan = null;
    }
  }

  startTurn(turnIndex: number): Span {
    if (this.turnSpan) {
      this.turnSpan.end();
    }
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
    if (this.chatSpan) {
      this.chatSpan.end();
      this.chatSpan = null;
    }
    if (this.turnSpan) {
      this.turnSpan.end();
      this.turnSpan = null;
    }
  }

  startChat(model?: string, system?: string): Span {
    if (this.chatSpan) {
      this.chatSpan.end();
    }
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
          [TOOL_ATTRS.IS_ERROR]: false,
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

  endToolExecution(callId: string, isError?: boolean): void {
    const entry = this.toolSpans.get(callId);
    if (!entry) return;

    const duration = Date.now() - entry.startTime;
    entry.span.setAttribute(TOOL_ATTRS.DURATION_MS, duration);
    if (isError !== undefined) {
      entry.span.setAttribute(TOOL_ATTRS.IS_ERROR, isError);
      if (isError) {
        entry.span.setStatus({ code: SpanStatusCode.ERROR });
      }
    }
    entry.span.end();
    this.toolSpans.delete(callId);
  }
}
