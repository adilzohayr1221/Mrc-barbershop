// Data access layer over Vercel Blob JSON docs.
// SECURITY: this module is server-only. Callers (API routes) enforce auth
// BEFORE reading anything that contains customer PII.
import { getDoc, putDoc, listDocs, delDoc, putBinary, getBinary } from './blob';
import { ensureSeeded } from './seed';
import type { Branch, Barber, Service, Booking, BookingStatus, Review, PinsDoc, PublicBarber, Customer, Membership, MembershipRedemption, PushSubscriptionDoc, ChatDoc, ChatMessage, ChatMeta, Gift, TeamChatDoc, WorkPhoto, Complaint, Comp, Tip, SkillVerification, ShopProduct, ShopOrder, PartnerLead, Salon, SalonOwner, TenantScoped, SalonTask } from './types';
import { PLATFORM_SALON_ID } from './types';
import { randomUUID } from 'node:crypto';

const P = {
  branches: 'data/branches.json',
  barbers: 'data/barbers.json',
  services: 'data/services.json',
  pins: 'data/pins.json',
  booking: (id: string) => `data/bookings/${id}.json`,
  bookingsPrefix: 'data/bookings/',
  review: (id: string) => `data/reviews/${id}.json`,
  reviewsPrefix: 'data/reviews/',
  photo: (name: string) => `photos/${name}`,
};

export async function getBranches(): Promise<Branch[]> {
  await ensureSeeded();
  return (await getDoc<Branch[]>(P.branches)) ?? [];
}

export async function saveBranches(branches: Branch[]): Promise<void> {
  await putDoc(P.branches, branches);
}

export async function getBarbers(): Promise<Barber[]> {
  await ensureSeeded();
  return (await getDoc<Barber[]>(P.barbers)) ?? [];
}

export async function saveBarbers(barbers: Barber[]): Promise<void> {
  await putDoc(P.barbers, barbers);
}

export async function getServices(): Promise<Service[]> {
  await ensureSeeded();
  return (await getDoc<Service[]>(P.services)) ?? [];
}

export async function saveServices(services: Service[]): Promise<void> {
  await putDoc(P.services, services);
}

export async function getPins(): Promise<PinsDoc | null> {
  await ensureSeeded();
  return getDoc<PinsDoc>(P.pins);
}

export async function savePins(pins: PinsDoc): Promise<void> {
  await putDoc(P.pins, pins);
}

export async function getBooking(id: string): Promise<Booking | null> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  const b = await getDoc<Booking>(P.booking(id));
  return b ? withStatus(b) : null;
}

/** Older booking docs predate the status field — treat a missing/invalid
 *  status as 'booked' so existing records keep working. Same for customerId
 *  (pre-account bookings have none). */
function withStatus(b: Booking): Booking {
  const s = (b as { status?: unknown }).status;
  const status: BookingStatus = s === 'cancelled' ? 'cancelled' : 'booked';
  const c = (b as { customerId?: unknown }).customerId;
  const customerId: string | null = typeof c === 'string' && c ? c : null;
  return status === b.status && customerId === b.customerId ? b : { ...b, status, customerId };
}

export async function saveBooking(b: Booking): Promise<void> {
  await putDoc(P.booking(b.id), b);
}

export async function listBookings(): Promise<Booking[]> {
  const paths = await listDocs(P.bookingsPrefix);
  const out: Booking[] = [];
  for (const p of paths) {
    const b = await getDoc<Booking>(p);
    if (b) out.push(withStatus(b));
  }
  out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return out;
}

export async function listReviews(): Promise<Review[]> {
  const paths = await listDocs(P.reviewsPrefix);
  const out: Review[] = [];
  for (const p of paths) {
    const r = await getDoc<Review>(p);
    if (r) out.push(r);
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

export async function saveReview(r: Review): Promise<void> {
  await putDoc(P.review(r.id), r);
}

export async function getReview(id: string): Promise<Review | null> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  return getDoc<Review>(P.review(id));
}

export async function deleteReview(id: string): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return;
  await delDoc(P.review(id));
}

/** Permanently delete a booking doc. Callers must enforce auth AND that the
 *  booking is cancelled before calling this — deletion is irreversible. */
export async function deleteBooking(id: string): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return;
  await delDoc(P.booking(id));
}

