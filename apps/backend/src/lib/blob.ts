import { del, put } from "@vercel/blob"

export async function uploadPublicBlob(params: {
  pathname: string
  body: Buffer
  contentType: string
}) {
  const blob = await put(params.pathname, params.body, {
    access: "public",
    addRandomSuffix: true,
    contentType: params.contentType,
  })

  return blob
}

export async function deleteBlobByUrl(url: string) {
  await del(url)
}
