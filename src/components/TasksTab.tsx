'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckIcon } from '@/components/Icons';

interface Assignment {
  barberId: string;
  barberName: string;
  status: 'pending' | 'submitted' | 'approved';
  photoUrl: string | null;
  submittedAt: string | null;
}

interface Task {
  id: string;
  title: string;
  description?: string;
  createdAt: string;
  salonId?: string;
  assignments: Assignment[];
}

interface Props {
  getToken: () => string;
  apiBase: string; // '/api/owner/tasks' | '/api/salon/tasks'
  barbers: { id: string; name: string; active?: boolean }[];
  // When true, the creator picks which salon the task belongs to (super-admin).
  // False for salon owners (their own salon, implied).
  salonPicker?: boolean;
}

function statusChip(s: Assignment['status']) {
  if (s === 'approved') return <span className="chip !border-green-600/40 !text-green-700 shrink-0">✓ Done</span>;
  if (s === 'submitted') return <span className="chip !border-gold/60 !text-gold shrink-0">⏳ Review</span>;
  return <span className="chip shrink-0">Pending</span>;
}

/** Task management: the owner assigns tasks to barbers; each barber completes
 *  the task and sends a photo as proof; the owner reviews and approves. */
export function TasksTab({ getToken, apiBase, barbers, salonPicker }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [salonId, setSalonId] = useState('mrc');
  const [salonOptions, setSalonOptions] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);

  const headers = useCallback(
    (): HeadersInit => ({
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
    }),
    [getToken]
  );

  const load = useCallback(() => {
    const url = salonPicker ? `${apiBase}?salon=${encodeURIComponent(salonId)}` : apiBase;
    fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setTasks(d?.tasks || []))
      .catch(() => {});
  }, [apiBase, getToken, salonId, salonPicker]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!salonPicker) return;
    fetch('/api/owner/salons', { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = (d?.salons || [])
          .filter((e: { salon: { status: string } }) => e.salon.status === 'active')
          .map((e: { salon: { id: string; name: string } }) => ({ id: e.salon.id, name: e.salon.name }));
        setSalonOptions(list);
      })
      .catch(() => {});
  }, [getToken, salonPicker]);

  const activeBarbers = barbers.filter((b) => b.active !== false);
  const needsReview = tasks.reduce(
    (n, t) => n + t.assignments.filter((a) => a.status === 'submitted').length,
    0
  );

  function toggleBarber(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function create() {
    setError('');
    if (title.trim().length < 3) {
      setError('Give the task a short title.');
      return;
    }
    if (!picked.length) {
      setError('Pick at least one barber.');
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim(),
        barberIds: picked,
      };
      if (salonPicker) body.salonId = salonId;
      const r = await fetch(apiBase, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not create the task.');
      setTitle('');
      setDescription('');
      setPicked([]);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the task.');
    }
    setBusy(false);
  }

  async function review(taskId: string, barberId: string, action: 'approve' | 'reopen') {
    setReviewBusy(`${taskId}:${barberId}`);
    try {
      const r = await fetch(`${apiBase}/${taskId}/review`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ barberId, action }),
      });
      if (!r.ok) throw new Error('Failed.');
      // Optimistic: the server write is authoritative, update the UI instantly
      // instead of re-fetching (blob reads can lag behind overwrites).
      const now = new Date().toISOString();
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                assignments: t.assignments.map((a) =>
                  a.barberId === barberId
                    ? {
                        ...a,
                        status: action === 'approve' ? 'approved' : 'pending',
                        photoUrl: action === 'approve' ? a.photoUrl : null,
                        submittedAt: action === 'approve' ? a.submittedAt ?? now : null,
                      }
                    : a
                ),
              }
            : t
        )
      );
    } catch {
      setError('Could not update the task.');
    }
    setReviewBusy(null);
  }

  async function removeTask(taskId: string, title: string) {
    if (!confirm(`Delete the task "${title}"? It will disappear for the barbers too.`)) return;
    try {
      const r = await fetch(`${apiBase}/${taskId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!r.ok) throw new Error('Failed.');
      // Optimistic: remove instantly (blob reads can lag behind deletes).
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch {
      setError('Could not delete the task.');
    }
  }

  return (
    <div>
      {needsReview > 0 && (
        <div className="card p-4 mb-4 border-2 border-gold/60 bg-[#fbf3df]">
          <p className="font-bold text-[15px]">
            ⏳ {needsReview} photo{needsReview === 1 ? '' : 's'} waiting for your review
          </p>
        </div>
      )}

      {/* Create */}
      <div className="card p-5 grid gap-4">
        <h3 className="font-bold text-[15px]">New task ✅</h3>
        {salonPicker && (
          <div>
            <label className="label">Salon</label>
            <select className="input" value={salonId} onChange={(e) => setSalonId(e.target.value)}>
              <option value="mrc">My shops (MRC)</option>
              {salonOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label">Task</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Clean the mirrors and sweep the floor"
            maxLength={120}
          />
        </div>
        <div>
          <label className="label">Details (optional)</label>
          <input
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Any extra instructions…"
            maxLength={300}
          />
        </div>
        <div>
          <label className="label">Assign to</label>
          <div className="flex flex-wrap gap-2">
            {activeBarbers.map((b) => (
              <button
                key={b.id}
                onClick={() => toggleBarber(b.id)}
                className={`rounded-full px-4 py-2 text-sm font-bold border min-h-[40px] ${
                  picked.includes(b.id)
                    ? 'bg-gold text-white border-gold'
                    : 'border-gold/40 text-gold'
                }`}
              >
                {picked.includes(b.id) ? '✓ ' : ''}{b.name}
              </button>
            ))}
            {activeBarbers.length === 0 && (
              <p className="text-sm text-neutral-500">No barbers yet.</p>
            )}
          </div>
        </div>
        {error && <p className="text-red-700 text-sm">{error}</p>}
        <button onClick={create} disabled={busy} className="gold-btn rounded-2xl px-6 py-3 text-[15px]">
          {busy ? 'Creating…' : 'Assign task'}
        </button>
      </div>

      {/* List */}
      <div className="grid gap-3 mt-5">
        {tasks.map((t) => (
          <div key={t.id} className="card p-4">
            <div className="flex justify-between items-start gap-2">
              <b className="text-[15px]">{t.title}</b>
              <button
                onClick={() => removeTask(t.id, t.title)}
                className="text-red-600/70 text-[13px] font-semibold shrink-0 px-2 py-1"
                title="Delete task"
              >
                🗑
              </button>
            </div>
            {t.description && <p className="text-sm text-neutral-600 mt-0.5">{t.description}</p>}
            <div className="grid gap-2.5 mt-3">
              {t.assignments.map((a) => (
                <div key={a.barberId} className="bg-[#f7f2e2] border border-[#e6dabf] rounded-xl p-3">
                  <div className="flex justify-between items-center gap-2">
                    <b className="text-sm">{a.barberName}</b>
                    {statusChip(a.status)}
                  </div>
                  {a.photoUrl && (
                    <a href={a.photoUrl} target="_blank" rel="noreferrer">
                      <img
                        src={a.photoUrl}
                        alt="Proof"
                        className="w-full max-h-[240px] object-cover rounded-xl mt-2 border border-gold/30"
                      />
                    </a>
                  )}
                  {a.status === 'submitted' && (
                    <div className="flex gap-2 mt-2.5">
                      <button
                        onClick={() => review(t.id, a.barberId, 'approve')}
                        disabled={reviewBusy === `${t.id}:${a.barberId}`}
                        className="gold-btn rounded-xl px-4 py-2 text-sm flex-1 inline-flex items-center justify-center gap-1"
                      >
                        <CheckIcon size={14} /> Approve
                      </button>
                      <button
                        onClick={() => review(t.id, a.barberId, 'reopen')}
                        disabled={reviewBusy === `${t.id}:${a.barberId}`}
                        className="rounded-xl px-4 py-2 text-sm border border-neutral-300 font-semibold flex-1"
                      >
                        Redo
                      </button>
                    </div>
                  )}
                  {a.status === 'approved' && (
                    <button
                      onClick={() => review(t.id, a.barberId, 'reopen')}
                      className="text-[13px] text-neutral-500 underline mt-2"
                    >
                      Reopen
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {tasks.length === 0 && (
          <div className="card p-8 text-center">
            <p className="text-sm text-neutral-500">No tasks yet — assign the first one above.</p>
          </div>
        )}
      </div>
    </div>
  );
}
