import { getStripe, toCents } from '@/lib/stripe';
import {
  getBarbers, saveBarbers, getShopDebt, applyShopDeduction,
  listBookings, saveBooking, listGifts, saveGift, listTips, saveTip,
  listWalkinPayments, saveWalkinPayment,
  listMemberships, listRedemptions, saveRedemption,
  claimOnceStale, releaseClaim,
} from '@/lib/store';
import { membershipRedemptionPayout, membershipPayoutKey } from '@/lib/membership';
import { payoutForBooking } from '@/lib/vip';
import { bookingStarted } from '@/lib/earnings';

// Barber payouts via Stripe Connect.
// Money flow: all customer charges land in the owner's (platform) Stripe
// account first. When a haircut is done, we transfer the barber's share to
// their connected Express account. The barber links their bank via Stripe's
// secure onboarding — we never see or store bank details.
//
// Supply shop: the barber never pays by card for shop supplies. Any
// outstanding supply-shop debt is settled from each payout FIRST (oldest
// order first) — the withheld part simply stays in the platform account,
// because the owner is the one who sold the items.

export interface PayoutResult {
  ok: boolean;
  transferId?: string;
  supplyDeducted?: number; // USD settled from the barber's supply-shop debt
  error?: string;
}

/**
 * Transfer an amount to a barber's connected Stripe account.
 * Returns { ok: true, transferId } or { ok: false, error }.
 * Idempotent via the idempotency key — safe to retry.
 */
export async function payoutToBarber(
  barberId: string,
  amountUsd: number,
  opts: { idempotencyKey: string; description: string; metadata?: Record<string, string> }
): Promise<PayoutResult> {
  const amount = Math.round(amountUsd * 100) / 100;
  if (amount <= 0) return { ok: false, error: 'Nothing to pay out.' };

  const barbers = await getBarbers();
  const barber = barbers.find((b) => b.id === barberId);
  if (!barber) return { ok: false, error: 'Barber not found.' };
  if (!barber.stripeAccountId) {
    return { ok: false, error: `${barber.name} has not connected a bank account yet.` };
  }

  // Settle supply-shop debt from this payout first (never by card).
  // Audit M1 (2026-10-29): the read-debt → transfer → settle sequence was
  // not atomic — two concurrent payouts for the same barber (different
  // bookings, different idempotency keys) could both read the same debt,
  // both withhold it from their transfers, and the barber lost it twice
  // (the second settle then found nothing left to settle). The whole
  // sequence now runs under a per-barber debt lock (create-only claim,
  // stealable after 2 minutes so a crashed invocation can't wedge it).
  // A payout that can't get the lock simply doesn't withhold — the debt
  // stays outstanding and settles from the next payout instead of ever
  // being settled twice. A crash between transfer and settle is healed by
  // the caller's same-key retry, which re-runs this flow (Stripe returns
  // the original transfer for the same idempotency key).
  let supplyDeducted = 0;
  const debtLockKey = `shop-debt-lock-${barberId}`;
  const debtLock = await claimOnceStale(debtLockKey, 2 * 60 * 1000).catch(() => false);
  try {
    if (debtLock) {
      try {
        const debt = await getShopDebt(barberId);
        supplyDeducted = Math.min(debt, amount);
      } catch (e) {
        console.error('[payout] shop debt check failed', barberId, e);
      }
    }
    return await payoutWithDebtSettled(barberId, barber, amount, supplyDeducted, opts);
  } finally {
    if (debtLock) await releaseClaim(debtLockKey).catch(() => {});
  }
}

