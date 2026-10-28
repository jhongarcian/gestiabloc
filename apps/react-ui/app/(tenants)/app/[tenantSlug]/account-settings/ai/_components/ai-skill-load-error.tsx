"use client"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { AiPageHeader, SECONDARY_BUTTON } from "./ai-ui"
import { useAiWorkspace } from "./ai-workspace"
export function AiSkillLoadError() {
  const router = useRouter()
  const { basePath } = useAiWorkspace()
  return (
    <>
      <AiPageHeader
        title="Skill unavailable"
        description="The sub-service could not be loaded."
      />
      <Alert className="rounded-2xl">
        <AlertTitle>Service information is unavailable</AlertTitle>
        <AlertDescription>
          Check your connection and try again. Existing service configuration
          has been preserved.
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className={SECONDARY_BUTTON} asChild>
              <Link href={`${basePath}/skills`}>Back to Skills</Link>
            </Button>
            <Button
              variant="outline"
              className={SECONDARY_BUTTON}
              onClick={() => router.refresh()}
            >
              Retry loading
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    </>
  )
}
