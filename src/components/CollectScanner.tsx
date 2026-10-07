'use client';

import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { ScanIcon, CheckSealIcon } from '@/components/Icons';

interface Summary {
  kind: 'payment' | 'membership' | 'gift' | 'comp' | 'loyalty';
  customerName: string;
  token: string;
  // payment (MRC1)
  serviceName?: string;
  date?: string;
  time?: string;
  amount?: number;
  depositPaid?: number;
  price?: number;
  bookingId?: string;
  // membership (MRC2)
  membershipId?: string;
  weekLabel?: string;
  // gift (MRC3)
  giftId?: string;
  shortCode?: string;
  buyerName?: string;
  recipientName?: string | null;
  // comp — free haircut granted by the owner for a complaint (MRC4)
  compId?: string;
  // loyalty — free 5th haircut earned from the loyalty program (MRC5)
  rewardId?: string;
}

type ParsedCode =
  | { kind: 'payment'; bookingId: string; token: string }
  | { kind: 'membership'; membershipId: string; token: string }
  | { kind: 'gift'; giftId: string; token: string }
  | { kind: 'giftShort'; shortCode: string }
  | { kind: 'comp'; compId: string; token: string }
  | { kind: 'loyalty'; rewardId: string; token: string };

// How long to ignore the same failing code before allowing a retry —
// stops the scanner hammering the API while one bad QR stays in view.
const RETRY_COOLDOWN_MS = 4000;

