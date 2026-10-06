'use client';

import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ReportProblemForm } from '@/components/ReportProblemButton';
import { CameraIcon, CheckSealIcon } from '@/components/Icons';

interface CompInfo {
  code: string;
  serviceName: string;
  value: number;
  status: string;
}

interface ComplaintRow {
  id: string;
  barberId: string;
  serviceName: string | null;
  text: string;
  photoUrl: string;
  status: 'open' | 'granted' | 'dismissed';
  createdAt: string;
  comp: CompInfo | null;
}

interface RecentBooking {
  id: string;
  date: string;
  time: string;
  barberName: string;
  serviceName: string | null;
}

function fmtWhen(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

const STATUS_CHIP: Record<string, string> = {
  open: 'chip !border-gold/60 !text-gold',
  granted: 'chip !border-green-600/40 !text-green-700',
  dismissed: 'chip !border-neutral-300 !text-neutral-500',
};

const STATUS_LABEL: Record<string, string> = {
  open: 'Under review',
  granted: 'Free haircut granted',
  dismissed: 'Reviewed — no issue found',
};

export function MyReportsSection({ token }: { token: string | null }) {
  const [open, setOpen] = useState(false);
  const [complaints, setComplaints] = useState<ComplaintRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [recent, setRecent] = useState<RecentBooking[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [picked, setPicked] = useState<RecentBooking | null>(null);
  const [sent, setSent] = useState(false);

  const getToken = () => token ?? '';

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/complaints', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const d = await r.json();
      if (r.ok) setComplaints(d.complaints ?? []);
    } catch { /* noop */ }
    setLoading(false);
    setLoaded(true);
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded) void load();
  }

  async function startReport() {
    setReporting(true);
    setPicked(null);
    setSent(false);
    setRecentLoading(true);
    try {
      const r = await fetch('/api/bookings/recent', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const d = await r.json();
      if (r.ok) setRecent(d.bookings ?? []);
    } catch { /* noop */ }
    setRecentLoading(false);
  }

  return (
    <section>
      <button
        onClick={toggle}
        className="w-full card p-4 flex items-center gap-3 text-left"
      >
        <span className="rounded-full w-10 h-10 bg-gold/10 border border-gold/40 flex items-center justify-center text-gold shrink-0">
          <CameraIcon size={18} />
        </span>
        <span className="flex-1">
          <b className="text-[15px] block">My reports</b>
          <span className="text-xs text-neutral-500">Problem with a haircut? Send us a photo</span>
        </span>
        <span className={`text-gold transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="card p-5 mt-2.5 fade-in">
          {sent ? (
            <div className="text-center py-4">
              <div className="text-[40px] mb-2">📩</div>
              <h3 className="font-extrabold text-[16px]">Report sent</h3>
              <p className="text-[14px] text-neutral-600 mt-2 leading-relaxed">
                The shop owner will review your report and photo. If he finds a real problem,
                he can give you a <b>free haircut of the same value</b>.
              </p>
              <button
                onClick={() => { setSent(false); setReporting(false); setPicked(null); void load(); }}
                className="gold-btn rounded-2xl w-full font-extrabold text-[15px] py-3 mt-4"
              >
                Done
              </button>
            </div>
          ) : reporting && !picked ? (
            <>
              <h3 className="font-extrabold text-[16px] mb-1">Which appointment?</h3>
              <p className="text-[13px] text-neutral-500 mb-3">Pick the haircut you had a problem with.</p>
              {recentLoading ? (
                <p className="text-sm text-neutral-500 text-center py-4">Loading…</p>
              ) : recent.length === 0 ? (
                <p className="text-sm text-neutral-500 text-center py-4">No recent appointments.</p>
              ) : (
                <div className="grid gap-2">
                  {recent.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => setPicked(b)}
                      className="text-left rounded-2xl border border-[#e6dabf] bg-[#f7f2e2] px-4 py-3 card-hover"
                    >
                      <b className="text-[14px] block">{b.serviceName ?? 'Haircut'} — {b.barberName}</b>
                      <span className="text-[12px] text-neutral-500">{b.date} · {b.time}</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => setReporting(false)}
                className="w-full mt-3 text-sm text-neutral-500 font-medium py-2"
              >
                Cancel
              </button>
            </>
          ) : reporting && picked ? (
            <>
              <button
                onClick={() => setPicked(null)}
                className="text-[13px] text-gold font-semibold mb-2"
              >
                ← Pick another appointment
              </button>
              <ReportProblemForm
                bookingId={picked.id}
                barberName={picked.barberName}
                getToken={getToken}
                onSent={() => setSent(true)}
              />
            </>
          ) : (
            <>
              {loading ? (
                <p className="text-sm text-neutral-500 text-center py-4">Loading…</p>
              ) : complaints.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-[14px] text-neutral-600 leading-relaxed">
                    Had a problem with a haircut? Take a photo of it with your camera and send it
                    to the owner. If he finds a real problem, you get a <b>free haircut of the same value</b>.
                  </p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {complaints.map((c) => (
                    <div key={c.id} className="rounded-2xl border border-[#e6dabf] bg-[#f7f2e2] p-3.5">
                      <div className="flex items-start gap-3">
                        <img src={c.photoUrl} alt="Evidence" className="w-16 h-16 rounded-xl object-cover shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <b className="text-[14px]">{c.serviceName ?? 'Haircut'}</b>
                            <span className={STATUS_CHIP[c.status]}>{STATUS_LABEL[c.status]}</span>
                          </div>
                          <p className="text-[12px] text-neutral-500 mt-0.5">{fmtWhen(c.createdAt)}</p>
                          <p className="text-[13px] text-neutral-600 mt-1 leading-relaxed">{c.text}</p>
                        </div>
                      </div>
                      {c.status === 'granted' && c.comp && (
                        <div className="mt-3 rounded-2xl bg-white border-2 border-gold/60 p-4 text-center">
                          <p className="font-extrabold text-[15px] flex items-center justify-center gap-1.5">
                            <CheckSealIcon size={16} className="text-gold" /> Your free {c.comp.serviceName}
                          </p>
                          <p className="text-[12px] text-neutral-500 mt-0.5">Show this code at the shop — single use</p>
                          <div className="inline-block mt-2.5 p-2.5 bg-white rounded-xl border border-[#e6dabf]">
                            <QRCodeSVG value={c.comp.code} size={168} level="M" />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={startReport}
                className="gold-btn rounded-2xl w-full font-extrabold text-[15px] py-3 mt-4"
              >
                ⚠️ Report a problem
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
