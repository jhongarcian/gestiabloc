import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { Upload } from "tus-js-client"

type SignedUploadTarget = {
  bucket: string
  fileId: string
  path: string
  token: string
}

const IMAGE_MAX_BYTES = 5 * 1024 * 1024
const PDF_MAX_BYTES = 20 * 1024 * 1024
const CSV_MAX_BYTES = 500 * 1024 * 1024
const RESUMABLE_MIN_BYTES = 6 * 1024 * 1024

let supabaseClient: SupabaseClient | null = null

function getSupabaseStorageClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("SUPABASE_STORAGE_NOT_CONFIGURED")
  }

  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }

  return supabaseClient
}

function isSignedResumableAuthError(error: unknown) {
  if (!error || typeof error !== "object") return false
  const response = (error as { originalResponse?: { getBody?: () => string } }).originalResponse
  const body = response?.getBody?.()
  if (!body) return false

  try {
    const details = JSON.parse(body) as { code?: string; message?: string }
    return details.code === "AccessDenied" && details.message === "Invalid Compact JWS"
  } catch {
    return false
  }
}

export async function uploadPrivateFileToSignedUrl(
  target: SignedUploadTarget,
  file: File,
  contentType: string,
  onProgress?: (fraction: number | null) => void,
) {
  const maxBytes = contentType === "text/csv" ? CSV_MAX_BYTES : contentType === "application/pdf" ? PDF_MAX_BYTES : IMAGE_MAX_BYTES
  if (file.size > maxBytes) {
    throw new Error("FILE_TOO_LARGE")
  }

  if (contentType === "text/csv" && file.size > RESUMABLE_MIN_BYTES) {
    const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!configuredUrl) throw new Error("SUPABASE_STORAGE_NOT_CONFIGURED")
    const storageUrl = new URL(configuredUrl)
    if (storageUrl.hostname.endsWith(".supabase.co") && !storageUrl.hostname.endsWith(".storage.supabase.co")) {
      storageUrl.hostname = storageUrl.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co")
    }
    storageUrl.pathname = `${storageUrl.pathname.replace(/\/$/, "")}/storage/v1/upload/resumable`
    try {
      await new Promise<void>((resolve, reject) => {
        const upload = new Upload(file, {
          endpoint: storageUrl.toString(),
          headers: { "x-signature": target.token },
          metadata: { bucketName: target.bucket, objectName: target.path, contentType },
          chunkSize: 6 * 1024 * 1024,
          retryDelays: [0, 3000, 5000, 10000, 20000],
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          onProgress: (sent, total) => onProgress?.(total ? sent / total : 0),
          onError: reject,
          onSuccess: () => resolve(),
        })
        upload.start()
      })
      return
    } catch (error) {
      if (!isSignedResumableAuthError(error)) throw error
    }
  }

  onProgress?.(null)
  const client = getSupabaseStorageClient()
  const { error } = await client.storage
    .from(target.bucket)
    .uploadToSignedUrl(target.path, target.token, file, {
      contentType,
    })

  if (error) {
    throw error
  }
  onProgress?.(1)
}
