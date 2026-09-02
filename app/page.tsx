"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { PLANS, type PlanId } from "@/lib/plans";
import {
  WHATSAPP_DISPLAY,
  WHATSAPP_LINK,
  ASK_QUESTION_LINK,
  COMPANY_NAME,
  COMPANY_REG,
  COMPANY_CSD,
  LAUNCH_OFFER_SPOTS,
} from "@/lib/site";

const INCLUDED = ["Cutting", "Weeding", "Edging", "Garden cuttings removed and bagged", "General tidy"];
const STEPS = ["You sign up.", "You get your service day.", "We WhatsApp you the day before.", "We come and do the work."];
const WORKER_POINTS = [
  "Our workers are known to us.",
  "They carry ID.",
  "They wear OGP Services clothing.",
  "They stay in the yard.",
  "They never enter the house.",
];

const CTA_BUTTON_CLASS =
  "block h-14 w-full rounded-lg bg-cta text-center text-base font-medium leading-[56px] text-white transition hover:brightness-95 active:brightness-90";
const SECONDARY_BUTTON_CLASS =
  "block h-14 w-full rounded-lg border-2 border-navy text-center text-base font-medium leading-[52px] text-navy transition hover:bg-navy hover:text-white";

export default function SignupPage() {
  const [fullName, setFullName] = useState("");
  const [houseNumber, setHouseNumber] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [block, setBlock] = useState("");
  const [plan, setPlan] = useState<PlanId>("monthly");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spotsLeft, setSpotsLeft] = useState<number | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    fetch("/api/launch-offer", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setSpotsLeft(data.spotsLeft))
      .catch(() => setSpotsLeft(null));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName,
          houseNumber,
          whatsappNumber,
          plan,
          agreedToTerms,
          block: block === "" ? null : Number(block),
        }),
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
      <header className="pb-24 pt-14">
        <Image src="/logo.png" alt="OGP Services" width={320} height={320} priority className="h-28 w-auto" />
        <h1 className="mt-10 text-[56px] font-black leading-[1.02] tracking-tight text-navy sm:text-[64px]">
          Your yard, kept tidy, all year round.
        </h1>
        {/* Full-width slot reserved for a before/after photo. */}
        <div className="mt-10 flex aspect-[4/3] w-full items-center justify-center border border-navy/15 bg-navy/5">
          <span className="text-sm font-medium text-navy/40">Before / after photo</span>
        </div>
      </header>

      {/* 2. Intro */}
      <section className="border-t border-navy/10 py-24">
        <p className="text-[17px] leading-relaxed text-navy">
          Most people here work shifts. You don&apos;t have time for your yard. We do it for you, on a set day,
          every month.
        </p>
      </section>

      {/* 3. Run from Platinum Village */}
      <section className="border-t border-navy/10 py-24">
        <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-skyblue">Run from Platinum Village</h2>
        <p className="mt-6 text-[17px] leading-relaxed text-navy">
          This service is run by a resident of Platinum Village.
          <br />
          Not an outside company.
        </p>
      </section>

      {/* 4. What's included */}
      <section className="border-t border-navy/10 py-24">
        <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-skyblue">What&apos;s included</h2>
        <ul className="mt-6 space-y-3">
          {INCLUDED.map((item) => (
            <li key={item} className="text-[17px] leading-relaxed text-navy">
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm leading-relaxed text-navy/60">
          Not included: household refuse. That stays with the municipality on Thursdays.
        </p>
      </section>

      {/* 5. How often */}
      <section className="border-t border-navy/10 py-24">
        <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-skyblue">How often</h2>
        <p className="mt-6 text-[17px] leading-relaxed text-navy">
          Twice a month, September to April.
          <br />
          Once a month, May to August.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-navy/60">Grass grows slowly in winter. That&apos;s why.</p>
      </section>

      {/* 6. How it works */}
      <section className="border-t border-navy/10 py-24">
        <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-skyblue">How it works</h2>
        <ol className="mt-6 flex flex-col gap-4">
          {STEPS.map((step, i) => (
            <li key={step} className="flex gap-4">
              <span className="text-[17px] font-semibold text-skyblue">{i + 1}</span>
              <span className="text-[17px] leading-relaxed text-navy">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* 7. Our workers */}
      <section className="border-t border-navy/10 py-24">
        <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-skyblue">Our workers</h2>
        <ul className="mt-6 space-y-3">
          {WORKER_POINTS.map((point) => (
            <li key={point} className="text-[17px] leading-relaxed text-navy">
              {point}
            </li>
          ))}
        </ul>
      </section>

      <div className="border-t border-navy/10 py-24">
        <a href="#signup-form" className={CTA_BUTTON_CLASS}>
          Sign up now
        </a>
      </div>

      {/* 8. Credibility - quiet, understated */}
      <section className="border-t border-navy/10 py-24">
        <div className="border border-navy/15 px-5 py-4">
          <p className="text-xs font-medium text-navy">
            {COMPANY_NAME} &middot; Reg. {COMPANY_REG} &middot; CSD {COMPANY_CSD}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-navy/60">
            We do grounds and maintenance work for Sibanye-Stillwater K6 Shaft and Royal Bafokeng Administration.
          </p>
        </div>
      </section>

      {/* 9. Price - the hero */}
      <section className="border-t border-navy/10 py-24">
        <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-skyblue">Price</h2>
        <div className="mt-6 flex items-baseline gap-2">
          <span className="text-7xl font-black tracking-tight text-navy">R200</span>
          <span className="text-base font-medium text-navy/40">per month</span>
        </div>

        <div className="mt-8 flex items-center justify-between border border-navy/15 px-5 py-4">
          <div>
            <span className="text-lg font-semibold text-navy">R2,000</span>
            <span className="ml-2 text-sm text-navy/50">per year</span>
          </div>
          <span className="text-xs font-medium uppercase tracking-wide text-skyblue">2 months free</span>
        </div>

        <div className="mt-3 flex items-center justify-between border border-navy/15 px-5 py-4">
          <div>
            <span className="text-lg font-semibold text-navy">R280</span>
            <span className="ml-2 text-sm text-navy/50">once-off visit</span>
          </div>
          <span className="text-xs font-medium uppercase tracking-wide text-navy/40">Select below</span>
        </div>
      </section>

      <div className="flex flex-col gap-3 border-t border-navy/10 py-24">
        <a href="#signup-form" className={CTA_BUTTON_CLASS}>
          Sign up now
        </a>
        <a href={ASK_QUESTION_LINK} className={SECONDARY_BUTTON_CLASS}>
          Ask a question
        </a>
      </div>

      {/* 10. Launch offer */}
      <section className="border-t border-navy/10 py-24">
        <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-skyblue">Launch offer</h2>
        <p className="mt-6 text-[17px] leading-relaxed text-navy">
          The first {LAUNCH_OFFER_SPOTS} customers get their second month free.
        </p>
        <p className="mt-2 text-sm text-navy/60">
          {spotsLeft === null
            ? "Checking spots..."
            : spotsLeft > 0
              ? `${spotsLeft} of ${LAUNCH_OFFER_SPOTS} spots left.`
              : `All ${LAUNCH_OFFER_SPOTS} spots are taken.`}
        </p>
      </section>

      {/* 11. Signup form */}
      <section id="signup-form" className="border-t border-navy/10 py-24">
        <form onSubmit={handleSubmit} className="flex flex-col gap-10" noValidate>
          <fieldset>
            <legend className="mb-5 text-sm font-bold uppercase tracking-[0.12em] text-skyblue">
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
            <legend className="mb-1 text-sm font-bold uppercase tracking-[0.12em] text-skyblue">
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
              <label htmlFor="block" className="text-sm font-medium text-navy/70">
                Block <span className="font-normal text-navy/40">(optional)</span>
              </label>
              <select
                id="block"
                value={block}
                onChange={(e) => setBlock(e.target.value)}
                className="h-14 border border-navy/15 bg-white px-4 text-base text-navy outline-none focus:border-skyblue"
              >
                <option value="">Not sure / no block</option>
                {[1, 2, 3, 4, 5, 6].map((b) => (
                  <option key={b} value={b}>
                    Block {b}
                  </option>
                ))}
              </select>
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

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              required
              checked={agreedToTerms}
              onChange={(e) => setAgreedToTerms(e.target.checked)}
              className="mt-0.5 h-4 w-4 flex-shrink-0 accent-skyblue"
            />
            <span className="text-sm leading-relaxed text-navy/70">
              I have read and agree to the{" "}
              <Link
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-navy underline underline-offset-2"
              >
                Terms and Conditions
              </Link>
              .
            </span>
          </label>

          {error && (
            <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}

          <div>
            <button
              type="submit"
              disabled={submitting || !agreedToTerms}
              className="h-14 w-full rounded-lg bg-cta text-base font-medium text-white transition hover:brightness-95 active:brightness-90 disabled:opacity-60"
            >
              {submitting ? "Redirecting to secure payment..." : "Continue to secure payment"}
            </button>
            <p className="mt-4 text-xs leading-relaxed text-navy/50">
              {PLANS[plan].recurring
                ? "You'll be redirected to PayFast to set up secure recurring billing. Cancel anytime."
                : "You'll be redirected to PayFast to pay securely for your visit."}
            </p>
          </div>
        </form>

        {/* Populated and submitted programmatically once /api/signup returns the signed PayFast fields. */}
        <form ref={formRef} method="POST" className="hidden" />
      </section>

      {/* 12. Footer */}
      <footer className="border-t border-navy/10 py-24">
        <p className="text-sm text-navy/60">
          WhatsApp{" "}
          <a href={WHATSAPP_LINK} className="text-navy underline underline-offset-2">
            {WHATSAPP_DISPLAY}
          </a>
        </p>
        <p className="mt-1 text-sm text-navy/60">{COMPANY_NAME}, Platinum Village, Rustenburg</p>
        <a href={ASK_QUESTION_LINK} className={`${SECONDARY_BUTTON_CLASS} mt-6`}>
          Ask a question
        </a>
      </footer>
    </main>
  );
}
