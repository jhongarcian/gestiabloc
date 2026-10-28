import { notFound } from "next/navigation"
import { AiFaqEditor } from "../../../_components/ai-faq-editor"
import { AiKnowledgeEditor } from "../../../_components/ai-knowledge-editor"
import { AiQualificationEditor } from "../../../_components/ai-qualification-editor"

export default async function AiSkillSectionPage({
  params,
}: {
  params: Promise<{ skillId: string; section: string }>
}) {
  const { skillId, section } = await params
  if (section === "faq") return <AiFaqEditor key={skillId} skillId={skillId} />
  if (section === "knowledge-base")
    return <AiKnowledgeEditor key={skillId} skillId={skillId} />
  if (section === "qualification-rules")
    return <AiQualificationEditor key={skillId} skillId={skillId} />
  notFound()
}
