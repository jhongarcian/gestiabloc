"use client"

import { useState } from "react"
import { ExternalLink, Target, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { AddContactOpportunityDialog } from "../../../../opportunities/_components/add-contact-opportunity-dialog"
import { ContactOpportunityDetailDrawer } from "../../_components/contact-opportunity-detail-drawer"

type OpportunityRecord = {
  id: string
  pipelineId: string
  stageId: string
  valueCents: number
  result: "OPEN" | "WON" | "LOST"
  closedAt: string | null
  updatedAt: string
  pipeline: {
    id: string
    name: string
    color: string
  }
  stage: {
    id: string
    name: string
    sortOrder: number
  }
}

type ContactOpportunitiesPageContentProps = {
  tenantId: string
  tenantSlug: string
  contactId: string
  contact: {
    id: string
    fullName: string
    email: string | null
    phoneNumber: string | null
  }
  opportunities: OpportunityRecord[]
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

function formatUsdCents(valueCents: number) {
  return currencyFormatter.format(valueCents / 100)
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))
}

function ResultBadge({ result }: { result: "OPEN" | "WON" | "LOST" }) {
  const styles = {
    OPEN: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
    WON: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
    LOST: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" },
  }

  const style = styles[result]

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${style.bg} ${style.text} ${style.border} border`}
    >
      {result}
    </span>
  )
}

export function ContactOpportunitiesPageContent({
  tenantId,
  contact,
  opportunities,
}: ContactOpportunitiesPageContentProps) {
  const [selectedOpportunity, setSelectedOpportunity] = useState<OpportunityRecord | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  const openOpportunities = opportunities.filter((opp) => opp.result === "OPEN")
  const closedOpportunities = opportunities.filter((opp) => opp.result !== "OPEN")

  // Get unique stages from all opportunities for the drawer
  const stages = Array.from(
    new Map(
      opportunities.map((opp) => [opp.stage.id, { id: opp.stage.id, name: opp.stage.name }])
    ).values()
  )

  const handleViewDetail = (opportunity: OpportunityRecord) => {
    setSelectedOpportunity(opportunity)
    setIsDrawerOpen(true)
  }

  const handleDelete = async (opportunityId: string) => {
    try {
      await api.delete(`/api/opportunities/${tenantId}/${opportunityId}`)
      // Refresh the page to show updated data
      window.location.reload()
    } catch {
      // Error handled silently
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Contact Opportunities
            </p>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
                Pipeline opportunities
              </h1>
              <p className="text-sm text-slate-600">
                View and manage the opportunity pipelines this contact is enrolled in.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:self-center">
            <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm text-slate-600 shadow-sm">
              <span className="inline-flex items-center gap-2">
                <Target className="h-4 w-4 text-slate-500" />
                <span className="font-semibold text-slate-950">{openOpportunities.length}</span> active
              </span>
            </div>

            <AddContactOpportunityDialog
              tenantId={tenantId}
              initialContact={{
                id: contact.id,
                fullName: contact.fullName,
                email: contact.email,
                phoneNumber: contact.phoneNumber,
              }}
              lockContact
              triggerLabel="Add to pipeline"
            />
          </div>
        </div>
      </div>

      {opportunities.length > 0 ? (
        <div className="space-y-6">
          {/* Active Opportunities */}
          {openOpportunities.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-900">Active Opportunities</h2>
              <div className="space-y-3">
                {openOpportunities.map((opportunity) => (
                  <div
                    key={opportunity.id}
                    className="rounded-[20px] border border-slate-200 bg-white px-4 py-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="h-3 w-3 shrink-0 rounded-full border border-slate-200"
                            style={{ backgroundColor: opportunity.pipeline.color }}
                          />
                          <p className="truncate text-[15px] font-semibold text-slate-950">
                            {opportunity.pipeline.name}
                          </p>
                          <ResultBadge result={opportunity.result} />
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-slate-600">
                          <p>
                            <span className="font-medium text-slate-900">Stage:</span>{" "}
                            {opportunity.stage.name}
                          </p>
                          <p>
                            <span className="font-medium text-slate-900">Value:</span>{" "}
                            {formatUsdCents(opportunity.valueCents)}
                          </p>
                          <p>
                            <span className="font-medium text-slate-900">Updated:</span>{" "}
                            {formatDateTime(opportunity.updatedAt)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 border-slate-200 text-slate-700 hover:bg-slate-50"
                          onClick={() => handleViewDetail(opportunity)}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          View
                        </Button>
                        <DeleteOpportunityButton
                          opportunityId={opportunity.id}
                          onDelete={handleDelete}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Closed Opportunities */}
          {closedOpportunities.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-900">Closed Opportunities</h2>
              <div className="space-y-3">
                {closedOpportunities.map((opportunity) => (
                  <div
                    key={opportunity.id}
                    className="rounded-[20px] border border-slate-200 bg-slate-50/60 px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="h-3 w-3 shrink-0 rounded-full border border-slate-200"
                            style={{ backgroundColor: opportunity.pipeline.color }}
                          />
                          <p className="truncate text-[15px] font-semibold text-slate-700">
                            {opportunity.pipeline.name}
                          </p>
                          <ResultBadge result={opportunity.result} />
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-slate-500">
                          <p>
                            <span className="font-medium text-slate-700">Stage:</span>{" "}
                            {opportunity.stage.name}
                          </p>
                          <p>
                            <span className="font-medium text-slate-700">Value:</span>{" "}
                            {formatUsdCents(opportunity.valueCents)}
                          </p>
                          {opportunity.closedAt && (
                            <p>
                              <span className="font-medium text-slate-700">Closed:</span>{" "}
                              {formatDateTime(opportunity.closedAt)}
                            </p>
                          )}
                        </div>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 text-slate-500 hover:text-slate-700"
                        onClick={() => handleViewDetail(opportunity)}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        View
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50/70 px-6 py-16 text-center">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm">
            <Target className="h-5 w-5" />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-slate-950">
            No opportunities yet
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            This contact hasn&apos;t been enrolled in any opportunity pipelines.
          </p>
          <div className="mt-6">
            <AddContactOpportunityDialog
              tenantId={tenantId}
              initialContact={{
                id: contact.id,
                fullName: contact.fullName,
                email: contact.email,
                phoneNumber: contact.phoneNumber,
              }}
              lockContact
              triggerLabel="Add to pipeline"
            />
          </div>
        </div>
      )}

      <ContactOpportunityDetailDrawer
        opportunity={selectedOpportunity}
        stages={stages}
        open={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
      />
    </section>
  )
}

function DeleteOpportunityButton({
  opportunityId,
  onDelete,
}: {
  opportunityId: string
  onDelete: (id: string) => Promise<void>
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 gap-1.5 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
      onClick={() => void onDelete(opportunityId)}
    >
      <Trash2 className="h-3.5 w-3.5" />
      Remove
    </Button>
  )
}
