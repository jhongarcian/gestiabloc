// Memory only. Reuse IDs for a failed logical request; clear them after success.
// The server records outcomes and counts. The browser never supplies metrics.
export class AiActivityTracker {
  private conversationId: string | null = null
  private attempt: { key: string; requestId: string } | null = null

  constructor(private readonly newId = () => crypto.randomUUID()) {}

  forRequest(key: string) {
    this.conversationId ??= this.newId()
    if (this.attempt?.key !== key)
      this.attempt = { key, requestId: this.newId() }
    return { conversationId: this.conversationId, requestId: this.attempt.requestId }
  }

  complete(requestId: string) {
    if (this.attempt?.requestId === requestId) this.attempt = null
  }

  newConversation() {
    this.conversationId = null
    this.attempt = null
  }
}
