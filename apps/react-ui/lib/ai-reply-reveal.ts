// Presentation only: the complete, validated answer remains in chat history.
export function replyWordEnds(text: string) {
  return Array.from(text.matchAll(/\S+\s*/gu), match => match.index + match[0].length)
}

export function revealedReplyWords(total: number, elapsedMs: number) {
  if (!total) return 0
  const duration = Math.min(total * 32, 8000)
  return Math.min(total, Math.max(1, Math.floor(Math.max(0, elapsedMs) / duration * total) + 1))
}

export function followAiReply(end: HTMLElement | null, root: HTMLElement | null, force = false) {
  if (!end || !root) return
  const focused = document.activeElement
  if (!force && (focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement) && focused.value.trim()) return
  const viewport = root.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? root
  const nearEnd = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 80
  // Let someone reading earlier messages keep their place.
  if (force || nearEnd) viewport.scrollTop = viewport.scrollHeight
  // Bring the composer into view once for a new message. Animation frames only
  // scroll the transcript, never the surrounding page.
  if (force) root.parentElement?.scrollIntoView({ block: "end", behavior: "instant" })
}
