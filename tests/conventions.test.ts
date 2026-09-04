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
