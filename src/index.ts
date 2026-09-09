import * as path from "node:path";
import { initTracer, resolveConfig } from "./tracer.js";
import { TraceContextManager } from "./context-manager.js";
import { FileSpanExporter } from "./exporters/file.js";
import type { PiOtelConfig } from "./types.js";

export interface ExtensionAPI {
  on(event: string, handler: (event: any, ctx: any) => Promise<any> | any): void;
}

export default function (pi: ExtensionAPI, configOverrides?: Partial<PiOtelConfig>) {
  const config = resolveConfig(configOverrides);
  if (config.disabled) {
    return;
  }

  const { tracer, provider, exporter, forceFlush, shutdown } = initTracer(config);
  const cm = new TraceContextManager(tracer);

  let currentSessionId: string | undefined;
  let currentCwd: string | undefined;

  pi.on("session_start", async (_event, ctx) => {
    try {
      if (ctx?.sessionId) currentSessionId = ctx.sessionId;
      if (ctx?.cwd) currentCwd = ctx.cwd;
    } catch (err) {
      console.warn("[pi-otel] Error in session_start:", err);
    }
  });

  pi.on("agent_start", async (_event, ctx) => {
    try {
      if (ctx?.sessionId) currentSessionId = ctx.sessionId;
      if (ctx?.cwd) currentCwd = ctx.cwd;
      // Default file path is per-session so concurrent sessions don't interleave;
      // an explicit PI_OTEL_FILE_PATH/override keeps a single shared file.
      if (
        config.exporter === "file" &&
        !configOverrides?.filePath &&
        !process.env.PI_OTEL_FILE_PATH &&
        currentSessionId &&
        exporter instanceof FileSpanExporter
      ) {
        exporter.setFilePath(path.join(".pi", `traces-${currentSessionId.slice(0, 8)}.jsonl`));
      }
      cm.startAgentRun(currentSessionId, currentCwd);
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
      const provider = event?.provider ?? event?.payload?.provider;
      cm.startChat(model, provider);
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
      let outputBytes: number | undefined;
      if (config.captureContent) {
        let contentStr = "";
        if (typeof event?.content === "string") {
          contentStr = event.content;
        } else if (Array.isArray(event?.content)) {
          contentStr = event.content
            .map((c: any) => c?.text ?? (typeof c === "string" ? c : ""))
            .join("");
        }
        outputBytes = Buffer.byteLength(contentStr, "utf8");
      }
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

  return { tracer, provider, exporter, forceFlush, shutdown, contextManager: cm };
}
