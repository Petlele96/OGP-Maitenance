"use client";

import Image from "next/image";
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { ShowcasePair } from "@/lib/showcase";

// Every showcase image is 3:4 portrait - the fixed ratio is what prevents layout shift.
const IMG_WIDTH = 900;
const IMG_HEIGHT = 1200;
// Content column is max-w-lg (512px) minus 24px padding each side.
const IMG_SIZES = "(min-width: 512px) 464px, calc(100vw - 48px)";
const START = 50;
const STEP = 5;

const LABEL_CLASS =
  "absolute top-3 rounded bg-navy/85 px-2 py-1 text-[11px] font-bold tracking-[0.12em] text-white";
const IMG_CLASS = "absolute inset-0 h-full w-full object-cover";

export function BeforeAfterSlider({ pair }: { pair: ShowcasePair }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const afterRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const pos = useRef(START);
  const dragging = useRef(false);
  const grabOffset = useRef(0);

  // Updates the DOM directly so dragging doesn't re-render on every pointer move.
  function apply(next: number) {
    const v = Math.min(100, Math.max(0, next));
    pos.current = v;
    if (afterRef.current) afterRef.current.style.clipPath = `inset(0 0 0 ${v}%)`;
    const handle = handleRef.current;
    if (!handle) return;
    handle.style.left = `${v}%`;
    const n = Math.round(v);
    handle.setAttribute("aria-valuenow", String(n));
    handle.setAttribute("aria-valuetext", `${n}% before, ${100 - n}% after`);
  }

  function moveTo(clientX: number) {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    apply(((clientX - grabOffset.current - rect.left) / rect.width) * 100);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    const onHandle = handleRef.current?.contains(e.target as Node) ?? false;
    // Touch only grabs the handle, so the rest of the photo still swipes the carousel.
    if (e.pointerType !== "mouse" && !onHandle) return;
    const rect = e.currentTarget.getBoundingClientRect();
    dragging.current = true;
    grabOffset.current = onHandle ? e.clientX - (rect.left + (rect.width * pos.current) / 100) : 0;
    e.currentTarget.setPointerCapture(e.pointerId);
    moveTo(e.clientX);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (dragging.current) moveTo(e.clientX);
  }

  function endDrag(e: PointerEvent<HTMLDivElement>) {
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const deltas: Record<string, number> = {
      ArrowLeft: -STEP,
      ArrowDown: -STEP,
      ArrowRight: STEP,
      ArrowUp: STEP,
      PageDown: -STEP * 2,
      PageUp: STEP * 2,
    };
    if (e.key === "Home") apply(0);
    else if (e.key === "End") apply(100);
    else if (e.key in deltas) apply(pos.current + deltas[e.key]);
    else return;
    e.preventDefault();
  }

  return (
    <figure className="m-0">
      <div data-ba="js">
        <div
          ref={rootRef}
          className="relative aspect-[3/4] w-full select-none overflow-hidden rounded-lg bg-navy/5"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <Image
            src={pair.beforeSrc}
            alt={`${pair.alt} (before)`}
            width={IMG_WIDTH}
            height={IMG_HEIGHT}
            sizes={IMG_SIZES}
            draggable={false}
            className={IMG_CLASS}
          />
          <span className={`${LABEL_CLASS} left-3`}>BEFORE</span>

          <div ref={afterRef} className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${START}%)` }}>
            <Image
              src={pair.afterSrc}
              alt={`${pair.alt} (after)`}
              width={IMG_WIDTH}
              height={IMG_HEIGHT}
              sizes={IMG_SIZES}
              draggable={false}
              className={IMG_CLASS}
            />
            <span className={`${LABEL_CLASS} right-3`}>AFTER</span>
          </div>

          <div
            ref={handleRef}
            role="slider"
            tabIndex={0}
            aria-label="Drag to compare before and after"
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={START}
            aria-valuetext={`${START}% before, ${100 - START}% after`}
            onKeyDown={onKeyDown}
            className="group absolute inset-y-0 z-10 w-12 -translate-x-1/2 cursor-ew-resize touch-pan-y outline-none"
            style={{ left: `${START}%` }}
          >
            <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_4px_rgba(0,0,0,0.5)]" />
            <span className="absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-navy shadow-md group-focus-visible:ring-4 group-focus-visible:ring-cta">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M7 5 2 10l5 5M13 5l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        </div>
      </div>

      {/* No-JS fallback: hidden by default, revealed by the <noscript> rule in BeforeAfterShowcase. */}
      <div data-ba="static" className="hidden grid-cols-2 gap-2">
        <div className="relative aspect-[3/4] overflow-hidden rounded-lg">
          <Image
            src={pair.beforeSrc}
            alt={`${pair.alt} (before)`}
            width={IMG_WIDTH}
            height={IMG_HEIGHT}
            sizes="(min-width: 512px) 228px, calc(50vw - 28px)"
            className={IMG_CLASS}
          />
          <span className={`${LABEL_CLASS} left-2`}>BEFORE</span>
        </div>
        <div className="relative aspect-[3/4] overflow-hidden rounded-lg">
          <Image
            src={pair.afterSrc}
            alt={`${pair.alt} (after)`}
            width={IMG_WIDTH}
            height={IMG_HEIGHT}
            sizes="(min-width: 512px) 228px, calc(50vw - 28px)"
            className={IMG_CLASS}
          />
          <span className={`${LABEL_CLASS} left-2`}>AFTER</span>
        </div>
      </div>

      <figcaption className="mt-3 text-sm text-navy/60">{pair.caption}</figcaption>
    </figure>
  );
}
