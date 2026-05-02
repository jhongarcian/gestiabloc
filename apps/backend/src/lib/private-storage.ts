import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.SUPABASE_URL
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY
const bucket = process.env.SUPABASE_STORAGE_BUCKET

let supabaseClient: ReturnType<typeof createClient> | null = null

function getSupabaseStorageClient() {
  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error("SUPABASE_STORAGE_NOT_CONFIGURED")
  }

  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabaseSecretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }

  return supabaseClient
}

export function getPrivateStorageBucket() {
  if (!bucket) {
    throw new Error("SUPABASE_STORAGE_BUCKET_NOT_CONFIGURED")
  }

  return bucket
}

export function privateStorageKeyForTenantFile(
  tenantId: string,
  fileId: string,
  filename: string,
) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
  return `tenants/${tenantId}/files/${fileId}/${safe}`
}

export async function createSignedUpload(params: { path: string }) {
  const client = getSupabaseStorageClient()
  const { data, error } = await client.storage
    .from(getPrivateStorageBucket())
    .createSignedUploadUrl(params.path)

  if (error || !data) {
    throw error ?? new Error("SUPABASE_CREATE_SIGNED_UPLOAD_FAILED")
  }

  return data
}

export async function createSignedDownload(params: {
  path: string
  expiresInSeconds?: number
}) {
  const client = getSupabaseStorageClient()
  const { data, error } = await client.storage
    .from(getPrivateStorageBucket())
    .createSignedUrl(params.path, params.expiresInSeconds ?? 60)

  if (error || !data) {
    throw error ?? new Error("SUPABASE_CREATE_SIGNED_DOWNLOAD_FAILED")
  }

  return data.signedUrl
}

export async function deletePrivateObject(params: { path: string }) {
  const client = getSupabaseStorageClient()
  const { error } = await client.storage
    .from(getPrivateStorageBucket())
    .remove([params.path])

  if (error) {
    throw error
  }
}
