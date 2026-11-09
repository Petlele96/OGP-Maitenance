"use client";

import { useCallback, useEffect, useState } from "react";
import { buildFollowUpLink, buildWhatsAppChatLink } from "@/lib/site";
import { SKIP_REASONS, type SkipOrMoveReason, type SkipReason } from "@/lib/schedule";
import type { PlanId } from "@/lib/plans";

interface Yard {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  block: number | null;
  plan: PlanId;
  notes: string | null;
  status: "done" | "not_done" | "pending";
  completedAt: string | null;
  reason: SkipOrMoveReason | null;
  rescheduledDate: string | null;
  overdueSince: string | null;
}

interface DayData {
  date: string;
  isToday: boolean;
  isFuture: boolean;
  yards: Yard[];
}

interface Worker {
  id: string;
  name: string;
}

export interface MovedInfo {
  id: string;
  fullName: string;
  whatsappNumber: string;
  dateLabel: string;
}

const REASON_LABELS: Record<SkipOrMoveReason, string> = {
  rain: "Rain",
  gate_locked: "Gate locked",
  dogs_loose: "Dogs loose",
  customer_requested: "Customer requested",
  other: "Other",
  moved: "Moved",
  blocked: "Blocked date",
};

const PLAN_LABELS: Record<PlanId, string> = { monthly: "Monthly", annual: "Annual", "once-off": "Once-off" };
const WORKER_KEY = "ops_last_worker";

function shortDate(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function recordContact(signupId: string) {
  fetch("/api/ops/contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signupId }),
  }).catch(() => {});
}

async function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

/**
 * Today's route as a single list in service order. The worker flags the exceptions, picks who did the
 * route and taps "Confirm day" - a shortcut that writes one visit record (today's date, that worker) for
 * every client still on the list. Nothing is stored about the day itself.
 */
