import { notFound } from "next/navigation"
import { AiSkillOverview } from "../../_components/ai-skills"
import { SAMPLE_SKILL_IDS } from "../../_lib/demo-data"

export default async function AiSkillPage({
  params,
}: {
  params: Promise<{ skillId: string }>
}) {
  const { skillId } = await params
  if (!SAMPLE_SKILL_IDS.includes(skillId)) notFound()
  return <AiSkillOverview skillId={skillId} />
}
