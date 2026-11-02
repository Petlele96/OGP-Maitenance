import type { Metadata } from "next";
import type { ReactNode } from "react";

// A private link sent to one customer - keep it out of search results.
export const metadata: Metadata = {
  title: "Leave a review - OGP Services",
  robots: { index: false, follow: false },
};

export default function ReviewLayout({ children }: { children: ReactNode }) {
  return children;
}