/** Customer accounts. One doc per customer: `data/customers/<id>.json`.
 *  Per-customer docs (instead of one shared array doc) so that creating an
 *  account is a FIRST WRITE to a fresh path — never an overwrite of a cached
 *  URL — which makes signup immediately followed by a session check reliable
 *  (read-after-write staleness on overwritten blob URLs broke auto-login). */
const CUST_PREFIX = 'data/customers/';
const custPath = (id: string) => `${CUST_PREFIX}${id}.json`;

export async function getCustomers(): Promise<Customer[]> {
  await ensureSeeded();
  const paths = await listDocs(CUST_PREFIX);
  const out: Customer[] = [];
  for (const p of paths) {
    if (!p.endsWith('.json')) continue;
    const id = p.slice(CUST_PREFIX.length, -'.json'.length);
    if (!/^[a-zA-Z0-9-]+$/.test(id)) continue;
    const c = await getDoc<Customer>(p);
    if (c && typeof c.id === 'string' && typeof c.email === 'string') out.push(c);
  }
  return out;
}

export async function saveCustomer(c: Customer): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(c.id)) throw new Error('bad customer id');
  await putDoc(custPath(c.id), c);
}

/** Delete a customer account doc. Only used by the one-time test cleanup. */
export async function deleteCustomer(id: string): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return;
  await delDoc(custPath(id));
}

export async function getCustomerByEmail(email: string): Promise<Customer | null> {
  const needle = email.trim().toLowerCase();
  const customers = await getCustomers();
  return customers.find((c) => c.email === needle) ?? null;
}

export async function getCustomer(id: string): Promise<Customer | null> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  return getDoc<Customer>(custPath(id));
}

export async function savePhoto(name: string, buf: Buffer, contentType: string): Promise<string> {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '');
  return putBinary(P.photo(safe), buf, contentType);
}

export async function getPhoto(name: string) {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '');
  return getBinary(P.photo(safe));
}

export function newId(): string {
  return randomUUID();
}

// Proof-of-completion photo for barber payouts (like DoorDash proof-of-delivery).
// The photo must come from the multipart field `photo`, taken with the camera.
// Throws an Error with a user-facing message when missing/invalid.
export async function saveCompletionPhoto(form: FormData, prefix: string): Promise<string> {
  const photo = form.get('photo');
  if (!photo || typeof photo === 'string') {
    throw new Error('Take a photo of the finished haircut to get paid.');
  }
  if (!photo.type.startsWith('image/')) {
    throw new Error('That file is not an image.');
  }
  const buf = Buffer.from(await photo.arrayBuffer());
  if (buf.byteLength > 5 * 1024 * 1024) {
    throw new Error('Photo is too large (max 5MB).');
  }
  const ext = photo.type.includes('png') ? 'png' : photo.type.includes('webp') ? 'webp' : 'jpg';
  return savePhoto(`${prefix}-${newId()}.${ext}`, buf, photo.type || 'image/jpeg');
}

/** Monthly plan memberships. One doc per membership: `data/memberships/<id>.json`. */
const MEMBERSHIP_PREFIX = 'data/memberships/';
const membershipPath = (id: string) => `${MEMBERSHIP_PREFIX}${id}.json`;

export async function saveMembership(m: Membership): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(m.id)) throw new Error('bad membership id');
  await putDoc(membershipPath(m.id), m);
}

export async function getMembership(id: string): Promise<Membership | null> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  return getDoc<Membership>(membershipPath(id));
}

export async function listMemberships(): Promise<Membership[]> {
  const paths = await listDocs(MEMBERSHIP_PREFIX);
  const out: Membership[] = [];
  for (const p of paths) {
    if (!p.endsWith('.json')) continue;
    const m = await getDoc<Membership>(p);
    if (m && typeof m.id === 'string') out.push(m);
  }
  return out;
}

export async function getMembershipByCustomer(customerId: string): Promise<Membership | null> {
  const all = await listMemberships();
  return all.find((m) => m.customerId === customerId) ?? null;
}

/** All memberships for a customer (family plans: one account can hold several). */
export async function getMembershipsByCustomer(customerId: string): Promise<Membership[]> {
  const all = await listMemberships();
  return all
    .filter((m) => m.customerId === customerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getMembershipBySubscriptionId(subscriptionId: string): Promise<Membership | null> {
  const all = await listMemberships();
  return all.find((m) => m.stripeSubscriptionId === subscriptionId) ?? null;
}

/** Membership redemptions (one haircut per week). `data/membership-redemptions/<id>.json`. */
const REDEMPTION_PREFIX = 'data/membership-redemptions/';
const redemptionPath = (id: string) => `${REDEMPTION_PREFIX}${id}.json`;

export async function saveRedemption(r: MembershipRedemption): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(r.id)) throw new Error('bad redemption id');
  await putDoc(redemptionPath(r.id), r);
}

