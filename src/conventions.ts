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
  OUTPUT: "tool.output",
} as const;

export const AGENT_ATTRS = {
  SESSION_ID: "session.id",
  SESSION_CWD: "session.cwd",
  TURN_INDEX: "pi.turn_index",
} as const;
