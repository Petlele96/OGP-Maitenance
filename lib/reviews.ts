/** Client-safe review constants and helpers (no DB access). */

export const REVIEW_NAME_MAX = 60;
export const REVIEW_COMMENT_MAX = 500;

export const REVIEW_REPLY_MAX = 500;

/** Per-IP limits on the public form - generous enough for a shared mobile-network address, tight enough to stop spam. */
export const REVIEW_MAX_PER_HOUR = 5;
export const REVIEW_MAX_PER_DAY = 15;

/** "Thabo, Phase 3" - the only identifying detail ever shown publicly. No surname, no phone, no house number. */
export function reviewerLabel(firstName: string, phase: number | null): string {
  return phase === null ? firstName : `${firstName}, Phase ${phase}`;
}
