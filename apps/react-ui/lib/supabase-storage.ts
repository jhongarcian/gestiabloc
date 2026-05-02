import { createClient, type SupabaseClient } from "@supabase/supabase-js"

type SignedUploadTarget = {
  bucket: string
  fileId: string
  path: string
  token: string
}

const IMAGE_MAX_BYTES = 5 * 1024 * 1024
const PDF_MAX_BYTES = 20 * 1024 * 1024

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

export async function uploadPrivateFileToSignedUrl(
  target: SignedUploadTarget,
  file: File,
  contentType: string,
) {
  const maxBytes = contentType === "application/pdf" ? PDF_MAX_BYTES : IMAGE_MAX_BYTES
  if (file.size > maxBytes) {
    throw new Error("FILE_TOO_LARGE")
  }

  const client = getSupabaseStorageClient()
  const { error } = await client.storage
    .from(target.bucket)
    .uploadToSignedUrl(target.path, target.token, file, {
      contentType,
    })

  if (error) {
    throw error
  }
}