export async function getRedemption(id: string): Promise<MembershipRedemption | null> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  return getDoc<MembershipRedemption>(redemptionPath(id));
}

export async function listRedemptions(membershipId: string): Promise<MembershipRedemption[]> {
  const paths = await listDocs(REDEMPTION_PREFIX);
  const out: MembershipRedemption[] = [];
  for (const p of paths) {
    if (!p.endsWith('.json')) continue;
    const r = await getDoc<MembershipRedemption>(p);
    if (r && r.membershipId === membershipId) out.push(r);
  }
  out.sort((a, b) => a.redeemedAt.localeCompare(b.redeemedAt));
  return out;
}

/** Build the public-safe barber list (no PII, no PINs). Pending self-signups are excluded. */
export async function getPublicBarbers(branchId?: string, salonId?: string): Promise<PublicBarber[]> {
  const [barbers, reviews, workPhotos] = await Promise.all([getBarbers(), listReviews(), listWorkPhotos()]);
  return barbers
    .filter((b) => b.active && b.approved !== false && (!branchId || b.branchIds.includes(branchId)) && (!salonId || inSalon(b, salonId)))
    .map((b) => {
      const br = reviews.filter((r) => r.barberId === b.id);
      const wp = workPhotos
        .filter((p) => p.barberId === b.id && p.status === 'approved')
        .map((p) => `/api/photos/${encodeURIComponent(p.photoPath.split('/').pop() || '')}`);
      return {
        id: b.id,
        name: b.name,
        photoUrl: b.photoPath ? `/api/photos/${encodeURIComponent(b.photoPath.split('/').pop() || '')}` : null,
        skills: b.skills,
        branchIds: b.branchIds,
        reviewCount: br.length,
        avgRating: br.length ? Math.round((br.reduce((s, r) => s + r.rating, 0) / br.length) * 10) / 10 : null,
        workingHours: b.workingHours,
        workPhotos: wp,
        verifiedSkills: b.verifiedSkills ?? [],
      };
    });
}

/** Web-push subscriptions. One doc per device: `data/push-subs/<id>.json`. */
const PUSH_PREFIX = 'data/push-subs/';
const pushPath = (id: string) => `${PUSH_PREFIX}${id}.json`;

export async function savePushSubscription(d: PushSubscriptionDoc): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(d.id)) throw new Error('bad push sub id');
  await putDoc(pushPath(d.id), d);
}

export async function listPushSubscriptions(role: 'customer' | 'barber', userId: string): Promise<PushSubscriptionDoc[]> {
  const paths = await listDocs(PUSH_PREFIX);
  const out: PushSubscriptionDoc[] = [];
  for (const p of paths) {
    if (!p.endsWith('.json')) continue;
    const d = await getDoc<PushSubscriptionDoc>(p);
    if (d && d.role === role && d.userId === userId && d.subscription?.endpoint) out.push(d);
  }
  return out;
}

/** Remove a subscription by endpoint (e.g. it expired or was replaced). */
export async function deletePushSubscriptionByEndpoint(endpoint: string): Promise<void> {
  const paths = await listDocs(PUSH_PREFIX);
  for (const p of paths) {
    if (!p.endsWith('.json')) continue;
    const d = await getDoc<PushSubscriptionDoc>(p);
    if (d && d.subscription?.endpoint === endpoint) {
      const id = p.slice(PUSH_PREFIX.length, -'.json'.length);
      if (/^[a-zA-Z0-9-]+$/.test(id)) await delDoc(pushPath(id));
    }
  }
}

/** Gift haircuts. One doc per gift: `data/gifts/<id>.json`. */
const GIFT_PREFIX = 'data/gifts/';
const giftPath = (id: string) => `${GIFT_PREFIX}${id}.json`;

export async function getGift(id: string): Promise<Gift | null> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  return getDoc<Gift>(giftPath(id));
}

export async function saveGift(g: Gift): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(g.id)) throw new Error('bad gift id');
  await putDoc(giftPath(g.id), g);
}

