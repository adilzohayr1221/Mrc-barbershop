'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ChatMsg {
  id: string;
  senderRole: 'customer' | 'barber';
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

export function ChatModal({
  bookingId,
  title,
  subtitle,
  me,
  getToken,
  onClose,
}: {
  bookingId: string;
  title: string; // e.g. "Chat with Adil"
  subtitle?: string; // e.g. "Today · 2:00 PM"
  me: 'customer' | 'barber';
  getToken: () => string;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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

  const load = async (silent: boolean) => {
    try {
      const r = await fetch(`/api/chats/${bookingId}`, {
        headers: { Authorization: `Bearer ${tokenRef.current()}` },
        cache: 'no-store',
      });
      if (!r.ok) return;
      const j = await r.json();
      setMessages((prev) => {
        const next: ChatMsg[] = j.messages ?? [];
        // Merge with local: keep messages not yet on the server (optimistic
        // sends or stale Blob reads). Prevents sent messages from vanishing.
        const serverIds = new Set(next.map((m) => m.id));
        const localOnly = prev.filter((m) => !serverIds.has(m.id));
        const merged = [...next, ...localOnly].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
    load(false);
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setSendError('');
    try {
      const r = await fetch(`/api/chats/${bookingId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current()}` },
        body: JSON.stringify({ text: t.slice(0, 500) }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok) {
        setText('');
        // Optimistic: show the message instantly from the POST response,
        // don't wait for the next poll (Blob reads can be stale).
        if (j?.message) {
          setMessages((prev) =>
            prev.some((m) => m.id === j.message.id) ? prev : [...prev, j.message]
          );
        } else {
          await load(true);
        }
        scrollBottom();
      } else {
        setSendError(j?.error || 'Could not send. Try again.');
      }
    } catch {
      setSendError('Could not send. Check your connection.');
    } finally {
      setSending(false);
    }
  };

  const removeMessage = async (messageId: string) => {
    if (!confirm('Delete this message?')) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/chats/${bookingId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current()}` },
        body: JSON.stringify({ messageId }),
      });
      if (r.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
        setSelectedId(null);
      }
    } catch {
      // keep the message on failure; next poll will sync
    } finally {
      setDeleting(false);
    }
  };

  if (!mounted) return null;

  // Portal on document.body: no ancestor transform/filter can break
  // position:fixed, and the container always starts at top:0.
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
            <b className="block text-[15px] truncate">{title}</b>
            {subtitle ? <span className="block text-[11px] text-neutral-500 truncate">{subtitle}</span> : null}
          </div>
          <button
            onClick={onClose}
            aria-label="Close chat"
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
              No messages yet.<br />Say hi — e.g. “I’m running 10 min late.”
            </p>
          ) : (
            messages.map((m) => {
              const mine = m.senderRole === me;
              const selected = selectedId === m.id;
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[78%]">
                    <button
                      onClick={() => setSelectedId(selected ? null : m.id)}
                      className={`w-full text-left rounded-2xl px-3.5 py-2 ${
                        mine
                          ? 'bg-black text-white rounded-br-md'
                          : 'bg-white border border-neutral-200 text-neutral-900 rounded-bl-md'
                      } ${selected ? 'ring-2 ring-gold' : ''}`}
                    >
                      <p className="text-[14px] leading-snug whitespace-pre-wrap break-words">{m.text}</p>
                      <span className={`block text-[10px] mt-1 ${mine ? 'text-neutral-400' : 'text-neutral-400'}`}>
                        {fmtTime(m.createdAt)}
                      </span>
                    </button>
                    {selected && (
                      <div className={`mt-1 flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <button
                          onClick={() => removeMessage(m.id)}
                          disabled={deleting}
                          className="text-[12px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-full px-3 py-1.5 disabled:opacity-50"
                        >
                          {deleting ? '…' : '🗑 Delete'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="p-3 border-t border-gold/20 bg-white shrink-0 min-w-0" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          {sendError ? (
            <p className="text-[12px] text-red-600 font-semibold mb-2 px-1">{sendError}</p>
          ) : null}
          <div className="flex gap-2 min-w-0">
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 500))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') send();
              }}
              onFocus={scrollBottom}
              placeholder="Type a message…"
              className="flex-1 min-w-0 rounded-full border border-neutral-300 px-4 py-2.5 text-[16px] bg-white focus:outline-none focus:border-gold"
            />
            <button
              onClick={send}
              disabled={!text.trim() || sending}
              className="btn-gold rounded-full px-5 py-2.5 text-[14px] font-bold disabled:opacity-40 shrink-0 min-h-[44px]"
            >
              {sending ? '…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
