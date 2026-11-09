"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { PlanId } from "@/lib/plans";

interface Worker {
  id: string;
  name: string;
}

interface OpsClient {
  id: string;
  fullName: string;
  houseNumber: string;
  block: number | null;
  plan: PlanId;
  paused: boolean;
  lastVisitDate: string | null;
  lastVisitWorker: string | null;
  nextServiceDate: string | null;
  nextServiceDateManual: boolean;
  dueDate: string | null;
  overdueSince: string | null;
}

interface ClientVisit {
  serviceDate: string;
  worker: string | null;
  note: string | null;
  confirmed: boolean;
}

const LAST_WORKER_KEY = "ops_last_worker";

/** Today's date in Johannesburg as YYYY-MM-DD (the phone's own clock zone can't be trusted near midnight). */
function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

function formatDate(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function planLabel(plan: PlanId): string {
  return plan === "monthly" ? "Monthly" : plan === "annual" ? "Annual" : "Once-off";
}

function blockLabel(block: number | null): string {
  return block === null ? "No block" : `Block ${block}`;
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export default function ClientsTab({
  mode,
  onChanged,
  onUnauthorized,
}: {
  /** "overdue" lists only clients past their next service date, in walking order (block, then house). */
  mode: "all" | "overdue";
  onChanged: () => void;
  onUnauthorized: () => void;
}) {
  const [clients, setClients] = useState<OpsClient[] | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadClients = useCallback(async () => {
    const res = await fetch("/api/ops/clients", { cache: "no-store" });
    if (res.status === 401) return onUnauthorized();
    setClients((await res.json()).clients);
    onChanged();
  }, [onUnauthorized, onChanged]);

  const loadWorkers = useCallback(async () => {
    const res = await fetch("/api/ops/workers", { cache: "no-store" });
    if (res.status === 401) return onUnauthorized();
    setWorkers((await res.json()).workers);
  }, [onUnauthorized]);

  useEffect(() => {
    loadClients();
    loadWorkers();
  }, [loadClients, loadWorkers]);

  const filtered = useMemo(() => {
    if (!clients) return [];
    let list = clients;
    if (mode === "overdue") {
      list = clients
        .filter((c) => c.overdueSince !== null)
        .sort(
          (a, b) =>
            (a.block ?? Infinity) - (b.block ?? Infinity) ||
            a.houseNumber.localeCompare(b.houseNumber, undefined, { numeric: true })
        );
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => c.fullName.toLowerCase().includes(q) || c.houseNumber.toLowerCase().includes(q));
  }, [clients, search, mode]);

  if (selectedId) {
    return (
      <ClientPage
        id={selectedId}
        workers={workers}
        onBack={() => setSelectedId(null)}
        onChanged={loadClients}
        onUnauthorized={onUnauthorized}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {mode === "all" ? (
        <WorkersCard workers={workers} onChanged={loadWorkers} onUnauthorized={onUnauthorized} />
      ) : (
        <p className="text-sm text-brand-600">
          Clients past their next service date, by block. Open one and record the visit with the date the work was
          done.
        </p>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or house number"
        className="rounded-xl border border-brand-200 px-4 py-3 text-sm text-brand-900 outline-none focus:border-brand-500"
      />

      {clients === null ? (
        <p className="mt-2 text-center text-sm text-brand-500">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="mt-2 text-center text-sm text-brand-500">
          {mode === "overdue" ? "Nobody is overdue." : "No clients found."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => setSelectedId(c.id)}
                className="w-full rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-brand-100"
              >
                <p className="font-semibold text-brand-900">
                  {c.fullName}
                  {c.overdueSince && (
                    <span className="ml-2 rounded-md bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-800">
                      Overdue since {formatDate(c.overdueSince)}
                    </span>
                  )}
                </p>
                <p className="text-sm text-brand-700">
                  House {c.houseNumber} <span className="text-brand-400">· {blockLabel(c.block)}</span>
                </p>
                <p className="mt-2 text-xs text-brand-600">
                  Last visit:{" "}
                  {c.lastVisitDate ? `${formatDate(c.lastVisitDate)}${c.lastVisitWorker ? ` · ${c.lastVisitWorker}` : ""}` : "none recorded"}
                </p>
                <p className="text-xs text-brand-600">
                  Next service: {c.nextServiceDate ? formatDate(c.nextServiceDate) : "not set"}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WorkersCard({
  workers,
  onChanged,
  onUnauthorized,
}: {
  workers: Worker[];
  onChanged: () => void;
  onUnauthorized: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await postJson("/api/ops/workers", { name });
    setBusy(false);
    if (res.status === 401) return onUnauthorized();
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Couldn't add that worker.");
      return;
    }
    setName("");
    onChanged();
  }

  async function remove(w: Worker) {
    if (!window.confirm(`Remove ${w.name} from the list? Visits already recorded keep their name.`)) return;
    const res = await postJson("/api/ops/workers/remove", { id: w.id });
    if (res.status === 401) return onUnauthorized();
    onChanged();
  }

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <h2 className="text-sm font-semibold text-brand-900">Workers ({workers.length})</h2>
        <span className="text-xs font-medium text-brand-500">{open ? "Hide" : "Show"}</span>
      </button>
      {workers.length === 0 && !open && (
        <p className="mt-1 text-xs text-amber-800">Add at least one worker before you can record a visit.</p>
      )}
      {open && (
        <>
          {workers.length === 0 ? (
            <p className="mt-3 text-sm text-brand-500">No workers yet.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {workers.map((w) => (
                <li key={w.id} className="flex items-center justify-between">
                  <span className="text-sm text-brand-900">{w.name}</span>
                  <button onClick={() => remove(w)} className="text-xs font-semibold text-red-700 underline">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={add} className="mt-3 flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="Worker's name"
              className="min-w-0 flex-1 rounded-lg border border-brand-200 px-3 py-2 text-sm text-brand-900 outline-none focus:border-brand-500"
            />
            <button
              type="submit"
              disabled={busy || name.trim().length < 2}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              Add
            </button>
          </form>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </>
      )}
    </section>
  );
}

function ClientPage({
  id,
  workers,
  onBack,
  onChanged,
  onUnauthorized,
}: {
  id: string;
  workers: Worker[];
  onBack: () => void;
  onChanged: () => void;
  onUnauthorized: () => void;
}) {
  const [client, setClient] = useState<OpsClient | null>(null);
  const [visits, setVisits] = useState<ClientVisit[]>([]);
  const [loadError, setLoadError] = useState(false);

  const [visitDate, setVisitDate] = useState(todayKey());
  const [workerId, setWorkerId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [visitMessage, setVisitMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const [nextDate, setNextDate] = useState("");
  const [nextBusy, setNextBusy] = useState(false);
  const [nextMessage, setNextMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/ops/client?id=${id}`, { cache: "no-store" });
    if (res.status === 401) return onUnauthorized();
    if (!res.ok) {
      setLoadError(true);
      return;
    }
    const json = await res.json();
    setClient(json.client);
    setVisits(json.visits);
    setNextDate(json.client.nextServiceDate ?? "");
  }, [id, onUnauthorized]);

  useEffect(() => {
    load();
  }, [load]);

  // Preselect whoever was picked last time, if they're still on the list.
  useEffect(() => {
    if (workerId) return;
    try {
      const last = localStorage.getItem(LAST_WORKER_KEY);
      if (last && workers.some((w) => w.id === last)) setWorkerId(last);
    } catch {
      /* storage unavailable - the picker just starts empty */
    }
  }, [workers, workerId]);

  async function saveVisit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setVisitMessage(null);
    const res = await postJson("/api/ops/client/visit", { signupId: id, date: visitDate, workerId, note });
    setSaving(false);
    if (res.status === 401) return onUnauthorized();
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setVisitMessage({ kind: "error", text: json.error ?? "Couldn't save that visit." });
      return;
    }
    try {
      localStorage.setItem(LAST_WORKER_KEY, workerId);
    } catch {
      /* ignore */
    }
    const next = json.nextDateUpdated
      ? ` Next service date set to ${formatDate(json.nextServiceDate)}.`
      : json.nextDateReason === "once_off"
        ? " Once-off bookings don't repeat, so there is no next date."
        : json.nextDateReason === "inactive"
          ? " Next service date not set - this client isn't active or booked."
          : " Next service date left as it was - a later visit is already recorded.";
    setVisitMessage({
      kind: "ok",
      text: `${json.updatedExisting ? "Updated the existing record for that day." : "Visit recorded."}${next}`,
    });
    setNote("");
    await load();
    onChanged();
  }

  async function saveNextDate(date: string | null) {
    setNextBusy(true);
    setNextMessage(null);
    const res = await postJson("/api/ops/client/next-date", { signupId: id, date });
    setNextBusy(false);
    if (res.status === 401) return onUnauthorized();
    if (!res.ok) {
      setNextMessage((await res.json().catch(() => ({}))).error ?? "Couldn't save that date.");
      return;
    }
    setNextMessage(date ? "Saved." : "Cleared.");
    await load();
    onChanged();
  }

  if (loadError) {
    return (
      <div>
        <button onClick={onBack} className="text-sm font-semibold text-brand-700 underline">
          Back to clients
        </button>
        <p className="mt-4 text-sm text-brand-500">Couldn't load that client.</p>
      </div>
    );
  }
  if (!client) return <p className="mt-4 text-center text-sm text-brand-500">Loading...</p>;

  const onceOff = client.plan === "once-off";
  const nextSource = onceOff
    ? "Once-off booking - it follows its booked date and doesn't repeat"
    : client.nextServiceDateManual
      ? "Set by you - this decides which day's list they appear on"
      : client.nextServiceDate
        ? "Suggested from the last visit - this decides which day's list they appear on"
        : "Not set - they follow their old fixed day until a visit is recorded";

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onBack} className="self-start text-sm font-semibold text-brand-700 underline">
        Back to clients
      </button>

      <div>
        <h2 className="text-xl font-bold text-brand-900">{client.fullName}</h2>
        <p className="text-sm text-brand-700">
          House {client.houseNumber} · {blockLabel(client.block)} · {planLabel(client.plan)}
          {client.paused ? " · Paused" : ""}
        </p>
      </div>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
        <h3 className="text-sm font-semibold text-brand-900">Next service date</h3>
        <p className="mt-1 text-lg font-bold text-brand-900">
          {client.nextServiceDate ? formatDate(client.nextServiceDate) : "Not set"}
        </p>
        <p className="text-xs text-brand-500">{nextSource}</p>
        {!onceOff && (
        <div className="mt-3 flex gap-2">
          <input
            type="date"
            value={nextDate}
            onChange={(e) => setNextDate(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-brand-200 px-2 py-2 text-sm text-brand-900"
          />
          <button
            onClick={() => saveNextDate(nextDate)}
            disabled={nextBusy || !nextDate || nextDate === (client.nextServiceDate ?? "")}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            Change
          </button>
          {client.nextServiceDate && (
            <button
              onClick={() => saveNextDate(null)}
              disabled={nextBusy}
              className="rounded-lg border-2 border-brand-300 px-3 py-2 text-sm font-semibold text-brand-700 disabled:opacity-60"
            >
              Clear (back to old fixed day)
            </button>
          )}
        </div>
        )}
        {nextMessage && <p className="mt-2 text-sm text-brand-700">{nextMessage}</p>}
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
        <h3 className="text-sm font-semibold text-brand-900">Record a visit</h3>
        <form onSubmit={saveVisit} className="mt-3 flex flex-col gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-brand-700">Date the work was done</span>
            <input
              type="date"
              value={visitDate}
              max={todayKey()}
              onChange={(e) => setVisitDate(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-brand-200 px-3 py-2 text-sm text-brand-900"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-brand-700">Who did the job</span>
            <select
              value={workerId}
              onChange={(e) => setWorkerId(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm text-brand-900"
            >
              <option value="">{workers.length === 0 ? "Add a worker first" : "Choose a worker"}</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-brand-700">Note (optional)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder="e.g. extra weeds along the back wall"
              className="mt-1 w-full rounded-lg border border-brand-200 px-3 py-2 text-sm text-brand-900 outline-none focus:border-brand-500"
            />
          </label>
          <button
            type="submit"
            disabled={saving || !visitDate || !workerId}
            className="rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Saving..." : "Record visit"}
          </button>
          {visitMessage && (
            <p className={`text-sm ${visitMessage.kind === "ok" ? "text-brand-700" : "text-red-600"}`}>
              {visitMessage.text}
            </p>
          )}
        </form>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
        <h3 className="text-sm font-semibold text-brand-900">Visit history</h3>
        {visits.length === 0 ? (
          <p className="mt-2 text-sm text-brand-500">No visits recorded yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {visits.map((v) => (
              <li key={v.serviceDate} className="border-t border-brand-50 pt-2 first:border-0 first:pt-0">
                <p className="text-sm font-medium text-brand-900">{formatDate(v.serviceDate)}</p>
                <p className="text-xs text-brand-600">{v.worker ? `By ${v.worker}` : "Worker not recorded"}</p>
                {v.note && <p className="text-xs text-brand-500">{v.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
