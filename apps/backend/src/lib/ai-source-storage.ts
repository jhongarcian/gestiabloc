import { createClient } from "@supabase/supabase-js"
import { AsyncLocalStorage } from "node:async_hooks"
import { getPrivateStorageBucket } from "./private-storage.js"
import { AiSourceError, AI_FILE_MAX_BYTES } from "./ai-source-types.js"

let client: ReturnType<typeof createClient> | null = null
let checkedUntil = 0
const deadlines = new AsyncLocalStorage<AbortSignal>()
const withinDeadline = <T>(work: () => Promise<T>) =>
  deadlines.run(AbortSignal.timeout(30000), work)
export async function aiStorage() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY)
    throw new AiSourceError(
      503,
      "AI_STORAGE_UNAVAILABLE",
      "Document storage is not configured.",
    )
  const bucket = getPrivateStorageBucket()
  client ??= createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.any([
              AbortSignal.timeout(30_000),
              ...(deadlines.getStore() ? [deadlines.getStore()!] : []),
              ...(init?.signal ? [init.signal] : []),
            ]),
          }),
      },
    },
  )
  if (Date.now() >= checkedUntil) {
    const { data, error } = await client.storage.getBucket(bucket)
    if (error || !data || data.public)
      throw new AiSourceError(
        503,
        "AI_STORAGE_UNAVAILABLE",
        "AI documents require a configured private storage bucket.",
      )
    checkedUntil = Date.now() + 60_000
  }
  return client.storage.from(bucket)
}
export const aiSourceStorage = {
  async upload(key: string, bytes: Buffer, contentType: string) {
    return withinDeadline(async () => {
      const { error } = await (
        await aiStorage()
      ).upload(key, bytes, { contentType, upsert: true })
      if (error)
        throw new AiSourceError(
          503,
          "AI_UPLOAD_FAILED",
          "The document could not be stored. Try uploading it again.",
        )
    })
  },
  async download(key: string) {
    return withinDeadline(async () => {
      const { data, error } = await (await aiStorage()).download(key)
      if (error || !data)
        throw new AiSourceError(
          503,
          "AI_DOWNLOAD_FAILED",
          "The stored document could not be read. Try again.",
        )
      if (data.size > AI_FILE_MAX_BYTES)
        throw new AiSourceError(
          400,
          "INVALID_FILE_SIZE",
          "The stored document exceeds 10 MB.",
        )
      return Buffer.from(await data.arrayBuffer())
    })
  },
  async remove(key: string) {
    return withinDeadline(async () => {
      const { error } = await (await aiStorage()).remove([key])
      if (error)
        throw new AiSourceError(
          503,
          "AI_DELETE_FAILED",
          "Document removal will be retried.",
        )
    })
  },
  async signedDownload(key: string, filename: string) {
    return withinDeadline(async () => {
      const { data, error } = await (
        await aiStorage()
      ).createSignedUrl(key, 60, { download: filename })
      if (error || !data)
        throw new AiSourceError(
          503,
          "AI_DOWNLOAD_FAILED",
          "A download could not be prepared. Try again.",
        )
      return data.signedUrl
    })
  },
}
export type AiSourceStorage = typeof aiSourceStorage
