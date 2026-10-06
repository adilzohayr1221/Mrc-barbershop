'use client';

import { useEffect, useRef, useState } from 'react';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
}

const POS_KEY = 'mrc-ai-pos';
const DRAG_THRESHOLD = 10;

const SUGGESTIONS = [
  'How much is a haircut?',
  'How do I book?',
  'Where are you located?',
];

function SparkleIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 1.5 14.3 9.7 22.5 12 14.3 14.3 12 22.5 9.7 14.3 1.5 12 9.7 9.7Z" />
      <path d="M19 3.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z" opacity=".75" />
    </svg>
  );
}

function CloseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

function SendIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function loadPos(): { right: number; bottom: number } {
  const def = { right: 16, bottom: 88 };
  try {
    if (typeof window === 'undefined') return def;
    const raw = window.localStorage.getItem(POS_KEY);
    if (!raw) return def;
    const p = JSON.parse(raw) as { right?: number; bottom?: number };
    if (typeof p.right === 'number' && typeof p.bottom === 'number') {
      return {
        right: Math.min(Math.max(p.right, 8), window.innerWidth - 64),
        bottom: Math.min(Math.max(p.bottom, 8), window.innerHeight - 64),
      };
    }
  } catch {
    /* ignore */
  }
  return def;
}

export default function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(loadPos);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ startX: number; startY: number; startR: number; startB: number; moved: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el && open) el.scrollTop = el.scrollHeight;
  }, [messages, busy, open]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open ]);

  useEffect(() => {
    if (open) {
      // Focus the input when the panel opens (mobile keyboards stay down until the user taps).
      const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 350);
      return () => window.clearTimeout(t);
    }
  }, [open ]);

  function persist(p: { right: number; bottom: number }) {
    try {
      window.localStorage.setItem(POS_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      startR: pos.right,
      startB: pos.bottom,
      moved: false,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) d.moved = true;
    if (!d.moved) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const right = Math.min(Math.max(d.startR - dx, 8), w - 64);
    const bottom = Math.min(Math.max(d.startB - dy, 8), h - 64);
    setPos({ right, bottom });
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      persist(pos);
    } else {
      setOpen((o) => !o);
    }
  }

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: 'user' as const, text }].slice(-24);
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const r = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.slice(-12) }),
      });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; reply?: string } | null;
      if (d && d.ok && typeof d.reply === 'string' && d.reply.trim()) {
        setMessages((m) => [...m, { role: 'assistant' as const, text: d.reply!.trim() }].slice(-24));
      } else {
        throw new Error('bad-reply');
      }
    } catch {
      setMessages((m) =>
        [...m, { role: 'assistant' as const, text: "Sorry, I'm having trouble right now — please call (443) 741-5820." }].slice(-24)
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Floating button — customer app only (mounted from the customer layout). */}
      {!open && (
        <button
          type="button"
          aria-label="Chat with the MRC assistant"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            drag.current = null;
          }}
          className="fixed z-40 w-14 h-14 rounded-full text-black flex items-center justify-center touch-none select-none"
          style={{
            right: pos.right,
            bottom: pos.bottom,
            background: 'linear-gradient(135deg, #d4af37 0%, #b8912a 100%)',
            boxShadow: '0 10px 28px rgba(0,0,0,0.28), 0 0 0 4px rgba(212,175,55,0.22)',
          }}
        >
          <span className="absolute inset-0 rounded-full animate-ping opacity-20 bg-[#d4af37] pointer-events-none" />
          <SparkleIcon size={28} />
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed z-[70] inset-x-4 bottom-4 sm:left-auto sm:right-6 sm:bottom-6 sm:w-[380px] fade-in">
          <div
            className="card overflow-hidden flex flex-col"
            style={{ maxHeight: '70vh', boxShadow: '0 24px 70px rgba(0,0,0,0.35)' }}
          >
            <div
              className="flex items-center justify-between px-4 py-3 shrink-0 border-b border-gold/30"
              style={{ background: 'linear-gradient(135deg, #fdf8ea 0%, #f6ead0 100%)' }}
            >
              <p className="font-extrabold text-[15px]">
                <span className="text-gold">✦</span> <span className="text-gold-dark">MRC Assistant</span>
              </p>
              <button
                type="button"
                aria-label="Close assistant"
                onClick={() => setOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-500 hover:text-[#141414] hover:bg-gold/15"
              >
                <CloseIcon />
              </button>
            </div>

            <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 grid gap-3 content-start min-h-[220px]">
              {messages.length === 0 && (
                <div className="grid gap-3">
                  <div className="bg-white border border-[#e6dabf] rounded-2xl rounded-tl-md px-4 py-3 text-[14px] leading-relaxed shadow-sm max-w-[85%]">
                    Hi! I&apos;m the MRC assistant 👋 Ask me about services, prices, branches, or booking.
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void send(s)}
                        disabled={busy}
                        className="text-[13px] font-semibold px-3 py-2 rounded-full bg-[#f7f2e2] border border-[#e6dabf] text-neutral-700 disabled:opacity-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.role === 'user'
                      ? 'justify-self-end bg-[#1c1a15] text-white rounded-2xl rounded-br-md px-4 py-2.5 text-[14px] leading-relaxed max-w-[85%]'
                      : 'justify-self-start bg-white border border-[#e6dabf] rounded-2xl rounded-tl-md px-4 py-2.5 text-[14px] leading-relaxed shadow-sm max-w-[85%]'
                  }
                >
                  {m.text}
                </div>
              ))}
              {busy && (
                <div className="justify-self-start bg-white border border-[#e6dabf] rounded-2xl rounded-tl-md px-4 py-3 shadow-sm flex gap-1.5">
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="w-2 h-2 rounded-full bg-gold animate-bounce"
                      style={{ animationDelay: `${d * 150}ms` }}
                    />
                  ))}
                </div>
              )}
            </div>

            <form
              className="shrink-0 flex items-center gap-2 px-3 py-3 border-t border-[#e6dabf] bg-[#fbf8ef]"
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about services, prices…"
                maxLength={500}
                autoComplete="off"
                className="flex-1 min-w-0 text-[16px] px-4 py-2.5 rounded-full bg-white border border-[#e6dabf] outline-none focus:border-gold"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                aria-label="Send message"
                className="gold-btn w-11 h-11 rounded-full flex items-center justify-center shrink-0 disabled:opacity-50"
              >
                <SendIcon />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
