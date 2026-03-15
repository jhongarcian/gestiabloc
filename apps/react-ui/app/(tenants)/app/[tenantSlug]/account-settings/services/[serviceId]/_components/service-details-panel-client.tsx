"use client"

import dynamic from "next/dynamic"

import type { ServiceDetailsPanelProps } from "../../../_components/service-details-panel"

const ServiceDetailsPanel = dynamic(
  () =>
    import("../../../_components/service-details-panel").then(
      (module) => module.ServiceDetailsPanel,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-[20px] border border-slate-200 bg-white p-5 text-sm text-slate-500">
        Loading service details...
      </div>
    ),
  },
)

export function ServiceDetailsPanelClient(props: ServiceDetailsPanelProps) {
  return <ServiceDetailsPanel {...props} />
}
