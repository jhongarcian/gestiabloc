import assert from "node:assert/strict"
import { test } from "node:test"
import { aiModels, aiModelCost, approvedAiModels, findAiModel, isAiModelApproved, modelApprovalKey, modelKey } from "./ai-model-catalog.js"
import { getAiConfiguration } from "./ai-provider-config.js"
import { getBillingConfiguration } from "./billing-config.js"
import { creditTestEnv } from "./ai-credit-execution.test-fixtures.js"

test("model policies have independent prices, budgets and credit costs", () => {
  assert.equal(new Set(aiModels.map(modelKey)).size, aiModels.length)
  const standard = findAiModel("openai/gpt-oss-120b")!, cheaper = findAiModel("openai/gpt-oss-20b")!, qwen = findAiModel("qwen/qwen3.8-27b")!
  assert.equal(aiModelCost(standard, 6000, 1800), "0.001980000")
  assert.equal(aiModelCost(cheaper, 6000, 1800), "0.000990000")
  assert.equal(aiModelCost(qwen, 6000, 1800), "0.012000000")
  assert.equal(standard.creditsPerReply, 1); assert.equal(qwen.creditsPerReply, 12)
  assert.equal(aiModelCost(qwen, qwen.maxInputTokens, qwen.maxOutputTokens), "0.026400000")
  assert.equal(findAiModel({ provider: "openai", model: standard.model }), undefined)
  assert.equal(aiModelCost(undefined, 10, 10), null)
  assert.throws(() => aiModelCost(standard, 2, 1, 3), /Invalid/)
})
test("approval is specific to provider, model and pricing policy; the legacy flag approves only its original model", () => {
  const original = findAiModel("openai/gpt-oss-120b")!, other = findAiModel("openai/gpt-oss-20b")!
  assert.equal(isAiModelApproved(original, { AI_CREDIT_MODEL_GATE_PASSED: "true" }), true)
  assert.equal(isAiModelApproved(other, { AI_CREDIT_MODEL_GATE_PASSED: "true" }), false)
  assert.equal(isAiModelApproved({ ...original, policyVersion: "v2" }, { AI_CREDIT_MODEL_GATE_PASSED: "true" }), false)
  const env = { AI_CREDIT_APPROVED_MODELS: modelApprovalKey(other) }
  assert.equal(isAiModelApproved(other, env), true); assert.equal(isAiModelApproved(original, env), false)
  for (const invalid of ["groq:unknown@v1", `${modelKey(other)}@v2`, `openai:${other.model}@v1`])
    assert.throws(() => approvedAiModels({ AI_CREDIT_APPROVED_MODELS: invalid }), /Unknown/)
  assert.throws(() => getBillingConfiguration({ ...creditTestEnv, AI_CREDIT_APPROVED_MODELS: "unknown" }))
  assert.equal(getBillingConfiguration({ ...creditTestEnv, AI_CREDIT_MODEL_GATE_PASSED: "false", ...env }).creditEnforcementEnabled, true)
})
test("generic selection preserves the existing model and can select another catalog entry without wallet changes", () => {
  const env = { SERVICE_FIT_AI_PROVIDER: "groq", GROQ_API_KEY: "fixture", GROQ_MODEL: "qwen/qwen3.8-27b" }
  assert.equal(getAiConfiguration(env)?.model, env.GROQ_MODEL)
  const model = findAiModel("openai/gpt-oss-20b")!
  const selected = { ...env, AI_MODEL: model.model, AI_CREDIT_APPROVED_MODELS: modelApprovalKey(model) }
  assert.equal(getAiConfiguration(selected)?.model, model.model)
  assert.equal(getAiConfiguration({ ...selected, AI_CREDIT_APPROVED_MODELS: "" }), null)
  assert.equal(getAiConfiguration({ ...env, AI_CREDIT_ENFORCEMENT_ENABLED: "true" }), null)
  assert.equal(getAiConfiguration({ ...env, SERVICE_FIT_AI_PROVIDER: "anthropic" }), null)
  assert.throws(() => getBillingConfiguration({ ...creditTestEnv, ...env }), /selected AI model/)
})
