// A bounded per-process cost guard, shared by workspace and contact replies.
// Stores timestamps/counts only, never message text.
export class AiReplyLimit {
  private windows = new Map<string, { count: number; startedAt: number; active: boolean }>()

  acquire(key: string, now = Date.now()): (() => void) | null {
    for (const [id, window] of this.windows)
      if (!window.active && now - window.startedAt >= 60000) this.windows.delete(id)
    let window = this.windows.get(key)
    if (window?.active || (window && window.count >= 10) || (!window && this.windows.size >= 2000)) return null
    if (!window) {
      window = { count: 0, startedAt: now, active: false }
      this.windows.set(key, window)
    }
    window.count++
    window.active = true
    return () => { window.active = false }
  }
}
