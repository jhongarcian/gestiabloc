import { isAxiosError } from "axios"
import { headers } from "next/headers"
import Link from "next/link"
import { redirect } from "next/navigation"

import { api, type MeResponse } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Layers3, Palette, Target } from "lucide-react"

import {
  OpportunityPipelineEditor,
  type OpportunityPipelineRecord,
} from "../../_components/opportunity-pipeline-editor"

type OpportunityPipelineDetailsResponse = {
  ok: boolean
  pipeline: OpportunityPipelineRecord
}

export default async function AccountSettingsOpportunityPipelinePage({
  params,
}: {
  params: Promise<{ tenantSlug: string; pipelineId: string }>
}) {
  const { tenantSlug, pipelineId } = await params

  let me: MeResponse["user"] | null = null
  const cookie = (await headers()).get("cookie") ?? ""

  try {
    const { data } = await api.get<MeResponse>("/api/auth/me", {
      headers: { cookie },
    })

    me = data?.user ?? null
  } catch {
    redirect("/login")
  }

  if (!me?.memberships?.length) {
    redirect("/login")
  }

  const membership = me.memberships.find((item) => item.tenant?.slug === tenantSlug)

  if (!membership?.tenant?.id) {
    redirect(`/app/${tenantSlug}`)
  }

  try {
    const { data } = await api.get<OpportunityPipelineDetailsResponse>(
      `/api/account-settings/${membership.tenant.id}/opportunities/${pipelineId}`,
      {
        headers: { cookie },
      },
    )

    return (
      <div className="flex h-full min-h-0 flex-col gap-4">
        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_46%,#fff7ed_100%)]">
          <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.3fr)_260px] lg:p-7">
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                  Opportunities Admin
                </p>
                <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-slate-950">
                  Edit the {data.pipeline.name} pipeline.
                </h2>
                <p className="max-w-2xl text-sm leading-6 text-slate-600">
                  Update the tenant-specific pipeline structure, adjust stage order, and keep the
                  opportunity flow aligned with your current sales process.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge
                  variant="secondary"
                  className="rounded-full border border-white/70 bg-white/85 px-3 py-1 text-slate-700"
                >
                  <Target className="mr-1.5 h-3.5 w-3.5" />
                  {data.pipeline.name}
                </Badge>
                <Badge
                  variant="secondary"
                  className="rounded-full border border-white/70 bg-white/85 px-3 py-1 text-slate-700"
                >
                  <Palette className="mr-1.5 h-3.5 w-3.5" />
                  {data.pipeline.color}
                </Badge>
              </div>
            </div>

            <div className="grid gap-3">
              <div className="rounded-[24px] border border-white/70 bg-white/85 p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Stages
                </p>
                <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
                  {data.pipeline.stages.length}
                </p>
              </div>
              <div className="rounded-[24px] border border-slate-300/60 bg-slate-950 p-4 text-white shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200/90">
                  Pipeline Theme
                </p>
                <p className="mt-2 text-3xl font-semibold tracking-tight">
                  <Layers3 className="inline-flex h-6 w-6" />
                </p>
                <p className="mt-2 text-xs text-slate-300">
                  Edit the stage flow and color theme from the form below
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 shadow-sm md:p-5">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold tracking-tight text-slate-950">
                Pipeline configuration
              </h3>
              <p className="text-sm text-slate-600">
                Change the pipeline name, stage list, and color theme for this tenant.
              </p>
            </div>

            <Button
              asChild
              type="button"
              variant="outline"
              className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
            >
              <Link href={`/app/${tenantSlug}/account-settings/opportunities`}>
                Back to pipelines
              </Link>
            </Button>
          </div>

          <OpportunityPipelineEditor
            tenantId={membership.tenant.id}
            initialPipeline={data.pipeline}
          />
        </section>
      </div>
    )
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) {
      redirect(`/app/${tenantSlug}/account-settings/opportunities`)
    }

    redirect(`/app/${tenantSlug}/account-settings/opportunities`)
  }
}
