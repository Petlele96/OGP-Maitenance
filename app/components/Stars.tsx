/** Read-only star rating, with the value spoken as text for screen readers. */
export function Stars({ rating, className = "" }: { rating: number; className?: string }) {
  return (
    <span role="img" aria-label={`${rating} out of 5 stars`} className={`tracking-wide text-amber-500 ${className}`}>
      {"★".repeat(rating)}
      <span className="opacity-25">{"★".repeat(5 - rating)}</span>
    </span>
  );
}
