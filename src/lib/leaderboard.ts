import { getBarbers, listBookings, listReviews } from './store';
import { isHaircutDone, shopToday } from './earnings';
import { PLATFORM_SALON_ID } from './types';

export interface LeaderboardEntry {
  barberId: string;
  name: string;
  photoPath: string | null;
  cuts: number; // completed haircuts this month
  avgRating: number | null; // average rating from this month's reviews
  ratingCount: number;
}

/** Monthly barber ranking: most completed haircuts first, then best rating.
 *  Resets automatically every calendar month. */
export async function getLeaderboard(salonId: string): Promise<{
  monthLabel: string;
  entries: LeaderboardEntry[];
}> {
  const today = shopToday();
  const month = today.slice(0, 7); // YYYY-MM
  const monthLabel = new Date(`${today}T12:00:00`).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  const [barbers, bookings, reviews] = await Promise.all([
    getBarbers(),
    listBookings(),
    listReviews(),
  ]);
  const inSalon = barbers.filter(
    (b) =>
      b.active !== false &&
      (b.approved ?? true) &&
      (b.salonId || PLATFORM_SALON_ID) === salonId
  );
  const entries: LeaderboardEntry[] = inSalon.map((b) => {
    let cuts = 0;
    for (const bk of bookings) {
      if (bk.barberId !== b.id) continue;
      if (!bk.date.startsWith(month)) continue;
      if (isHaircutDone(bk, today)) cuts++;
    }
    const monthReviews = reviews.filter(
      (r) => r.barberId === b.id && r.createdAt.slice(0, 7) === month
    );
    const avgRating = monthReviews.length
      ? monthReviews.reduce((s, r) => s + r.rating, 0) / monthReviews.length
      : null;
    return {
      barberId: b.id,
      name: b.name,
      photoPath: b.photoPath ?? null,
      cuts,
      avgRating,
      ratingCount: monthReviews.length,
    };
  });
  entries.sort(
    (a, b) => b.cuts - a.cuts || (b.avgRating ?? -1) - (a.avgRating ?? -1)
  );
  return { monthLabel, entries };
}
