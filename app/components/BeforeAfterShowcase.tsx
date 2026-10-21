"use client";

import { useRef, useState } from "react";
import { SHOWCASE } from "@/lib/showcase";
import { BeforeAfterSlider } from "./BeforeAfterSlider";

// With JS off, swap the interactive slider for the two images side by side.
const NO_JS_CSS = "[data-ba=js]{display:none!important}[data-ba=static]{display:grid!important}";

export function BeforeAfterShowcase() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  if (SHOWCASE.length === 0) return null;

  // Distance between slide starts (slide width + gap).
  function pitch(el: HTMLDivElement): number {
    const first = el.children[0] as HTMLElement;
    const second = el.children[1] as HTMLElement | undefined;
    return second ? second.offsetLeft - first.offsetLeft : el.clientWidth;
  }

  function handleScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    setActive(Math.min(SHOWCASE.length - 1, Math.max(0, Math.round(el.scrollLeft / pitch(el)))));
  }

  function goTo(index: number) {
    const el = scrollerRef.current;
    if (!el) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: index * pitch(el), behavior: reduceMotion ? "auto" : "smooth" });
  }

  return (
    <section className="border-t border-navy/10 py-24" aria-labelledby="showcase-heading">
      <noscript>
        <style>{NO_JS_CSS}</style>
      </noscript>
      <h2 id="showcase-heading" className="text-sm font-bold uppercase tracking-[0.12em] text-skyblue">
        Before &amp; after
      </h2>
      <p className="mt-4 text-[17px] leading-relaxed text-navy/70">
        Real Platinum Village yards.<span data-ba="js"> Drag the handle to compare.</span>
      </p>

      <div className="mt-8" role="region" aria-roledescription="carousel" aria-label="Before and after photos">
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          className="relative flex snap-x snap-mandatory gap-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {SHOWCASE.map((pair, i) => (
            <div
              key={pair.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${SHOWCASE.length}`}
              className="w-full shrink-0 snap-center"
            >
              <BeforeAfterSlider pair={pair} />
            </div>
          ))}
        </div>

        {SHOWCASE.length > 1 && (
          <div data-ba="js" className="mt-5 flex justify-center">
            {SHOWCASE.map((pair, i) => (
              <button
                key={pair.id}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Show pair ${i + 1} of ${SHOWCASE.length}`}
                aria-current={i === active}
                className="flex h-6 w-6 items-center justify-center"
              >
                <span className={`h-2 w-2 rounded-full transition-colors ${i === active ? "bg-navy" : "bg-navy/25"}`} />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
