import "dotenv/config"
import { writeFile } from "node:fs/promises"
import { buildAiEvaluationCases } from "../src/lib/ai-evaluation-cases.js"
import { runAiEvaluation } from "../src/lib/ai-evaluation.js"

async function main() {
  const args = process.argv.slice(2)
  const value = (key: string) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1] }
  const model = value("--model") ?? "openai/gpt-oss-120b"
  if (!["openai/gpt-oss-120b", "qwen/qwen3.8-27b"].includes(model)) throw new Error("Unsupported evaluation model")
  const fixtures = buildAiEvaluationCases()
  if (!args.includes("--live")) {
    console.log(JSON.stringify({ dryRun: true, model, cases: fixtures.length, categories: [...new Set(fixtures.map(f => f.category))], maxProviderBudgetUsd: 5 }))
    return
  }
  const apiKey = process.env.GROQ_API_KEY?.trim()
  if (!apiKey) throw new Error("GROQ_API_KEY is required for live evaluation")
  const report = await runAiEvaluation({ apiKey, model, baseUrl: "https://api.groq.com/openai/v1/chat/completions" }, Number(value("--limit") ?? 100))
  const output = value("--output")
  if (output) await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 })
  const { rows, records, ...summary } = report
  console.log(JSON.stringify({ ...summary, completedCases: rows.length, passedCases: rows.filter(r => r.passed).length, recordedAttempts: records.filter(r => r.status !== "STARTED").length }))
  if (!report.complete || !report.qualityChecksPassed || !report.providerCostPassed) process.exitCode = 1
}
main().catch(() => { console.error("Evaluation failed; verify configuration and output location. No credentials or provider payloads are logged."); process.exitCode = 1 })
