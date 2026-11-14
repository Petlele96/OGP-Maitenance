"use client";

import { useCallback, useEffect, useState } from "react";
import CalendarGrid from "./CalendarGrid";

interface AppSettings {
  dailyVisitLimit: number;
  workingDays: number[];
  paydayDay: number;
}

interface BlockedDate {
  date: string;
  label: string | null;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function formatDayHeading(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export default function ScheduleTab() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [blockedDates, setBlockedDates] = useState<BlockedDate[] | null>(null);
  const [limitInput, setLimitInput] = useState("7");
  const [workingDaysInput, setWorkingDaysInput] = useState<number[]>([1, 2, 3, 4, 5]);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [paydayInput, setPaydayInput] = useState("25");
  const [paydaySaving, setPaydaySaving] = useState(false);
  const [paydaySaved, setPaydaySaved] = useState(false);
  const [paydayError, setPaydayError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const [blockDateValue, setBlockDateValue] = useState("");
  const [blockLabel, setBlockLabel] = useState("");
  const [blockSubmitting, setBlockSubmitting] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    const res = await fetch("/api/owner/settings", { cache: "no-store" });
    if (!res.ok) return;
    const json = await res.json();
    setSettings(json.settings);
    setBlockedDates(json.blockedDates);
    setLimitInput(String(json.settings.dailyVisitLimit));
    setWorkingDaysInput(json.settings.workingDays);
    setPaydayInput(String(json.settings.paydayDay));
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  function toggleWorkingDay(day: number) {
    setWorkingDaysInput((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }

  async function handleSaveSettings() {
    setSettingsSaving(true);
    setSettingsSaved(false);
    await fetch("/api/owner/settings/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dailyVisitLimit: Number(limitInput), workingDays: workingDaysInput }),
    });
    setSettingsSaving(false);
    setSettingsSaved(true);
    setRefreshToken((n) => n + 1);
  }

  async function handleSavePayday() {
    const day = Number(paydayInput);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      setPaydayError("Enter a day between 1 and 31.");
      return;
    }
    setPaydaySaving(true);
    setPaydaySaved(false);
    setPaydayError(null);
    const res = await fetch("/api/owner/settings/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paydayDay: day }),
    });
    setPaydaySaving(false);
    if (!res.ok) {
      setPaydayError("Couldn't save that. Please try again.");
      return;
    }
    setPaydaySaved(true);
  }

  async function handleBlockDate() {
    if (!blockDateValue) return;
    setBlockSubmitting(true);
    setBlockError(null);
    const res = await fetch("/api/owner/settings/block-date", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: blockDateValue, label: blockLabel.trim() === "" ? null : blockLabel.trim() }),
    });
    setBlockSubmitting(false);
    if (!res.ok) {
      setBlockError("Couldn't block that date.");
      return;
    }
    setBlockDateValue("");
    setBlockLabel("");
    await loadSettings();
    setRefreshToken((n) => n + 1);
  }

  async function handleUnblock(date: string) {
    await fetch("/api/owner/settings/unblock-date", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date }),
    });
    await loadSettings();
    setRefreshToken((n) => n + 1);
  }

  return (
    <div className="flex flex-col gap-4">
      <CalendarGrid refreshToken={refreshToken} dailyLimit={settings?.dailyVisitLimit ?? 7} />

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
        <h2 className="text-sm font-semibold text-brand-900">Working days &amp; workload limit</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {WEEKDAY_LABELS.map((label, day) => (
            <button
              key={day}
              onClick={() => toggleWorkingDay(day)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                workingDaysInput.includes(day) ? "bg-brand-600 text-white" : "border-2 border-brand-200 text-brand-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="mt-3 block text-xs text-brand-500">
          Daily visit limit (warns above this)
          <input
            type="number"
            min={1}
            value={limitInput}
            onChange={(e) => setLimitInput(e.target.value)}
            className="mt-1 w-24 rounded-lg border border-brand-200 px-3 py-2 text-sm text-brand-900"
          />
        </label>
        <button
          onClick={handleSaveSettings}
          disabled={settingsSaving || !settings}
          className="mt-3 w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {settingsSaving ? "Saving..." : settingsSaved ? "Saved" : "Save"}
        </button>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
        <h2 className="text-sm font-semibold text-brand-900">Payday date</h2>
        <p className="mt-1 text-xs text-brand-500">
          The day of the month your customers are paid. Every month-end payment due date follows it, so change it here
          once if it turns out to be wrong.
        </p>
        <label className="mt-3 block text-xs text-brand-500">
          Day of the month (1-31)
          <input
            type="number"
            min={1}
            max={31}
            value={paydayInput}
            onChange={(e) => {
              setPaydayInput(e.target.value);
              setPaydaySaved(false);
            }}
            className="mt-1 w-24 rounded-lg border border-brand-200 px-3 py-2 text-sm text-brand-900"
          />
        </label>
        {paydayError && <p className="mt-2 text-xs text-red-600">{paydayError}</p>}
        <button
          onClick={handleSavePayday}
          disabled={paydaySaving || !settings}
          className="mt-3 w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {paydaySaving ? "Saving..." : paydaySaved ? "Saved" : "Save"}
        </button>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
        <h2 className="text-sm font-semibold text-brand-900">Blocked dates</h2>
        {blockedDates === null ? (
          <p className="mt-2 text-sm text-brand-500">Loading...</p>
        ) : blockedDates.length === 0 ? (
          <p className="mt-2 text-sm text-brand-500">No dates blocked.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {blockedDates.map((b) => (
              <li key={b.date} className="flex items-center justify-between border-t border-brand-50 pt-2 first:border-0 first:pt-0">
                <span className="text-sm text-brand-800">
                  {formatDayHeading(b.date)} {b.label && <span className="text-brand-400">· {b.label}</span>}
                </span>
                <button onClick={() => handleUnblock(b.date)} className="text-xs font-medium text-brand-500 underline">
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              type="date"
              value={blockDateValue}
              onChange={(e) => setBlockDateValue(e.target.value)}
              className="flex-1 rounded-lg border border-brand-200 px-3 py-2 text-sm text-brand-900"
            />
            <input
              value={blockLabel}
              onChange={(e) => setBlockLabel(e.target.value)}
              placeholder="Reason (optional)"
              className="flex-1 rounded-lg border border-brand-200 px-3 py-2 text-sm text-brand-900"
            />
          </div>
          {blockError && <p className="text-xs text-red-600">{blockError}</p>}
          <button
            onClick={handleBlockDate}
            disabled={blockSubmitting || !blockDateValue}
            className="rounded-lg border-2 border-brand-300 px-4 py-2 text-sm font-semibold text-brand-700 disabled:opacity-60"
          >
            {blockSubmitting ? "Blocking..." : "Block this date"}
          </button>
        </div>
      </section>

    </div>
  );
}
