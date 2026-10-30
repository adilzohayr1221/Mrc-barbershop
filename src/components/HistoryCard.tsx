'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLang } from '@/components/LanguageContext';
import { formatDateUS, formatPhoneUS, formatTime12h } from '@/lib/format';

interface DayItem {
  time: string;
  customerName: string;
  serviceName: string;
  earned: number;
  photoUrl: string | null;
}
interface DayRow {
  date: string;
  customers: number;
  earned: number;
  items: DayItem[];
}
interface CustomerRow {
  name: string;
  phone: string;
  visits: number;
  lastDate: string;
  earned: number;
  photoUrl: string | null;
  usualService: string;
}

// A customer must be recognizable at a glance: his photo when he has one,
// otherwise a colored circle with his initial — the color is stable per
// name, so the barber learns "the teal A is Aquan" fast.
const AVATAR_COLORS = ['#b45309', '#0f766e', '#1d4ed8', '#be185d', '#7c3aed', '#15803d', '#c2410c', '#0369a1'];
function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function CustomerAvatar({ name, photoUrl, size = 40 }: { name: string; photoUrl: string | null; size?: number }) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        className="rounded-full object-cover shrink-0 border border-gold/40"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full flex items-center justify-center font-extrabold text-white shrink-0"
      style={{ width: size, height: size, background: colorFor(name), fontSize: size * 0.42 }}
    >
      {(name || '?').trim().charAt(0).toUpperCase()}
    </div>
  );
}

