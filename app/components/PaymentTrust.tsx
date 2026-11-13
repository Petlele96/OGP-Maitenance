"use client";

import { useEffect, useRef, useState } from "react";
import { PAYFAST_CARD_STATEMENT } from "./payment-copy";

/**
 * The official Payfast logo (full colour, from the Payfast logo pack), saved as public/payfast-badge.svg.
 * Until that file exists the badge simply does not render (no broken-image icon) - the wording stands alone.
 * If the downloaded file has a different name or type (e.g. .svg), change this one constant.
 */
export const PAYFAST_BADGE_SRC = "/payfast-badge.svg";

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
      className="mb-3 h-10 w-auto"
    />
  );
}

/**
 * Sits directly under the card option on the signup page, where someone hesitates. The claim is for card
 * payments only - cash and EFT are handled by OGP Services directly, so nothing here may imply Payfast covers them.
 */
export function PaymentTrustBlock() {
  return (
    <div className="mt-4 border-t border-navy/10 pt-4">
      <PayfastBadge />
      <p className="text-sm font-medium leading-relaxed text-navy">{PAYFAST_CARD_STATEMENT}</p>
    </div>
  );
}

/** The same statement (and badge) on the booking confirmation, where the payment link is still to come. */
export function PaymentTrustNote() {
  return (
    <div className="mt-5 border-t border-navy/10 pt-5">
      <PayfastBadge />
      <p className="text-sm leading-relaxed text-navy/70">{PAYFAST_CARD_STATEMENT}</p>
    </div>
  );
}
