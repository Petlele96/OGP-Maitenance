"use client";

import { useEffect, useRef, useState } from "react";
import { PAYFAST_CARD_STATEMENT, PAY_LATER_STATEMENT } from "./payment-copy";

/**
 * The official Payfast merchant badge, downloaded from the Payfast dashboard and saved here in public/.
 * Until that file exists the badge simply does not render (no broken-image icon) - the wording stands alone.
 * If the downloaded file has a different name or type (e.g. .svg), change this one constant.
 */
export const PAYFAST_BADGE_SRC = "/payfast-badge.png";

function PayfastBadge() {
  const [missing, setMissing] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // The image can fail before React has attached onError (server-rendered page), so check once on mount too.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setMissing(true);
  }, []);
  if (missing) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the badge's size is not ours to know or crop
    <img
      ref={ref}
      src={PAYFAST_BADGE_SRC}
      alt="Payfast"
      onError={() => setMissing(true)}
      className="mb-3 h-8 w-auto"
    />
  );
}

/**
 * Sits directly above the payment choice on the signup page, where someone hesitates. Two statements of equal
 * weight: what protects a card payment, and the way out for anyone who would rather not use a card. The card
 * claim is made for card payments only - cash and EFT are handled by OGP Services directly.
 */
export function PaymentTrustBlock() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="border border-navy/15 px-4 py-4">
        <PayfastBadge />
        <p className="text-sm font-medium leading-relaxed text-navy">{PAYFAST_CARD_STATEMENT}</p>
      </div>
      <div className="border border-navy/15 px-4 py-4">
        <p className="text-sm font-medium leading-relaxed text-navy">{PAY_LATER_STATEMENT}</p>
      </div>
    </div>
  );
}

/** The card statement (and badge) on its own - for the booking confirmation, where the payment link is still to come. */
export function PaymentTrustNote() {
  return (
    <div className="mt-5 border-t border-navy/10 pt-5">
      <PayfastBadge />
      <p className="text-sm leading-relaxed text-navy/70">{PAYFAST_CARD_STATEMENT}</p>
    </div>
  );
}
