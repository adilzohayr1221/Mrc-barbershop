import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { listShopProducts, saveShopProduct, savePhoto, newId } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Owner: list all supply-shop products.
export async function GET(req: Request) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ products: await listShopProducts() });
}

// Owner: add a supply product (multipart: photo?, name, description, price).
export async function POST(req: Request) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    if (!photo.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Photo must be an image.' }, { status: 400 });
    }
    const buf = Buffer.from(await photo.arrayBuffer());
    if (buf.byteLength > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Photo is too large (max 5MB).' }, { status: 400 });
    }
    const ext = photo.type.includes('png') ? 'png' : photo.type.includes('webp') ? 'webp' : 'jpg';
    photoPath = await savePhoto(`shop-product-${id}.${ext}`, buf, photo.type || 'image/jpeg');
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
