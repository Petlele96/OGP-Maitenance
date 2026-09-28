"use client";

import { useEffect, useState } from "react";
import { SiteFooter } from "../../components/SiteFooter";

interface TrackingData {
  fullName: string;
  houseNumber: string;
  planLabel: string;
  nextServiceDate: string | null;
  visitDates: string[];
  whatsappLink: string;
}

type Status = "loading" | "ready" | "error";

const POLL_MS = 15000;

function formatDate(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export default function TrackingPage({ params }: { params: { token: string } }) {
  const [status, setStatus] = useState<Status>("loading");
  const [data, setData] = useState<TrackingData | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/track/${params.token}`, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          setStatus("error");
          return;
        }
        setData(await res.json());
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    load();
    // Polls silently so a moved or completed visit shows up without the customer needing
    // to reload - no visible loading state on subsequent ticks, only the first load.
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [params.token]);

  return (
    <>
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 py-14 text-navy">
        {status === "loading" && <p className="text-center text-sm text-navy/60">Loading...</p>}

        {status === "error" && (
          <>
            <h1 className="text-xl font-bold text-navy">We couldn't find that link</h1>
            <p className="mt-2 text-sm text-navy/70">
              If you think this is a mistake, message us on WhatsApp and we'll help.
            </p>
          </>
        )}

        {status === "ready" && data && (
          <>
            <p className="text-sm text-navy/60">House {data.houseNumber}</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-navy">{data.fullName}</h1>
            <p className="mt-1 text-sm font-medium text-skyblue">{data.planLabel}</p>

            <div className="mt-8 rounded-2xl bg-cream p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-navy/50">Next service day</p>
              <p className="mt-1 text-lg font-bold text-navy">
                {data.nextServiceDate ? formatDate(data.nextServiceDate) : "We'll confirm on WhatsApp"}
              </p>
            </div>

            <div className="mt-8">
              <h2 className="text-sm font-semibold text-navy">Visit history</h2>
              {data.visitDates.length === 0 ? (
                <p className="mt-2 text-sm text-navy/60">No visits completed yet.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {data.visitDates.map((date) => (
                    <li key={date} className="text-sm text-navy/80">
                      {formatDate(date)}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <a
              href={data.whatsappLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-10 rounded-xl bg-cta px-5 py-3 text-center text-sm font-semibold text-white"
            >
              Contact us on WhatsApp
            </a>
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
