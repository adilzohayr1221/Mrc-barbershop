// Complete customer-account deletion (audit M7/M8, 2026-10-29), shared by
// the customer's self-delete and the owner's customer delete so both paths
// do exactly the same work.
//
// RETENTION NOTE: deleting an account removes the customer's identity and
// personal data — the login record, profile / ID / complaint photos, chat
// threads, push subscriptions, and the Stripe customer object (which drops
// the saved payment methods with it). Financial and business records are
// RETAINED: bookings, gifts, memberships, redemptions and tips keep their
// customerId and name/phone snapshots because the shop needs them for
// payouts, refunds, chargebacks and tax/bookkeeping records. They are
// never used to contact the person again, the login is gone, and the
// email is freed for a fresh signup.
import {
  getMembershipsByCustomer,
  listBookings,
  listComplaints,
  deletePhoto,
  deleteChatThread,
  listPushSubscriptions,
  deletePushSubscription,
  deleteCustomer,
  releaseClaim,
  signupEmailClaimKey,
} from './store';
import { getStripe, isStripeConfigured } from './stripe';
import type { Customer } from './types';

/** Cancel every live (active / past_due) Stripe subscription belonging to
 *  the customer's memberships. Returns human-readable failure strings;
 *  empty = everything cancelled (or nothing to cancel). */
export async function cancelCustomerSubscriptions(customerId: string): Promise<string[]> {
  const errors: string[] = [];
  if (!isStripeConfigured()) return errors;
  const memberships = await getMembershipsByCustomer(customerId);
  for (const m of memberships) {
    if (!m.stripeSubscriptionId) continue;
    if (m.status !== 'active' && m.status !== 'past_due') continue;
    try {
      await getStripe().subscriptions.cancel(m.stripeSubscriptionId);
    } catch (e) {
      console.error('[lifecycle] subscription cancel failed', m.stripeSubscriptionId, e);
      errors.push(`subscription ${m.stripeSubscriptionId}`);
    }
  }
  return errors;
}

export async function deleteCustomerAccountCompletely(
  customer: Customer,
  opts: { failLoudly: boolean }
): Promise<{ ok: boolean; errors: string[] }> {
  // 1) Stop the money first: a deleted account must never be charged again.
  const cancelErrors = await cancelCustomerSubscriptions(customer.id);
  if (opts.failLoudly && cancelErrors.length > 0) {
    // Owner path: refuse to delete while a subscription could not be
    // cancelled — deleting first would orphan a live billing subscription
    // with no account left to manage it.
    return { ok: false, errors: cancelErrors };
  }

  // 2) Drop the Stripe customer (and with it the saved payment methods).
  if (customer.stripeCustomerId && isStripeConfigured()) {
    try {
      await getStripe().customers.del(customer.stripeCustomerId);
    } catch (e) {
      console.error('[lifecycle] Stripe customer delete failed', customer.id, e);
    }
  }

  // 3) Personal photo blobs: profile photo, discount ID photo, and every
  // complaint photo the customer filed.
  if (customer.photoPath) await deletePhoto(customer.photoPath);
  if (customer.discount?.photoPath) await deletePhoto(customer.discount.photoPath);
  const complaints = (await listComplaints()).filter((c) => c.customerId === customer.id);
  for (const c of complaints) {
    if (c.photoPath) await deletePhoto(c.photoPath);
  }

  // 4) Chat threads for the customer's bookings.
  const bookings = (await listBookings()).filter((b) => b.customerId === customer.id);
  for (const b of bookings) {
    await deleteChatThread(b.id);
  }

  // 5) Push subscriptions (every device).
  const subs = await listPushSubscriptions('customer', customer.id);
  for (const s of subs) {
    await deletePushSubscription(s.id);
  }

  // 6) Free the email for a future signup, then remove the account record
  // itself (which also ends every session: requireActiveCustomer checks
  // the account still exists).
  await releaseClaim(signupEmailClaimKey(customer.email));
  await deleteCustomer(customer.id);
  return { ok: true, errors: cancelErrors };
}
