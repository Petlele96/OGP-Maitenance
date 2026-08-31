"use client";

import { useRef, useState, type FormEvent } from "react";
import { PLANS, type PlanId } from "@/lib/plans";

const SERVICES = ["Cutting", "Weeding", "Edging", "Refuse removal", "General tidy-up"];

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
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-8">
      <header className="mb-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">
          Platinum Village, Rustenburg
        </p>
        <h1 className="mt-1 text-2xl font-bold text-brand-900">OGP Services</h1>
        <p className="mt-1 text-base text-brand-700">Yard Maintenance Signup</p>
      </header>

      <section className="mb-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-brand-100">
        <h2 className="text-sm font-semibold text-brand-900">Every plan includes</h2>
        <ul className="mt-3 grid grid-cols-2 gap-2 text-sm text-brand-800">
          {SERVICES.map((service) => (
            <li key={service} className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-500" />
              {service}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-brand-600">
          Year-round service, including winter - your yard is maintained every month, no matter
          the season.
        </p>
      </section>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <fieldset className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-brand-100">
          <legend className="px-1 text-sm font-semibold text-brand-900">Choose your plan</legend>
          <div className="mt-2 flex flex-col gap-3">
            {(Object.values(PLANS)).map((p) => (
              <label
                key={p.id}
                className={`flex cursor-pointer items-center justify-between rounded-xl border-2 p-4 transition ${
                  plan === p.id ? "border-brand-500 bg-brand-50" : "border-brand-100"
                }`}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="plan"
                    value={p.id}
                    checked={plan === p.id}
                    onChange={() => setPlan(p.id)}
                    className="h-5 w-5 accent-brand-600"
                  />
                  <span>
                    <span className="block font-semibold text-brand-900">{p.label}</span>
                    <span className="block text-sm text-brand-700">{p.priceLine}</span>
                  </span>
                </span>
                {p.badge && (
                  <span className="rounded-full bg-brand-500 px-2.5 py-1 text-xs font-semibold text-white">
                    {p.badge}
                  </span>
                )}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-brand-100">
          <legend className="px-1 text-sm font-semibold text-brand-900">Your details</legend>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="fullName" className="text-sm font-medium text-brand-800">
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
              className="rounded-xl border border-brand-200 px-4 py-3 text-base text-brand-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="houseNumber" className="text-sm font-medium text-brand-800">
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
              className="rounded-xl border border-brand-200 px-4 py-3 text-base text-brand-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="whatsappNumber" className="text-sm font-medium text-brand-800">
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
              className="rounded-xl border border-brand-200 px-4 py-3 text-base text-brand-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
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
          className="w-full rounded-xl bg-brand-600 px-4 py-4 text-base font-semibold text-white shadow-sm transition active:bg-brand-700 disabled:opacity-60"
        >
          {submitting ? "Redirecting to secure payment..." : "Continue to secure payment"}
        </button>

        <p className="text-center text-xs text-brand-600">
          You&apos;ll be redirected to PayFast to set up secure recurring billing. Cancel anytime.
        </p>
      </form>

      {/* Populated and submitted programmatically once /api/signup returns the signed PayFast fields. */}
      <form ref={formRef} method="POST" className="hidden" />
    </main>
  );
}
