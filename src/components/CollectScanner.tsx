'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { ScanIcon, CheckSealIcon } from '@/components/Icons';
import { useLang } from '@/components/LanguageContext';

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
  | { kind: 'wallet'; membershipId: string }
  | { kind: 'gift'; giftId: string; token: string }
  | { kind: 'giftShort'; shortCode: string }
  | { kind: 'comp'; compId: string; token: string }
  | { kind: 'loyalty'; rewardId: string; token: string };

// Fill {placeholders} in a translated template with React nodes — keeps <b>
// emphasis and survives word-order changes across languages.
function fillTemplate(template: string, values: Record<string, React.ReactNode>) {
  return (
    <>
      {template.split(/(\{[^}]+\})/g).map((part, i) => {
        const m = /^\{([^}]+)\}$/.exec(part);
        const v = m ? values[m[1]] : undefined;
        return <React.Fragment key={i}>{v !== undefined ? v : part}</React.Fragment>;
      })}
    </>
  );
}

// Split a translated "lead — emphasized tail" string so the tail keeps <b>.
function splitEmphasis(s: string) {
  const i = s.indexOf('\u2014');
  if (i < 0) return <>{s}</>;
  return (
    <>
      {s.slice(0, i).trim()} — <b>{s.slice(i + 1).trim()}</b>
    </>
  );
}

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
  const { t } = useLang();

  function parseCode(raw: string): ParsedCode | null {
    const code = raw.trim();
    // A bare 6-character code is a gift short code (no colons).
    if (/^[A-Z0-9]{6}$/i.test(code)) return { kind: 'giftShort', shortCode: code.toUpperCase() };
    const parts = code.split(':');
    // Wallet pass QR: MRCW:membershipId (static, no rotating token)
    if (parts[0] === 'MRCW' && parts.length === 2 && parts[1]) {
      return { kind: 'wallet', membershipId: parts[1] };
    }
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
      setError(t('barber.scan.error_not_mrc'));
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
        if (!r.ok) throw new Error(d.error || t('barber.scan.error_read'));
        // Good read — now stop the camera and show the confirmation.
        await stopCamera();
        const p = d.preview;
        setSummary({
          kind: 'gift',
          customerName: p.recipientName || t('barber.scan.gift_recipient_fallback'),
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
        if (!r.ok) throw new Error(d.error || t('barber.scan.error_read'));
        // Good read — now stop the camera and show the confirmation.
        await stopCamera();
        const pc = d.preview;
        setSummary({
          kind: 'comp',
          customerName: pc.customerName || t('barber.scan.comp_customer'),
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
        if (!r.ok) throw new Error(d.error || t('barber.scan.error_read'));
        // Good read — now stop the camera and show the confirmation.
        await stopCamera();
        const pl = d.preview;
        setSummary({
          kind: 'loyalty',
          customerName: pl.customerName || t('barber.scan.loyalty_customer'),
          token: parsed.token,
          rewardId: parsed.rewardId,
          serviceName: pl.serviceName,
        });
      } else if (parsed.kind === 'wallet') {
        // Apple Wallet pass QR — static membership ID, verify it's active.
        const r = await fetch('/api/barber/wallet-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({ membershipId: parsed.membershipId }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || t('barber.scan.error_verify'));
        await stopCamera();
        setSummary({
          kind: 'membership',
          customerName: d.customerName,
          token: '',
          membershipId: parsed.membershipId,
          weekLabel: d.weekLabel,
          serviceName: d.serviceName,
        });
      } else if (parsed.kind === 'membership') {
        const r = await fetch('/api/memberships/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({ membershipId: parsed.membershipId, token: parsed.token, preview: true }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || t('barber.scan.error_read'));
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
        if (!r.ok) throw new Error(d.error || t('barber.scan.error_read'));
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
      setError(e instanceof Error ? e.message : t('barber.scan.error_read'));
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
          setCamError(t('barber.scan.cam_denied'));
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setCamError(t('barber.scan.cam_not_found'));
        } else if (name === 'NotReadableError') {
          setCamError(t('barber.scan.cam_busy'));
        } else {
          setCamError(t('barber.scan.cam_generic'));
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
        if (!photoFile) throw new Error(t('barber.scan.photo_required'));
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
        if (!r.ok) throw new Error(d.error || t('barber.scan.gift_redeem_error'));
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
        if (!r.ok) throw new Error(d.error || t('barber.scan.comp_error'));
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
        if (!r.ok) throw new Error(d.error || t('barber.scan.loyalty_error'));
        setPhase('done');
        onCollected();
        return;
      }
      if (summary.kind === 'membership') {
        // Proof-of-completion photo required (like DoorDash): no photo = no payout.
        if (!photoFile) throw new Error(t('barber.scan.photo_required'));
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
      if (!r.ok) throw new Error(d.error || t('barber.scan.error_charge'));
      setPhase('done');
      onCollected();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('barber.scan.error_charge'));
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
      setError(t('barber.scan.photo_not_image'));
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError(t('barber.scan.photo_too_large'));
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
        {t('barber.scan.trigger')}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <div className="absolute inset-0 bg-black/60" onClick={close} />
          <div className="relative card w-full max-w-sm p-5 fade-in max-h-[92dvh] overflow-y-auto">
            {phase === 'scan' && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-extrabold text-[17px]">{t('barber.scan.title')}</h3>
                  <button
                    onClick={close}
                    aria-label={t('barber.scan.close_aria')}
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
                      {t('barber.scan.retry_camera')}
                    </button>
                  </div>
                ) : (
                  <div className="rounded-2xl overflow-hidden border-2 border-gold/50 bg-black relative">
                    <div id="mrc-collect-reader" style={{ width: '100%', aspectRatio: '1 / 1' }} />
                    {(startingCam || busy) && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                        <p className="text-white text-sm font-semibold">
                          {startingCam ? t('barber.scan.starting_camera') : t('barber.scan.reading_code')}
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
                  {t('barber.scan.hint')}
                </p>

                <button
                  onClick={() => setShowManual((s) => !s)}
                  className="w-full mt-1 text-[13px] text-gold font-semibold py-2"
                >
                  {showManual ? t('barber.scan.manual_toggle_hide') : t('barber.scan.manual_toggle_show')}
                </button>
                {showManual && (
                  <div className="flex gap-2 mt-1">
                    <input
                      id="mrc-manual-code"
                      value={manual}
                      onChange={(e) => setManual(e.target.value)}
                      placeholder={t('barber.scan.manual_placeholder')}
                      autoCapitalize="off"
                      autoCorrect="off"
                      className="input flex-1 min-w-0 font-mono text-[16px]"
                    />
                    <button
                      onClick={() => manual.trim() && void handleCode(manual)}
                      disabled={busy || !manual.trim()}
                      className="gold-btn rounded-2xl px-5 font-bold text-[14px] disabled:opacity-50 shrink-0"
                    >
                      {t('barber.scan.manual_go')}
                    </button>
                  </div>
                )}
              </>
            )}

            {phase === 'confirm' && photoStep && summary && (summary.kind === 'membership' || summary.kind === 'gift') && (
              <>
                <h3 className="font-extrabold text-[18px] text-center">{t('barber.scan.photo_title')}</h3>
                <p className="text-[13px] text-neutral-500 text-center mt-1 mb-4 leading-relaxed">
                  {splitEmphasis(t('barber.scan.photo_hint'))}
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
                    <img src={photoPreview} alt={t('barber.scan.photo_alt')} className="w-full max-h-[260px] object-cover" />
                    <button
                      onClick={() => { setPhotoFile(null); setPhotoPreview(null); }}
                      className="absolute top-2 right-2 w-9 h-9 rounded-full bg-black/60 text-white font-bold text-[15px]"
                      aria-label={t('barber.scan.photo_retake_aria')}
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
                    <p className="text-[14px] font-bold text-gold mt-1">{t('barber.scan.photo_take')}</p>
                    <p className="text-[12px] text-neutral-500 mt-0.5">{t('barber.scan.photo_opens_camera')}</p>
                  </button>
                )}
                {error && <p className="text-sm text-red-700 mt-3 text-center leading-relaxed">{error}</p>}
                <button
                  onClick={() => void charge()}
                  disabled={busy || !photoFile}
                  className="gold-btn rounded-2xl w-full font-extrabold text-[16px] py-4 mt-4 disabled:opacity-50"
                >
                  {busy ? t('barber.scan.photo_redeeming') : t('barber.scan.photo_confirm')}
                </button>
                <button
                  onClick={() => { resetPhoto(); setError(''); }}
                  disabled={busy}
                  className="w-full mt-2 text-sm text-neutral-500 font-medium py-2"
                >
                  {t('barber.scan.photo_back')}
                </button>
              </>
            )}

            {phase === 'confirm' && !photoStep && summary && summary.kind === 'membership' && (
              <>
                <h3 className="font-extrabold text-[18px] text-center">{t('barber.scan.membership_title')}</h3>
                <div className="mt-4 grid gap-2 text-[15px] bg-[#f7f2e2] border border-[#e6dabf] rounded-2xl p-4">
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">{t('barber.scan.membership_member')}</span><b className="text-right">{summary.customerName}</b></p>
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">{t('barber.scan.membership_plan')}</span><b className="text-right">{t('barber.scan.membership_plan_value')}</b></p>
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">{t('barber.scan.membership_week')}</span><b className="text-right">{summary.weekLabel}{summary.serviceName ? ` — ${summary.serviceName}` : ''}</b></p>
                  <p className="flex justify-between gap-3 pt-2 mt-1 border-t border-[#e6dabf]">
                    <span className="font-bold">{t('barber.scan.membership_redeem')}</span>
                    <b className="text-gold text-[20px]">{summary.serviceName ?? t('barber.scan.membership_redeem_value')}</b>
                  </p>
                </div>
                <p className="text-[12px] text-neutral-500 text-center mt-2">{t('barber.scan.membership_note')}</p>
                {error && <p className="text-sm text-red-700 mt-3 text-center leading-relaxed">{error}</p>}
                <button
                  onClick={() => startPhotoStep()}
                  disabled={busy}
                  className="gold-btn rounded-2xl w-full font-extrabold text-[16px] py-4 mt-4 disabled:opacity-50"
                >
                  {t('barber.scan.membership_cta')}
                </button>
                <button
                  onClick={scanDifferent}
                  disabled={busy}
                  className="w-full mt-2 text-sm text-neutral-500 font-medium py-2"
                >
                  {t('barber.scan.scan_different')}
                </button>
              </>
            )}

            {phase === 'confirm' && !photoStep && summary && summary.kind === 'gift' && (
              <>
                <h3 className="font-extrabold text-[18px] text-center">{t('barber.scan.gift_title')}</h3>
                <div className="mt-4 grid gap-2 text-[15px] bg-[#f7f2e2] border-2 border-gold/60 rounded-2xl p-4">
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">{t('barber.scan.gift_service')}</span><b className="text-right">{summary.serviceName!}</b></p>
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">{t('barber.scan.gift_from')}</span><b className="text-right">{summary.buyerName}</b></p>
                  {summary.recipientName && (
                    <p className="flex justify-between gap-3"><span className="text-neutral-500">{t('barber.scan.gift_for')}</span><b className="text-right">{summary.recipientName}</b></p>
                  )}
                  <p className="flex justify-between gap-3 pt-2 mt-1 border-t border-[#e6dabf]">
                    <span className="font-bold">{t('barber.scan.gift_value')}</span>
                    <b className="text-gold text-[20px]">${summary.price!.toFixed(2)}</b>
                  </p>
                </div>
                <p className="text-[12px] text-neutral-500 text-center mt-2">{t('barber.scan.gift_note')}</p>
                {error && <p className="text-sm text-red-700 mt-3 text-center leading-relaxed">{error}</p>}
                <button
                  onClick={() => startPhotoStep()}
                  disabled={busy}
                  className="gold-btn rounded-2xl w-full font-extrabold text-[16px] py-4 mt-4 disabled:opacity-50"
                >
                  {t('barber.scan.gift_cta')}
                </button>
                <button
                  onClick={scanDifferent}
                  disabled={busy}
                  className="w-full mt-2 text-sm text-neutral-500 font-medium py-2"
                >
                  {t('barber.scan.scan_different')}
                </button>
              </>
            )}

            {phase === 'confirm' && summary && summary.kind === 'comp' && (
              <>
                <h3 className="font-extrabold text-[18px] text-center">{t('barber.scan.comp_title')}</h3>
                <div className="mt-4 grid gap-2 text-[15px] bg-[#f7f2e2] border-2 border-gold/60 rounded-2xl p-4">
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">{t('barber.scan.comp_customer')}</span><b className="text-right">{summary.customerName}</b></p>
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">{t('barber.scan.comp_service')}</span><b className="text-right">{summary.serviceName!}</b></p>
                  <p className="flex justify-between gap-3 pt-2 mt-1 border-t border-[#e6dabf]">
                    <span className="font-bold">{t('barber.scan.comp_value')}</span>
                    <b className="text-gold text-[20px]">${summary.price!.toFixed(2)}</b>
                  </p>
                </div>
                <p className="text-[12px] text-neutral-500 text-center mt-2">{t('barber.scan.comp_note')}</p>
                {error && <p className="text-sm text-red-700 mt-3 text-center leading-relaxed">{error}</p>}
                <button
                  onClick={() => void charge()}
                  disabled={busy}
                  className="gold-btn rounded-2xl w-full font-extrabold text-[16px] py-4 mt-4 disabled:opacity-50"
                >
                  {busy ? t('barber.scan.comp_redeeming') : t('barber.scan.comp_cta')}
                </button>
                <button
                  onClick={scanDifferent}
                  disabled={busy}
                  className="w-full mt-2 text-sm text-neutral-500 font-medium py-2"
                >
                  {t('barber.scan.scan_different')}
                </button>
              </>
            )}

            {phase === 'confirm' && summary && summary.kind === 'loyalty' && (
              <>
                <h3 className="font-extrabold text-[18px] text-center">{t('barber.scan.loyalty_title')}</h3>
                <div className="mt-4 grid gap-2 text-[15px] bg-[#f7f2e2] border-2 border-gold/60 rounded-2xl p-4">
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">{t('barber.scan.loyalty_customer')}</span><b className="text-right">{summary.customerName}</b></p>
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">{t('barber.scan.loyalty_reward')}</span><b className="text-right">{summary.serviceName!}</b></p>
                </div>
                <p className="text-[12px] text-neutral-500 text-center mt-2">{t('barber.scan.loyalty_note')}</p>
                {error && <p className="text-sm text-red-700 mt-3 text-center leading-relaxed">{error}</p>}
                <button
                  onClick={() => void charge()}
                  disabled={busy}
                  className="gold-btn rounded-2xl w-full font-extrabold text-[16px] py-4 mt-4 disabled:opacity-50"
                >
                  {busy ? 'Redeeming…' : t('barber.scan.loyalty_cta')}
                </button>
                <button
                  onClick={scanDifferent}
                  disabled={busy}
                  className="w-full mt-2 text-sm text-neutral-500 font-medium py-2"
                >
                  {t('barber.scan.scan_different')}
                </button>
              </>
            )}

            {phase === 'confirm' && summary && summary.kind === 'payment' && (
              <>
                <h3 className="font-extrabold text-[18px] text-center">{t('barber.scan.payment_title')}</h3>
                <div className="mt-4 grid gap-2 text-[15px] bg-[#f7f2e2] border border-[#e6dabf] rounded-2xl p-4">
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">{t('barber.scan.payment_customer')}</span><b className="text-right">{summary.customerName}</b></p>
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">{t('barber.scan.payment_service')}</span><b className="text-right">{summary.serviceName!}</b></p>
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">{t('barber.scan.payment_when')}</span><b className="text-right">{summary.date!} at {summary.time!}</b></p>
                  <p className="flex justify-between gap-3"><span className="text-neutral-500">{t('barber.scan.payment_deposit')}</span><b className="text-right">${summary.depositPaid!.toFixed(2)}</b></p>
                  <p className="flex justify-between gap-3 pt-2 mt-1 border-t border-[#e6dabf]">
                    <span className="font-bold">{t('barber.scan.payment_charge_now')}</span>
                    <b className="text-gold text-[20px]">${summary.amount!.toFixed(2)}</b>
                  </p>
                </div>
                {error && <p className="text-sm text-red-700 mt-3 text-center leading-relaxed">{error}</p>}
                <button
                  onClick={() => void charge()}
                  disabled={busy}
                  className="gold-btn rounded-2xl w-full font-extrabold text-[16px] py-4 mt-4 disabled:opacity-50"
                >
                  {busy ? t('barber.scan.payment_charging') : t('barber.scan.payment_cta').replace('{amount}', summary.amount!.toFixed(2))}
                </button>
                <button
                  onClick={scanDifferent}
                  disabled={busy}
                  className="w-full mt-2 text-sm text-neutral-500 font-medium py-2"
                >
                  {t('barber.scan.scan_different')}
                </button>
              </>
            )}

            {phase === 'done' && summary && summary.kind === 'membership' && (
              <div className="text-center py-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-green-600/10 border border-green-600/30 flex items-center justify-center text-green-700 mb-4">
                  <CheckSealIcon size={34} />
                </div>
                <h3 className="font-extrabold text-[19px]">{t('barber.scan.membership_done_title')}</h3>
                <p className="text-sm text-neutral-600 mt-2 leading-relaxed">
                  {fillTemplate(t('barber.scan.membership_done_body'), { week: <b>{summary.weekLabel}</b>, name: summary.customerName })}
                </p>
                <button onClick={close} className="gold-btn rounded-2xl font-bold text-[15px] px-10 py-3 mt-6">
                  {t('barber.scan.done_button')}
                </button>
              </div>
            )}

            {phase === 'done' && summary && summary.kind === 'gift' && (
              <div className="text-center py-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-green-600/10 border border-green-600/30 flex items-center justify-center text-green-700 mb-4">
                  <CheckSealIcon size={34} />
                </div>
                <h3 className="font-extrabold text-[19px]">{t('barber.scan.gift_done_title')}</h3>
                <p className="text-sm text-neutral-600 mt-2 leading-relaxed">
                  {fillTemplate(t('barber.scan.gift_done_body'), { service: <b>{summary.serviceName}</b> })}
                  {summary.buyerName && <><br />{fillTemplate(t('barber.scan.gift_done_giver'), { name: <b>{summary.buyerName}</b> })}</>}
                </p>
                <button onClick={close} className="gold-btn rounded-2xl font-bold text-[15px] px-10 py-3 mt-6">
                  {t('barber.scan.done_button')}
                </button>
              </div>
            )}

            {phase === 'done' && summary && summary.kind === 'payment' && (
              <div className="text-center py-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-green-600/10 border border-green-600/30 flex items-center justify-center text-green-700 mb-4">
                  <CheckSealIcon size={34} />
                </div>
                <h3 className="font-extrabold text-[19px]">{t('barber.scan.payment_done_title')}</h3>
                <p className="text-sm text-neutral-600 mt-2 leading-relaxed">
                  {fillTemplate(t('barber.scan.payment_done_body'), { amount: <b>${summary.amount!.toFixed(2)}</b>, name: summary.customerName })}
                  <br />{fillTemplate(t('barber.scan.payment_done_total'), { total: <b>${summary.price!.toFixed(2)}</b> })}
                </p>
                <button onClick={close} className="gold-btn rounded-2xl font-bold text-[15px] px-10 py-3 mt-6">
                  {t('barber.scan.done_button')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
