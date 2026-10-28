"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { isAxiosError } from "axios"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { sourceFileError, type AiSource } from "../_lib/sources"

type Upload = {
  requestId: string
  skillId: string
  file: File
  progress: number
  error: string
}
function sourceMessage(error: unknown) {
  if (isAxiosError(error)) {
    if (typeof error.response?.data?.details === "string")
      return error.response.data.details
    if (error.response?.status === 401)
      return "Your session expired. Sign in again to continue."
    if (error.response?.status === 403)
      return "You need account administrator access to manage sources."
    if (error.response?.status === 404)
      return "This source or sub-service is no longer available."
  }
  return "The request could not finish. Your edits are still here. Try again."
}
export function useAiSources(tenantId: string) {
  const [sourceCollections, setCollections] = useState<
    Record<string, AiSource[]>
  >({})
  const [sourceErrors, setErrors] = useState<Record<string, string>>({})
  const [sourceConflicts, setConflicts] = useState<Record<string, boolean>>({})
  const [sourceLoading, setLoading] = useState<Record<string, boolean>>({})
  const [sourceBusy, setBusy] = useState<string | null>(null)
  const [sourceUploads, setUploads] = useState<Record<string, Upload>>({})
  const [uploadingSource, setUploading] = useState<string | null>(null)
  const reads = useRef(new Set<string>()),
    write = useRef(false),
    uploadLock = useRef(false)
  const controllers = useRef(new Set<AbortController>())
  const sourceRoot = `/api/account-settings/${tenantId}/ai/skills`
  useEffect(() => {
    const current = controllers.current
    return () => {
      for (const controller of current) controller.abort()
    }
  }, [])
  const loadSources = useCallback(
    async (skillId: string, quiet = false) => {
      if (reads.current.has(skillId)) return
      reads.current.add(skillId)
      if (!quiet) setLoading((old) => ({ ...old, [skillId]: true }))
      try {
        const { data } = await api.get<{ sources: AiSource[] }>(
          `${sourceRoot}/${skillId}/sources`,
        )
        setCollections((old) => ({ ...old, [skillId]: data.sources }))
        if (!quiet) setErrors((old) => ({ ...old, [skillId]: "" }))
      } catch (error) {
        setErrors((old) => ({ ...old, [skillId]: sourceMessage(error) }))
      } finally {
        reads.current.delete(skillId)
        if (!quiet) setLoading((old) => ({ ...old, [skillId]: false }))
      }
    },
    [sourceRoot],
  )
  const store = (skillId: string, source: AiSource) =>
    setCollections((old) => ({
      ...old,
      [skillId]: (old[skillId] ?? []).some((item) => item.id === source.id)
        ? old[skillId].map((item) => (item.id === source.id ? source : item))
        : [...(old[skillId] ?? []), source],
    }))
  const clearSourceError = (skillId: string) => {
    setErrors((old) => ({ ...old, [skillId]: "" }))
    setConflicts((old) => ({ ...old, [skillId]: false }))
  }
  async function uploadSourceFile(
    skillId: string,
    file: File,
    requestId = crypto.randomUUID(),
  ) {
    if (uploadLock.current) return
    const invalid = sourceFileError(file)
    if (invalid) {
      setErrors((old) => ({ ...old, [skillId]: invalid }))
      return
    }
    uploadLock.current = true
    setUploading(requestId)
    const controller = new AbortController()
    controllers.current.add(controller)
    setUploads((old) => ({
      ...old,
      [requestId]: { requestId, skillId, file, progress: 0, error: "" },
    }))
    try {
      const body = new FormData()
      body.set("requestId", requestId)
      body.set("file", file)
      const { data } = await api.post<{ source: AiSource }>(
        `${sourceRoot}/${skillId}/sources/files`,
        body,
        {
          signal: controller.signal,
          timeout: 90_000,
          onUploadProgress: (event) =>
            setUploads((old) =>
              old[requestId]
                ? {
                    ...old,
                    [requestId]: {
                      ...old[requestId],
                      progress: event.total
                        ? Math.round((event.loaded / event.total) * 100)
                        : 0,
                    },
                  }
                : old,
            ),
        },
      )
      store(skillId, data.source)
      setUploads((old) => {
        const next = { ...old }
        delete next[requestId]
        return next
      })
      toast.success("File uploaded. Processing is queued.")
    } catch (error) {
      if (!controller.signal.aborted) {
        setUploads((old) => ({
          ...old,
          [requestId]: {
            requestId,
            skillId,
            file,
            progress: 0,
            error: sourceMessage(error),
          },
        }))
        await loadSources(skillId, true)
      }
    } finally {
      controllers.current.delete(controller)
      uploadLock.current = false
      setUploading(null)
    }
  }
  async function changeSource(
    skillId: string,
    change:
      | { action: "create"; requestId: string; label: string; url: string }
      | { action: "edit"; source: AiSource; label: string; url?: string }
      | { action: "retry" | "delete"; source: AiSource },
  ) {
    if (write.current) return false
    write.current = true
    setBusy(skillId)
    setErrors((old) => ({ ...old, [skillId]: "" }))
    try {
      const root = `${sourceRoot}/${skillId}/sources`
      if (change.action === "delete") {
        await api.delete(`${root}/${change.source.id}`, {
          data: { revision: change.source.revision },
        })
        setCollections((old) => ({
          ...old,
          [skillId]: (old[skillId] ?? []).filter(
            (item) => item.id !== change.source.id,
          ),
        }))
        toast.success("Source removed from helper knowledge.")
      } else {
        const { data } =
          change.action === "create"
            ? await api.post<{ source: AiSource }>(`${root}/links`, {
                requestId: change.requestId,
                label: change.label,
                url: change.url,
              })
            : change.action === "edit"
              ? await api.patch<{ source: AiSource }>(
                  `${root}/${change.source.id}`,
                  {
                    revision: change.source.revision,
                    label: change.label,
                    ...(change.url !== undefined ? { url: change.url } : {}),
                  },
                )
              : await api.post<{ source: AiSource }>(
                  `${root}/${change.source.id}/retry`,
                  { revision: change.source.revision },
                )
        store(skillId, data.source)
        toast.success(
          change.action === "edit"
            ? "Source saved."
            : "Source processing queued.",
        )
      }
      return true
    } catch (error) {
      if (
        isAxiosError(error) &&
        error.response?.data?.error === "AI_SOURCE_CONFLICT"
      ) {
        await loadSources(skillId, true)
        setConflicts((old) => ({ ...old, [skillId]: true }))
      }
      setErrors((old) => ({ ...old, [skillId]: sourceMessage(error) }))
      return false
    } finally {
      write.current = false
      setBusy(null)
    }
  }
  function dismissSourceUpload(requestId: string) {
    if (uploadLock.current) return
    setUploads((old) => {
      const next = { ...old }
      delete next[requestId]
      return next
    })
  }
  return {
    sourceCollections,
    sourceErrors,
    sourceConflicts,
    sourceLoading,
    sourceBusy,
    sourceUploads,
    uploadingSource,
    sourceRoot,
    loadSources,
    changeSource,
    clearSourceError,
    uploadSourceFile,
    dismissSourceUpload,
  }
}
