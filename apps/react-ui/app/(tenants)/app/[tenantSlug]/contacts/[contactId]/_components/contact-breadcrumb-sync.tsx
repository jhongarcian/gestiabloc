"use client"

import { useEffect } from "react"

export function ContactBreadcrumbSync({ label }: { label: string }) {
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("contact-breadcrumb-updated", {
        detail: { label },
      }),
    )

    return () => {
      window.dispatchEvent(
        new CustomEvent("contact-breadcrumb-updated", {
          detail: { label: null },
        }),
      )
    }
  }, [label])

  return null
}
