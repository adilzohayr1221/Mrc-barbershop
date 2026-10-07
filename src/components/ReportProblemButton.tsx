'use client';

import { useRef, useState } from 'react';

// The report form itself — textarea + camera-only photo. The photo input uses
// capture="environment" so the gallery picker is skipped and the evidence
// photo is always taken fresh with the camera.
export function ReportProblemForm({ bookingId, barberName, getToken, onSent }: {
  bookingId: string;
  barberName: string;
  getToken: () => string;
  onSent: () => void;
}) {
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setError('That file is not an image.');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError('Photo is too large (max 5MB).');
      return;
    }
    setPhoto(f);
    setError('');
    setPreview(URL.createObjectURL(f));
  }

  async function submit() {
    if (!photo) { setError('Take a photo with your camera.'); return; }
    if (text.trim().length < 5) { setError('Describe the problem in a few words.'); return; }
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('bookingId', bookingId);
      form.append('text', text.trim());
      form.append('photo', photo, 'evidence.jpg');
      const r = await fetch('/api/complaints', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not send the report.');
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the report.');
    }
    setBusy(false);
  }

  return (
    <>
      <p className="text-[13px] text-neutral-500 mb-4">
        What went wrong with {barberName}? Take a photo of it — the photo must be taken
        right now with your camera.
      </p>
      <label className="block text-[13px] font-bold text-neutral-700 mb-1.5">What happened?</label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={1000}
        placeholder="e.g. The haircut is uneven on the left side…"
        className="input w-full resize-none"
      />
      <label className="block text-[13px] font-bold text-neutral-700 mt-4 mb-1.5">
        Photo evidence — taken with your camera
      </label>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={pickPhoto}
        className="hidden"
      />
      {preview ? (
        <div className="relative rounded-2xl overflow-hidden border-2 border-gold/50">
          <img src={preview} alt="Evidence" className="w-full max-h-[220px] object-cover" />
          <button
            onClick={() => { setPhoto(null); setPreview(null); }}
            className="absolute top-2 right-2 w-9 h-9 rounded-full bg-black/60 text-white font-bold text-[15px]"
            aria-label="Remove photo"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full rounded-2xl border-2 border-dashed border-gold/50 bg-[#f7f2e2] py-8 text-center card-hover"
        >
          <div className="text-[32px]">📷</div>
          <p className="text-[14px] font-bold text-gold mt-1">Take a photo</p>
          <p className="text-[12px] text-neutral-500 mt-0.5">Opens your camera directly</p>
        </button>
      )}
      {error && (
        <p className="text-[13px] text-red-700 bg-red-600/10 border border-red-600/25 rounded-xl px-3.5 py-2.5 mt-3 text-center leading-relaxed">
          {error}
        </p>
      )}
      <button
        onClick={() => void submit()}
        disabled={busy}
        className="gold-btn rounded-2xl w-full font-extrabold text-[15px] py-3.5 mt-4 disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Send report to the owner'}
      </button>
    </>
  );
}

// Appointment-card button + modal wrapper around the form.
export function ReportProblemButton({ bookingId, barberName, getToken }: {
  bookingId: string;
  barberName: string;
  getToken: () => string;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  function close() {
    setOpen(false);
    setDone(false);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mt-2.5 inline-flex items-center gap-1.5 text-[13px] font-bold text-red-700 border border-red-600/30 rounded-full px-3.5 py-2 min-h-[40px] card-hover"
      >
        ⚠️ Report a problem
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <div className="absolute inset-0 bg-black/60" onClick={close} />
          <div className="relative card w-full max-w-sm p-5 fade-in max-h-[92dvh] overflow-y-auto">
            {done ? (
              <div className="text-center py-6">
                <div className="text-[44px] mb-3">📩</div>
                <h3 className="font-extrabold text-[18px]">Report sent</h3>
                <p className="text-[14px] text-neutral-600 mt-2 leading-relaxed">
                  The shop owner will review your report and photo. If he finds a real problem,
                  he can give you a <b>free haircut of the same value</b> — not a cash refund.
                </p>
                <button onClick={close} className="gold-btn rounded-2xl w-full font-extrabold text-[15px] py-3 mt-5">
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-extrabold text-[17px]">Report a problem</h3>
                  <button
                    onClick={close}
                    aria-label="Close"
                    className="w-9 h-9 shrink-0 rounded-full bg-neutral-100 border border-neutral-200 text-neutral-600 font-bold text-[15px] leading-none"
                  >
                    ✕
                  </button>
                </div>
                <ReportProblemForm
                  bookingId={bookingId}
                  barberName={barberName}
                  getToken={getToken}
                  onSent={() => setDone(true)}
                />
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