export default function DayRoute({
  date,
  onMoved,
  onChanged,
  onUnauthorized,
}: {
  date: string;
  onMoved: (info: MovedInfo) => void;
  onChanged: () => void;
  onUnauthorized: () => void;
}) {
  const [data, setData] = useState<DayData | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [workerId, setWorkerId] = useState("");
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveDate, setMoveDate] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [postponing, setPostponing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/ops/day?date=${date}`, { cache: "no-store" });
    if (res.status === 401) {
      onUnauthorized();
      return;
    }
    if (res.ok) setData(await res.json());
  }, [date, onUnauthorized]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/ops/workers", { cache: "no-store" });
      if (!res.ok) return;
      const list: Worker[] = (await res.json()).workers;
      setWorkers(list);
      try {
        const last = localStorage.getItem(WORKER_KEY);
        if (last && list.some((w) => w.id === last)) setWorkerId(last);
      } catch {
        /* storage unavailable - the picker just starts empty */
      }
    })();
  }, []);

  async function run(fn: () => Promise<Response>) {
    setError(null);
    const res = await fn();
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "That didn't save. Please try again.");
    }
    await load();
    onChanged();
  }

  async function flagNotDone(yard: Yard, reason: SkipReason) {
    setBusyId(yard.id);
    await run(() => post("/api/ops/skip", { signupId: yard.id, reason, date }));
    setBusyId(null);
    setPickingId(null);
  }

  async function undoNotDone(yard: Yard) {
    setBusyId(yard.id);
    await run(() => post("/api/ops/unskip", { signupId: yard.id, date }));
    setBusyId(null);
  }

  async function confirmDay() {
    if (!workerId) return;
    setConfirming(true);
    try {
      localStorage.setItem(WORKER_KEY, workerId);
    } catch {
      /* ignore */
    }
    await run(() => post("/api/ops/day/confirm", { date, workerId }));
    setConfirming(false);
  }

  async function postponeToday() {
    if (!window.confirm("Move every remaining visit today to the next working day?")) return;
    setPostponing(true);
    await run(() => fetch("/api/ops/postpone-today", { method: "POST" }));
    setPostponing(false);
  }

  async function moveYard(yard: Yard) {
    if (!moveDate) return;
    setBusyId(yard.id);
    const label = shortDate(moveDate);
    const res = await post("/api/ops/move", { signupId: yard.id, originalDate: date, targetDate: moveDate });
    setBusyId(null);
    setMovingId(null);
    setMoveDate("");
    if (res.ok) onMoved({ id: yard.id, fullName: yard.fullName, whatsappNumber: yard.whatsappNumber, dateLabel: label });
    await load();
    onChanged();
  }

  if (!data) return <p className="mt-8 text-center text-sm text-brand-500">Loading...</p>;

  const { yards } = data;
  const editable = !data.isFuture;
  const notDone = yards.filter((y) => y.status === "not_done");
  const pendingCount = yards.filter((y) => y.status === "pending").length;
  const doneCount = yards.filter((y) => y.status === "done").length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-bold text-brand-900">
          {new Date(`${data.date}T00:00:00`).toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
          {data.isToday && <span className="ml-2 text-xs font-semibold text-brand-500">Today</span>}
        </h2>
        {data.isFuture && <p className="mt-1 text-xs text-brand-500">This day hasn&apos;t happened yet.</p>}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {yards.length === 0 ? (
        <p className="mt-4 text-center text-sm text-brand-500">No visits scheduled for this day.</p>
      ) : (
        <>
          {editable && pendingCount > 0 ? (
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
              <label className="block text-xs font-medium text-brand-600">
                Who did this route?
                <select
                  value={workerId}
                  onChange={(e) => setWorkerId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-brand-200 bg-white px-3 py-2 text-base text-brand-900 outline-none focus:border-brand-500"
                >
                  <option value="">{workers.length === 0 ? "Add a worker in the Clients tab first" : "Choose a worker"}</option>
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={confirmDay}
                disabled={confirming || !workerId}
                className="mt-3 h-14 w-full rounded-xl bg-brand-600 text-lg font-bold text-white shadow-sm disabled:opacity-60"
              >
                {confirming ? "Recording..." : "Confirm day"}
              </button>
              <p className="mt-2 text-center text-xs text-brand-600">
                {doneCount} done · {notDone.length} not done · {pendingCount} will get a visit record dated today
              </p>
            </div>
          ) : null}

          {data.isToday && pendingCount > 0 && (
            <button
              onClick={postponeToday}
              disabled={postponing}
              className="w-full rounded-xl border-2 border-brand-300 px-4 py-3 text-sm font-semibold text-brand-700 disabled:opacity-60"
            >
              {postponing ? "Postponing..." : "Postpone today (rain)"}
            </button>
          )}

          <ul className="flex flex-col gap-3">
            {yards.map((y) => (
              <li
                key={y.id}
                className={`rounded-2xl p-4 shadow-sm ring-1 ring-brand-100 ${
                  y.status === "not_done" ? "bg-brand-50" : "bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-brand-900">
                      {y.fullName}
                      {y.overdueSince && (
                        <span className="ml-2 rounded-md bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-800">
                          Overdue since {shortDate(y.overdueSince)}
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-brand-700">
                      House {y.houseNumber}
                      {y.block !== null && <span className="text-brand-400"> · Block {y.block}</span>}
                      <span className="text-brand-400"> · {PLAN_LABELS[y.plan]}</span>
                    </p>
                    <a
                      href={buildWhatsAppChatLink(y.whatsappNumber)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => recordContact(y.id)}
                      className="text-sm text-brand-500 underline"
                    >
                      {y.whatsappNumber}
                    </a>
                    {y.notes && <p className="mt-1 text-xs text-brand-500">{y.notes}</p>}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2 text-right">
                    {y.status === "not_done" ? (
                      <span className="rounded-lg bg-brand-100 px-2.5 py-1.5 text-xs font-semibold text-brand-700">
                        Not done: {y.reason ? REASON_LABELS[y.reason] : "-"}
                        {y.rescheduledDate && <> → {shortDate(y.rescheduledDate)}</>}
                      </span>
                    ) : y.status === "done" ? (
                      <span className="rounded-lg bg-brand-100 px-2.5 py-1.5 text-xs font-semibold text-brand-700">
                        ✓ Done{y.completedAt ? ` ${timeOf(y.completedAt)}` : ""}
                      </span>
                    ) : (
                      <span className="rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-600">
                        {y.overdueSince ? "Overdue" : "Due"}
                      </span>
                    )}

                    {editable &&
                      (y.status === "not_done" ? (
                        <button
                          onClick={() => undoNotDone(y)}
                          disabled={busyId === y.id}
                          className="text-xs font-semibold text-brand-600 underline disabled:opacity-60"
                        >
                          Undo
                        </button>
                      ) : (
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => {
                              setMovingId(null);
                              setPickingId(pickingId === y.id ? null : y.id);
                            }}
                            className="rounded-md border border-brand-300 px-2.5 py-1 text-xs font-semibold text-brand-700"
                          >
                            Not done
                          </button>
                          <button
                            onClick={() => {
                              setPickingId(null);
                              setMovingId(movingId === y.id ? null : y.id);
                            }}
                            className="text-xs font-medium text-brand-500 underline"
                          >
                            Move
                          </button>
                        </div>
                      ))}
                  </div>
                </div>

                {pickingId === y.id && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {SKIP_REASONS.map((reason) => (
                      <button
                        key={reason}
                        onClick={() => flagNotDone(y, reason)}
                        disabled={busyId === y.id}
                        className="rounded-lg border-2 border-brand-300 px-3 py-2 text-xs font-semibold text-brand-700 disabled:opacity-60"
                      >
                        {REASON_LABELS[reason]}
                      </button>
                    ))}
                    <button
                      onClick={() => setPickingId(null)}
                      className="rounded-lg px-3 py-2 text-xs font-semibold text-brand-500 underline"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {movingId === y.id && (
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="date"
                      value={moveDate}
                      onChange={(e) => setMoveDate(e.target.value)}
                      className="flex-1 rounded-lg border border-brand-200 px-2 py-2 text-sm text-brand-900"
                    />
                    <button
                      onClick={() => moveYard(y)}
                      disabled={!moveDate || busyId === y.id}
                      className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => {
                        setMovingId(null);
                        setMoveDate("");
                      }}
                      className="text-xs font-semibold text-brand-500 underline"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {y.status === "done" && y.plan === "once-off" && (
                  <a
                    href={buildFollowUpLink(y.fullName, y.whatsappNumber)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => recordContact(y.id)}
                    className="mt-3 block rounded-lg border-2 border-brand-500 px-4 py-3 text-center text-sm font-semibold text-brand-700"
                  >
                    Follow up: offer monthly plan
                  </a>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