export async function listGifts(): Promise<Gift[]> {
  const paths = await listDocs(GIFT_PREFIX);
  const out: Gift[] = [];
  for (const p of paths) {
    if (!p.endsWith('.json')) continue;
    const g = await getDoc<Gift>(p);
    if (g && typeof g.id === 'string' && typeof g.shortCode === 'string') out.push(g);
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

/** In-app chat: one thread per booking, stored at `data/chats/<bookingId>.json`. */
const CHAT_PREFIX = 'data/chats/';
const chatPath = (bookingId: string) => `${CHAT_PREFIX}${bookingId}.json`;

export async function getChat(bookingId: string): Promise<ChatDoc | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(bookingId)) return null;
  return getDoc<ChatDoc>(chatPath(bookingId));
}

export async function saveChat(chat: ChatDoc): Promise<void> {
  await putDoc(chatPath(chat.bookingId), chat);
}

/**
 * Chat messages as individual files (no-overwrite storage).
 * Each message is `data/chats/<bookingId>/m-<messageId>.json`.
 * New files have no CDN staleness (unlike overwriting the single chat file),
 * so sent messages are visible immediately on re-entry.
 */
const chatMsgDir = (bookingId: string) => `${CHAT_PREFIX}${bookingId}/`;
const chatMsgPath = (bookingId: string, messageId: string) => `${chatMsgDir(bookingId)}m-${messageId}.json`;
const chatMetaPath = (bookingId: string) => `${chatMsgDir(bookingId)}meta.json`;

function validChatId(bookingId: string, messageId: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(bookingId) && /^[A-Za-z0-9_-]+$/.test(messageId);
}

/** Save a single chat message as its own file (no overwrite, no staleness). */
export async function saveChatMessage(bookingId: string, msg: ChatMessage): Promise<void> {
  if (!validChatId(bookingId, msg.id)) return;
  await putDoc(chatMsgPath(bookingId, msg.id), msg);
}

/** Delete a single chat message file. */
export async function deleteChatMessage(bookingId: string, messageId: string): Promise<boolean> {
  if (!validChatId(bookingId, messageId)) return false;
  try {
    await delDoc(chatMsgPath(bookingId, messageId));
    return true;
  } catch {
    return false;
  }
}

export async function getChatMeta(bookingId: string): Promise<ChatMeta> {
  if (!/^[A-Za-z0-9_-]+$/.test(bookingId)) return {};
  return (await getDoc<ChatMeta>(chatMetaPath(bookingId))) ?? {};
}

export async function saveChatMeta(bookingId: string, meta: ChatMeta): Promise<void> {
  if (!/^[A-Za-z0-9_-]+$/.test(bookingId)) return;
  await putDoc(chatMetaPath(bookingId), meta);
}

/**
 * Get all messages for a booking: merges the legacy single-file format
 * (`data/chats/<id>.json`) with the new per-message files.
 * The `list` API is not CDN-cached, so new messages appear immediately.
 */
export async function getChatMessages(bookingId: string): Promise<ChatMessage[]> {
  if (!/^[A-Za-z0-9_-]+$/.test(bookingId)) return [];
  const byId = new Map<string, ChatMessage>();

  // Legacy single-file format (backward compat).
  try {
    const legacy = await getDoc<ChatDoc>(chatPath(bookingId));
    for (const m of legacy?.messages ?? []) {
      if (m?.id) byId.set(m.id, m);
    }
  } catch { /* ignore */ }

  // New per-message files.
  try {
    const paths = await listDocs(chatMsgDir(bookingId));
    const msgs = await Promise.all(
      paths
        .filter((p) => p.endsWith('.json') && !p.endsWith('/meta.json'))
        .map((p) => getDoc<ChatMessage>(p).catch(() => null))
    );
    for (const m of msgs) {
      if (m?.id) byId.set(m.id, m);
    }
  } catch { /* ignore */ }

  const out = [...byId.values()];
  out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return out.slice(-200);
}

/** Barber team group chat: single shared thread for all active barbers. */
const TEAM_CHAT_PATH = 'data/team-chat.json';
const teamChatPathFor = (salonId: string) =>
  salonId === PLATFORM_SALON_ID ? TEAM_CHAT_PATH : `data/team-chat/${salonId}.json`;

export async function getTeamChat(salonId: string = PLATFORM_SALON_ID): Promise<TeamChatDoc | null> {
  const doc = await getDoc<TeamChatDoc>(teamChatPathFor(salonId));
  // Backward compat: the platform salon's history lives at the legacy path.
  if (!doc && salonId === PLATFORM_SALON_ID) return getDoc<TeamChatDoc>(TEAM_CHAT_PATH);
  return doc;
}

