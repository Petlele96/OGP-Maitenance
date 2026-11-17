"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ISSUE_GROUPS, ISSUE_NOTE_MAX, OTHER_ISSUE_TYPE } from "@/lib/issues";
import { PHASES } from "@/lib/sort";

interface Worker {
  id: string;
  name: string;
}
interface Customer {
  id: string;
  fullName: string;
  houseNumber: string;
  phase: number | null;
}

const LAST_WORKER_KEY = "ops_last_worker"; // shared with the visit form: the same people, the same "who are you" picker

/** Shrinks a phone photo to a JPEG before it is sent: the full picture for the owner, a small copy for the PDF. */
async function toJpeg(file: File, maxSide: number, quality: number): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode"));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", quality)
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * "Log an issue": a full-screen form opened from the ops header, available from any tab. Built to be filled in
 * standing in a yard - photo first, big tap targets, nothing to type except an optional note. Saving never waits
 * for the AI step, and nothing is sent to anyone.
 */
export default function IssueForm({ onClose, onUnauthorized }: { onClose: () => void; onUnauthorized: () => void }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [optionsError, setOptionsError] = useState(false);

  const [photo, setPhoto] = useState<{ full: Blob; thumb: Blob; previewUrl: string } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [issueType, setIssueType] = useState("");
  const [urgent, setUrgent] = useState<boolean | null>(null);
  const [where, setWhere] = useState<"customer" | "other">("customer");
  const [query, setQuery] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [locationText, setLocationText] = useState("");
  const [phase, setPhase] = useState("");
  const [note, setNote] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [newWorker, setNewWorker] = useState("");
  const [addingWorker, setAddingWorker] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ urgent: boolean } | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/ops/issues/options", { cache: "no-store" });
      if (res.status === 401) return onUnauthorized();
      if (!res.ok) return setOptionsError(true);
      const json = await res.json();
      setCustomers(json.customers);
      setWorkers(json.workers);
      try {
        const last = localStorage.getItem(LAST_WORKER_KEY);
        if (last && json.workers.some((w: Worker) => w.id === last)) setWorkerId(last);
      } catch {
        /* storage unavailable - the picker just starts empty */
      }
    })();
  }, [onUnauthorized]);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.previewUrl); }, [photo]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || customer) return [];
    return customers.filter((c) => c.fullName.toLowerCase().includes(q) || c.houseNumber.toLowerCase().includes(q)).slice(0, 6);
  }, [query, customers, customer]);

  async function onPhotoPicked(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const [full, thumb] = await Promise.all([toJpeg(file, 1600, 0.8), toJpeg(file, 420, 0.65)]);
      setPhoto({ full, thumb, previewUrl: URL.createObjectURL(thumb) });
    } catch {
      setPhotoError("That picture could not be read. Try taking it again.");
    }
    setPhotoBusy(false);
  }

  async function addWorkerName() {
    const name = newWorker.trim();
    if (name.length < 2) return;
    const res = await fetch("/api/ops/workers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.status === 401) return onUnauthorized();
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setError(json.error ?? "Could not add that name.");
    setWorkers((w) => [...w, json.worker].sort((a, b) => a.name.localeCompare(b.name)));
    setWorkerId(json.worker.id);
    setNewWorker("");
    setAddingWorker(false);
  }

  function validate(): string | null {
    if (!photo) return "Add a photo of the issue.";
    if (!issueType) return "Choose what the issue is.";
    if (urgent === null) return "Say whether you would want someone to come today.";
    if (issueType === OTHER_ISSUE_TYPE && !note.trim()) return "You chose Other, so say what the issue is in the note.";
    if (where === "customer") {
      if (!customer) return "Choose the customer, or switch to somewhere else.";
      if (customer.phase === null && !phase) return "Choose a phase.";
    } else {
      if (!locationText.trim()) return "Say which street or landmark it is at.";
      if (!phase) return "Choose a phase.";
    }
    if (!workerId) return "Choose who is logging this.";
    return null;
  }

  async function save() {
    const problem = validate();
    if (problem) return setError(problem);
    setError(null);
    setSaving(true);

    const body = new FormData();
    body.set("photo", new File([photo!.full], "issue.jpg", { type: "image/jpeg" }));
    body.set("thumb", new File([photo!.thumb], "thumb.jpg", { type: "image/jpeg" }));
    body.set("issueType", issueType);
    body.set("urgent", urgent ? "yes" : "no");
    body.set("workerId", workerId);
    if (note.trim()) body.set("note", note.trim());
    if (where === "customer" && customer) {
      body.set("signupId", customer.id);
      if (customer.phase === null && phase) body.set("phase", phase);
    } else {
      body.set("locationText", locationText.trim());
      body.set("phase", phase);
    }

    let res: Response;
    try {
      res = await fetch("/api/ops/issues", { method: "POST", body });
    } catch {
      setSaving(false);
      return setError("No connection. Check your signal and try again - nothing was lost, the form is still filled in.");
    }
    setSaving(false);
    if (res.status === 401) return onUnauthorized();
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setError(json.error ?? "Could not save that issue.");

    try {
      localStorage.setItem(LAST_WORKER_KEY, workerId);
    } catch {
      /* ignore */
    }
    // The AI step runs after the save and is never waited for. If it fails, the owner has a Retry button.
    fetch("/api/ops/issues/assist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: json.id }),
      keepalive: true,
    }).catch(() => {});
    setSaved({ urgent: urgent === true });
  }

  function logAnother() {
    setPhoto(null);
    setIssueType("");
    setUrgent(null);
    setQuery("");
    setCustomer(null);
    setLocationText("");
    setPhase("");
    setNote("");
    setError(null);
    setSaved(null);
  }

  if (saved) {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-brand-50">
        <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
          <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-brand-100">
            <p className="text-3xl">✓</p>
            <h2 className="mt-1 text-lg font-bold text-brand-900">Issue logged</h2>
            <p className="mt-1 text-sm text-brand-700">
              {saved.urgent
                ? "Marked urgent. It is at the top of the owner's Issues list. Nothing is sent automatically, so let the owner know."
                : "It is on the owner's Issues list. Nothing has been sent to anyone."}
            </p>
          </div>
          <button onClick={logAnother} className="rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white">
            Log another issue
          </button>
          <button onClick={onClose} className="rounded-xl bg-white px-4 py-3 text-base font-semibold text-brand-700 ring-1 ring-brand-200">
            Done
          </button>
        </div>
      </div>
    );
  }

  const choice = (active: boolean, tone: "red" | "green" = "green") =>
    `flex-1 rounded-xl px-3 py-3 text-sm font-semibold ring-1 ${
      active
        ? tone === "red"
          ? "bg-red-600 text-white ring-red-600"
          : "bg-brand-600 text-white ring-brand-600"
        : "bg-white text-brand-800 ring-brand-200"
    }`;
  const label = "text-xs font-semibold uppercase tracking-wide text-brand-700";
  const field =
    "w-full rounded-xl border border-brand-200 bg-white px-3 py-3 text-base text-brand-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-brand-50">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-4 pb-8 pt-5">
        <header className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-brand-900">Log an issue</h1>
          <button onClick={onClose} className="text-sm font-medium text-brand-500 underline">
            Cancel
          </button>
        </header>

        {optionsError && (
          <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">Could not load the customer and worker lists. Close this and try again.</p>
        )}

        {/* 1. Photo */}
        <section className="flex flex-col gap-2">
          <p className={label}>Photo (required)</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              onPhotoPicked(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {photo ? (
            <div className="flex items-center gap-3 rounded-xl bg-white p-2 ring-1 ring-brand-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.previewUrl} alt="The issue" className="h-20 w-28 rounded-lg object-cover" />
              <button onClick={() => fileRef.current?.click()} className="text-sm font-semibold text-brand-600 underline">
                Retake photo
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={photoBusy}
              className="rounded-xl border-2 border-dashed border-brand-400 bg-white px-4 py-8 text-base font-semibold text-brand-700 disabled:opacity-60"
            >
              {photoBusy ? "Preparing photo..." : "Take or choose a photo"}
            </button>
          )}
          {photoError && <p className="text-sm text-red-600">{photoError}</p>}
        </section>

        {/* 2. What */}
        <section className="flex flex-col gap-2">
          <p className={label}>What is the issue?</p>
          <select value={issueType} onChange={(e) => setIssueType(e.target.value)} className={field}>
            <option value="" disabled>
              Choose a category
            </option>
            {ISSUE_GROUPS.map((g) => (
              <optgroup key={g.key} label={g.label}>
                {g.types.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </section>

        {/* 3. Urgent */}
        <section className="flex flex-col gap-2">
          <p className={label}>Would you want someone to come today?</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setUrgent(true)} className={choice(urgent === true, "red")}>
              Yes - urgent
            </button>
            <button type="button" onClick={() => setUrgent(false)} className={choice(urgent === false)}>
              No - can wait
            </button>
          </div>
        </section>

        {/* 4. Where */}
        <section className="flex flex-col gap-2">
          <p className={label}>Where is it?</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setWhere("customer")} className={choice(where === "customer")}>
              A customer&apos;s house
            </button>
            <button type="button" onClick={() => setWhere("other")} className={choice(where === "other")}>
              Somewhere else
            </button>
          </div>

          {where === "customer" ? (
            customer ? (
              <div className="flex items-center justify-between rounded-xl bg-white p-3 ring-1 ring-brand-100">
                <div>
                  <p className="text-sm font-semibold text-brand-900">
                    House {customer.houseNumber} · {customer.fullName}
                  </p>
                  <p className="text-xs text-brand-600">{customer.phase !== null ? `Phase ${customer.phase}` : "No phase on file"}</p>
                </div>
                <button
                  onClick={() => {
                    setCustomer(null);
                    setQuery("");
                    setPhase("");
                  }}
                  className="text-xs font-semibold text-brand-500 underline"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Type a house number or name"
                  className={field}
                  autoComplete="off"
                />
                {matches.length > 0 && (
                  <ul className="overflow-hidden rounded-xl bg-white ring-1 ring-brand-100">
                    {matches.map((c) => (
                      <li key={c.id} className="border-t border-brand-50 first:border-0">
                        <button
                          onClick={() => {
                            setCustomer(c);
                            setPhase("");
                          }}
                          className="w-full px-3 py-3 text-left"
                        >
                          <span className="text-sm font-semibold text-brand-900">
                            House {c.houseNumber} · {c.fullName}
                          </span>
                          <span className="ml-2 text-xs text-brand-600">{c.phase !== null ? `Phase ${c.phase}` : ""}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {query.trim() && matches.length === 0 && (
                  <p className="text-xs text-brand-600">No customer matches. Use &quot;Somewhere else&quot; if it is not at a subscriber&apos;s house.</p>
                )}
              </>
            )
          ) : (
            <input
              value={locationText}
              onChange={(e) => setLocationText(e.target.value)}
              maxLength={120}
              placeholder="Street or landmark, e.g. corner of Birch and Oak"
              className={field}
            />
          )}

          {(where === "other" || (customer && customer.phase === null)) && (
            <select value={phase} onChange={(e) => setPhase(e.target.value)} className={field}>
              <option value="" disabled>
                Select the phase
              </option>
              {PHASES.map((p) => (
                <option key={p} value={p}>
                  Phase {p}
                </option>
              ))}
            </select>
          )}
        </section>

        {/* 5. Note */}
        <section className="flex flex-col gap-2">
          <p className={label}>{issueType === OTHER_ISSUE_TYPE ? "Note - say what the issue is (required)" : "Short note (optional)"}</p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={ISSUE_NOTE_MAX}
            rows={2}
            placeholder={issueType === OTHER_ISSUE_TYPE ? "What is the issue?" : "Anything that helps, e.g. water running since morning"}
            className={field}
          />
        </section>

        {/* 6. Who */}
        <section className="flex flex-col gap-2">
          <p className={label}>Logged by</p>
          {workers.length > 0 && !addingWorker ? (
            <>
              <select value={workerId} onChange={(e) => setWorkerId(e.target.value)} className={field}>
                <option value="" disabled>
                  Choose your name
                </option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <button onClick={() => setAddingWorker(true)} className="self-start text-xs font-semibold text-brand-500 underline">
                My name is not here
              </button>
            </>
          ) : (
            <div className="flex gap-2">
              <input value={newWorker} onChange={(e) => setNewWorker(e.target.value)} placeholder="Your name" className={field} />
              <button onClick={addWorkerName} className="shrink-0 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white">
                Add
              </button>
            </div>
          )}
          <p className="text-xs text-brand-500">The date and time are saved automatically.</p>
        </section>

        {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700">{error}</p>}

        <button
          onClick={save}
          disabled={saving || photoBusy}
          className="sticky bottom-3 rounded-xl bg-brand-600 px-4 py-4 text-base font-bold text-white shadow-lg disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save issue"}
        </button>
      </div>
    </div>
  );
}
