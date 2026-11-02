"use client";

import { useEffect, useState } from "react";
import { reviewerLabel } from "@/lib/reviews";
import { Stars } from "./Stars";

interface PublicReview {
  id: string;
  firstName: string;
  block: number | null;
  rating: number;
  comment: string;
  reply: string | null;
}

/** Approved reviews, newest first. Renders nothing at all - no heading, no empty state - until there's at least one. */
export function CustomerReviews() {
  const [reviews, setReviews] = useState<PublicReview[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/reviews");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.reviews)) setReviews(data.reviews);
      } catch {
        // Stay empty - the section simply doesn't appear.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (reviews.length === 0) return null;

  return (
    <section className="border-t border-navy/10 py-24" aria-labelledby="reviews-heading">
      <h2 id="reviews-heading" className="text-sm font-bold uppercase tracking-[0.12em] text-skyblue">
        What residents say
      </h2>
      <ul className="mt-8 flex flex-col gap-8">
        {reviews.map((r) => (
          <li key={r.id}>
            <Stars rating={r.rating} className="text-xl" />
            {r.comment && (
              <p className="mt-2 whitespace-pre-line text-[17px] leading-relaxed text-navy/80">{r.comment}</p>
            )}
            <p className="mt-2 text-sm font-semibold text-navy">{reviewerLabel(r.firstName, r.block)}</p>
            {r.reply && (
              <div className="mt-3 rounded-lg bg-cream px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wide text-navy/50">Reply from OGP Services</p>
                <p className="mt-1 whitespace-pre-line text-[15px] leading-relaxed text-navy/80">{r.reply}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