export async function saveTeamChat(doc: TeamChatDoc, salonId: string = PLATFORM_SALON_ID): Promise<void> {
  await putDoc(teamChatPathFor(salonId), doc);
}

/** Barber work portfolio photos. */
const WORK_PHOTO_PREFIX = 'data/work-photos/';
const workPhotoPath = (id: string) => `${WORK_PHOTO_PREFIX}${id}.json`;

export async function listWorkPhotos(): Promise<WorkPhoto[]> {
  const paths = await listDocs(WORK_PHOTO_PREFIX);
  const out: WorkPhoto[] = [];
  for (const p of paths) {
    const r = await getDoc<WorkPhoto>(p);
    if (r) out.push(r);
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

export async function getWorkPhoto(id: string): Promise<WorkPhoto | null> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  return getDoc<WorkPhoto>(workPhotoPath(id));
}

export async function saveWorkPhoto(p: WorkPhoto): Promise<void> {
  await putDoc(workPhotoPath(p.id), p);
}

export async function deleteWorkPhoto(id: string): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return;
  await delDoc(workPhotoPath(id));
}

/** Customer complaints with photo evidence. `data/complaints/<id>.json`. */
const COMPLAINT_PREFIX = 'data/complaints/';
const complaintPath = (id: string) => `${COMPLAINT_PREFIX}${id}.json`;

