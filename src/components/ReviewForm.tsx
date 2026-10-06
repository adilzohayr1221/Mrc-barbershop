'use client';

import { useState } from 'react';
import { StarIcon } from '@/components/Icons';

export default function ReviewForm({
  barberId,
  barberName,
  token,
  onSubmitted,
}: {
  barberId: string;
  barberName: string;
  token: string;
  onSubmitted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const active = hover || rating;

  async function submit() {
    if (rating < 1 || text.trim().length < 2 || sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await fetch('/api/reviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ barberId, rating, text: text.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not post your review.');
      setDone(true);
      setText('');
      setRating(0);
      setHover(0);
      onSubmitted();
      window.setTimeout(() => {
        setDone(false);
        setOpen(false);
      }, 2600);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post your review.');
    }
    setSending(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 text-sm font-semibold text-gold underline underline-offset-2 decoration-gold/40"
      >
        Write a review
      </button>
    );
  }

  return (
    <div className="mt-1 bg-[#faf6ea] border border-gold/25 rounded-xl p-3">
      <p className="text-sm font-semibold">Your review for {barberName}</p>
      <div className="flex items-center gap-1 mt-2" role="radiogroup" aria-label="Your rating">
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={rating === i}
            aria-label={`${i} star${i === 1 ? '' : 's'}`}
            onClick={() => setRating(i)}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(0)}
            className="p-1 text-gold"
          >
            <StarIcon size={26} className={i <= active ? '' : 'opacity-25'} />
          </button>
        ))}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={1000}
        placeholder="How was your haircut?"
        className="input mt-2 w-full resize-none"
      />
      {error && <p className="text-sm text-red-600 mt-1.5">{error}</p>}
      {done && <p className="text-sm text-green-700 font-medium mt-1.5">Thanks! Your review was posted.</p>}
      <div className="flex gap-2 mt-2.5">
        <button
          type="button"
          onClick={submit}
          disabled={sending || rating < 1 || text.trim().length < 2}
          className="gold-btn rounded-xl px-4 py-2 text-sm disabled:opacity-40"
        >
          {sending ? 'Posting…' : 'Post review'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-xl px-4 py-2 text-sm border border-gold/30 text-neutral-600"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
