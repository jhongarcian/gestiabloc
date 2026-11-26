"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { replyWordEnds, revealedReplyWords } from "@/lib/ai-reply-reveal"

const motionQuery = "(prefers-reduced-motion: reduce)"
const reducedMotion = () => window.matchMedia(motionQuery).matches
const serverMotion = () => true
function subscribeMotion(changed: () => void) {
  const media = window.matchMedia(motionQuery)
  media.addEventListener("change", changed)
  return () => media.removeEventListener("change", changed)
}

export function AiReplyText({ id, text, animate = false, className, onFinish, onProgress }: {
  id: string
  text: string
  animate?: boolean
  className?: string
  onFinish?: (id: string) => void
  onProgress?: () => void
}) {
  const prefersReducedMotion = useSyncExternalStore(subscribeMotion, reducedMotion, serverMotion)
  const ends = useMemo(() => replyWordEnds(text), [text])
  const [progress, setProgress] = useState({ text, words: 0 })
  const words = progress.text === text ? progress.words : 0
  const revealing = animate && !prefersReducedMotion && words < ends.length
  const visible = revealing ? text.slice(0, ends[words - 1] ?? 0) : text

  useEffect(() => {
    if (animate && (prefersReducedMotion || !ends.length)) onFinish?.(id)
  }, [animate, prefersReducedMotion, ends.length, id, onFinish])

  useEffect(() => {
    if (!revealing) return
    let frame: number
    const started = performance.now()
    const tick = (now: number) => {
      const next = revealedReplyWords(ends.length, now - started)
      setProgress(current => current.text === text && current.words === next ? current : { text, words: next })
      if (next === ends.length) onFinish?.(id)
      else frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [revealing, ends, text, id, onFinish])

  useEffect(() => { onProgress?.() }, [visible, onProgress])

  return <div className="flex min-w-0 flex-col items-start gap-2" aria-busy={revealing} data-revealing={revealing}>
    {/* Announce the whole answer once, rather than each animated word. */}
    <p className="sr-only">{text}</p>
    <p aria-hidden="true" data-slot="ai-reply-text" className={cn("whitespace-pre-wrap break-words text-sm leading-7 text-foreground [overflow-wrap:anywhere]", className)}>
      {visible}{revealing ? <span aria-hidden="true" className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 bg-current" /> : null}
    </p>
    {revealing ? <Button type="button" variant="ghost" size="sm" onClick={() => {
      setProgress({ text, words: ends.length })
      onFinish?.(id)
    }}>Show full answer</Button> : null}
  </div>
}
