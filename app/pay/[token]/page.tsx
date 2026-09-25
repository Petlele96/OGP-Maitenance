"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ASK_QUESTION_LINK } from "@/lib/site";

type Status = "loading" | "redirecting" | "error";

export default function PayPage({ params }: { params: { token: string } }) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/pay/${params.token}`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;

        if (!res.ok) {
          setError(data.error ?? "This payment link isn't valid.");
          setStatus("error");
          return;
        }

        setStatus("redirecting");
        const form = formRef.current;
        if (!form) return;
        form.action = data.actionUrl;
        form.innerHTML = "";
        for (const [key, value] of Object.entries(data.fields as Record<string, string>)) {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = key;
          input.value = value;
          form.appendChild(input);
        }
        form.submit();
      } catch {
        if (!cancelled) {
          setError("Could not reach the server. Check your connection and try again.");
          setStatus("error");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [params.token]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      {status === "loading" || status === "redirecting" ? (
        <>
          <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
          <h1 className="text-xl font-bold text-brand-900">Taking you to secure payment...</h1>
          <p className="mt-2 text-sm text-brand-700">Please don&apos;t close this page.</p>
        </>
      ) : (
        <>
          <h1 className="text-xl font-bold text-brand-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-brand-700">{error}</p>
          <a
            href={ASK_QUESTION_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white"
          >
            Contact us on WhatsApp
          </a>
          <Link href="/" className="mt-4 text-sm font-semibold text-brand-600 underline">
            Back to home
          </Link>
        </>
      )}

      {/* Populated and submitted programmatically once /api/pay/[token] returns the signed PayFast fields. */}
      <form ref={formRef} method="POST" className="hidden" />
    </main>
  );
}
