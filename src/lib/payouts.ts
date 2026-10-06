import { getStripe, toCents } from '@/lib/stripe';
import { getBarbers, saveBarbers, getShopDebt, applyShopDeduction } from '@/lib/store';

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

  let transferId: string | undefined;
  if (net > 0) {
    try {
      const transfer = await getStripe().transfers.create(
        {
          amount: toCents(net),
          currency: 'usd',
          destination: barber.stripeAccountId,
          description: opts.description,
          metadata: {
            barberId,
            barberName: barber.name,
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
