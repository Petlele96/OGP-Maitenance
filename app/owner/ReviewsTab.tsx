"use client";

import { useCallback, useEffect, useState } from "react";
import { buildReviewShareLink } from "@/lib/site";
import { REVIEW_REPLY_MAX, reviewerLabel } from "@/lib/reviews";
import { Stars } from "../components/Stars";

interface CustomerMatch {
  fullName: string;
  houseNumber: string;
  block: number | null;
  status: string;
}

interface OwnerReview {
  id: string;
  name: string;
  phone: string;
  rating: number;
  comment: string;
  status: "pending" | "approved";
  hidden: boolean;
  reply: string | null;
  createdAt: string;
  matches: CustomerMatch[];
  siteBlock: number | null;
}

function stateOf(r: OwnerReview): { label: string; className: string } {
  if (r.hidden) return { label: "Hidden", className: "bg-gray-100 text-gray-700" };
  if (r.status === "approved") return { label: "Approved - on the site", className: "bg-brand-50 text-brand-700" };
  return { label: "Pending - not on the site", className: "bg-amber-50 text-amber-800" };
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function matchLine(m: CustomerMatch): string {
  const block = m.block === null ? "block not recorded" : `Block ${m.block}`;
  const status = m.status === "cancelled" || m.status === "archived" ? ` (${m.status})` : "";
  return `${m.fullName} · House ${m.houseNumber} · ${block}${status}`;
}

export default function ReviewsTab({ onChanged }: { onChanged?: () => void }) {
  const [reviews, setReviews] = useState<OwnerReview[] | null>(null);
  const [reviewUrl, setReviewUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/owner/reviews", { cache: "no-store" });
    if (!res.ok) return;
    const json = await res.json();
    setReviews(json.reviews);
  }, []);

  useEffect(() => {
    setReviewUrl(`${window.location.origin}/review`);
    load();
  }, [load]);

  async function moderate(r: OwnerReview, action: "approve" | "hide" | "unhide" | "reply", reply?: string) {
    setBusyId(r.id);
    setError(null);
    const res = await fetch("/api/owner/reviews/moderate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewId: r.id, action, reply }),
    });
    setBusyId(null);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "That didn't save. Please try again.");
      return;
    }
    if (action === "reply") setReplyingId(null);
    await load();
    onChanged?.();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(reviewUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this review link", reviewUrl);
    }
  }

  return (
    <>
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
        <h2 className="text-sm font-semibold text-brand-900">Your review link</h2>
        <p className="mt-1 text-xs text-brand-500">One link for everyone. Send it to anyone or post it in a group.</p>
        <p className="mt-2 break-all rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">{reviewUrl}</p>
        <div className="mt-3 flex gap-2">
          <button
            onClick={copyLink}
            className="rounded-lg border-2 border-brand-300 px-4 py-2 text-xs font-semibold text-brand-700"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <a
            href={buildReviewShareLink(reviewUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white"
          >
            Share on WhatsApp
          </a>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
        <h2 className="text-sm font-semibold text-brand-900">Reviews</h2>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {reviews === null ? (
          <p className="mt-3 text-sm text-brand-500">Loading...</p>
        ) : reviews.length === 0 ? (
          <p className="mt-3 text-sm text-brand-500">No reviews yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-4">
            {reviews.map((r) => {
              const state = stateOf(r);
              const busy = busyId === r.id;
              return (
                <li key={r.id} className="border-t border-brand-50 pt-4 first:border-0 first:pt-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Stars rating={r.rating} className="text-lg" />
                      <p className="mt-0.5 text-sm font-semibold text-brand-900">{r.name}</p>
                      <p className="text-xs text-brand-500">
                        {r.phone} · {formatDay(r.createdAt)}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-lg px-2 py-1 text-xs font-semibold ${state.className}`}>
                      {state.label}
                    </span>
                  </div>

                  {r.matches.length > 0 ? (
                    <div className="mt-2 rounded-lg bg-brand-50 px-3 py-2">
                      <p className="text-xs font-semibold text-brand-700">
                        {r.matches.length === 1 ? "Matches a customer" : `Matches ${r.matches.length} customers`}
                      </p>
                      {r.matches.map((m, i) => (
                        <p key={i} className="text-sm text-brand-900">
                          {matchLine(m)}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2">
                      <p className="text-xs font-semibold text-amber-800">No match</p>
                      <p className="text-sm text-amber-900">
                        No customer has this phone number. You can still approve it if you know who it is.
                      </p>
                    </div>
                  )}

                  {r.comment && <p className="mt-2 whitespace-pre-line text-sm text-brand-900">{r.comment}</p>}

                  <p className="mt-2 text-xs text-brand-400">
                    Shows on the site as: {reviewerLabel(r.name.trim().split(/\s+/)[0], r.siteBlock)}
                  </p>

                  {r.reply && replyingId !== r.id && (
                    <div className="mt-2 rounded-lg bg-brand-50 px-3 py-2">
                      <p className="text-xs font-semibold text-brand-700">Your reply</p>
                      <p className="mt-0.5 whitespace-pre-line text-sm text-brand-900">{r.reply}</p>
                    </div>
                  )}

                  {replyingId === r.id && (
                    <div className="mt-2">
                      <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        maxLength={REVIEW_REPLY_MAX}
                        rows={3}
                        placeholder="Reply from OGP Services - shown under the review on the site"
                        className="w-full rounded-lg border border-brand-200 px-3 py-2 text-sm text-brand-900 outline-none focus:border-brand-500"
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => moderate(r, "reply", replyText)}
                          disabled={busy}
                          className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                        >
                          {replyText.trim() === "" ? "Remove reply" : "Save reply"}
                        </button>
                        <button
                          onClick={() => setReplyingId(null)}
                          className="rounded-lg border-2 border-brand-200 px-4 py-2 text-xs font-semibold text-brand-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {!r.hidden && r.status === "pending" && (
                      <button
                        onClick={() => moderate(r, "approve")}
                        disabled={busy}
                        className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                      >
                        Approve
                      </button>
                    )}
                    {r.hidden ? (
                      <button
                        onClick={() => moderate(r, "unhide")}
                        disabled={busy}
                        className="rounded-lg border-2 border-brand-300 px-4 py-2 text-xs font-semibold text-brand-700 disabled:opacity-60"
                      >
                        Unhide
                      </button>
                    ) : (
                      <button
                        onClick={() => moderate(r, "hide")}
                        disabled={busy}
                        className="rounded-lg border-2 border-brand-300 px-4 py-2 text-xs font-semibold text-brand-700 disabled:opacity-60"
                      >
                        Hide
                      </button>
                    )}
                    {replyingId !== r.id && (
                      <button
                        onClick={() => {
                          setReplyingId(r.id);
                          setReplyText(r.reply ?? "");
                        }}
                        className="rounded-lg border-2 border-brand-300 px-4 py-2 text-xs font-semibold text-brand-700"
                      >
                        {r.reply ? "Edit reply" : "Reply"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