// Barber-side: scan the customer's QR payment code with the phone camera,
// review the charge, then collect the remaining balance from the saved card.
export function CollectScanner({
  getToken,
  onCollected,
}: {
  getToken: () => string;
  onCollected: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [scanSession, setScanSession] = useState(0);
  const [phase, setPhase] = useState<'scan' | 'confirm' | 'done'>('scan');
  const [camError, setCamError] = useState('');
  const [startingCam, setStartingCam] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState('');
  const [showManual, setShowManual] = useState(false);
  // Proof-of-completion photo (membership/gift): taken with the camera before
  // the redeem payout is released — like DoorDash proof-of-delivery.
  const [photoStep, setPhotoStep] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const handledRef = useRef(false);
  const lastFailRef = useRef<{ code: string; at: number } | null>(null);
  const qrRef = useRef<Html5Qrcode | null>(null);

  function parseCode(raw: string): ParsedCode | null {
    const code = raw.trim();
    // A bare 6-character code is a gift short code (no colons).
    if (/^[A-Z0-9]{6}$/i.test(code)) return { kind: 'giftShort', shortCode: code.toUpperCase() };
    const parts = code.split(':');
    if (parts.length !== 3 || !parts[1] || !parts[2]) return null;
    if (parts[0] === 'MRC1') return { kind: 'payment', bookingId: parts[1], token: parts[2] };
    if (parts[0] === 'MRC2') return { kind: 'membership', membershipId: parts[1], token: parts[2] };
    if (parts[0] === 'MRC3') return { kind: 'gift', giftId: parts[1], token: parts[2] };
    if (parts[0] === 'MRC4') return { kind: 'comp', compId: parts[1], token: parts[2] };
    if (parts[0] === 'MRC5') return { kind: 'loyalty', rewardId: parts[1], token: parts[2] };
    return null;
  }

  async function stopCamera() {
    const q = qrRef.current;
    qrRef.current = null;
    if (q) {
      try {
        await q.stop();
      } catch {
        /* already stopped */
      }
      try {
        q.clear();
      } catch {
        /* noop */
      }
    }
  }

  function restartCamera() {
    lastFailRef.current = null;
    setError('');
    setCamError('');
    setScanSession((s) => s + 1);
  }

  async function handleCode(raw: string) {
    if (handledRef.current) return;
    const code = raw.trim();
    // Ignore the same failing code for a few seconds so we don't hammer
    // the API while one bad QR stays in front of the camera.
    const lf = lastFailRef.current;
    if (lf && lf.code === code && Date.now() - lf.at < RETRY_COOLDOWN_MS) return;
    const parsed = parseCode(code);
    if (!parsed) {
      lastFailRef.current = { code, at: Date.now() };
      setError('That code is not an MRC code. Point the camera at the QR on the customer\u2019s phone, or type the 6-letter gift code.');
      return;
    }
    handledRef.current = true;
    setBusy(true);
    setError('');
    try {
      if (parsed.kind === 'gift' || parsed.kind === 'giftShort') {
        const r = await fetch('/api/gifts/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify(
            parsed.kind === 'giftShort'
              ? { shortCode: parsed.shortCode, preview: true }
              : { giftId: parsed.giftId, token: parsed.token, preview: true }
          ),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not read the code.');
        // Good read — now stop the camera and show the confirmation.
        await stopCamera();
        const p = d.preview;
        setSummary({
          kind: 'gift',
          customerName: p.recipientName || 'Gift recipient',
          token: parsed.kind === 'gift' ? parsed.token : '',
          giftId: parsed.kind === 'gift' ? parsed.giftId : undefined,
          shortCode: parsed.kind === 'giftShort' ? parsed.shortCode : undefined,
          serviceName: p.serviceName,
          price: p.price,
          buyerName: p.buyerName,
          recipientName: p.recipientName ?? null,
        });
      } else if (parsed.kind === 'comp') {
        const r = await fetch('/api/comps/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({ compId: parsed.compId, token: parsed.token, preview: true }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not read the code.');
        // Good read — now stop the camera and show the confirmation.
        await stopCamera();
        const pc = d.preview;
        setSummary({
          kind: 'comp',
          customerName: pc.customerName || 'Customer',
token: parsed.token,
          compId: parsed.compId,
          serviceName: pc.serviceName,
          price: pc.value,
        });
      } else if (parsed.kind === 'loyalty') {
        const r = await fetch('/api/loyalty/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({ rewardId: parsed.rewardId, token: parsed.token, preview: true }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not read the code.');
        // Good read — now stop the camera and show the confirmation.
        await stopCamera();
        const pl = d.preview;
        setSummary({
          kind: 'loyalty',
          customerName: pl.customerName || 'Customer',
          token: parsed.token,
          rewardId: parsed.rewardId,
          serviceName: pl.serviceName,
        });
      } else if (parsed.kind === 'membership') {
        const r = await fetch('/api/memberships/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({ membershipId: parsed.membershipId, token: parsed.token, preview: true }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not read the code.');
        // Good read — now stop the camera and show the confirmation.
        await stopCamera();
        setSummary({
          kind: 'membership',
          customerName: d.customerName,
          token: parsed.token,
          membershipId: parsed.membershipId,
          weekLabel: d.weekLabel,
          serviceName: d.serviceName,
        });
      } else {
        const r = await fetch('/api/payments/collect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({ bookingId: parsed.bookingId, token: parsed.token, preview: true }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not read the code.');
        // Good read — now stop the camera and show the confirmation.
        await stopCamera();
        setSummary({
          kind: 'payment',
          customerName: d.customerName,
          token: parsed.token,
          serviceName: d.serviceName,
          date: d.date,
          time: d.time,
          amount: d.amount,
          depositPaid: d.depositPaid,
          price: d.price,
          bookingId: parsed.bookingId,
        });
      }
      setPhase('confirm');
    } catch (e) {
      // Keep the camera RUNNING so the barber can immediately scan a fresh
      // code — no more frozen viewfinder after a failed read.
      lastFailRef.current = { code, at: Date.now() };
      setError(e instanceof Error ? e.message : 'Could not read the code.');
      handledRef.current = false;
    }
    setBusy(false);
  }

  useEffect(() => {
    if (!open) return;
    handledRef.current = false;
    lastFailRef.current = null;
    setPhase('scan');
    setError('');
    setCamError('');
    setStartingCam(true);
    setSummary(null);
    setManual('');
    setShowManual(false);
    resetPhoto();
    let cancelled = false;
    (async () => {
      try {
        // Enumerate cameras first and pick the rear one explicitly — a bare
        // facingMode constraint fails on some iOS browsers, and an unsized
        // container can leave the video invisible.
        let cameraId: string | undefined;
        try {
          const cams = await Html5Qrcode.getCameras();
          const back = cams.find((c) => /back|rear|environment/i.test(c.label));
          cameraId = (back ?? cams[cams.length - 1] ?? cams[0])?.id;
        } catch {
          // getCameras() needs permission on some browsers — fall through
          // to the facingMode constraint below.
        }
        const q = new Html5Qrcode('mrc-collect-reader');
        qrRef.current = q;
        await q.start(
          cameraId ?? { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 260, height: 260 }, aspectRatio: 1 },
          (decoded) => {
            if (!cancelled) void handleCode(decoded);
          },
          () => {}
        );
        if (!cancelled) setStartingCam(false);
      } catch (e) {
        if (cancelled) return;
        setStartingCam(false);
        const name = (e as { name?: string })?.name ?? '';
        if (name === 'NotAllowedError') {
          setCamError('Camera permission was denied. Allow camera access for this site and try again — or enter the code manually below.');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setCamError('No camera found on this device. Enter the code manually below.');
        } else if (name === 'NotReadableError') {
          setCamError('The camera is busy in another app. Close it and retry — or enter the code manually below.');
        } else {
          setCamError('Could not start the camera on this device. Enter the code manually below.');
        }
      }
    })();
    return () => {
      cancelled = true;
      void stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scanSession]);

  function close() {
    void stopCamera();
    setOpen(false);
    resetPhoto();
  }

  async function charge() {
    if (!summary) return;
    setBusy(true);
    setError('');
    try {
      if (summary.kind === 'gift') {
        // Proof-of-completion photo required (like DoorDash): no photo = no payout.
        if (!photoFile) throw new Error('Take a photo of the finished haircut to get paid.');
        const form = new FormData();
        if (summary.shortCode) form.append('shortCode', summary.shortCode);
        else {
          form.append('giftId', summary.giftId!);
          form.append('token', summary.token);
        }
        form.append('photo', photoFile, 'gift.jpg');
        const r = await fetch('/api/gifts/redeem', {
          method: 'POST',
          headers: { Authorization: `Bearer ${getToken()}` },
          body: form,
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not redeem the gift.');
        setPhase('done');
        onCollected();
        return;
      }
      if (summary.kind === 'comp') {
        const r = await fetch('/api/comps/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({ compId: summary.compId, token: summary.token }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not redeem the free haircut.');
        setPhase('done');
        onCollected();
        return;
      }
      if (summary.kind === 'loyalty') {
        const r = await fetch('/api/loyalty/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({ rewardId: summary.rewardId, token: summary.token }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not redeem the free haircut.');
        setPhase('done');
        onCollected();
        return;
      }
      if (summary.kind === 'membership') {
        // Proof-of-completion photo required (like DoorDash): no photo = no payout.
        if (!photoFile) throw new Error('Take a photo of the finished haircut to get paid.');
        const form = new FormData();
        form.append('membershipId', summary.membershipId!);
        form.append('token', summary.token);
        form.append('photo', photoFile, 'plan.jpg');
        const r = await fetch('/api/memberships/redeem', {
          method: 'POST',
          headers: { Authorization: `Bearer ${getToken()}` },
          body: form,
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not redeem the haircut.');
        setPhase('done');
        onCollected();
        return;
      }
      const r = await fetch('/api/payments/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ bookingId: summary.bookingId, token: summary.token }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'The charge failed.');
      setPhase('done');
      onCollected();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The charge failed.');
    }
    setBusy(false);
  }

  function scanDifferent() {
    setSummary(null);
    setPhase('scan');
    resetPhoto();
    restartCamera();
  }

  function resetPhoto() {
    setPhotoStep(false);
    setPhotoFile(null);
    setPhotoPreview(null);
  }

  function startPhotoStep() {
    resetPhoto();
    setError('');
    setPhotoStep(true);
  }

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
    setPhotoFile(f);
    setError('');
    setPhotoPreview(URL.createObjectURL(f));
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full inline-flex items-center justify-center gap-2 gold-btn rounded-2xl font-extrabold text-[15px] py-3.5"
      >
        <ScanIcon size={18} />
        Scan payment code
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <div className="absolute inset-0 bg-black/60" onClick={close} />
          <div className="relative card w-full max-w-sm p-5 fade-in max-h-[92dvh] overflow-y-auto">
            {phase === 'scan' && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-extrabold text-[17px]">Scan customer code</h3>
                  <button
                    onClick={close}
                    aria-label="Close"
                    className="w-9 h-9 shrink-0 rounded-full bg-neutral-100 border border-neutral-200 text-neutral-600 font-bold text-[15px] leading-none"
                  >
                    ✕
                  </button>
                </div>

                {camError ? (
                  <div className="rounded-2xl border border-red-600/25 bg-red-600/10 p-5 text-center">
                    <p className="text-sm text-red-700 leading-relaxed">{camError}</p>
                    <button
                      onClick={restartCamera}
                      className="gold-btn rounded-2xl px-6 py-2.5 mt-3 text-[14px] font-bold"
                    >
                      Retry camera
                    </button>
                  </div>
                ) : (
                  <div className="rounded-2xl overflow-hidden border-2 border-gold/50 bg-black relative">
                    <div id="mrc-collect-reader" style={{ width: '100%', aspectRatio: '1 / 1' }} />
                    {(startingCam || busy) && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                        <p className="text-white text-sm font-semibold">
                          {startingCam ? 'Starting camera…' : 'Reading code…'}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {error && !camError && (
                  <p className="text-[13px] text-red-700 bg-red-600/10 border border-red-600/25 rounded-xl px-3.5 py-2.5 mt-3 text-center leading-relaxed">
                    {error}
                  </p>
                )}

                <p className="text-[12px] text-neutral-500 text-center mt-2.5 leading-relaxed">
                  Point at the QR on the customer&apos;s phone — it scans automatically.
                </p>

                <button
                  onClick={() => setShowManual((s) => !s)}
                  className="w-full mt-1 text-[13px] text-gold font-semibold py-2"
                >
                  {showManual ? 'Hide manual entry' : 'Camera not working? Enter the code manually'}
                </button>
                {showManual && (
                  <div className="flex gap-2 mt-1">
                    <input
                      id="mrc-manual-code"
                      value={manual}
                      onChange={(e) => setManual(e.target.value)}
                      placeholder="MRC1:… / MRC4:… / MRC5:… / 6-letter gift code"
                      autoCapitalize="off"
                      autoCorrect="off"
                      className="input flex-1 min-w-0 font-mono text-[16px]"
                    />
                    <button
                      onClick={() => manual.trim() && void handleCode(manual)}
                      disabled={busy || !manual.trim()}
                      className="gold-btn rounded-2xl px-5 font-bold text-[14px] disabled:opacity-50 shrink-0"
                    >
                      Go
                    </button>
                  </div>
                )}
              </>
            )}

            {phase === 'confirm' && photoStep && summary && (summary.kind === 'membership' || summary.kind === 'gift') && (
              <>
                <h3 className="font-extrabold text-[18px] text-center">Photo of the haircut 📷</h3>
                <p className="text-[13px] text-neutral-500 text-center mt-1 mb-4 leading-relaxed">
                  Take a photo of the finished haircut — <b>your payout is sent when the photo is taken</b>.
                </p>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={pickPhoto}
                  className="hidden"
                />
                {photoPreview ? (
                  <div className="relative rounded-2xl overflow-hidden border-2 border-gold/50">
                    <img src={photoPreview} alt="Finished haircut" className="w-full max-h-[260px] object-cover" />
                    <button
                      onClick={() => { setPhotoFile(null); setPhotoPreview(null); }}
                      className="absolute top-2 right-2 w-9 h-9 rounded-full bg-black/60 text-white font-bold text-[15px]"
                      aria-label="Retake photo"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => photoInputRef.current?.click()}
                    className="w-full rounded-2xl border-2 border-dashed border-gold/50 bg-[#f7f2e2] py-10 text-center card-hover"
                  >
                    <div className="text-[36px]">📷</div>
                    <p className="text-[14px] font-bold text-gold mt-1">Take a photo</p>
                    <p className="text-[12px] text-neutral-500 mt-0.5">Opens your camera directly</p>
                  </button>
                )}
                {error && <p className="text-sm text-red-700 mt-3 text-center leading-relaxed">{error}</p>}
                <button
                  onClick={() => void charge()}
                  disabled={busy || !photoFile}
                  className="gold-btn rounded-2xl w-full font-extrabold text-[16px] py-4 mt-4 disabled:opacity-50"
                >
                  {busy ? 'Redeeming…' : '✓ Confirm & get paid'}
                </button>
                <button
                  onClick={() => { resetPhoto(); setError(''); }}
                  disabled={busy}
                  className="w-full mt-2 text-sm text-neutral-500 font-medium py-2"
                >
                  Back
                </button>
              </>
            )}

            {phase === 'confirm' && !photoStep && summary && summary.kind === 'membership' && (
              <>
                <h3 className="font-extrabold text-[18px] text-center">Confirm redemption</h3>
                <div className="mt-4 grid gap-2 text-[15px] bg-[#f7f2e2] border border-[#e6dabf] rounded-2xl p-4">
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">Member</span><b className="text-right">{summary.customerName}</b></p>
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">Plan</span><b className="text-right">Monthly — 4 haircuts</b></p>
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">This week</span><b className="text-right">{summary.weekLabel}{summary.serviceName ? ` — ${summary.serviceName}` : ''}</b></p>
                  <p className="flex justify-between gap-3 pt-2 mt-1 border-t border-[#e6dabf]">
                    <span className="font-bold">Redeem</span>
                    <b className="text-gold text-[20px]">{summary.serviceName ?? '1 haircut'}</b>
                  </p>
                </div>
                <p className="text-[12px] text-neutral-500 text-center mt-2">One haircut per week — unused weeks don&apos;t carry over.</p>
                {error && <p className="text-sm text-red-700 mt-3 text-center leading-relaxed">{error}</p>}
                <button
                  onClick={() => startPhotoStep()}
                  disabled={busy}
                  className="gold-btn rounded-2xl w-full font-extrabold text-[16px] py-4 mt-4 disabled:opacity-50"
                >
                  Redeem 1 haircut
                </button>
                <button
                  onClick={scanDifferent}
                  disabled={busy}
                  className="w-full mt-2 text-sm text-neutral-500 font-medium py-2"
                >
                  Scan a different code
                </button>
              </>
            )}

            {phase === 'confirm' && !photoStep && summary && summary.kind === 'gift' && (
              <>
                <h3 className="font-extrabold text-[18px] text-center">🎁 Gift haircut</h3>
                <div className="mt-4 grid gap-2 text-[15px] bg-[#f7f2e2] border-2 border-gold/60 rounded-2xl p-4">
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">Service</span><b className="text-right">{summary.serviceName!}</b></p>
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">From</span><b className="text-right">{summary.buyerName}</b></p>
                  {summary.recipientName && (
                    <p className="flex justify-between gap-3"><span className="text-neutral-500">For</span><b className="text-right">{summary.recipientName}</b></p>
                  )}
                  <p className="flex justify-between gap-3 pt-2 mt-1 border-t border-[#e6dabf]">
                    <span className="font-bold">Value</span>
                    <b className="text-gold text-[20px]">${summary.price!.toFixed(2)}</b>
                  </p>
                </div>
                <p className="text-[12px] text-neutral-500 text-center mt-2">Single use — the haircut is already paid for.</p>
                {error && <p className="text-sm text-red-700 mt-3 text-center leading-relaxed">{error}</p>}
                <button
                  onClick={() => startPhotoStep()}
                  disabled={busy}
                  className="gold-btn rounded-2xl w-full font-extrabold text-[16px] py-4 mt-4 disabled:opacity-50"
                >
                  Redeem gift
                </button>
                <button
                  onClick={scanDifferent}
                  disabled={busy}
                  className="w-full mt-2 text-sm text-neutral-500 font-medium py-2"
                >
                  Scan a different code
                </button>
              </>
            )}

            {phase === 'confirm' && summary && summary.kind === 'comp' && (
              <>
                <h3 className="font-extrabold text-[18px] text-center">✂️ Free haircut (comp)</h3>
                <div className="mt-4 grid gap-2 text-[15px] bg-[#f7f2e2] border-2 border-gold/60 rounded-2xl p-4">
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">Customer</span><b className="text-right">{summary.customerName}</b></p>
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">Service</span><b className="text-right">{summary.serviceName!}</b></p>
                  <p className="flex justify-between gap-3 pt-2 mt-1 border-t border-[#e6dabf]">
                    <span className="font-bold">Value</span>
                    <b className="text-gold text-[20px]">${summary.price!.toFixed(2)}</b>
                  </p>
                </div>
                <p className="text-[12px] text-neutral-500 text-center mt-2">Single use — granted by the owner. The customer pays nothing and there is no payout for this haircut.</p>
                {error && <p className="text-sm text-red-700 mt-3 text-center leading-relaxed">{error}</p>}
                <button
                  onClick={() => void charge()}
                  disabled={busy}
                  className="gold-btn rounded-2xl w-full font-extrabold text-[16px] py-4 mt-4 disabled:opacity-50"
                >
                  {busy ? 'Redeeming…' : 'Redeem free haircut'}
                </button>
                <button
                  onClick={scanDifferent}
                  disabled={busy}
                  className="w-full mt-2 text-sm text-neutral-500 font-medium py-2"
                >
                  Scan a different code
                </button>
              </>
            )}

            {phase === 'confirm' && summary && summary.kind === 'loyalty' && (
              <>
                <h3 className="font-extrabold text-[18px] text-center">🎉 Free haircut (loyalty)</h3>
                <div className="mt-4 grid gap-2 text-[15px] bg-[#f7f2e2] border-2 border-gold/60 rounded-2xl p-4">
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">Customer</span><b className="text-right">{summary.customerName}</b></p>
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">Reward</span><b className="text-right">{summary.serviceName!}</b></p>
                </div>
                <p className="text-[12px] text-neutral-500 text-center mt-2">Single use — earned with 4 haircuts. The customer pays nothing and there is no payout for this haircut.</p>
                {error && <p className="text-sm text-red-700 mt-3 text-center leading-relaxed">{error}</p>}
                <button
                  onClick={() => void charge()}
                  disabled={busy}
                  className="gold-btn rounded-2xl w-full font-extrabold text-[16px] py-4 mt-4 disabled:opacity-50"
                >
                  {busy ? 'Redeeming…' : 'Redeem free haircut'}
                </button>
                <button
                  onClick={scanDifferent}
                  disabled={busy}
                  className="w-full mt-2 text-sm text-neutral-500 font-medium py-2"
                >
                  Scan a different code
                </button>
              </>
            )}

            {phase === 'confirm' && summary && summary.kind === 'payment' && (
              <>
                <h3 className="font-extrabold text-[18px] text-center">Confirm collection</h3>
                <div className="mt-4 grid gap-2 text-[15px] bg-[#f7f2e2] border border-[#e6dabf] rounded-2xl p-4">
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">Customer</span><b className="text-right">{summary.customerName}</b></p>
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">Service</span><b className="text-right">{summary.serviceName!}</b></p>
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">When</span><b className="text-right">{summary.date!} at {summary.time!}</b></p>
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">Deposit paid</span><b className="text-right">${summary.depositPaid!.toFixed(2)}</b></p>
                  <p className="flex justify-between gap-3 pt-2 mt-1 border-t border-[#e6dabf]">
                    <span className="font-bold">Charge now</span>
                    <b className="text-gold text-[20px]">${summary.amount!.toFixed(2)}</b>
                  </p>
                </div>
                {error && <p className="text-sm text-red-700 mt-3 text-center leading-relaxed">{error}</p>}
                <button
                  onClick={() => void charge()}
                  disabled={busy}
                  className="gold-btn rounded-2xl w-full font-extrabold text-[16px] py-4 mt-4 disabled:opacity-50"
                >
                  {busy ? 'Charging…' : `Charge $${summary.amount!.toFixed(2)}`}
                </button>
                <button
                  onClick={scanDifferent}
                  disabled={busy}
                  className="w-full mt-2 text-sm text-neutral-500 font-medium py-2"
                >
                  Scan a different code
                </button>
              </>
            )}

            {phase === 'done' && summary && summary.kind === 'membership' && (
              <div className="text-center py-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-green-600/10 border border-green-600/30 flex items-center justify-center text-green-700 mb-4">
                  <CheckSealIcon size={34} />
                </div>
                <h3 className="font-extrabold text-[19px]">Haircut redeemed</h3>
                <p className="text-sm text-neutral-600 mt-2 leading-relaxed">
                  <b>{summary.weekLabel}</b> used for {summary.customerName}.
                </p>
                <button onClick={close} className="gold-btn rounded-2xl font-bold text-[15px] px-10 py-3 mt-6">
                  Done
                </button>
              </div>
            )}

            {phase === 'done' && summary && summary.kind === 'gift' && (
              <div className="text-center py-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-green-600/10 border border-green-600/30 flex items-center justify-center text-green-700 mb-4">
                  <CheckSealIcon size={34} />
                </div>
                <h3 className="font-extrabold text-[19px]">🎁 Gift redeemed</h3>
                <p className="text-sm text-neutral-600 mt-2 leading-relaxed">
                  <b>{summary.serviceName}</b> — enjoy the haircut!
                  {summary.buyerName && <><br />Gifted by <b>{summary.buyerName}</b>.</>}
                </p>
                <button onClick={close} className="gold-btn rounded-2xl font-bold text-[15px] px-10 py-3 mt-6">
                  Done
                </button>
              </div>
            )}

            {phase === 'done' && summary && summary.kind === 'payment' && (
              <div className="text-center py-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-green-600/10 border border-green-600/30 flex items-center justify-center text-green-700 mb-4">
                  <CheckSealIcon size={34} />
                </div>
                <h3 className="font-extrabold text-[19px]">Payment complete</h3>
                <p className="text-sm text-neutral-600 mt-2 leading-relaxed">
                  <b>${summary.amount!.toFixed(2)}</b> collected from {summary.customerName}.
                  <br />Total paid: <b>${summary.price!.toFixed(2)}</b> — all done.
                </p>
                <button onClick={close} className="gold-btn rounded-2xl font-bold text-[15px] px-10 py-3 mt-6">
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
