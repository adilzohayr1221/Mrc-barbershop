// VIP home visits (owner's model, 2026-10-17): the customer pays a flat
// $100 for a haircut at home, paid in full at booking time. When the visit
// is completed (proof photo, same as in-shop), the barber's payout is $60
// and the platform keeps $40.
export const VIP_PRICE_USD = 100;
export const VIP_BARBER_PAYOUT_USD = 60;

// What a completed booking pays out to its barber. Regular bookings pay
// out everything collected; a VIP home visit pays the fixed $60 share.
export function payoutForBooking(b: { houseCall?: boolean; amountPaid?: number | null }): number {
  const paid = Math.round((b.amountPaid ?? 0) * 100) / 100;
  return b.houseCall ? Math.min(VIP_BARBER_PAYOUT_USD, paid) : paid;
}
