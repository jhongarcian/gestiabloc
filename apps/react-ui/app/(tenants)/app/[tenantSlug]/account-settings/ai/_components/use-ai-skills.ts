"use client"

import { useRef, useState } from "react"
import { isAxiosError } from "axios"
import { toast } from "sonner"
import { api } from "@/lib/api"
import type { AiSkillDraft } from "../_lib/demo-data"
import {
  qualificationDirty,
  knowledgeDirty,
  mergeSavedSkill,
  toSkillDraft,
  type AiSkillResponse,
  type AiSkillsResponse,
} from "../_lib/skills"
import { knowledgeInput, knowledgeValidation } from "../_lib/content"

function message(error: unknown) {
  if (isAxiosError(error)) {
    const details: unknown = error.response?.data?.details
    if (typeof details === "string") return details
    if (Array.isArray(details))
      return details
        .map((item) => item.message)
        .filter((value): value is string => typeof value === "string")
        .join(" ")
    if (error.response?.status === 404)
      return "This sub-service is no longer available. Return to Skills and refresh the gallery."
    if (error.response?.status === 403)
      return "You need account administrator access to manage these skills."
    if (error.response?.status === 401)
      return "Your session has expired. Sign in again to continue."
  }
  return "The request could not be completed. Your edits are still here. Try again."
}
export function useAiSkills(
  tenantId: string,
  initialCatalog: AiSkillsResponse | null,
) {
  const [skills, setSkills] = useState(
    () => initialCatalog?.skills.map(toSkillDraft) ?? [],
  )
  const [fields, setFields] = useState(initialCatalog?.fields ?? [])
  const [fieldsBySkill, setFieldsBySkill] = useState<
    Record<string, AiSkillResponse["fields"]>
  >({})
  const [catalogReady, setCatalogReady] = useState(Boolean(initialCatalog))
  const [catalogError, setCatalogError] = useState(
    initialCatalog ? "" : "Your service skills could not be loaded.",
  )
  const [catalogBusy, setCatalogBusy] = useState(false)
  const [savingSkillId, setSavingSkillId] = useState<string | null>(null)
  const [savingKnowledgeId, setSavingKnowledgeId] = useState<string | null>(
    null,
  )
  const [knowledgeErrors, setKnowledgeErrors] = useState<
    Record<string, string>
  >({})
  const [knowledgeConflicts, setKnowledgeConflicts] = useState<
    Record<string, AiSkillResponse>
  >({})
  const [skillErrors, setSkillErrors] = useState<Record<string, string>>({})
  const [skillConflicts, setSkillConflicts] = useState<
    Record<string, AiSkillResponse>
  >({})
  const lock = useRef(false)
  const path = `/api/account-settings/${tenantId}/ai/skills`
  function updateSkill(
    id: string,
    update: (skill: AiSkillDraft) => AiSkillDraft,
    fallback?: AiSkillDraft,
  ) {
    if (lock.current) return
    setSkills((current) => {
      const existing = current.find((skill) => skill.id === id) ?? fallback
      if (!existing) return current
      const next = update(existing)
      return current.some((skill) => skill.id === id)
        ? current.map((skill) => (skill.id === id ? next : skill))
        : [...current, next]
    })
    setSkillErrors((current) => ({ ...current, [id]: "" }))
    setKnowledgeErrors((current) => ({ ...current, [id]: "" }))
  }
  async function reloadSkills() {
    if (lock.current) return
    lock.current = true
    setCatalogBusy(true)
    try {
      const { data } = await api.get<AiSkillsResponse>(path)
      setSkills((current) =>
        data.skills.map((dto) => {
          const next = toSkillDraft(dto)
          const previous = current.find((skill) => skill.id === dto.id)
          return previous ? mergeSavedSkill(previous, dto, "refresh") : next
        }),
      )
      setFields(data.fields)
      setFieldsBySkill({})
      setCatalogReady(true)
      setCatalogError("")
    } catch (error) {
      setCatalogError(message(error))
    } finally {
      lock.current = false
      setCatalogBusy(false)
    }
  }
  async function saveQualification(skill: AiSkillDraft) {
    if (
      lock.current ||
      !qualificationDirty(skill) ||
      skill.qualificationReadOnlyReason ||
      skillConflicts[skill.id]
    )
      return
    lock.current = true
    setSavingSkillId(skill.id)
    setSkillErrors((current) => ({ ...current, [skill.id]: "" }))
    try {
      const { data } = await api.patch<AiSkillResponse>(
        `${path}/${skill.id}/qualification`,
        { revision: skill.revision, qualification: skill.qualification },
      )
      setSkills((current) => {
        const existing = current.find((item) => item.id === skill.id) ?? skill
        const next = mergeSavedSkill(existing, data.skill, "qualification")
        return current.some((item) => item.id === skill.id)
          ? current.map((item) => (item.id === skill.id ? next : item))
          : [...current, next]
      })
      setFields(data.fields)
      setFieldsBySkill((current) => ({ ...current, [skill.id]: data.fields }))
      toast.success("Qualification rules saved.")
    } catch (error) {
      if (
        isAxiosError(error) &&
        error.response?.data?.error === "AI_QUALIFICATION_CONFLICT"
      ) {
        try {
          const { data } = await api.get<AiSkillResponse>(`${path}/${skill.id}`)
          setSkillConflicts((current) => ({ ...current, [skill.id]: data }))
        } catch (cause) {
          setSkillErrors((current) => ({
            ...current,
            [skill.id]: message(cause),
          }))
        }
      } else
        setSkillErrors((current) => ({
          ...current,
          [skill.id]: message(error),
        }))
    } finally {
      lock.current = false
      setSavingSkillId(null)
    }
  }
  function resolveQualificationConflict(
    skill: AiSkillDraft,
    keepEdits: boolean,
  ) {
    const conflict = skillConflicts[skill.id]
    if (!conflict || lock.current) return
    updateSkill(
      skill.id,
      (current) => ({
        ...current,
        revision: conflict.skill.revision,
        savedQualification: conflict.skill.qualification,
        qualification: keepEdits
          ? current.qualification
          : structuredClone(conflict.skill.qualification),
        qualificationReadOnlyReason: conflict.skill.qualificationReadOnlyReason,
      }),
      skill,
    )
    setSkillConflicts((current) => {
      const next = { ...current }
      delete next[skill.id]
      return next
    })
    setFields(conflict.fields)
    setFieldsBySkill((current) => ({ ...current, [skill.id]: conflict.fields }))
  }
  async function saveKnowledge(skill: AiSkillDraft) {
    if (
      lock.current ||
      !knowledgeDirty(skill) ||
      knowledgeValidation(skill.knowledge) ||
      skill.knowledgeReadOnlyReason ||
      knowledgeConflicts[skill.id]
    )
      return
    lock.current = true
    setSavingKnowledgeId(skill.id)
    setKnowledgeErrors((current) => ({ ...current, [skill.id]: "" }))
    try {
      const { data } = await api.patch<{ skill: AiSkillResponse["skill"] }>(
        `${path}/${skill.id}/knowledge`,
        {
          revision: skill.knowledgeRevision,
          knowledge: knowledgeInput(skill.knowledge),
        },
      )
      setSkills((current) => {
        const existing = current.find((item) => item.id === skill.id) ?? skill
        const next = mergeSavedSkill(existing, data.skill, "knowledge")
        return current.some((item) => item.id === skill.id)
          ? current.map((item) => (item.id === skill.id ? next : item))
          : [...current, next]
      })
      toast.success("Knowledge saved.")
    } catch (error) {
      if (
        isAxiosError(error) &&
        error.response?.data?.error === "AI_KNOWLEDGE_CONFLICT"
      ) {
        try {
          const { data } = await api.get<AiSkillResponse>(`${path}/${skill.id}`)
          setKnowledgeConflicts((current) => ({ ...current, [skill.id]: data }))
        } catch (cause) {
          setKnowledgeErrors((current) => ({
            ...current,
            [skill.id]: message(cause),
          }))
        }
      } else
        setKnowledgeErrors((current) => ({
          ...current,
          [skill.id]: message(error),
        }))
    } finally {
      lock.current = false
      setSavingKnowledgeId(null)
    }
  }
  function resolveKnowledgeConflict(skill: AiSkillDraft, keepEdits: boolean) {
    const conflict = knowledgeConflicts[skill.id]
    if (!conflict || lock.current) return
    updateSkill(
      skill.id,
      (current) => {
        const next = mergeSavedSkill(current, conflict.skill, "knowledge")
        return {
          ...next,
          knowledge: keepEdits ? current.knowledge : next.knowledge,
        }
      },
      skill,
    )
    setKnowledgeConflicts((current) => {
      const next = { ...current }
      delete next[skill.id]
      return next
    })
    setKnowledgeErrors((current) => ({ ...current, [skill.id]: "" }))
  }
  return {
    skills,
    fields,
    fieldsBySkill,
    catalogReady,
    catalogError,
    catalogBusy,
    savingSkillId,
    savingKnowledgeId,
    knowledgeErrors,
    knowledgeConflicts,
    saveKnowledge,
    resolveKnowledgeConflict,
    skillErrors,
    skillConflicts,
    updateSkill,
    reloadSkills,
    saveQualification,
    resolveQualificationConflict,
  }
}
