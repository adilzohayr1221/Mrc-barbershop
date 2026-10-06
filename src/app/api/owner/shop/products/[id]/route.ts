import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { getShopProduct, saveShopProduct, deleteShopProduct } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Owner: mark a product in/out of stock. Body: { inStock: boolean }.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const product = await getShopProduct(id);
  if (!product) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (typeof body?.inStock !== 'boolean') {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  product.inStock = body.inStock;
  await saveShopProduct(product);
  return NextResponse.json({ ok: true, product });
}

// Owner: remove a product from the shop (orders already placed are kept).
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const product = await getShopProduct(id);
  if (!product) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
  await deleteShopProduct(id);
  return NextResponse.json({ ok: true });
}
