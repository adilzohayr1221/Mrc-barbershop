// Shared data model types for MRC Barbershop.

// ---- Multi-salon tenancy -------------------------------------------------
// Every shop-level record belongs to one salon via `salonId`.
// A missing salonId means 'mrc' — the platform owner's own shops — so all
// existing MRC data keeps working unchanged (backward compatible).
export const PLATFORM_SALON_ID = 'mrc';

/** Tenant scope for shop-level records. Missing = platform owner's salon. */
export interface TenantScoped {
  salonId?: string;
}

export type SalonStatus = 'pending' | 'active' | 'suspended';

// A barbershop on the platform. The platform owner (super-admin) approves
// each salon; the salon owner then manages only their own shop.
export interface Salon {
  id: string;
  name: string; // salon display name, e.g. "Fade Factory"
  slug: string; // url-friendly, used in /customer?salon=<slug>
  ownerName: string;
  ownerEmail: string; // lowercase
  ownerPhone: string;
  city: string;
  status: SalonStatus;
  createdAt: string; // ISO
  approvedAt?: string | null; // ISO
}

// Login account for a salon owner (one per salon in v1).
export interface SalonOwner extends TenantScoped {
  id: string;
  salonId: string; // always set (required, not optional)
  name: string;
  email: string; // lowercase, unique
  passwordHash: string; // scrypt hash — never sent to clients
  active: boolean;
  createdAt: string; // ISO
}

// Tasks the shop owner assigns to barbers (e.g. "clean the mirrors").
// The barber completes the task and uploads a PHOTO as proof; the owner
// reviews the photo and approves. Formal assignment so nothing is awkward.
export type TaskAssignmentStatus = 'pending' | 'submitted' | 'approved';

export interface TaskAssignment {
  barberId: string;
  status: TaskAssignmentStatus;
  photoPath?: string | null; // proof photo under photos/
  submittedAt?: string | null; // ISO
  approvedAt?: string | null; // ISO
}

export interface SalonTask extends TenantScoped {
  id: string;
  title: string;
  description?: string;
  assignments: TaskAssignment[];
  createdBy: 'owner' | 'salon_owner';
  createdAt: string; // ISO
}