// Barber's work history, opened from Settings: every date he worked (tap
// a date to see that day's customers) and his customers ranked by visits —
// the most loyal customer first, crowned and badged so he stands out.
// Data comes from /api/barber/history (completed haircuts only).
export default function HistoryCard({ token }: { token: string }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'dates' | 'customers'>('dates');
  const [dates, setDates] = useState<DayRow[] | null>(null);
  const [customers, setCustomers] = useState<CustomerRow[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    fetch('/api/barber/history', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setDates(d.dates ?? []);
          setCustomers(d.customers ?? []);
        }
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  function openView() {
    load(); // always fresh when opened
    setOpen(true);
  }

  const money = (n: number) => `$${n.toFixed(2)}`;

  return (
    <>
      <button onClick={openView} className="card p-5 w-full text-left relative overflow-hidden card-hover">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-gold to-transparent" />
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-full bg-gold/15 border border-gold/40 flex items-center justify-center text-xl shrink-0">
            📅
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-extrabold text-[16px] text-[#141414]">{t('barber.history.title')}</div>
            <div className="text-[12px] text-neutral-500">{t('barber.history.sub')}</div>
          </div>
          <span className="text-neutral-400 font-extrabold text-lg shrink-0">›</span>
        </div>
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] bg-[#f7f2e2] overflow-y-auto fade-in">
          <div className="max-w-2xl mx-auto px-4 py-6">
            <div className="flex items-center justify-between mb-5">
              <h1 className="text-[22px] font-extrabold tracking-tight text-[#141414]">{t('barber.history.title')}</h1>
              <button
                onClick={() => setOpen(false)}
                className="w-10 h-10 rounded-full bg-white border border-gold/40 flex items-center justify-center text-[18px] font-bold text-neutral-600 card-hover"
                aria-label={t('barber.history.close_aria')}
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4">
              {(
                [
                  { key: 'dates', label: t('barber.history.tab_dates') },
                  { key: 'customers', label: t('barber.history.tab_customers') },
                ] as const
              ).map((tb) => (
                <button
                  key={tb.key}
                  onClick={() => setTab(tb.key)}
                  className={
                    tab === tb.key
                      ? 'rounded-full bg-[#141414] text-white font-bold text-[14px] py-2.5'
                      : 'rounded-full bg-white border border-gold/40 text-neutral-600 font-bold text-[14px] py-2.5'
                  }
                >
                  {tb.label}
                </button>
              ))}
            </div>

            {tab === 'dates' &&
              (dates === null ? null : dates.length === 0 ? (
                <div className="card p-8 text-center text-sm text-neutral-500">{t('barber.history.empty_dates')}</div>
              ) : (
                <div className="grid gap-2.5">
                  {dates.map((d) => (
                    <div key={d.date} className="card p-4">
                      <button
                        onClick={() => setExpanded(expanded === d.date ? null : d.date)}
                        className="w-full flex items-center justify-between gap-2 text-left"
                      >
                        <span className="font-extrabold text-[15px] text-[#141414]">{formatDateUS(d.date)}</span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className="text-[13px] text-neutral-500 font-semibold">
                            {d.customers} {d.customers === 1 ? t('barber.history.customer_one') : t('barber.history.customers')} ·{' '}
                            <span className="text-gold-dark font-extrabold">{money(d.earned)}</span>
                          </span>
                          <span className="text-neutral-400 font-extrabold">{expanded === d.date ? '▾' : '›'}</span>
                        </span>
                      </button>
                      {expanded === d.date && (
                        <div className="mt-3 border-t border-gold/25 pt-2.5 grid gap-2.5">
                          {d.items.map((it, i) => (
                            <div key={i} className="flex items-center gap-2.5">
                              <CustomerAvatar name={it.customerName} photoUrl={it.photoUrl} size={34} />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-[#141414] truncate">{it.customerName}</div>
                                {it.serviceName && <div className="text-[12px] text-neutral-500 truncate">{it.serviceName}</div>}
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-sm font-bold text-[#141414]">{formatTime12h(it.time)}</div>
                                <div className="text-[12px] font-bold text-gold-dark">{money(it.earned)}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}

            {tab === 'customers' &&
              (customers === null ? null : customers.length === 0 ? (
                <div className="card p-8 text-center text-sm text-neutral-500">{t('barber.history.empty_customers')}</div>
              ) : (
                <div className="grid gap-2.5">
                  {customers.map((c, i) => (
                    <div key={`${c.name}-${i}`} className="card p-4 flex items-center gap-3">
                      <div className="relative shrink-0">
                        <div className={i === 0 ? 'rounded-full ring-2 ring-[#d4af37] ring-offset-2 ring-offset-[#f7f2e2]' : ''}>
                          <CustomerAvatar name={c.name} photoUrl={c.photoUrl} size={46} />
                        </div>
                        <span
                          className={
                            i === 0
                              ? 'absolute -bottom-1.5 -right-1.5 min-w-[20px] h-[20px] px-1 rounded-full text-white text-[11px] font-extrabold flex items-center justify-center border-2 border-[#f7f2e2]'
                              : 'absolute -bottom-1.5 -right-1.5 min-w-[20px] h-[20px] px-1 rounded-full bg-[#141414] text-white text-[11px] font-extrabold flex items-center justify-center border-2 border-[#f7f2e2]'
                          }
                          style={i === 0 ? { background: 'linear-gradient(135deg, #a8821f, #d4af37)' } : undefined}
                        >
                          {i + 1}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-extrabold text-[15px] text-[#141414] truncate">
                          {c.name}
                          {i === 0 && (
                            <span className="ml-2 align-middle text-[11px] font-extrabold text-[#8a6d1c] bg-gold/20 border border-gold/50 rounded-full px-2 py-0.5 whitespace-nowrap">
                              👑 {t('barber.history.top_badge')}
                            </span>
                          )}
                        </div>
                        <div className="text-[12px] text-neutral-500 truncate">
                          {c.usualService ? `${t('barber.history.usually')} ${c.usualService} · ` : ''}
                          {t('barber.history.last_visit')} {formatDateUS(c.lastDate)}
                        </div>
                        {c.phone && <div className="text-[12px] text-neutral-500">📞 {formatPhoneUS(c.phone)}</div>}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-extrabold text-[16px] text-gold-dark">
                          {c.visits} {c.visits === 1 ? t('barber.history.visit_one') : t('barber.history.visits')}
                        </div>
                        <div className="text-[12px] text-neutral-500">{money(c.earned)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
          </div>
        </div>
      )}
    </>
  );
}
