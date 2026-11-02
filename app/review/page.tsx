"use client";

import { useState, type FormEvent } from "react";
import { SiteFooter } from "../components/SiteFooter";
import { REVIEW_COMMENT_MAX, REVIEW_NAME_MAX } from "@/lib/reviews";

const RATING_WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

const FIELD_CLASS =
  "mt-2 w-full rounded-lg border border-navy/20 px-4 py-3 text-base text-navy outline-none focus:border-skyblue";

export default function ReviewPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [website, setWebsite] = useState(""); // honeypot - real visitors never see or fill this
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (rating === 0) {
      setError("Please tap a star rating first.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, phone, rating, comment, website }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setDone(true);
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 py-14 text-navy">
        {done ? (
          <>
            <h1 className="text-2xl font-extrabold tracking-tight text-navy">Thank you</h1>
            <p className="mt-2 text-[17px] leading-relaxed text-navy/70">
              Your review has been sent to us. It'll appear on our website once we've had a look at it.
            </p>
          </>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <h1 className="text-2xl font-extrabold tracking-tight text-navy">How did we do?</h1>
            <p className="mt-2 text-[17px] leading-relaxed text-navy/70">
              Leave a quick review of OGP Services. It only takes a minute.
            </p>

            <label className="mt-8 block">
              <span className="text-sm font-semibold text-navy">Your name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={REVIEW_NAME_MAX}
                autoComplete="name"
                className={FIELD_CLASS}
              />
            </label>

            <label className="mt-5 block">
              <span className="text-sm font-semibold text-navy">Your cell number</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="082 123 4567"
                className={FIELD_CLASS}
              />
              <span className="mt-1 block text-xs text-navy/60">
                Only used so we can check you're one of our customers. It is never shown on the website.
              </span>
            </label>

            <fieldset className="mt-6">
              <legend className="text-sm font-semibold text-navy">Your rating</legend>
              <div className="mt-2 flex items-center gap-1" role="radiogroup" aria-label="Star rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={rating === n}
                    aria-label={`${n} star${n === 1 ? "" : "s"}`}
                    onClick={() => setRating(n)}
                    className={`h-12 w-12 rounded-lg text-3xl leading-none transition ${
                      n <= rating ? "text-amber-500" : "text-navy/20"
                    }`}
                  >
                    ★
                  </button>
                ))}
              </div>
              <p className="mt-1 h-5 text-sm text-navy/60" aria-live="polite">
                {RATING_WORDS[rating]}
              </p>
            </fieldset>

            <label className="mt-4 block">
              <span className="text-sm font-semibold text-navy">A few words (optional)</span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={REVIEW_COMMENT_MAX}
                rows={4}
                placeholder="What did you like? Anything we could do better?"
                className={FIELD_CLASS}
              />
              <span className="mt-1 block text-right text-xs text-navy/50">
                {comment.length}/{REVIEW_COMMENT_MAX}
              </span>
            </label>

            {/* Honeypot: off-screen and skipped by keyboard and screen readers. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>
                Website
                <input
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                  name="website"
                />
              </label>
            </div>

            {error && (
              <p role="alert" className="mt-2 text-sm text-red-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-6 h-14 w-full rounded-lg bg-cta text-base font-medium text-white transition hover:brightness-95 disabled:opacity-60"
            >
              {submitting ? "Sending..." : "Send my review"}
            </button>
          </form>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