export interface Branch extends TenantScoped {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export interface Barber extends TenantScoped {
  id: string;
  name: string;
  photoPath: string | null; // blob pathname under photos/
  skills: string[];
  branchIds: string[];
  active: boolean;
  createdAt: string;
  // Barber self-signup (optional): barbers who create their own account with email.
  email?: string;
  passwordHash?: string; // scrypt hash, same helper as customer passwords
  approved?: boolean; // missing = approved (all owner-created barbers keep working)
  // Working hours set by the barber himself; missing = default shop slots.
  workingHours?: WorkingHours;
  // Stripe Connect: the barber's Express account for receiving payouts.
  // The barber links their bank via Stripe's secure onboarding — we never
  // see or store bank details, only this account ID.
  stripeAccountId?: string | null;
  payoutsEnabled?: boolean; // Connect onboarding complete, can receive transfers
  verifiedSkills?: string[]; // skills the owner verified from photo evidence
}

// A barber's photo evidence for one skill, sent to the owner as a batch.
// The owner approves → the skill shows as verified on the barber's profile.
export interface SkillVerification extends TenantScoped {
  id: string;
  barberId: string;
  skill: string;
  photoPaths: string[];
  status: 'draft' | 'pending' | 'approved' | 'rejected';
  createdAt: string;
  submittedAt?: string | null;
  reviewedAt?: string | null;
}

export interface Service extends TenantScoped {
  id: string;
  name: string;
  price: number;
  durationMin: number;
  active: boolean;
}

// Barber working hours, set by the barber himself from his dashboard.
// Keyed by JS weekday: '0' = Sunday … '6' = Saturday.
// Each day maps to the list of hours he works, e.g. { '1': ['09:00','11:00'] }.
// A working hour "HH:00" opens its two 30-min booking slots (HH:00 and HH:30).
// A missing or empty day = closed. If the whole workingHours is missing, the
// barber never set a schedule and the shop's default time slots (9 AM – 8:30 PM) apply.
export type WorkingHours = Partial<Record<'0' | '1' | '2' | '3' | '4' | '5' | '6', string[]>>;

export type BookingStatus = 'booked' | 'cancelled' | 'no_show';

export interface Booking extends TenantScoped {
  id: string;
  barberId: string;
  serviceId: string;
  branchId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  customerName: string;
  customerPhone: string;
  customerId: string | null; // linked customer account; null for pre-account bookings
  createdAt: string;
  status: BookingStatus; // 'booked' default; 'cancelled' keeps the record without hard-deleting
  paymentIntentId?: string | null; // Stripe PaymentIntent id
  paymentStatus?: 'paid' | 'refunded' | 'paid_in_full' | 'membership_pending' | 'membership_redeemed' | null; // 'paid' = deposit paid
  amountPaid?: number | null; // dollars, captured at booking time
  stripeCustomerId?: string | null; // Stripe customer owning the saved card
  stripePaymentMethodId?: string | null; // saved card, charged for the remaining balance after the haircut
  remainingPaymentIntentId?: string | null; // off-session charge for the remaining balance
  collectToken?: string | null; // single-use QR token for in-shop collection (server-side)
  collectTokenExpiry?: string | null; // ISO timestamp
  reminded24h?: boolean; // push reminder sent ~24h before the appointment
  reminded2h?: boolean; // push reminder sent ~2h before the appointment
  completedAt?: string | null; // ISO — when the barber marked the haircut done
  completionPhotoPath?: string | null; // proof-of-completion photo (camera) — required before payout
  membershipId?: string | null; // when booked with a plan: which plan it belongs to
  payoutTransferId?: string | null; // Stripe Transfer ID for the barber's payout
  payoutAmount?: number | null; // dollars transferred to the barber
}

// Monthly haircut plan ("Offers"): $120/month for 4 haircuts — one per week.
// Each week of the Stripe billing period grants one haircut credit; an unused
// weekly credit expires at the end of its week (no rollover). The weekly
// credit is consumed when the barber scans the member's code at the shop.
export type MembershipStatus = 'active' | 'past_due' | 'canceled';

export interface Membership extends TenantScoped {
  id: string;
  customerId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: MembershipStatus; // synced from Stripe whenever it is read
  currentPeriodStart: string; // ISO — Stripe subscription current period
  currentPeriodEnd: string; // ISO — Stripe subscription current period
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  qrToken?: string | null; // rotating short-lived token for the MRC2 QR code
  qrTokenExpiry?: string | null; // ISO timestamp
  // Mix & Match plan (missing planKind = standard $120 plan).
  planKind?: 'standard' | 'custom';
  planPriceUsd?: number; // custom plan monthly price
  weeklyServices?: { serviceId: string; name: string; price: number }[]; // 4 entries, week 0..3
  weekAlertsSent?: string[]; // `${periodStart}#${weekIndex}` already notified
}

export interface MembershipRedemption extends TenantScoped {
  id: string;
  membershipId: string;
  customerId: string;
  barberId: string;
  weekIndex: number; // 0..3 within the billing period
  periodStart: string; // ISO of the billing period this redemption belongs to
  redeemedAt: string; // ISO
  bookingId?: string | null; // auto-linked booking that day, if any
  photoPath?: string | null; // proof-of-completion photo (camera) — required before payout
}

// In-app chat between customer and barber, one thread per booking.
export interface ChatMessage {
  id: string;
  senderRole: 'customer' | 'barber';
  senderId: string;
  senderName: string;
  text: string; // max 500 chars
  createdAt: string; // ISO
}

export interface ChatDoc {
  bookingId: string;
  messages: ChatMessage[];
  customerLastRead?: string | null; // ISO — hides push when they're viewing
  barberLastRead?: string | null; // ISO
}

// Per-chat read-state for the new per-message file storage.
export interface ChatMeta {
  customerLastRead?: string | null; // ISO
  barberLastRead?: string | null; // ISO
}
// Barber work portfolio photos — uploaded by the barber, visible to customers
// only after the owner approves them.
export interface WorkPhoto extends TenantScoped {
  id: string;
  barberId: string;
  photoPath: string; // blob pathname under photos/
  status: 'pending' | 'approved';
  createdAt: string;
}

// Customer complaint about a barber/haircut, with camera-taken photo evidence.
// The owner reviews it and may grant a free haircut of the same value (comp),
// never a cash refund.
export interface Complaint extends TenantScoped {
  id: string;
  customerId: string;
  barberId: string;
  bookingId?: string | null;
  serviceName?: string;
  text: string;
  photoPath: string; // camera-taken evidence photo under photos/
  status: 'open' | 'granted' | 'dismissed';
  createdAt: string;
  resolvedAt?: string | null;
  compId?: string | null;
}

// Free-haircut compensation granted by the owner for a complaint.
// Single-use QR (MRC4); the customer pays nothing and the barber gets no payout.
export interface Comp extends TenantScoped {
  id: string;
  token: string;
  customerId: string;
  complaintId: string;
  serviceId?: string | null;
  serviceName: string;
  value: number; // dollars — same value as the complained-about haircut
  status: 'active' | 'redeemed';
  createdAt: string;
  redeemedAt?: string | null;
  redeemedByBarberId?: string | null;
}

// Tip (بقشيش) from a customer to a barber after a haircut.
// Charged off-session on the customer's saved card; 100% goes to the barber.
export interface Tip extends TenantScoped {
  id: string;
  barberId: string;
  customerId: string;
  amount: number; // dollars
  source: 'booking' | 'redemption' | 'gift';
  sourceId: string; // bookingId / redemptionId / giftId
  paymentIntentId: string;
  payoutTransferId?: string | null;
  payoutFailed?: boolean;
  createdAt: string;
}

// Web-push subscriptions (one per device). role+userId = who to notify.
export interface PushSubscriptionDoc extends TenantScoped {
  id: string;
  role: 'customer' | 'barber';
  userId: string; // customerId or barberId
  subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };
  createdAt: string;
}

