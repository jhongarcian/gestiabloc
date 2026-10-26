import { AiSkillOverview } from "../../_components/ai-skills"

export default async function AiSkillPage({
  params,
}: {
  params: Promise<{ skillId: string }>
}) {
  const { skillId } = await params
  return <AiSkillOverview skillId={skillId} />
}
