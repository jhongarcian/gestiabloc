export type AiTestReply = {
  id: string
  answer: string
  answerMode?: "ADAPTED" | "EXACT" | "TRANSLATED"
  helper: { name: string; language: string; tone: string; revision: number }
  sources: Array<{
    id: string
    label: string
    section: string
    skillId: string | null
    excerpt: string
    faqId?: string
  }>
  context: { skillCount: number; limited: boolean }
}
export type AiTestTurn = { question: string; reply: AiTestReply }
export function chatHistory(turns: AiTestTurn[]) {
  const selected: AiTestTurn[] = []
  let size = 0
  for (const turn of turns.slice(-6).reverse()) {
    if (size + turn.question.length + turn.reply.answer.length > 12000) break
    selected.unshift(turn)
    size += turn.question.length + turn.reply.answer.length
  }
  return selected.flatMap((turn) => [
    { role: "user" as const, content: turn.question },
    { role: "assistant" as const, content: turn.reply.answer },
  ])
}