async function payoutWithDebtSettled(
  barberId: string,
  barber: { name: string; stripeAccountId?: string | null },
  amount: number,
  supplyDeducted: number,
  opts: { idempotencyKey: string; description: string; metadata?: Record<string, string> }
): Promise<PayoutResult> {
  if (!barber.stripeAccountId) {
    return { ok: false, error: `${barber.name} has not connected a bank account yet.` };
  }
  const stripeAccountId: string = barber.stripeAccountId;
  const net = Math.round((amount - supplyDeducted) * 100) / 100;

  // The barber bears Stripe's bank-payout fee (owner's rule). Stripe v2 +
  // express dashboard requires the platform as fees_collector, so we deduct
  // the $0.25 fee here before transferring.
  const STRIPE_PAYOUT_FEE_USD = 0.25;
  const netAfterFee = Math.max(0, Math.round((net - STRIPE_PAYOUT_FEE_USD) * 100) / 100);

  let transferId: string | undefined;
  if (netAfterFee > 0) {
    try {
      const transfer = await getStripe().transfers.create(
        {
          amount: toCents(netAfterFee),
          currency: 'usd',
          destination: stripeAccountId,
          description: opts.description,
          metadata: {
            barberId,
            barberName: barber.name,
            payoutFeeUsd: STRIPE_PAYOUT_FEE_USD.toFixed(2),
            ...(supplyDeducted > 0 ? { supplyDeductedUsd: supplyDeducted.toFixed(2) } : {}),
            ...(opts.metadata ?? {}),
          },
        },
        { idempotencyKey: opts.idempotencyKey }
      );
      transferId = transfer.id;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Transfer failed.';
      console.error('[payout] transfer failed', barberId, msg);
      return { ok: false, error: msg };
    }
  }

  // Only mark the debt settled once the money has actually moved
  // (or the whole payout was consumed by the debt — nothing to transfer).
  if (supplyDeducted > 0) {
    try {
      await applyShopDeduction(barberId, supplyDeducted, opts.idempotencyKey);
    } catch (e) {
      console.error('[payout] shop deduction ledger failed', barberId, e);
    }
  }
  return { ok: true, transferId, supplyDeducted };
}

/**
 * Refresh a barber's Connect account status from Stripe (Accounts v2).
 * Updates payoutsEnabled on the barber record.
 */
export async function refreshConnectStatus(barberId: string): Promise<{ payoutsEnabled: boolean; detailsSubmitted: boolean }> {
  const barbers = await getBarbers();
  const barber = barbers.find((b) => b.id === barberId);
  if (!barber?.stripeAccountId) return { payoutsEnabled: false, detailsSubmitted: false };

  const account = await getStripe().v2.core.accounts.retrieve(barber.stripeAccountId, {
    include: ['configuration.recipient', 'requirements'],
  });
  const transfersStatus =
    account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status;
  const payoutsEnabled = transfersStatus === 'active';
  const reqSummary = account.requirements?.summary;
  const detailsSubmitted =
    reqSummary?.minimum_deadline?.status !== 'currently_due' &&
    reqSummary?.minimum_deadline?.status !== 'past_due';

  if (barber.payoutsEnabled !== payoutsEnabled) {
    barber.payoutsEnabled = payoutsEnabled;
    await saveBarbers(barbers);
  }
  return { payoutsEnabled, detailsSubmitted };
}

// ---------------------------------------------------------------------------
// Failed-payout retry sweep.
//
// A payout can fail at completion time even though the customer paid — most
// commonly because Stripe has not yet released the charge's funds to the
// platform's available balance (first live charges are held for days). The
// original routes persist the failure (no transfer id), and this sweep —
// run by the reminders cron — retries until the money lands, so a barber's
// pay is never stranded silently.
//
// Double-pay safety: before transferring, the sweep looks for an existing
// Stripe transfer to the same barber carrying the same source metadata
// (covers a first attempt whose response was lost after the transfer was
// created — Stripe idempotency keys only live 24h) and adopts it instead.
// Retries also reuse the original idempotency key.
export interface PayoutRetryOutcome {
  checked: number;
  paid: number;
  adopted: number;
  stillFailing: number;
}

const RETRY_WINDOW_DAYS = 45;

async function findExistingTransfer(
  destination: string,
  matchMeta: (m: Record<string, string>) => boolean,
  whenIso: string
): Promise<string | null> {
  try {
    const t = new Date(whenIso).getTime();
    const list = await getStripe().transfers.list({
      destination,
      created: {
        gte: Math.floor((t - 3600_000) / 1000),
        lte: Math.floor((t + 48 * 3600_000) / 1000),
      },
      limit: 100,
    });
    const hit = list.data.find((tr) => matchMeta((tr.metadata ?? {}) as Record<string, string>));
    return hit?.id ?? null;
  } catch {
    return null;
  }
}

