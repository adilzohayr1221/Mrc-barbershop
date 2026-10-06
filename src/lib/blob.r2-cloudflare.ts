// Cloudflare R2 data layer (S3-compatible). All access is server-side only.
// Env (Worker secrets/vars):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
// The exported interface is identical to the old Vercel Blob layer, so
// nothing else in the app needs to change.
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

let client: S3Client | null = null;

function bucket(): string {
  const b = process.env.R2_BUCKET || '';
  if (!b) throw new Error('R2_BUCKET is not configured');
  return b;
}

function getClient(): S3Client {
  if (client) return client;
  const accountId = process.env.R2_ACCOUNT_ID || '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 is not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)');
  }
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

async function streamToBytes(stream: unknown): Promise<Uint8Array> {
  // aws-sdk v3 Body has transformToByteArray in both Node and Workers.
  const body = stream as { transformToByteArray?: () => Promise<Uint8Array> };
  if (body && typeof body.transformToByteArray === 'function') {
    return body.transformToByteArray();
  }
  // Fallback: async-iterable stream.
  const chunks: Uint8Array[] = [];
  const iter = stream as AsyncIterable<Uint8Array>;
  for await (const chunk of iter) chunks.push(chunk);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Read a JSON doc; returns null when missing. */
export async function getDoc<T>(path: string): Promise<T | null> {
  try {
    const res = await getClient().send(new GetObjectCommand({ Bucket: bucket(), Key: path }));
    if (!res.Body) return null;
    const bytes = await streamToBytes(res.Body);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

/** Write a JSON doc (overwrite). */
export async function putDoc(path: string, data: unknown): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: path,
      Body: JSON.stringify(data),
      ContentType: 'application/json',
    })
  );
}

/** List object keys under a prefix. */
export async function listDocs(prefix: string): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  for (;;) {
    const page = await getClient().send(
      new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 })
    );
    for (const o of page.Contents || []) if (o.Key) out.push(o.Key);
    if (!page.IsTruncated) break;
    token = page.NextContinuationToken;
  }
  return out;
}

export async function delDoc(path: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: path }));
}

/** Raw binary put (photos). Returns the key. */
export async function putBinary(path: string, body: Buffer, contentType: string): Promise<string> {
  await getClient().send(
    new PutObjectCommand({ Bucket: bucket(), Key: path, Body: body, ContentType: contentType })
  );
  return path;
}

/** Fetch a stored object's bytes server-side. */
export async function getBinary(path: string): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  try {
    const res = await getClient().send(new GetObjectCommand({ Bucket: bucket(), Key: path }));
    if (!res.Body) return null;
    const bytes = await streamToBytes(res.Body);
    // Copy into a fresh ArrayBuffer (bytes may be a view over a larger buffer).
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return { data: copy.buffer, contentType: res.ContentType || 'application/octet-stream' };
  } catch {
    return null;
  }
}
