'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface TeamChatMsg {
  id: string;
  senderBarberId: string;
  senderName: string;
  text: string;
  createdAt: string;
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    let h = d.getHours();
    const m = d.getMinutes().toString().padStart(2, '0');
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ap}`;
  } catch {
    return '';
  }
}

// Group chat for all active barbers. Same phone-safe patterns as ChatModal:
// visualViewport keyboard avoidance, safe-area padding, 16px input, 5s polling.
//
// Rendered in a portal on document.body so no ancestor transform/filter can
// break position:fixed. The container is always top:0 — position:fixed is
// viewport-relative by definition, so visualViewport.offsetTop must NOT be
// used (on iOS it includes the page scroll offset and pushes the modal
// off-screen when opened while scrolled down).
export function TeamChatModal({
  getToken,
  onClose,
  readOnly = false,
  subtitle = 'All barbers',
}: {
  getToken: () => string;
  onClose: () => void;
  readOnly?: boolean; // owner ghost mode: can read, cannot send
  subtitle?: string;
}) {
  const [messages, setMessages] = useState<TeamChatMsg[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef(getToken);
  tokenRef.current = getToken;

  useEffect(() => {
    setMounted(true);
  }, []);

  const scrollBottom = () => {
    requestAnimationFrame(() => {
      const el = boxRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  const markRead = async () => {
    try {
      await fetch('/api/team-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current()}` },
        body: JSON.stringify({ markRead: true }),
        cache: 'no-store',
      });
    } catch {
      /* best effort */
    }
  };

  const load = async (silent: boolean) => {
    try {
      const r = await fetch('/api/team-chat', {
        headers: { Authorization: `Bearer ${tokenRef.current()}` },
        cache: 'no-store',
      });
      if (!r.ok) return;
      const j = await r.json();
      if (typeof j.barberId === 'string') setMyId(j.barberId);
      const next: TeamChatMsg[] = j.messages ?? [];
      setMessages((prev) => {
        const serverIds = new Set(next.map((m) => m.id));
        // Preserve messages we sent that the server hasn't echoed yet —
        // Blob overwrites can read stale for a few seconds after a write.
        // (Failed sends are removed explicitly in send().)
        const unsynced = prev.filter(
          (m) => !serverIds.has(m.id) && Date.now() - new Date(m.createdAt).getTime() < 60_000
        );
        const merged = [...next, ...unsynced].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        const changed =
          merged.length !== prev.length || merged[merged.length - 1]?.id !== prev[prev.length - 1]?.id;
        if (changed) setTimeout(scrollBottom, 0);
        return changed ? merged : prev;
      });
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load(false).then(() => markRead());
    const t = setInterval(() => load(true), 5000);
    const body = document.body;
    const html = document.documentElement;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlOverflow = html.style.overflow;
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    return () => {
      clearInterval(t);
      body.style.overflow = prevBodyOverflow;
      html.style.overflow = prevHtmlOverflow;
      void markRead();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    // Optimistic: show the message instantly, sync with the server after.
    const tempId = `temp-${Date.now()}`;
    const optimistic: TeamChatMsg = {
      id: tempId,
      senderBarberId: myId ?? 'me',
      senderName: '',
      text: t.slice(0, 500),
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setText('');
    setSending(true);
    setSendError('');
    setTimeout(scrollBottom, 0);
    try {
      const r = await fetch('/api/team-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current()}` },
        body: JSON.stringify({ text: t.slice(0, 500) }),
      });
      if (r.ok) {
        // Use the server-confirmed message directly — the Blob read after a
        // write can briefly return the stale (pre-send) version, which would
        // wipe the optimistic message. The 5s poll converges everything else.
        const j = await r.json().catch(() => null);
        const real = j?.message;
        if (real && typeof real.id === 'string') {
          setMessages((prev) => {
            const next = prev.map((m) => (m.id === tempId ? (real as TeamChatMsg) : m));
            setTimeout(scrollBottom, 0);
            return next;
          });
        } else {
          await load(true);
        }
        scrollBottom();
      } else {
        const j = await r.json().catch(() => null);
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setSendError(j?.error || 'Could not send. Try again.');
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setSendError('Could not send. Check your connection.');
    } finally {
      setSending(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100]"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/50 hidden sm:block" onClick={onClose} />
      <div className="absolute inset-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full sm:max-w-md sm:h-[80dvh] sm:rounded-3xl bg-[#faf6ef] sm:shadow-2xl flex flex-col overflow-hidden">
        <div
          className="flex items-center gap-3 px-4 py-3 border-b border-gold/20 bg-white shrink-0 min-w-0"
          style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
        >
          <div className="w-10 h-10 rounded-full bg-gold/15 border border-gold/40 flex items-center justify-center text-gold font-extrabold text-lg shrink-0">
            💬
          </div>
          <div className="flex-1 min-w-0">
            <b className="block text-[15px] truncate">Team chat</b>
            <span className="block text-[11px] text-neutral-500 truncate">{subtitle}</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close team chat"
            className="w-10 h-10 rounded-full bg-neutral-100 hover:bg-neutral-200 flex items-center justify-center text-neutral-600 font-bold text-lg shrink-0"
          >
            ✕
          </button>
        </div>

        <div ref={boxRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
          {loading ? (
            <p className="text-center text-neutral-400 text-sm mt-8">Loading messages…</p>
          ) : messages.length === 0 ? (
            <p className="text-center text-neutral-400 text-sm mt-8 leading-relaxed">
              No messages yet.<br />
              {readOnly ? 'The barbers have not written anything.' : 'Say hi to the team 👋'}
            </p>
          ) : (
            messages.map((m) => {
              const mine = m.id.startsWith('temp-') || (myId != null && m.senderBarberId === myId);
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[78%] rounded-2xl px-3.5 py-2 ${
                      mine
                        ? 'bg-black text-white rounded-br-md'
                        : 'bg-white border border-neutral-200 text-neutral-900 rounded-bl-md'
                    }`}
                  >
                    {!mine && (
                      <span className="block text-[11px] font-extrabold text-gold mb-0.5">{m.senderName}</span>
                    )}
                    <p className="text-[14px] leading-snug whitespace-pre-wrap break-words">{m.text}</p>
                    <span className="block text-[10px] mt-1 text-neutral-400">{fmtTime(m.createdAt)}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {!readOnly && (
          <div className="p-3 border-t border-gold/20 bg-white shrink-0 min-w-0" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
            {sendError ? (
              <p className="text-[12px] text-red-600 font-semibold mb-2 px-1">{sendError}</p>
            ) : null}
            <div className="flex gap-2 min-w-0">
              <input
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 500))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') send();
                }}
                onFocus={scrollBottom}
                placeholder="Message the team…"
                className="flex-1 min-w-0 rounded-full border border-neutral-300 px-4 py-2.5 text-[16px] bg-white focus:outline-none focus:border-gold"
              />
              <button
                onClick={send}
                disabled={!text.trim() || sending}
                className="gold-btn rounded-full px-5 py-2.5 text-[14px] font-bold disabled:opacity-40 shrink-0 min-h-[44px]"
              >
                {sending ? '…' : 'Send'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