export async function listComplaints(): Promise<Complaint[]> {
  const paths = await listDocs(COMPLAINT_PREFIX);
  const out: Complaint[] = [];
  for (const p of paths) {
    const r = await getDoc<Complaint>(p);
    if (r) out.push(r);
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

export async function getComplaint(id: string): Promise<Complaint | null> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  return getDoc<Complaint>(complaintPath(id));
}

export async function saveComplaint(c: Complaint): Promise<void> {
  await putDoc(complaintPath(c.id), c);
}

/** Free-haircut comps granted by the owner. `data/comps/<id>.json`. */
const COMP_PREFIX = 'data/comps/';
const compPath = (id: string) => `${COMP_PREFIX}${id}.json`;

export async function listComps(): Promise<Comp[]> {
  const paths = await listDocs(COMP_PREFIX);
  const out: Comp[] = [];
  for (const p of paths) {
    const r = await getDoc<Comp>(p);
    if (r) out.push(r);
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

export async function getComp(id: string): Promise<Comp | null> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  return getDoc<Comp>(compPath(id));
}

export async function saveComp(c: Comp): Promise<void> {
  await putDoc(compPath(c.id), c);
}

/** Customer tips (بقشيش) to barbers. `data/tips/<id>.json`. */
const TIP_PREFIX = 'data/tips/';
const tipPath = (id: string) => `${TIP_PREFIX}${id}.json`;

export async function listTips(): Promise<Tip[]> {
  const paths = await listDocs(TIP_PREFIX);
  const out: Tip[] = [];
  for (const p of paths) {
    const r = await getDoc<Tip>(p);
    if (r) out.push(r);
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

export async function saveTip(t: Tip): Promise<void> {
  await putDoc(tipPath(t.id), t);
}

/** Update a single barber inside the barbers array doc. */
export async function saveBarber(updated: Barber): Promise<void> {
  const all = await getBarbers();
  const i = all.findIndex((b) => b.id === updated.id);
  if (i >= 0) all[i] = updated;
  else all.push(updated);
  await saveBarbers(all);
}

/** Skill verifications: one record per (barber, skill). `data/skill-verifications/<id>.json`. */
const SKILLVER_PREFIX = 'data/skill-verifications/';
const skillVerPath = (id: string) => `${SKILLVER_PREFIX}${id}.json`;

export async function listSkillVerifications(): Promise<SkillVerification[]> {
  const paths = await listDocs(SKILLVER_PREFIX);
  const out: SkillVerification[] = [];
  for (const p of paths) {
    const r = await getDoc<SkillVerification>(p);
    if (r) out.push(r);
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

export async function getSkillVerification(id: string): Promise<SkillVerification | null> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  return getDoc<SkillVerification>(skillVerPath(id));
}

export async function getSkillVerificationByBarberSkill(
  barberId: string,
  skill: string
): Promise<SkillVerification | null> {
  const all = await listSkillVerifications();
  return all.find((v) => v.barberId === barberId && v.skill === skill) ?? null;
}

export async function saveSkillVerification(v: SkillVerification): Promise<void> {
  await putDoc(skillVerPath(v.id), v);
}

/** Barber supply shop: owner-managed products, `data/shop-products/<id>.json`. */
const SHOP_PRODUCT_PREFIX = 'data/shop-products/';
const shopProductPath = (id: string) => `${SHOP_PRODUCT_PREFIX}${id}.json`;

export async function listShopProducts(): Promise<ShopProduct[]> {
  const paths = await listDocs(SHOP_PRODUCT_PREFIX);
  const out: ShopProduct[] = [];
  for (const p of paths) {
    const r = await getDoc<ShopProduct>(p);
    if (r) out.push(r);
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

export async function getShopProduct(id: string): Promise<ShopProduct | null> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  return getDoc<ShopProduct>(shopProductPath(id));
}

export async function saveShopProduct(p: ShopProduct): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(p.id)) throw new Error('bad product id');
  await putDoc(shopProductPath(p.id), p);
}

export async function deleteShopProduct(id: string): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return;
  await delDoc(shopProductPath(id));
}

/** Barber supply shop: purchase orders, `data/shop-orders/<id>.json`. */
const SHOP_ORDER_PREFIX = 'data/shop-orders/';
const shopOrderPath = (id: string) => `${SHOP_ORDER_PREFIX}${id}.json`;

export async function listShopOrders(): Promise<ShopOrder[]> {
  const paths = await listDocs(SHOP_ORDER_PREFIX);
  const out: ShopOrder[] = [];
  for (const p of paths) {
    const r = await getDoc<ShopOrder>(p);
    if (r) out.push(r);
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

export async function listShopOrdersByBarber(barberId: string): Promise<ShopOrder[]> {
  return (await listShopOrders()).filter((o) => o.barberId === barberId);
}

export async function getShopOrder(id: string): Promise<ShopOrder | null> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  return getDoc<ShopOrder>(shopOrderPath(id));
}

export async function saveShopOrder(o: ShopOrder): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(o.id)) throw new Error('bad order id');
  await putDoc(shopOrderPath(o.id), o);
}

/** Outstanding supply debt for a barber (what his next payouts will settle).
 * Only confirmed, earnings-paid orders count — pending orders can still be
 * cancelled, and card orders were already paid. */
export async function getShopDebt(barberId: string): Promise<number> {
  const orders = await listShopOrdersByBarber(barberId);
  const debt = orders
    .filter((o) => o.payMethod === 'earnings' && o.status === 'confirmed')
    .reduce((s, o) => s + Math.max(0, o.priceUsd - o.deductedUsd), 0);
  return Math.round(debt * 100) / 100;
}

/**
 * Settle `amount` of a barber's supply debt, oldest order first.
 * Idempotent per idempotencyKey — a retried payout never settles twice.
 */
export async function applyShopDeduction(
  barberId: string,
  amount: number,
  idempotencyKey: string
): Promise<number> {
  let remaining = Math.round(amount * 100) / 100;
  if (remaining <= 0) return 0;
  const orders = (await listShopOrdersByBarber(barberId))
    .filter((o) => o.payMethod === 'earnings' && o.status === 'confirmed' && o.priceUsd - o.deductedUsd > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let applied = 0;
  for (const o of orders) {
    if (remaining <= 0) break;
    if (o.settledKeys.includes(idempotencyKey)) continue;
    const owed = Math.round((o.priceUsd - o.deductedUsd) * 100) / 100;
    const take = Math.min(owed, remaining);
    o.deductedUsd = Math.round((o.deductedUsd + take) * 100) / 100;
    o.settledKeys.push(idempotencyKey);
    await saveShopOrder(o);
    remaining = Math.round((remaining - take) * 100) / 100;
    applied = Math.round((applied + take) * 100) / 100;
  }
  return applied;
}

/** Partner leads: barbershop owners asking for their own app. `data/partner-leads/<id>.json`. */
const PARTNER_LEAD_PREFIX = 'data/partner-leads/';
const partnerLeadPath = (id: string) => `${PARTNER_LEAD_PREFIX}${id}.json`;

export async function savePartnerLead(lead: PartnerLead): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(lead.id)) throw new Error('bad lead id');
  await putDoc(partnerLeadPath(lead.id), lead);
}

export async function listPartnerLeads(): Promise<PartnerLead[]> {
  const paths = await listDocs(PARTNER_LEAD_PREFIX);
  const out: PartnerLead[] = [];
  for (const p of paths) {
    const r = await getDoc<PartnerLead>(p);
    if (r) out.push(r);
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

export async function deletePartnerLead(id: string): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return;
  await delDoc(partnerLeadPath(id));
}

/* ================= Multi-salon platform ================= */

/** Tenant scope of a record: which salon it belongs to. Missing = platform salon. */
export function salonOf<T extends TenantScoped>(r: T): string {
  return r.salonId || PLATFORM_SALON_ID;
}

/** Filter helper: keep only records belonging to `salonId`. */
export function inSalon<T extends TenantScoped>(r: T, salonId: string): boolean {
  return salonOf(r) === salonId;
}

/** Salons registry. One doc per salon: `data/salons/<id>.json`. */
const SALON_PREFIX = 'data/salons/';
const salonPath = (id: string) => `${SALON_PREFIX}${id}.json`;

export async function saveSalon(s: Salon): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(s.id)) throw new Error('bad salon id');
  await putDoc(salonPath(s.id), s);
}

