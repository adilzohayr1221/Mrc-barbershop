import { getStripe, toCents } from '@/lib/stripe';
import {
  getBarbers, saveBarbers, getShopDebt, applyShopDeduction,
  listBookings, saveBooking, listGifts, saveGift, listTips, saveTip,
  listWalkinPayments, saveWalkinPayment,
  listMemberships, listRedemptions, saveRedemption,
} from '@/lib/store';
import { membershipPayoutPerWeek } from '@/lib/membership';

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
  let supplyDeducted = 0;
  try {
    const debt = await getShopDebt(barberId);
    supplyDeducted = Math.min(debt, amount);
  } catch (e) {
    console.error('[payout] shop debt check failed', barberId, e);
  }
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
          destination: barber.stripeAccountId,
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

  // Booking payouts (photo-verified completions).
  for (const b of bookings) {
    if (!b.completedAt || b.payoutTransferId || (b.payoutAmount ?? 0) > 0) continue;
    if (b.status === 'cancelled') continue;
    if (b.paymentStatus !== 'paid' && b.paymentStatus !== 'paid_in_full') continue;
    const amount = Math.round((b.amountPaid ?? 0) * 100) / 100;
    await attempt({
      barberId: b.barberId,
      amount,
      idempotencyKey: `payout-booking-${b.id}`,
      description: `MRC Barbershop — haircut payout (${b.date} ${b.time})`,
      metadata: { kind: 'booking_payout', bookingId: b.id },
      matchMeta: (m) => m.bookingId === b.id,
      whenIso: b.completedAt,
      onSuccess: async (tid) => {
        b.payoutTransferId = tid;
        b.payoutAmount = amount;
        await saveBooking(b);
      },
    });
  }

  // Gift payouts (full gift value to the redeeming barber).
  for (const g of gifts) {
    if (g.status !== 'redeemed' || !g.redeemedAt || !g.redeemedByBarberId) continue;
    if (g.payoutTransferId || (g.payoutAmount ?? 0) > 0) continue;
    await attempt({
      barberId: g.redeemedByBarberId,
      amount: g.price,
      idempotencyKey: `payout-gift-${g.id}`,
      description: `MRC Barbershop — gift haircut payout (${g.serviceName})`,
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
      idempotencyKey: `payout-tip-${t.id}`,
      description: `MRC Barbershop — customer tip ($${t.amount.toFixed(2)})`,
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
      idempotencyKey: `payout-walkin-${w.id}`,
      description: `MRC Barbershop — walk-in payment ($${w.amount.toFixed(2)})`,
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
      const amount = membershipPayoutPerWeek(m);
      await attempt({
        barberId: r.barberId,
        amount,
        idempotencyKey: `payout-membership-${m.id}-${r.weekIndex}-${r.periodStart}`,
        description: `MRC Barbershop — plan haircut payout (Week ${r.weekIndex + 1})`,
        metadata: { kind: 'membership_payout', membershipId: m.id },
        matchMeta: (md) => md.kind === 'membership_payout' && md.membershipId === m.id,
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
