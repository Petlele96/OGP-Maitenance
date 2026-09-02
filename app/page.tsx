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
    <main className="mx-auto max-w-lg bg-white px-6 text-navy">
      {/* 1. Logo + headline */}
      <header className="pb-16 pt-14">
        <Image src="/logo.png" alt="OGP Services" width={320} height={320} priority className="h-9 w-auto" />
        <p className="mt-10 text-xs font-semibold uppercase tracking-[0.14em] text-skyblue">
          Platinum Village, Rustenburg
        </p>
        <h1 className="mt-3 text-[46px] font-extrabold leading-[1.05] tracking-tight text-navy sm:text-[52px]">
          Yards kept tidy, all year round.
        </h1>
      </header>

      {/* 2. Price - the hero */}
      <section className="border-t border-navy/10 py-16">
        <div className="flex items-baseline gap-2">
          <span className="text-6xl font-extrabold tracking-tight text-navy">R200</span>
          <span className="text-base font-medium text-navy/50">per month</span>
        </div>

        <div className="mt-8 flex items-center justify-between border border-navy/15 px-5 py-4">
          <div>
            <span className="text-lg font-semibold text-navy">R2,000</span>
            <span className="ml-2 text-sm text-navy/50">per year</span>
          </div>
          <span className="text-xs font-medium uppercase tracking-wide text-skyblue">2 months free</span>
        </div>
      </section>

      {/* 3. What's included */}
      <section className="border-t border-navy/10 py-16">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-skyblue">What&apos;s included</h2>
        <ul className="mt-6 space-y-3">
          {SERVICES.map((service) => (
            <li key={service} className="text-[17px] leading-relaxed text-navy">
              {service}
            </li>
          ))}
        </ul>
      </section>

      {/* 4. Schedule */}
      <section className="border-t border-navy/10 py-16">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-skyblue">Schedule</h2>
        <p className="mt-6 text-[17px] leading-relaxed text-navy">
          Twice a month, September to April.
          <br />
          Once a month, May to August.
        </p>
      </section>

      {/* 5. Credibility - quiet, understated */}
      <section className="border-t border-navy/10 py-16">
        <div className="border border-navy/15 px-5 py-4">
          <p className="text-xs font-medium text-navy">OGP Services (Pty) Ltd &middot; Reg. 2019/343931/07</p>
          <p className="mt-2 text-xs leading-relaxed text-navy/60">
            Grounds and maintenance work delivered for Sibanye-Stillwater, Royal Bafokeng
            Administration and Rustenburg Local Municipality.
          </p>
        </div>
      </section>

      {/* 6. Signup form */}
      <section className="border-t border-navy/10 py-16">
        <form onSubmit={handleSubmit} className="flex flex-col gap-10" noValidate>
          <fieldset>
            <legend className="mb-5 text-xs font-semibold uppercase tracking-[0.14em] text-skyblue">
              Choose your plan
            </legend>
            <div className="flex flex-col gap-3">
              {Object.values(PLANS).map((p) => (
                <label
                  key={p.id}
                  className={`flex cursor-pointer items-center justify-between border px-5 py-4 transition ${
                    plan === p.id ? "border-skyblue" : "border-navy/15"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="plan"
                      value={p.id}
                      checked={plan === p.id}
                      onChange={() => setPlan(p.id)}
                      className="h-4 w-4 accent-skyblue"
                    />
                    <span>
                      <span className="block text-base font-medium text-navy">{p.label}</span>
                      <span className="block text-sm text-navy/50">{p.priceLine}</span>
                    </span>
                  </span>
                  {p.badge && (
                    <span className="text-xs font-medium uppercase tracking-wide text-skyblue">{p.badge}</span>
                  )}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-5">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-skyblue">
              Your details
            </legend>

            <div className="flex flex-col gap-2">
              <label htmlFor="fullName" className="text-sm font-medium text-navy/70">
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
                className="h-14 border border-navy/15 px-4 text-base text-navy outline-none focus:border-skyblue"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="houseNumber" className="text-sm font-medium text-navy/70">
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
                className="h-14 border border-navy/15 px-4 text-base text-navy outline-none focus:border-skyblue"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="whatsappNumber" className="text-sm font-medium text-navy/70">
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
                className="h-14 border border-navy/15 px-4 text-base text-navy outline-none focus:border-skyblue"
              />
            </div>
          </fieldset>

          {error && (
            <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}

          <div>
            <button
              type="submit"
              disabled={submitting}
              className="h-14 w-full rounded-lg bg-cta text-base font-medium text-white transition hover:brightness-95 active:brightness-90 disabled:opacity-60"
            >
              {submitting ? "Redirecting to secure payment..." : "Continue to secure payment"}
            </button>
            <p className="mt-4 text-xs leading-relaxed text-navy/50">
              You&apos;ll be redirected to PayFast to set up secure recurring billing. Cancel anytime.
            </p>
          </div>
        </form>

        {/* Populated and submitted programmatically once /api/signup returns the signed PayFast fields. */}
        <form ref={formRef} method="POST" className="hidden" />
      </section>

      {/* 7. Footer */}
      <footer className="border-t border-navy/10 py-10">
        <p className="text-sm text-navy/60">
          WhatsApp{" "}
          <a href={WHATSAPP_LINK} className="text-navy underline underline-offset-2">
            {WHATSAPP_DISPLAY}
          </a>
        </p>
      </footer>
    </main>
  );
}
