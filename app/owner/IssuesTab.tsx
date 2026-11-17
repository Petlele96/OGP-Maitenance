"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ISSUE_GROUPS,
  ISSUE_STATUSES,
  ISSUE_STATUS_LABELS,
  buildUrgentIssueMessage,
  findIssueType,
  formatIssueDate,
  isIssueOverdue,
  OTHER_ISSUE_TYPE,
  issueDaysOpen,
  issueDescription,
  issueGroupLabel,
  issueNeedsWording,
  issuePhaseLabel,
  johannesburgDateKey,
  monthLabel,
  type IssueStatus,
} from "@/lib/issues";
import { PHASES } from "@/lib/sort";
import { CountCard } from "./BookingQueues";

interface Issue {
  id: string;
  category: string;
  issueType: string;
  note: string | null;
  urgent: boolean;
  signupId: string | null;
  customerName: string | null;
  locationLabel: string;
  phase: number | null;
  loggedBy: string;
  loggedAt: string;
  status: IssueStatus;
  reportedAt: string | null;
  resolvedAt: string | null;
  reportDescription: string | null;
  aiDescription: string | null;
  aiStatus: "done" | "failed" | null;
  aiFlag: boolean;
  aiFlagReason: string | null;
  aiFlagDismissed: boolean;
}

type StatusFilter = "unresolved" | "all" | IssueStatus;

interface Filters {
  urgentOnly: boolean;
  category: string;
  phase: string;
  status: StatusFilter;
}
const DEFAULT_FILTERS: Filters = { urgentOnly: false, category: "", phase: "", status: "unresolved" };

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

