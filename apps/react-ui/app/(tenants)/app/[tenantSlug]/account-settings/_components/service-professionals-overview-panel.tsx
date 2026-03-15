"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { isAxiosError } from "axios"
import { BriefcaseBusiness, UserRound, Users } from "lucide-react"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/lib/api"

type ServiceProfessionalSummaryResponse = {
  ok: boolean
  items: Array<{
    id: string
    serviceId: string
    serviceName: string
    kind: "INTERNAL_USER" | "EXTERNAL"
    name: string
  }>
}

type ServiceProfessionalsOverviewPanelProps = {
  tenantId: string
  tenantSlug: string
}

export function ServiceProfessionalsOverviewPanel({
  tenantId,
  tenantSlug,
}: ServiceProfessionalsOverviewPanelProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [rows, setRows] = useState<ServiceProfessionalSummaryResponse["items"]>([])

  const load = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const { data } = await api.get<ServiceProfessionalSummaryResponse>(
        `/api/account-settings/${tenantId}/service-professionals`,
      )
      setRows(data.items)
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        setErrorMessage(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not load professionals.",
        )
      } else {
        setErrorMessage("Could not load professionals.")
      }
      setRows([])
    } finally {
      setIsLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    void load()
  }, [load])

  const servicesCount = useMemo(
    () => new Set(rows.map((row) => row.serviceId)).size,
    [rows],
  )

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_45%,#fff7ed_100%)]">
        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.3fr)_360px] lg:p-7">
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                Professionals Directory
              </p>
              <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-slate-950">
                View professionals and their associated services.
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">
                Open the related service to configure checklist, professionals, and follow-up template steps.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Professionals</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{rows.length}</p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Services</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{servicesCount}</p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">External</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">
                  {rows.filter((row) => row.kind === "EXTERNAL").length}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-[24px] border border-slate-300/60 bg-slate-950 p-5 text-white shadow-sm">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/90">How to configure</p>
              <p className="text-sm leading-6 text-slate-300">
                This tab is read-only. Open a service to edit professionals and follow-up templates.
              </p>
            </div>
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
              Use Services and then open the service detail view for configuration.
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-5">
          <h3 className="text-xl font-semibold text-slate-950">Professionals</h3>
          <p className="text-sm text-slate-500">Number, professional name, and associated service.</p>
        </div>

        <div className="min-h-0 overflow-auto px-4 py-4 md:px-5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">#</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Service associated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-slate-500">
                    Loading professionals...
                  </TableCell>
                </TableRow>
              ) : errorMessage ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-rose-600">
                    {errorMessage}
                  </TableCell>
                </TableRow>
              ) : rows.length ? (
                rows.map((row, index) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-slate-600">{index + 1}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-2 font-medium text-slate-900">
                        {row.kind === "EXTERNAL" ? (
                          <BriefcaseBusiness className="h-4 w-4 text-amber-600" />
                        ) : (
                          <UserRound className="h-4 w-4 text-blue-600" />
                        )}
                        {row.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/app/${tenantSlug}/account-settings/services/${row.serviceId}`}
                        className="text-blue-700 hover:underline"
                      >
                        {row.serviceName}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-slate-500">
                    No professionals configured yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-slate-700">
          <Users className="h-4 w-4" />
          <p className="text-sm">Configure professionals directly inside each service detail view.</p>
        </div>
      </section>
    </div>
  )
}
