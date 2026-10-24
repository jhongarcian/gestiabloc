import { notFound } from "next/navigation"
import { AiFaqEditor } from "../../../_components/ai-faq-editor"
import { AiKnowledgeEditor } from "../../../_components/ai-knowledge-editor"
import { AiQualificationEditor } from "../../../_components/ai-qualification-editor"
import { SAMPLE_SKILL_IDS } from "../../../_lib/demo-data"

export default async function AiSkillSectionPage({
  params,
}: {
  params: Promise<{ skillId: string; section: string }>
}) {
  const { skillId, section } = await params
  if (!SAMPLE_SKILL_IDS.includes(skillId)) notFound()
  if (section === "faq") return <AiFaqEditor key={skillId} skillId={skillId} />
  if (section === "knowledge-base")
    return <AiKnowledgeEditor key={skillId} skillId={skillId} />
  if (section === "qualification-rules")
    return <AiQualificationEditor key={skillId} skillId={skillId} />
  notFound()
}
