'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckIcon, CameraIcon } from '@/components/Icons';

interface BarberTask {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  status: 'pending' | 'submitted' | 'approved';
  photoUrl: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
}

function statusChip(s: BarberTask['status']) {
  if (s === 'approved') return <span className="chip !border-green-600/40 !text-green-700 shrink-0">✓ Done</span>;
  if (s === 'submitted') return <span className="chip !border-gold/60 !text-gold shrink-0">⏳ Under review</span>;
  return <span className="chip shrink-0">To do</span>;
}

/** Barber's own tasks: do the task, take a photo as proof, send it to the owner. */
export function BarberTasks({ getToken }: { getToken: () => string }) {
  const [tasks, setTasks] = useState<BarberTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showAlert, setShowAlert] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const alertedRef = useRef(false);
  const [activeTask, setActiveTask] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/barber/tasks', { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = d?.tasks || [];
        setTasks(list);
        // Big unmissable alert on app open when tasks are waiting —
        // only on first load, not after submitting a photo.
        if (!alertedRef.current && list.some((t: BarberTask) => t.status === 'pending')) {
          alertedRef.current = true;
          setShowAlert(true);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [getToken]);

  useEffect(() => {
    load();
  }, [load]);

  const pending = tasks.filter((t) => t.status === 'pending');
  const done = tasks.filter((t) => t.status !== 'pending');

  async function submitPhoto(taskId: string, file: File) {
    setError('');
    setSubmitting(taskId);
    try {
      const form = new FormData();
      form.append('photo', file);
      const r = await fetch(`/api/barber/tasks/${taskId}/submit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not submit the photo.');
      // Optimistic: mark submitted instantly (blob reads can lag behind overwrites).
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, status: 'submitted', submittedAt: new Date().toISOString() }
            : t
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit the photo.');
    }
    setSubmitting(null);
    setActiveTask(null);
  }

  if (!loaded) return null;
  if (tasks.length === 0) return null;

  return (
    <section ref={sectionRef}>
      {/* Big first-thing alert: you have tasks waiting */}
      {showAlert && pending.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 fade-in">
          <div className="card p-8 max-w-sm w-full text-center border-4 border-gold relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-transparent via-gold to-transparent" />
            <div className="text-[64px] leading-none">🔔</div>
            <h2 className="font-extrabold text-[26px] mt-4 tracking-tight">
              <span className="gold-text">You have a task!</span>
            </h2>
            <p className="text-neutral-600 mt-2 text-[15px]">
              {pending.length === 1
                ? 'The owner gave you 1 task to do.'
                : `The owner gave you ${pending.length} tasks to do.`}
            </p>
            <p className="text-neutral-500 text-sm mt-1">عندك مهمة لازم تسويها</p>
            <button
              onClick={() => {
                setShowAlert(false);
                sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className="gold-btn rounded-2xl px-8 py-3.5 text-[16px] w-full mt-6"
            >
              Show me 👀
            </button>
            <button
              onClick={() => setShowAlert(false)}
              className="text-neutral-400 text-sm mt-3 underline"
            >
              Later
            </button>
          </div>
        </div>
      )}

      <h2 className="font-extrabold mt-7 mb-3 text-[18px] tracking-tight text-[#141414]">
        My tasks ✅
        {pending.length > 0 && (
          <span className="ml-2 text-[12px] font-bold text-white bg-gold rounded-full px-2.5 py-0.5 align-middle">
            {pending.length}
          </span>
        )}
      </h2>

      {error && (
        <p className="text-red-700 text-sm bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-3 mb-3">{error}</p>
      )}

      <div className="grid gap-2.5">
        {pending.map((t) => (
          <div key={t.id} className="card p-4 border-2 border-gold/50">
            <div className="flex justify-between items-start gap-2">
              <b className="text-[15px]">{t.title}</b>
              {statusChip(t.status)}
            </div>
            {t.description && <p className="text-sm text-neutral-600 mt-1">{t.description}</p>}
            <button
              onClick={() => {
                setActiveTask(t.id);
                fileRef.current?.click();
              }}
              disabled={submitting === t.id}
              className="gold-btn rounded-xl px-4 py-2.5 text-sm mt-3 w-full inline-flex items-center justify-center gap-2"
            >
              <CameraIcon size={16} />
              {submitting === t.id ? 'Sending…' : 'Done — take a photo 📷'}
            </button>
          </div>
        ))}

        {done.map((t) => (
          <div key={t.id} className="card p-4 opacity-90">
            <div className="flex justify-between items-start gap-2">
              <b className="text-[15px]">{t.title}</b>
              {statusChip(t.status)}
            </div>
            {t.photoUrl && (
              <img src={t.photoUrl} alt="Proof" className="w-full max-h-[220px] object-cover rounded-xl mt-2.5 border border-gold/30" />
            )}
            {t.status === 'submitted' && (
              <p className="text-[13px] text-neutral-500 mt-2">Photo sent — waiting for the owner&apos;s review.</p>
            )}
            {t.status === 'approved' && (
              <p className="text-[13px] text-green-700 font-semibold mt-2 inline-flex items-center gap-1">
                <CheckIcon size={14} /> Approved by the owner
              </p>
            )}
          </div>
        ))}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && activeTask) submitPhoto(activeTask, f);
        }}
      />
    </section>
  );
}
