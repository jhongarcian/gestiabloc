"use client"
import { useEffect, useRef, useState } from "react"
import { isAxiosError } from "axios"
import { api } from "@/lib/api"
import { AiActivityTracker } from "@/lib/ai-activity-tracking"
import {
  chatHistory,
  type AiTestReply,
  type AiTestTurn,
} from "../_lib/test-chat"

function errorMessage(error: unknown) {
  if (isAxiosError(error)) {
    if (error.response?.status === 401)
      return "Your session has expired. Sign in again to continue."
    if (error.response?.status === 403)
      return "Account administrator access is required to test the helper."
    if (error.response?.status === 429)
      return "The helper is busy. Wait a moment before sending another question."
    if (error.response?.status === 503)
      return "The AI service is unavailable. Your question is still here; try again shortly."
    if (error.response?.status === 502)
      return "The helper could not produce a complete reply. Your question is still here; try again."
  }
  return "The helper could not be reached. Your question is still here; check your connection and try again."
}
export function useTestChat(tenantId: string) {
  const [turns, setTurns] = useState<AiTestTurn[]>([])
  const [question, setQuestion] = useState("")
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [available, setAvailable] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const request = useRef<AbortController | null>(null)
  const tracking = useRef(new AiActivityTracker())
  const statusRequest = useRef<AbortController | null>(null)
  const path = `/api/account-settings/${tenantId}/ai/test-chat`
  useEffect(
    () => () => {
      request.current?.abort()
      statusRequest.current?.abort()
    },
    [],
  )
  async function checkAvailability() {
    if (statusRequest.current) return
    const controller = new AbortController()
    statusRequest.current = controller
    setChecking(true)
    setError("")
    try {
      const { data } = await api.get<{ available: boolean }>(path, {
        signal: controller.signal,
      })
      setAvailable(data.available)
    } catch (cause) {
      if (!controller.signal.aborted) {
        setAvailable(null)
        setError(errorMessage(cause))
      }
    } finally {
      if (!controller.signal.aborted) setChecking(false)
      statusRequest.current = null
    }
  }
  async function send() {
    const content = question.trim()
    if (
      !content ||
      content.length > 2000 ||
      request.current ||
      available !== true
    )
      return
    const controller = new AbortController()
    request.current = controller
    setPending(content)
    setError("")
    const activity = tracking.current.forRequest(JSON.stringify([content, turns.at(-1)?.reply.id]))
    try {
      const { data } = await api.post<{ ok: true; reply: AiTestReply }>(
        `${path}/messages`,
        { question: content, history: chatHistory(turns), ...activity },
        { signal: controller.signal, timeout: 40000 },
      )
      if (controller.signal.aborted) return
      tracking.current.complete(activity.requestId)
      window.dispatchEvent(new Event("ai-activity-recorded"))
      setTurns((current) =>
        [...current, { question: content, reply: data.reply }].slice(-20),
      )
      if (turns.length >= 20) setTruncated(true)
      setQuestion("")
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause))
    } finally {
      if (request.current === controller) {
        request.current = null
        setPending(null)
      }
    }
  }
  function stop() {
    request.current?.abort()
    request.current = null
    setPending(null)
  }
  function clear() {
    if (request.current) return
    tracking.current.newConversation()
    setTurns([])
    setError("")
    setQuestion("")
    setTruncated(false)
  }
  return {
    turns,
    question,
    setQuestion,
    pending,
    error,
    available,
    checking,
    truncated,
    checkAvailability,
    send,
    stop,
    clear,
  }
}
