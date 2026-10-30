// Vercel Blob data layer. All access is server-side only.
// Auth: explicit storeId + Vercel OIDC token (auto-injected on Vercel deployments).
import { put, head, list, del } from '@vercel/blob';

const STORE_ID = process.env.BLOB_STORE_ID || '';

function oidcOpts() {
  return {
    storeId: STORE_ID,
    // VERCEL_OIDC_TOKEN is auto-populated on Vercel; explicit pass for clarity.
    oidcToken: process.env.VERCEL_OIDC_TOKEN,
  } as const;
}

function ensureConfigured() {
  if (!STORE_ID) throw new Error('BLOB_STORE_ID is not configured');
}

/** Private blobs need the RW token as a bearer to download their bytes. */
function downloadHeaders(): HeadersInit {
  const t = process.env.BLOB_READ_WRITE_TOKEN;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** Read a JSON doc; returns null when missing. */
export async function getDoc<T>(path: string): Promise<T | null> {
  ensureConfigured();
  try {
    const meta = await head(path, oidcOpts());
    // NOTE: do NOT append query params to the download URL — the blob
    // frontend rejects them on private downloads and the read fails.
    // `cache: no-store` opts out of Next's fetch cache; the Authorization
    // header keeps the read private.
    const res = await fetch(meta.url, {
      headers: downloadHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Write a JSON doc (overwrite).
 *  cacheControlMaxAge 60 (the minimum allowed): overwritten blobs keep the
 *  same download URL, so bound the blob CDN's stale-read window as tightly
 *  as possible. */
export async function putDoc(path: string, data: unknown): Promise<void> {
  ensureConfigured();
  await put(path, JSON.stringify(data), {
    ...oidcOpts(),
    access: 'private',
    contentType: 'application/json',
    allowOverwrite: true,
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
  });
}

/** Create-if-absent write (audit H1): writes the doc ONLY when the path does
 *  not exist yet. Returns true when this call created it, false when a blob
 *  already existed there. Vercel Blob `put` with allowOverwrite:false throws
 *  on an existing pathname, and put() is strongly consistent for existence —
 *  unlike getDoc/head reads, which can serve a CDN-cached copy for up to
 *  cacheControlMaxAge. That makes this the atomic primitive for claims and
 *  counters: two racers can both pass a check-then-write, but only one can
 *  win a create-only put at the same path. */
export async function putDocCreateOnly(path: string, data: unknown): Promise<boolean> {
  ensureConfigured();
  try {
    await put(path, JSON.stringify(data), {
      ...oidcOpts(),
      access: 'private',
      contentType: 'application/json',
      allowOverwrite: false,
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
    });
    return true;
  } catch {
    // A conflict means the blob already exists. Any OTHER failure (network,
    // config) must not masquerade as "already claimed" — confirm existence
    // via head() (metadata reads are not CDN-cached the way downloads are)
    // and rethrow when the path is genuinely absent.
    try {
      await head(path, oidcOpts());
      return false;
    } catch {
      throw new Error(`putDocCreateOnly failed for ${path}`);
    }
  }
}

/** List pathnames under a prefix. */
export async function listDocs(prefix: string): Promise<string[]> {
  ensureConfigured();
  const out: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await list({ ...oidcOpts(), prefix, cursor, limit: 1000 });
    out.push(...page.blobs.map((b) => b.pathname));
    if (!page.hasMore) break;
    cursor = page.cursor;
  }
  return out;
}

export async function delDoc(path: string): Promise<void> {
  ensureConfigured();
  await del(path, oidcOpts());
}

/** Raw binary put (photos). Returns the pathname. */
export async function putBinary(path: string, body: Buffer, contentType: string): Promise<string> {
  ensureConfigured();
  const blob = await put(path, body, {
    ...oidcOpts(),
    access: 'private',
    contentType,
    allowOverwrite: true,
    addRandomSuffix: false,
  });
  return blob.pathname;
}

/** Fetch a private blob's bytes server-side. */
export async function getBinary(path: string): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  ensureConfigured();
  try {
    const meta = await head(path, oidcOpts());
    // NOTE: do NOT append query params to the download URL — the blob
    // frontend rejects them on private downloads and the read fails.
    const res = await fetch(meta.url, {
      headers: downloadHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.arrayBuffer();
    return { data, contentType: meta.contentType || 'application/octet-stream' };
  } catch {
    return null;
  }
}
