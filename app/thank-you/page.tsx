"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type Status = "loading" | "pending" | "active" | "timeout" | "error";

export default function ThankYouPage() {
  return (
    <Suspense fallback={null}>
      <ThankYouContent />
    </Suspense>
  );
}

function ThankYouContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    if (!id) {
      setStatus("error");
      return;
    }

    let attempts = 0;
    let cancelled = false;

    async function poll() {
      attempts += 1;
      try {
        const res = await fetch(`/api/signup/${id}`, { cache: "no-store" });
        if (!res.ok) throw new Error("not found");
        const data = await res.json();
        if (cancelled) return;

        if (data.paymentStatus === "active") {
          setStatus("active");
          return;
        }
        if (attempts >= 15) {
          setStatus("timeout");
          return;
        }
        setStatus("pending");
        setTimeout(poll, 2000);
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      {status === "loading" || status === "pending" ? (
        <>
          <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
          <h1 className="text-xl font-bold text-brand-900">Confirming your payment...</h1>
          <p className="mt-2 text-sm text-brand-700">
            This usually takes a few seconds. Please don&apos;t close this page.
          </p>
        </>
      ) : status === "active" ? (
        <>
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-2xl text-white">
            ✓
          </div>
          <h1 className="text-xl font-bold text-brand-900">You&apos;re all set!</h1>
          <p className="mt-2 text-sm text-brand-700">
            Your OGP Services subscription is active. We&apos;ll be in touch on WhatsApp before your
            first visit.
          </p>
        </>
      ) : status === "timeout" ? (
        <>
          <h1 className="text-xl font-bold text-brand-900">Still confirming</h1>
          <p className="mt-2 text-sm text-brand-700">
            Your payment is taking longer than usual to confirm. If money left your account,
            you&apos;re covered - we&apos;ll update your status shortly. Otherwise, contact us on
            WhatsApp.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-xl font-bold text-brand-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-brand-700">
            We couldn&apos;t find that signup. If you completed a payment, please contact us on
            WhatsApp so we can confirm it manually.
          </p>
        </>
      )}

      <Link href="/" className="mt-6 text-sm font-semibold text-brand-600 underline">
        Back to home
      </Link>
    </main>
  );
}
