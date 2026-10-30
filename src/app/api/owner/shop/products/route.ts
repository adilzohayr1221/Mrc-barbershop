import { NextResponse } from 'next/server';

import { requireActiveOwner } from "@/lib/guard";
import { listShopProducts, saveShopProduct, savePhoto, newId, sniffImageType } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Owner: list all supply-shop products.
export async function GET(req: Request) {
  if (!(await requireActiveOwner(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ products: await listShopProducts() });
}

// Owner: add a supply product (multipart: photo?, name, description, price).
export async function POST(req: Request) {
  if (!(await requireActiveOwner(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Invalid form.' }, { status: 400 });
  const name = String(form.get('name') || '').trim().slice(0, 80);
  const description = String(form.get('description') || '').trim().slice(0, 500);
  const price = Math.round(Number(form.get('price')) * 100) / 100;
  if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
  if (!Number.isFinite(price) || price <= 0 || price > 10000) {
    return NextResponse.json({ error: 'Enter a valid price.' }, { status: 400 });
  }
  let photoPath: string | null = null;
  const id = newId();
  const photo = form.get('photo');
  if (photo && typeof photo !== 'string') {
    const buf = Buffer.from(await photo.arrayBuffer());
    if (buf.byteLength > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Photo is too large (max 5MB).' }, { status: 400 });
    }
    // Audit M13: sniff the real image type from the bytes.
    const sniffed = sniffImageType(buf);
    if (!sniffed) {
      return NextResponse.json({ error: 'Photo must be an image.' }, { status: 400 });
    }
    photoPath = await savePhoto(`shop-product-${id}.${sniffed.ext}`, buf, sniffed.mime);
  }
  const product = {
    id,
    name,
    description,
    priceUsd: price,
    photoPath,
    inStock: true,
    createdAt: new Date().toISOString(),
  };
  await saveShopProduct(product);
  return NextResponse.json({ ok: true, product });
}