export interface Customer extends TenantScoped {
  id: string;
  name: string;
  email: string; // lowercase, trimmed, unique
  passwordHash: string; // scrypt hash — never sent to clients
  createdAt: string;
  stripeCustomerId?: string | null; // Stripe customer for saved payment methods
  photoPath?: string | null; // profile photo in Blob (served via /api/photos/)
  favoriteBarberId?: string | null; // barber the customer starred as favorite
}

// Public-safe customer (never includes passwordHash)
export interface PublicCustomer {
  id: string;
  name: string;
  email: string;
}

export interface Review extends TenantScoped {
  id: string;
  barberId: string;
  customerName: string;
  customerId?: string; // set for reviews written by logged-in customers
  rating: number; // 1..5
  text: string;
  createdAt: string;
}

export interface PinsDoc {
  ownerHash: string;
  barbers: Record<string, string>; // barberId -> bcrypt hash
}

// Gift haircuts: a customer buys a full-price service as a gift for someone
// else (son, friend, brother…). The gift is a single-use QR code (MRC3)
// plus a 6-character shareable short code; the recipient shows it at the
// shop and the barber redeems it with the scanner. Valid 12 months.
export type GiftStatus = 'active' | 'redeemed';

export interface Gift extends TenantScoped {
  id: string;
  buyerCustomerId: string;
  buyerName: string;
  recipientName: string | null;
  serviceId: string;
  serviceName: string;
  price: number;
  status: GiftStatus;
  token: string;
  shortCode: string;
  expiresAt: string; // ISO
  stripePaymentIntentId: string;
  createdAt: string; // ISO
  redeemedAt: string | null; // ISO
  redeemedByBarberId: string | null;
  claimedByCustomerId: string | null; // recipient who saved the gift to his account
  claimedAt: string | null; // ISO — when the recipient claimed it
  payoutTransferId?: string | null; // Stripe Transfer ID for the barber's payout
  payoutAmount?: number | null; // dollars transferred to the redeeming barber
  completionPhotoPath?: string | null; // proof-of-completion photo (camera) — required before payout
}

// Public-safe barber (never includes PINs)
export interface PublicBarber {
  id: string;
  name: string;
  photoUrl: string | null;
  skills: string[];
  branchIds: string[];
  reviewCount: number;
  avgRating: number | null;
  workingHours?: WorkingHours;
  workPhotos?: string[]; // approved portfolio photo URLs
  verifiedSkills?: string[]; // owner-verified skills (show a ✓ badge)
}

// Barber team group chat: one shared thread for all active barbers in the shop.
export interface TeamChatMessage {
  id: string;
  senderBarberId: string;
  senderName: string;
  text: string; // max 500 chars
  createdAt: string; // ISO
}

export interface TeamChatDoc {
  messages: TeamChatMessage[];
  lastRead: Record<string, string>; // barberId -> ISO of last view
  ownerLastRead?: string | null; // owner's ghost read position — never exposed to barbers
}

// A barbershop owner asking for his own MRC-style app (the /partners page).
export interface PartnerLead {
  id: string;
  name: string;
  salonName: string;
  phone: string;
  email: string;
  city: string;
  createdAt: string; // ISO
}

// Barber supply shop (owner stocks real items in the shop's storage room).
// The barber never pays by card — purchases are deducted from his earnings:
// each payout first settles his outstanding supply debt, oldest order first.
export interface ShopProduct extends TenantScoped {
  id: string;
  name: string;
  description: string;
  priceUsd: number;
  photoPath: string | null; // blob pathname
  inStock: boolean;
  createdAt: string; // ISO
}

export interface ShopOrder extends TenantScoped {
  id: string;
  barberId: string;
  barberName: string;
  productId: string;
  productName: string;
  priceUsd: number; // line total = unitPriceUsd * quantity
  unitPriceUsd: number;
  quantity: number;
  photoPath: string | null;
  // Payment: 'earnings' = deducted from future payouts (the primary method);
  // 'card' = paid immediately by card/Apple Pay (secondary).
  payMethod: 'earnings' | 'card';
  paymentIntentId?: string | null; // card payments only
  // Lifecycle: pending (owner hasn't handed it over — barber can cancel) ->
  // confirmed (owner handed it over — no more cancel) | cancelled.
  status: 'pending' | 'confirmed' | 'cancelled';
  deductedUsd: number; // settled so far from the barber's payouts (earnings only, after confirm)
  settledKeys: string[]; // payout idempotency keys already applied (safe retry)
  confirmedAt?: string | null;
  cancelledAt?: string | null;
  createdAt: string; // ISO
}
