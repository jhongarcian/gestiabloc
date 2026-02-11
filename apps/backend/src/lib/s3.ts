import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";

const region = process.env.AWS_REGION!;
const bucket = process.env.S3_BUCKET!;

export const s3 = new S3Client({ region });

export async function presignPutObject(params: {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}) {
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: params.key,
    ContentType: params.contentType,
  });

  const url = await getSignedUrl(s3, cmd, { expiresIn: params.expiresInSeconds ?? 60 });
  return url;
}

export async function presignPostObject(params: {
  key: string;
  contentType: string;
  maxSizeBytes: number;
  expiresInSeconds?: number;
}) {
  const post = await createPresignedPost(s3, {
    Bucket: bucket,
    Key: params.key,
    Expires: params.expiresInSeconds ?? 60,
    Fields: {
      "Content-Type": params.contentType,
    },
    Conditions: [
      ["content-length-range", 1, params.maxSizeBytes],
      ["eq", "$Content-Type", params.contentType],
    ],
  });

  return post;
}

export async function presignGetObject(params: {
  key: string;
  expiresInSeconds?: number;
}) {
  const cmd = new GetObjectCommand({
    Bucket: bucket,
    Key: params.key,
  });

  const url = await getSignedUrl(s3, cmd, { expiresIn: params.expiresInSeconds ?? 60 });
  return url;
}

export function s3KeyForTenantFile(tenantId: string, fileId: string, filename: string) {
  // Avoid spaces etc.
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `tenants/${tenantId}/files/${fileId}/${safe}`;
}

export function s3KeyForTenantAvatar(
  tenantId: string,
  userId: string,
  fileId: string,
  filename: string,
) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `tenants/${tenantId}/avatars/${userId}/${fileId}/${safe}`;
}