function postJson(url: string, body: unknown) {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

/** The last 12 months, newest first, for the report picker. */
function recentMonths(): string[] {
  const [y, m] = johannesburgDateKey(new Date()).split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/**
 * Maintenance issues the crew logged: urgent and open at the top with a count, everything open below newest first,
 * filters, days open on every row, anything open more than 30 days highlighted, and the monthly PDF.
 * Nothing here sends anything - messages are only copied, the PDF is only downloaded.
 */
export default function IssuesTab({ onChanged, onUnauthorized }: { onChanged: () => void; onUnauthorized: () => void }) {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [assistConfigured, setAssistConfigured] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

  const months = useMemo(recentMonths, []);
  const [month, setMonth] = useState(months[0]);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  // Issues in the chosen month that would go into the report without AI or edited wording (found before downloading).
  const [wordingCheck, setWordingCheck] = useState<{ month: string; ids: string[] } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/owner/issues", { cache: "no-store" });
    if (res.status === 401) return onUnauthorized();
    if (!res.ok) return setLoadError(true);
    const json = await res.json();
    setIssues(json.issues);
    setAssistConfigured(json.assistConfigured);
    setLoadError(false);
  }, [onUnauthorized]);

  useEffect(() => {
    load();
  }, [load]);

  function changed() {
    load();
    onChanged(); // refreshes the dashboard's count
  }

  /** Checks the month first: if any issue has no AI or edited wording, stop and list them instead of downloading. */
  async function startReport() {
    setReportBusy(true);
    setReportError(null);
    setWordingCheck(null);
    try {
      const res = await fetch(`/api/owner/issues/report?month=${month}&check=1`, { cache: "no-store" });
      if (res.status === 401) return onUnauthorized();
      if (!res.ok) throw new Error();
      const json: { missingIds: string[] } = await res.json();
      if (json.missingIds.length > 0) {
        setWordingCheck({ month, ids: json.missingIds });
        setReportBusy(false);
        return;
      }
    } catch {
      setReportError("Could not check the report. Try again in a moment.");
      setReportBusy(false);
      return;
    }
    await downloadReport();
  }

  async function downloadReport() {
    setReportBusy(true);
    setReportError(null);
    try {
      const res = await fetch(`/api/owner/issues/report?month=${month}`);
      if (res.status === 401) return onUnauthorized();
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `OGP-maintenance-report-${month}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setWordingCheck(null);
    } catch {
      setReportError("Could not make the report. Try again in a moment.");
    }
    setReportBusy(false);
  }

  const all = issues ?? [];
  // Rows from the check that still have no wording (this shrinks as the owner fixes them below).
  const stillMissing = wordingCheck && wordingCheck.month === month
    ? all.filter((i) => wordingCheck.ids.includes(i.id) && issueNeedsWording(i))
    : [];
  const urgentOpen = all.filter((i) => i.urgent && i.status !== "resolved");
  const flagged = all.filter((i) => i.aiFlag && !i.aiFlagDismissed && !i.urgent && i.status !== "resolved");

  // Heads-up when "Other" is a fifth or more of the last 30 days (with at least 5 issues): the list is probably missing a category.
  const recent = all.filter((i) => issueDaysOpen(i.loggedAt, new Date().toISOString()) <= 30);
  const recentOther = recent.filter((i) => i.issueType === OTHER_ISSUE_TYPE).length;
  const otherNotice = recent.length >= 5 && recentOther / recent.length >= 0.2 ? { other: recentOther, total: recent.length } : null;

  const isDefault =
    !filters.urgentOnly && !filters.category && !filters.phase && filters.status === "unresolved";
  const filtered = all.filter((i) => {
    if (filters.urgentOnly && !i.urgent) return false;
    if (filters.category && i.category !== filters.category) return false;
    if (filters.phase && String(i.phase) !== filters.phase) return false;
    if (filters.status === "unresolved" && i.status === "resolved") return false;
    if (filters.status !== "unresolved" && filters.status !== "all" && i.status !== filters.status) return false;
    return true;
  });
  // With no filters the urgent and flagged ones are already shown in full above, so they are not repeated underneath.
  const shownAbove = new Set([...urgentOpen, ...flagged].map((i) => i.id));
  const listed = isDefault ? filtered.filter((i) => !shownAbove.has(i.id)) : filtered;

  const select = "rounded-lg border border-brand-200 bg-white px-2 py-2 text-xs text-brand-900";

  if (loadError) return <p className="text-sm text-red-700">Could not load issues. Refresh and try again.</p>;
  if (!issues) return <p className="mt-8 text-center text-sm text-brand-500">Loading...</p>;

  return (
    <div className="flex flex-col gap-4">
      <CountCard
        count={urgentOpen.length}
        title="Urgent and open"
        waiting="Issues marked urgent that are not resolved yet. Nothing is sent automatically - you decide what goes out."
        clear="No urgent issues are open."
      />
      {urgentOpen.length > 0 && (
        <ul className="flex flex-col gap-3">
          {urgentOpen.map((i) => (
            <IssueRow key={i.id} issue={i} assistConfigured={assistConfigured} onChanged={changed} onUnauthorized={onUnauthorized} />
          ))}
        </ul>
      )}

      {flagged.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-amber-800">Flagged for your review ({flagged.length})</h2>
          <p className="-mt-2 text-xs text-brand-600">
            Marked &quot;can wait&quot;, but the AI thinks they may be more serious. It has not changed anything - you decide.
          </p>
          <ul className="flex flex-col gap-3">
            {flagged.map((i) => (
              <IssueRow key={i.id} issue={i} assistConfigured={assistConfigured} onChanged={changed} onUnauthorized={onUnauthorized} />
            ))}
          </ul>
        </section>
      )}

      {otherNotice && (
        <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-300">
          <span className="font-semibold">&quot;Other&quot; is being used a lot:</span> {otherNotice.other} of the last {otherNotice.total} issues (last 30 days). The category list may be missing something real. Filter by the Other category to see what the notes say.
        </p>
      )}

      <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
        <h2 className="text-sm font-semibold text-brand-900">Monthly report (PDF)</h2>
        <div className="flex items-center gap-2">
          <select
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setWordingCheck(null);
            }} className={`${select} min-w-0 flex-1`} aria-label="Report month"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          <button
            onClick={startReport}
            disabled={reportBusy}
            className="shrink-0 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            {reportBusy ? "Making..." : "Download report"}
          </button>
        </div>
        {reportError && <p className="text-xs text-red-700">{reportError}</p>}
        {wordingCheck && wordingCheck.month === month && (
          <div className="flex flex-col gap-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-300">
            {stillMissing.length > 0 ? (
              <>
                <p className="text-xs font-semibold text-amber-900">
                  {stillMissing.length} {stillMissing.length === 1 ? "issue has" : "issues have"} no AI wording and no wording you wrote. The report has not been downloaded.
                </p>
                <p className="text-xs text-amber-900">
                  If you download as it is, these print the worker&apos;s note (for Other) or just the issue type. Use &quot;Edit report wording&quot; on each one below, then download.
                </p>
                <ul className="flex flex-col gap-3">
                  {stillMissing.map((i) => (
                    <IssueRow key={i.id} issue={i} assistConfigured={assistConfigured} onChanged={changed} onUnauthorized={onUnauthorized} />
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-xs font-semibold text-amber-900">Every issue in this month now has wording.</p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={downloadReport}
                disabled={reportBusy}
                className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                {stillMissing.length > 0 ? "Download anyway" : "Download report"}
              </button>
              <button onClick={() => setWordingCheck(null)} className="text-xs font-semibold text-brand-500 underline">
                Cancel
              </button>
            </div>
          </div>
        )}
        <p className="text-xs text-brand-500">Issues logged in the month, grouped by category. It downloads to your phone - nothing is sent.</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-brand-900">
          {isDefault ? `Other open issues (${listed.length})` : `Matching issues (${listed.length})`}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-2 py-2 text-xs text-brand-900">
            <input
              type="checkbox"
              checked={filters.urgentOnly}
              onChange={(e) => setFilters((f) => ({ ...f, urgentOnly: e.target.checked }))}
            />
            Urgent
          </label>
          <select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))} className={select} aria-label="Category">
            <option value="">All categories</option>
            {ISSUE_GROUPS.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
          <select value={filters.phase} onChange={(e) => setFilters((f) => ({ ...f, phase: e.target.value }))} className={select} aria-label="Phase">
            <option value="">All phases</option>
            {PHASES.map((p) => (
              <option key={p} value={p}>
                Phase {p}
              </option>
            ))}
          </select>
          <select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as StatusFilter }))}
            className={select}
            aria-label="Status"
          >
            <option value="unresolved">Not resolved</option>
            {ISSUE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ISSUE_STATUS_LABELS[s]}
              </option>
            ))}
            <option value="all">All statuses</option>
          </select>
          {!isDefault && (
            <button onClick={() => setFilters(DEFAULT_FILTERS)} className="text-xs font-semibold text-brand-500 underline">
              Clear
            </button>
          )}
        </div>

        {listed.length === 0 ? (
          <p className="rounded-2xl bg-white p-4 text-center text-sm text-brand-500 shadow-sm ring-1 ring-brand-100">
            {all.length === 0 ? "No issues have been logged yet." : "Nothing here."}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {listed.map((i) => (
              <IssueRow key={i.id} issue={i} assistConfigured={assistConfigured} onChanged={changed} onUnauthorized={onUnauthorized} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function IssueRow({
  issue: i,
  assistConfigured,
  onChanged,
  onUnauthorized,
}: {
  issue: Issue;
  assistConfigured: boolean;
  onChanged: () => void;
  onUnauthorized: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const def = findIssueType(i.issueType);
  const typeLabel = def?.type.label ?? i.issueType;
  const days = issueDaysOpen(i.loggedAt, i.resolvedAt);
  const overdue = isIssueOverdue(i.status, days);
  const description = issueDescription({ reportDescription: i.reportDescription, aiDescription: i.aiDescription, typeLabel });
  const descriptionIsAi = !i.reportDescription?.trim() && Boolean(i.aiDescription?.trim());
  const showFlag = i.aiFlag && !i.aiFlagDismissed && !i.urgent && i.status !== "resolved";

  async function act(url: string, body: unknown) {
    setBusy(true);
    setError(null);
    const res = await postJson(url, body);
    setBusy(false);
    if (res.status === 401) return onUnauthorized();
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "That did not save. Try again.");
      return false;
    }
    onChanged();
    return true;
  }

  async function copyMessage() {
    const ok = await copyText(
      buildUrgentIssueMessage({
        groupLabel: issueGroupLabel(i.category),
        typeLabel,
        locationLabel: i.locationLabel,
        phase: i.phase,
        description: i.reportDescription?.trim() || i.aiDescription?.trim() || i.note?.trim() || typeLabel,
        loggedAt: i.loggedAt,
      })
    );
    setCopied(ok);
    if (!ok) setError("Could not copy. Select and copy the details by hand.");
    setTimeout(() => setCopied(false), 2500);
  }

  async function retryAssist() {
    setBusy(true);
    setError(null);
    const res = await postJson("/api/owner/issues/assist", { id: i.id });
    setBusy(false);
    if (res.status === 401) return onUnauthorized();
    const json = await res.json().catch(() => ({}));
    if (json.result === "not_configured") setError("AI assist is not set up on the server yet.");
    else if (json.result !== "done") setError("The AI suggestion did not come through. Try again later.");
    onChanged();
  }

  const statusDates = [
    `Logged ${formatIssueDate(i.loggedAt)}`,
    i.reportedAt ? `Reported to client ${formatIssueDate(i.reportedAt)}` : null,
    i.resolvedAt ? `Resolved ${formatIssueDate(i.resolvedAt)}` : null,
  ].filter(Boolean);

  return (
    <li
      className={`rounded-2xl p-3 shadow-sm ${
        overdue ? "bg-red-50 ring-2 ring-red-400" : i.urgent && i.status !== "resolved" ? "bg-white ring-2 ring-red-200" : "bg-white ring-1 ring-brand-100"
      }`}
    >
      <div className="flex gap-3">
        <a href={`/api/owner/issues/photo?id=${i.id}&size=full`} target="_blank" rel="noopener noreferrer" className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/owner/issues/photo?id=${i.id}&size=thumb`}
            alt={typeLabel}
            loading="lazy"
            className="h-24 w-24 rounded-xl bg-brand-50 object-cover"
          />
        </a>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-500">
                {issueGroupLabel(i.category)} · {typeLabel}
              </p>
              {i.urgent && (
                <span className="mt-1 inline-block rounded-md bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Urgent</span>
              )}
            </div>
            <div
              className={`shrink-0 rounded-xl px-2.5 py-1.5 text-center ${
                i.status === "resolved" ? "bg-brand-50 text-brand-700" : overdue ? "bg-red-600 text-white" : "bg-brand-100 text-brand-900"
              }`}
            >
              <p className="text-2xl font-black leading-none">{days}</p>
              <p className="mt-0.5 text-[9px] font-bold uppercase leading-none">{i.status === "resolved" ? "days to fix" : days === 1 ? "day open" : "days open"}</p>
            </div>
          </div>
          <p className="mt-1.5 text-sm font-semibold text-brand-900">{description}</p>
          <p className="mt-0.5 text-xs text-brand-700">
            {i.locationLabel} · {issuePhaseLabel(i.phase)}
            {i.customerName ? ` · ${i.customerName}` : ""}
          </p>
        </div>
      </div>

      {overdue && <p className="mt-2 text-xs font-bold text-red-700">Open for more than 30 days</p>}

      <p className="mt-2 text-xs text-brand-600">
        {statusDates.join(" · ")} · by {i.loggedBy}
      </p>
      {i.note && <p className="mt-1 text-xs italic text-brand-500">Note: {i.note}</p>}

      {showFlag && (
        <div className="mt-2 rounded-xl bg-amber-50 p-2.5 ring-1 ring-amber-300">
          <p className="text-xs font-semibold text-amber-900">AI review: this may be more serious than marked</p>
          {i.aiFlagReason && <p className="mt-0.5 text-xs text-amber-900">{i.aiFlagReason}</p>}
          <div className="mt-2 flex gap-2">
            <button
              disabled={busy}
              onClick={() => act("/api/owner/issues/update", { action: "urgent", id: i.id, urgent: true })}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              Mark urgent
            </button>
            <button
              disabled={busy}
              onClick={() => act("/api/owner/issues/update", { action: "dismiss_flag", id: i.id })}
              className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-300 disabled:opacity-60"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-brand-50 p-1">
        {ISSUE_STATUSES.map((s) => (
          <button
            key={s}
            disabled={busy || i.status === s}
            onClick={() => act("/api/owner/issues/update", { action: "status", id: i.id, status: s })}
            className={`rounded-lg px-1 py-2 text-[11px] font-semibold ${
              i.status === s ? "bg-brand-600 text-white" : "bg-white text-brand-700 disabled:opacity-60"
            }`}
          >
            {ISSUE_STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {i.urgent && i.status !== "resolved" && (
          <button onClick={copyMessage} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white">
            {copied ? "Copied" : "Copy message"}
          </button>
        )}
        <button
          disabled={busy}
          onClick={() => act("/api/owner/issues/update", { action: "urgent", id: i.id, urgent: !i.urgent })}
          className="text-xs font-semibold text-brand-500 underline"
        >
          {i.urgent ? "Mark not urgent" : "Mark urgent"}
        </button>
        <button
          onClick={() => {
            setDraft(
              i.reportDescription?.trim() ||
                i.aiDescription?.trim() ||
                (i.issueType === OTHER_ISSUE_TYPE ? (i.note?.trim() ?? "").slice(0, 200) : "")
            );
            setEditing((e) => !e);
          }}
          className="text-xs font-semibold text-brand-500 underline"
        >
          Edit report wording
        </button>
        {i.aiStatus !== "done" &&
          (assistConfigured ? (
            <button disabled={busy} onClick={retryAssist} className="text-xs font-semibold text-brand-500 underline">
              {i.aiStatus === "failed" ? "AI suggestion failed - retry" : "Get AI suggestion"}
            </button>
          ) : (
            <span className="text-xs text-brand-400">AI assist is not set up</span>
          ))}
      </div>

      {editing && (
        <div className="mt-2 flex flex-col gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={200}
            placeholder="One line for the report. Leave empty to use the AI's line (or the worker's note for Other, else the issue type)."
            className="w-full rounded-lg border border-brand-200 px-3 py-2 text-sm text-brand-900"
          />
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={async () => {
                if (await act("/api/owner/issues/update", { action: "description", id: i.id, description: draft })) setEditing(false);
              }}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              Save
            </button>
            <button onClick={() => setEditing(false)} className="text-xs font-semibold text-brand-500 underline">
              Cancel
            </button>
          </div>
        </div>
      )}
      {descriptionIsAi && !editing && <p className="mt-1 text-[10px] text-brand-400">Description written by AI. Edit it before you rely on it.</p>}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </li>
  );
}
