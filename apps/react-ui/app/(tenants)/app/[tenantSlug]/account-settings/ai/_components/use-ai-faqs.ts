"use client"
import { useCallback, useRef, useState } from "react"
import { isAxiosError } from "axios"
import { toast } from "sonner"
import { api } from "@/lib/api"
import type { AiFaqCollection, AiFaqInput } from "../_lib/content"
export function useAiFaqs(tenantId: string) {
  const [faqCollections, setCollections] = useState<
    Record<string, AiFaqCollection>
  >({})
  const [faqErrors, setErrors] = useState<Record<string, string>>({})
  const [faqConflicts, setConflicts] = useState<Record<string, boolean>>({})
  const [faqBusy, setBusy] = useState<string | null>(null)
  const [faqLoading, setLoading] = useState<Record<string, boolean>>({})
  const requests = useRef(new Set<string>())
  const write = useRef(false)
  const root = `/api/account-settings/${tenantId}/ai/skills`
  const loadFaqs = useCallback(
    async (id: string) => {
      if (requests.current.has(id)) return
      requests.current.add(id)
      setLoading((current) => ({ ...current, [id]: true }))
      try {
        const { data } = await api.get<AiFaqCollection>(`${root}/${id}/faqs`)
        setCollections((current) => ({ ...current, [id]: data }))
        setErrors((current) => ({ ...current, [id]: "" }))
      } catch {
        setErrors((current) => ({
          ...current,
          [id]: "Questions could not be loaded. Try again.",
        }))
      } finally {
        requests.current.delete(id)
        setLoading((current) => ({ ...current, [id]: false }))
      }
    },
    [root],
  )
  async function changeFaq(
    id: string,
    revision: string,
    change:
      | { action: "create"; faq: AiFaqInput; faqId?: string }
      | { action: "update"; faq: AiFaqInput; faqId?: string }
      | { action: "delete"; faqId: string }
      | { action: "order"; ids: string[] },
  ) {
    if (write.current || requests.current.has(id)) return false
    write.current = true
    setBusy(id)
    setErrors((current) => ({ ...current, [id]: "" }))
    try {
      const path = `${root}/${id}/faqs`
      const response =
        change.action === "create"
          ? await api.post<AiFaqCollection>(path, { revision, faq: change.faq })
          : change.action === "update"
            ? await api.patch<AiFaqCollection>(`${path}/${change.faqId}`, {
                revision,
                faq: change.faq,
              })
            : change.action === "delete"
              ? await api.delete<AiFaqCollection>(`${path}/${change.faqId}`, {
                  data: { revision },
                })
              : await api.put<AiFaqCollection>(`${path}/order`, {
                  revision,
                  ids: change.ids,
                })
      setCollections((current) => ({ ...current, [id]: response.data }))
      setConflicts((current) => ({ ...current, [id]: false }))
      toast.success(
        change.action === "delete"
          ? "Question removed."
          : change.action === "order"
            ? "Question order saved."
            : "Question saved.",
      )
      return true
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 409) {
        await loadFaqs(id)
        setConflicts((current) => ({ ...current, [id]: true }))
        setErrors((current) => ({
          ...current,
          [id]: "Questions were changed elsewhere. Your edits are still in this dialog. Review the latest saved questions before saving again.",
        }))
      } else {
        const details = isAxiosError(error)
          ? error.response?.data?.details
          : null
        setErrors((current) => ({
          ...current,
          [id]:
            typeof details === "string"
              ? details
              : "The question could not be saved. Your edits are still here. Try again.",
        }))
      }
      return false
    } finally {
      write.current = false
      setBusy(null)
    }
  }
  function clearFaqError(id: string) {
    setErrors((current) => ({ ...current, [id]: "" }))
    setConflicts((current) => ({ ...current, [id]: false }))
  }
  return {
    faqCollections,
    faqErrors,
    faqConflicts,
    faqBusy,
    faqLoading,
    loadFaqs,
    changeFaq,
    clearFaqError,
  }
}
