"use client";

import { useState } from "react";

function recordContact(signupId: string) {
  fetch("/api/owner/customers/contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signupId }),
  }).catch(() => {});
}

/**
 * Copy message / Open WhatsApp for one awaiting-payment customer - the same two buttons wherever they appear (the
 * Payments due rows, the awaiting-payment list, the customer page). Each press issues a fresh activation link through
 * /api/owner/send-payment-link, the ordinary subscription checkout, so it works whether or not the customer has been
 * serviced and whether or not their due date has arrived. It never touches the due date: if they do not pay, they
 * still appear in Payments due on the day as normal.
 */
export default function PaymentLinkActions({
  signupId,
  onSent,
  heading,
}: {
  signupId: string;
  onSent: () => void;
  /** Optional label above the buttons, e.g. "Send payment link now". */
  heading?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // If the browser refuses clipboard access, the message is shown here to copy by hand.
  const [manual, setManual] = useState("");

  async function issueLink(): Promise<{ message: string; whatsappLink: string } | null> {
    const res = await fetch("/api/owner/send-payment-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signupId }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Couldn't create that link.");
      return null;
    }
    return res.json();
  }

  async function copy() {
    setBusy(true);
    setCopied(false);
    setError(null);
    setManual("");
    const json = await issueLink();
    setBusy(false);
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json.message);
      setCopied(true);
    } catch {
      setManual(json.message);
    }
    recordContact(signupId);
    onSent();
  }

  async function openWhatsApp() {
    setBusy(true);
    setCopied(false);
    setError(null);
    setManual("");
    // Opened before the request so mobile browsers treat it as the result of the tap, not a popup.
    const waTab = window.open("", "_blank");
    const json = await issueLink();
    setBusy(false);
    if (!json) {
      waTab?.close();
      return;
    }
    if (waTab) waTab.location.href = json.whatsappLink;
    recordContact(signupId);
    onSent();
  }

  return (
    <div className="mt-2">
      {heading && <p className="mb-1.5 text-xs font-semibold text-brand-700">{heading}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={copy}
          disabled={busy}
          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Working..." : copied ? "Copied" : "Copy message"}
        </button>
        <button
          onClick={openWhatsApp}
          disabled={busy}
          className="rounded-lg border-2 border-brand-300 px-3 py-2 text-sm font-semibold text-brand-700 disabled:opacity-50"
        >
          Open WhatsApp
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      {manual && (
        <label className="mt-2 block text-xs text-brand-500">
          Couldn&apos;t copy automatically - select and copy this message:
          <textarea
            readOnly
            value={manual}
            rows={4}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-1 w-full rounded-lg border border-brand-200 p-2 text-sm text-brand-900"
          />
        </label>
      )}
    </div>
  );
}
