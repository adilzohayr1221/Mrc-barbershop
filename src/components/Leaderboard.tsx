'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LeaderboardEntry } from '@/lib/leaderboard';

const MEDALS = ['🥇', '🥈', '🥉'];

function photoUrl(photoPath: string | null): string | null {
  return photoPath
    ? `/api/photos/${encodeURIComponent(photoPath.split('/').pop() || '')}`
    : null;
}

/** Monthly barber ranking — most completed haircuts first, then best rating.
 *  Shared by owner, salon-owner and barber dashboards. Read-only everywhere. */
export function Leaderboard({
  apiBase,
  getToken,
}: {
  apiBase: string;
  getToken: () => string;
}) {
  const [monthLabel, setMonthLabel] = useState('');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    fetch(apiBase, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setMonthLabel(d.monthLabel || '');
          setEntries(d.entries || []);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [apiBase, getToken]);

  useEffect(() => {
    load();
  }, [load]);

  if (!loaded) return null;

  return (
    <div>
      <div className="text-center mt-1 mb-4">
        <div className="text-[40px] leading-none">🏆</div>
        <h2 className="font-extrabold text-[18px] mt-2 tracking-tight">
          <span className="gold-text">{monthLabel || 'This month'}</span>
        </h2>
        <p className="text-neutral-500 text-[13px] mt-1">
          Top barbers — most haircuts wins
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-neutral-500">No barbers yet.</p>
        </div>
      ) : (
        <div className="grid gap-2.5">
          {entries.map((e, i) => {
            const url = photoUrl(e.photoPath);
            return (
              <div
                key={e.barberId}
                className={`card p-4 flex items-center gap-3 ${
                  i === 0 ? 'border-2 border-gold' : ''
                }`}
              >
                <span className="w-9 text-center text-[22px] shrink-0">
                  {i < 3 ? MEDALS[i] : <span className="text-neutral-400 font-extrabold text-[16px]">#{i + 1}</span>}
                </span>
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt={e.name}
                    className="w-11 h-11 rounded-full object-cover shrink-0 border border-gold/40"
                  />
                ) : (
                  <span className="w-11 h-11 rounded-full bg-gold/15 border border-gold/40 flex items-center justify-center font-extrabold text-gold text-[16px] shrink-0">
                    {e.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="flex-1 min-w-0">
                  <span className="block font-bold text-[15px] truncate">{e.name}</span>
                  <span className="block text-[12px] text-neutral-500 mt-0.5">
                    {e.avgRating != null ? (
                      <>⭐ {e.avgRating.toFixed(1)} <span className="text-neutral-400">({e.ratingCount})</span></>
                    ) : (
                      <span className="text-neutral-400">No ratings yet</span>
                    )}
                  </span>
                </span>
                <span className="text-right shrink-0">
                  <span className="block font-extrabold text-[20px] gold-text">{e.cuts}</span>
                  <span className="block text-[10px] text-neutral-500 uppercase tracking-wide">
                    {e.cuts === 1 ? 'cut' : 'cuts'}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
