"use client";

import { useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { PLANS, type PlanId } from "@/lib/plans";

const SERVICES = ["Cutting", "Weeding", "Edging", "Refuse removal", "General tidy"];
const WHATSAPP_DISPLAY = "079 533 5440";
const WHATSAPP_LINK = "https://wa.me/27795335440";

export default function SignupPage() {
  const [fullName, setFullName] = useState("");
  const [houseNumber, setHouseNumber] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [plan, setPlan] = useState<PlanId>("monthly");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName, houseNumber, whatsappNumber, plan }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please check your details.");
        setSubmitting(false);
        return;
      }

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
      setError("Could not reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col bg-white px-5 pb-10 pt-8 text-navy">
      {/* 1. Logo + headline */}
      <header className="mb-8 text-center">
        <Image src="/logo.png" alt="OGP Services" width={320} height={320} priority className="mx-auto h-auto w-32" />
        <h1 className="mt-4 text-2xl font-bold leading-snug text-navy">
          Platinum Village yards, kept tidy all year round
        </h1>
      </header>

      {/* 2. Price, stated immediately */}
      <section className="mb-8 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-skyblue/25 bg-skyblue/5 px-4 py-5 text-center">
          <p className="text-2xl font-bold text-navy">R200</p>
          <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-skyblue">per month</p>
        </div>
        <div className="rounded-2xl border border-skyblue/25 bg-skyblue/5 px-4 py-5 text-center">
          <p className="text-2xl font-bold text-navy">R2,000</p>
          <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-skyblue">per year</p>
        </div>
      </section>

      {/* 3. What's included */}
      <section className="mb-8">
        <h2 className="text-xs font-bold uppercase tracking-wide text-skyblue">What&apos;s included</h2>
        <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm text-navy">
          {SERVICES.map((service) => (
            <li key={service} className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-skyblue" />
              {service}
            </li>
          ))}
        </ul>
      </section>

      {/* 4. Schedule */}
      <section className="mb-8">
        <h2 className="text-xs font-bold uppercase tracking-wide text-skyblue">Schedule</h2>
        <p className="mt-3 text-sm text-navy">Twice a month, September to April.</p>
        <p className="text-sm text-navy">Once a month, May to August.</p>
      </section>

      {/* 5. Credibility */}
      <section className="mb-8 border-y border-navy/10 py-5 text-center">
        <p className="text-xs font-semibold text-navy">OGP Services (Pty) Ltd</p>
        <p className="mt-0.5 text-xs text-navy/60">Registration 2019/343931/07</p>
        <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-navy/70">
          Grounds and maintenance work delivered for Sibanye-Stillwater, Royal Bafokeng
          Administration and Rustenburg Local Municipality.
        </p>
      </section>

      {/* 6. Signup form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <fieldset className="rounded-2xl border border-navy/10 p-5">
          <legend className="px-1 text-sm font-semibold text-navy">Choose your plan</legend>
          <div className="mt-2 flex flex-col gap-3">
            {Object.values(PLANS).map((p) => (
              <label
                key={p.id}
                className={`flex cursor-pointer items-center justify-between rounded-xl border-2 p-4 transition ${
                  plan === p.id ? "border-skyblue bg-skyblue/5" : "border-navy/10"
                }`}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="plan"
                    value={p.id}
                    checked={plan === p.id}
                    onChange={() => setPlan(p.id)}
                    className="h-5 w-5 accent-skyblue"
                  />
                  <span>
                    <span className="block font-semibold text-navy">{p.label}</span>
                    <span className="block text-sm text-navy/70">{p.priceLine}</span>
                  </span>
                </span>
                {p.badge && (
                  <span className="rounded-full bg-skyblue px-2.5 py-1 text-xs font-semibold text-white">
                    {p.badge}
                  </span>
                )}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-4 rounded-2xl border border-navy/10 p-5">
          <legend className="px-1 text-sm font-semibold text-navy">Your details</legend>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="fullName" className="text-sm font-medium text-navy/80">
              Full name
            </label>
            <input
              id="fullName"
              type="text"
              inputMode="text"
              autoComplete="name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Thabo Mokoena"
              className="rounded-xl border border-navy/20 px-4 py-3 text-base text-navy outline-none focus:border-skyblue focus:ring-2 focus:ring-skyblue/10"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="houseNumber" className="text-sm font-medium text-navy/80">
              House number
            </label>
            <input
              id="houseNumber"
              type="text"
              inputMode="text"
              required
              value={houseNumber}
              onChange={(e) => setHouseNumber(e.target.value)}
              placeholder="e.g. 42"
              className="rounded-xl border border-navy/20 px-4 py-3 text-base text-navy outline-none focus:border-skyblue focus:ring-2 focus:ring-skyblue/10"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="whatsappNumber" className="text-sm font-medium text-navy/80">
              WhatsApp number
            </label>
            <input
              id="whatsappNumber"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
              placeholder="e.g. 082 123 4567"
              className="rounded-xl border border-navy/20 px-4 py-3 text-base text-navy outline-none focus:border-skyblue focus:ring-2 focus:ring-skyblue/10"
            />
          </div>
        </fieldset>

        {error && (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-cta px-4 py-4 text-base font-semibold text-white shadow-sm transition hover:brightness-95 active:brightness-90 disabled:opacity-60"
        >
          {submitting ? "Redirecting to secure payment..." : "Continue to secure payment"}
        </button>

        <p className="text-center text-xs text-navy/60">
          You&apos;ll be redirected to PayFast to set up secure recurring billing. Cancel anytime.
        </p>
      </form>

      {/* Populated and submitted programmatically once /api/signup returns the signed PayFast fields. */}
      <form ref={formRef} method="POST" className="hidden" />

      {/* 7. Footer */}
      <footer className="mt-10 text-center">
        <a
          href={WHATSAPP_LINK}
          className="inline-flex items-center gap-2 rounded-full border-2 border-cta px-5 py-2.5 text-sm font-semibold text-cta transition hover:bg-cta hover:text-white"
        >
          WhatsApp us: {WHATSAPP_DISPLAY}
        </a>
      </footer>
    </main>
  );
}
