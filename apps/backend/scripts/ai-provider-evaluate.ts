import "dotenv/config"
import { writeFile } from "node:fs/promises"
import { buildAiEvaluationCases } from "../src/lib/ai-evaluation-cases.js"
import { runAiEvaluation } from "../src/lib/ai-evaluation.js"
import { aiModels, findAiModel, type AiProviderId } from "../src/lib/ai-model-catalog.js"
import { aiProviderAdapters } from "../src/lib/ai-provider-adapters.js"

async function main() {
  const args = process.argv.slice(2)
  const value = (key: string) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1] }
  const model = value("--model") ?? "openai/gpt-oss-120b"
  const provider = (value("--provider") ?? "groq") as AiProviderId
  const definition = findAiModel({ provider, model }), adapter = aiProviderAdapters[provider]
  if (!definition || !adapter) throw new Error("Unsupported evaluation model")
  const fixtures = buildAiEvaluationCases()
  if (!args.includes("--live")) {
    console.log(JSON.stringify({ dryRun: true, provider, model, policyVersion: definition.policyVersion, creditsPerReply: definition.creditsPerReply, availableModels: aiModels.map(m => ({ provider: m.provider, model: m.model })), cases: fixtures.length, categories: [...new Set(fixtures.map(f => f.category))], maxProviderBudgetUsd: 5 }))
    return
  }
  const apiKey = process.env[adapter.configuration.apiKeyEnv]?.trim()
  if (!apiKey) throw new Error("Provider credentials are required for live evaluation")
  // This standalone synthetic benchmark never accesses customer wallets. Its
  // budget and usage observer still apply; the parent app's settings are untouched.
  process.env.AI_CREDIT_ENFORCEMENT_ENABLED = "false"
  const report = await runAiEvaluation({ provider, apiKey, model, baseUrl: adapter.configuration.defaultUrl }, Number(value("--limit") ?? 100))
  const output = value("--output")
  if (output) await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 })
  const { rows, records, ...summary } = report
  console.log(JSON.stringify({ ...summary, completedCases: rows.length, passedCases: rows.filter(r => r.passed).length, recordedAttempts: records.filter(r => r.status !== "STARTED").length }))
  if (!report.complete || !report.qualityChecksPassed || !report.providerCostPassed) process.exitCode = 1
}
main().catch(() => { console.error("Evaluation failed; verify configuration and output location. No credentials or provider payloads are logged."); process.exitCode = 1 })