export async function retryFailedPayouts(): Promise<PayoutRetryOutcome> {
  const out: PayoutRetryOutcome = { checked: 0, paid: 0, adopted: 0, stillFailing: 0 };
  const cutoff = Date.now() - RETRY_WINDOW_DAYS * 24 * 3600 * 1000;
  const [barbers, bookings, gifts, tips, memberships, walkins] = await Promise.all([
    getBarbers(),
    listBookings(),
    listGifts(),
    listTips(),
    listMemberships(),
    listWalkinPayments(),
  ]);
  const barberById = new Map(barbers.map((b) => [b.id, b]));

  async function attempt(o: {
    barberId: string;
    amount: number;
    idempotencyKey: string;
    description: string;
    metadata: Record<string, string>;
    matchMeta: (m: Record<string, string>) => boolean;
    whenIso: string;
    onSuccess: (transferId: string | null) => Promise<void>;
  }): Promise<void> {
    const barber = barberById.get(o.barberId);
    if (!barber?.stripeAccountId) return;
    if (!(o.amount > 0)) return;
    if (new Date(o.whenIso).getTime() < cutoff) return;
    out.checked++;
    const existing = await findExistingTransfer(barber.stripeAccountId, o.matchMeta, o.whenIso);
    if (existing) {
      await o.onSuccess(existing);
      out.adopted++;
      return;
    }
    const result = await payoutToBarber(o.barberId, o.amount, {
      idempotencyKey: o.idempotencyKey,
      description: o.description,
      metadata: o.metadata,
    });
    if (result.ok) {
      await o.onSuccess(result.transferId ?? null);
      out.paid++;
    } else {
      out.stillFailing++;
    }
  }

  // Automatic remaining-balance charges (owner's order, 2026-10-25).
  // Bookings completed before automatic charging existed — or whose
  // completion-time charge failed — still sit at paymentStatus 'paid'
  // with only the $5 deposit collected; the rest of the price is owed by
  // the customer's saved card. Charge it here, BEFORE the payout loop
  // below, so the payout in this same pass covers the full amount.
  // Safety mirrors the payout rules: never charge for an appointment
  // whose start hasn't arrived (audit M2), never touch cancelled or
  // membership bookings, and the charge itself is idempotent per booking.
  try {
    const { chargeRemainingBalance } = await import('@/lib/balanceCharge');
    for (const b of bookings) {
      if (!b.completedAt) continue;
      if (b.status === 'cancelled') continue;
      if (b.paymentStatus !== 'paid') continue;
      if (new Date(b.completedAt).getTime() < cutoff) continue;
      if (!bookingStarted(b)) continue;
      try {
        await chargeRemainingBalance(b);
      } catch (e) {
        console.error('[sweep] balance charge failed', b.id, e);
      }
    }
  } catch (e) {
    console.error('[sweep] balance-charge pass failed', e);
  }

  // Booking payouts (photo-verified completions).
  for (const b of bookings) {
    if (!b.completedAt) continue;
    if (b.status === 'cancelled') continue;
    if (b.paymentStatus !== 'paid' && b.paymentStatus !== 'paid_in_full') continue;
    // Audit M2: never pay for an appointment whose start hasn't arrived
    // (a future booking marked done early) — it becomes payable here once
    // its start passes.
    if (!bookingStarted(b)) continue;
    const owed = payoutForBooking(b);
    const already = b.payoutAmount ?? 0;
    if (owed <= 0 || already >= owed) continue;
    if (!b.payoutTransferId && already === 0) {
      // First (full) payout attempt — unchanged behavior.
      await attempt({
        barberId: b.barberId,
        amount: owed,
        idempotencyKey: `payout-booking-${b.id}`,
        description: `MRC Barbershops — haircut payout (${b.date} ${b.time})`,
        metadata: { kind: 'booking_payout', bookingId: b.id },
        matchMeta: (m) => m.bookingId === b.id && m.leg !== 'remainder',
        whenIso: b.completedAt,
        onSuccess: async (tid) => {
          b.payoutTransferId = tid;
          b.payoutAmount = owed;
          await saveBooking(b);
        },
      });
    } else {
      // Audit H3 (2026-10-22): the remainder leg. Done paid out what was
      // collected at the time (the $5 deposit); Collect later grew the
      // collected total, but the old sweep skipped any booking that already
      // had a transfer — stranding the rest (e.g. $35) forever. Pay exactly
      // the difference, under its own idempotency key + metadata leg.
      const remainder = Math.round((owed - already) * 100) / 100;
      await attempt({
        barberId: b.barberId,
        amount: remainder,
        idempotencyKey: `payout-booking-${b.id}-remainder`,
        description: `MRC Barbershops — haircut payout, remainder (${b.date} ${b.time})`,
        metadata: { kind: 'booking_payout', bookingId: b.id, leg: 'remainder' },
        matchMeta: (m) => m.bookingId === b.id && m.leg === 'remainder',
        whenIso: b.completedAt,
        onSuccess: async () => {
          b.payoutAmount = owed;
          await saveBooking(b);
        },
      });
    }
  }

  // Gift payouts (full gift value to the redeeming barber).
  for (const g of gifts) {
    if (g.status !== 'redeemed' || !g.redeemedAt || !g.redeemedByBarberId) continue;
    if (g.payoutTransferId || (g.payoutAmount ?? 0) > 0) continue;
    await attempt({
      barberId: g.redeemedByBarberId,
      amount: g.price,
      idempotencyKey: `payout-gift-${g.id}`,
      description: `MRC Barbershops — gift haircut payout (${g.serviceName})`,
      metadata: { kind: 'gift_payout', giftId: g.id },
      matchMeta: (m) => m.giftId === g.id,
      whenIso: g.redeemedAt,
      onSuccess: async (tid) => {
        g.payoutTransferId = tid;
        g.payoutAmount = g.price;
        await saveGift(g);
      },
    });
  }

  // Tip payouts (100% to the barber).
  for (const t of tips) {
    if (!t.payoutFailed || t.payoutTransferId) continue;
    await attempt({
      barberId: t.barberId,
      amount: t.amount,
      idempotencyKey: `payout-tip-${t.source}-${t.sourceId}`,
      description: `MRC Barbershops — customer tip ($${t.amount.toFixed(2)})`,
      metadata: { kind: 'tip_payout', tipId: t.id },
      matchMeta: (m) => m.tipId === t.id,
      whenIso: t.createdAt,
      onSuccess: async (tid) => {
        t.payoutTransferId = tid;
        t.payoutFailed = false;
        await saveTip(t);
      },
    });
  }

  // Walk-in QR payouts (100% to the barber).
  for (const w of walkins) {
    if (!w.payoutFailed || w.payoutTransferId) continue;
    await attempt({
      barberId: w.barberId,
      amount: w.amount,
      idempotencyKey: `payout-walkin-pi-${w.paymentIntentId}`,
      description: `MRC Barbershops — walk-in payment ($${w.amount.toFixed(2)})`,
      metadata: { kind: 'walkin_payout', walkinId: w.id },
      matchMeta: (m) => m.walkinId === w.id,
      whenIso: w.createdAt,
      onSuccess: async (tid) => {
        w.payoutTransferId = tid;
        w.payoutFailed = false;
        await saveWalkinPayment(w);
      },
    });
  }

  // Membership payouts — only redemptions whose outcome was persisted as
  // failed (older redemptions predate outcome persistence and are never
  // touched, so a payout that landed back then can't be duplicated).
  for (const m of memberships) {
    const reds = await listRedemptions(m.id).catch(() => []);
    for (const r of reds) {
      if (!r.payoutFailed || r.payoutTransferId) continue;
      const amount = membershipRedemptionPayout(m, r.guest === true);
      await attempt({
        barberId: r.barberId,
        amount,
        // Guest-aware key — must match the redeem route exactly, or a guest
        // retry could collide with the member's own payout for that week.
        idempotencyKey: membershipPayoutKey(m.id, r.weekIndex, r.periodStart, r.guest === true),
        description:
          r.guest === true
            ? `MRC Barbershops — plan GUEST haircut payout (Week ${r.weekIndex + 1})`
            : `MRC Barbershops — plan haircut payout (Week ${r.weekIndex + 1})`,
        // Audit H3 (2026-10-29): the transfer metadata and the adoption
        // matcher now carry the full redemption identity — week index,
        // period start and guest flag. The old matcher (kind + membershipId
        // only) could adopt the WRONG transfer for a retry: the member's
        // retry could adopt the guest's transfer for the same week (or
        // another week's), recording a payout that never happened for this
        // redemption while the real one stayed stranded.
        metadata: {
          kind: 'membership_payout',
          membershipId: m.id,
          weekIndex: String(r.weekIndex),
          periodStart: r.periodStart,
          ...(r.guest === true ? { guest: '1' } : {}),
        },
        matchMeta: (md) => {
          if (md.kind !== 'membership_payout' || md.membershipId !== m.id) return false;
          if ((md.guest === '1') !== (r.guest === true)) return false;
          if (md.weekIndex !== undefined || md.periodStart !== undefined) {
            // Post-fix transfer: require the exact redemption identity.
            return md.weekIndex === String(r.weekIndex) && md.periodStart === r.periodStart;
          }
          // Legacy transfer (created before week/period were stamped):
          // adoptable only when the guest flag matches — the find window
          // is anchored on this redemption's own timestamp.
          return true;
        },
        whenIso: r.redeemedAt,
        onSuccess: async (tid) => {
          r.payoutTransferId = tid;
          r.payoutFailed = false;
          await saveRedemption(r);
        },
      });
    }
  }

  return out;
}