export async function getSalon(id: string): Promise<Salon | null> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  return getDoc<Salon>(salonPath(id));
}

export async function listSalons(): Promise<Salon[]> {
  const paths = await listDocs(SALON_PREFIX);
  const out: Salon[] = [];
  for (const p of paths) {
    if (!p.endsWith('.json')) continue;
    const s = await getDoc<Salon>(p);
    if (s && typeof s.id === 'string') out.push(s);
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

export async function getSalonBySlug(slug: string): Promise<Salon | null> {
  const all = await listSalons();
  return all.find((s) => s.slug === slug) ?? null;
}

/** Resolve a public salon identifier (id or slug) to the salon, or null. */
export async function resolveSalon(ref: string | null | undefined): Promise<Salon | null> {
  if (!ref) return null;
  const byId = await getSalon(ref);
  if (byId) return byId;
  return getSalonBySlug(ref);
}

/** Salon-owner login accounts. One doc per owner: `data/salon-owners/<id>.json`. */
const SALON_OWNER_PREFIX = 'data/salon-owners/';
const salonOwnerPath = (id: string) => `${SALON_OWNER_PREFIX}${id}.json`;

export async function saveSalonOwner(o: SalonOwner): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(o.id)) throw new Error('bad salon-owner id');
  await putDoc(salonOwnerPath(o.id), o);
}

export async function getSalonOwner(id: string): Promise<SalonOwner | null> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  return getDoc<SalonOwner>(salonOwnerPath(id));
}

export async function listSalonOwners(): Promise<SalonOwner[]> {
  const paths = await listDocs(SALON_OWNER_PREFIX);
  const out: SalonOwner[] = [];
  for (const p of paths) {
    if (!p.endsWith('.json')) continue;
    const o = await getDoc<SalonOwner>(p);
    if (o && typeof o.id === 'string') out.push(o);
  }
  return out;
}

export async function getSalonOwnerByEmail(email: string): Promise<SalonOwner | null> {
  const needle = email.trim().toLowerCase();
  const all = await listSalonOwners();
  return all.find((o) => o.email === needle) ?? null;
}

export async function getSalonOwnerBySalon(salonId: string): Promise<SalonOwner | null> {
  const all = await listSalonOwners();
  return all.find((o) => o.salonId === salonId) ?? null;
}

/** Shop tasks for barbers (with photo proof). One doc per task: `data/tasks/<id>.json`. */
const TASK_PREFIX = 'data/tasks/';
const taskPath = (id: string) => `${TASK_PREFIX}${id}.json`;

export async function saveTask(t: SalonTask): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(t.id)) throw new Error('bad task id');
  await putDoc(taskPath(t.id), t);
}

export async function getTask(id: string): Promise<SalonTask | null> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  return getDoc<SalonTask>(taskPath(id));
}

export async function listTasks(): Promise<SalonTask[]> {
  const paths = await listDocs(TASK_PREFIX);
  const out: SalonTask[] = [];
  for (const p of paths) {
    if (!p.endsWith('.json')) continue;
    const t = await getDoc<SalonTask>(p);
    if (t && typeof t.id === 'string') out.push(t);
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

export async function deleteTask(id: string): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return;
  await delDoc(taskPath(id));
}
