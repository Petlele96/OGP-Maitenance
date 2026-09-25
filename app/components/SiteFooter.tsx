import Link from "next/link";
import { WHATSAPP_DISPLAY, WHATSAPP_LINK, REPORT_PROBLEM_LINK, COMPANY_NAME, COMPANY_REG } from "@/lib/site";

/**
 * Shared across every public-facing page (signup, terms, thank-you, cancelled, pay) - not
 * /ops or /owner, which are password-gated internal tools with their own brand-* palette
 * and no audience for company-credibility copy or client logos.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-navy/10 bg-cream px-6 py-16 text-navy">
      <div className="mx-auto max-w-lg">
        <p className="text-sm leading-relaxed text-navy/80">
          <span className="font-semibold text-navy">{COMPANY_NAME}</span> — a registered construction, cleaning and
          grounds maintenance company operating in Rustenburg since 2019. Reg {COMPANY_REG}.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-navy/80">
          Grounds and landscaping work completed for Sibanye-Stillwater and the Royal Bafokeng Administration.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-navy/80">
          Yard maintenance is run from inside Platinum Village by the company director, a resident of the complex.
        </p>

        {/* Reserved for two client logos - left deliberately empty (no box/border) until they're added. */}
        <div className="mt-8 flex gap-8" aria-hidden="true">
          <div className="h-10 w-28" />
          <div className="h-10 w-28" />
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-navy/10 pt-6 text-sm">
          <a href={WHATSAPP_LINK} className="text-navy underline underline-offset-2">
            WhatsApp {WHATSAPP_DISPLAY}
          </a>
          <Link href="/terms" className="text-navy underline underline-offset-2">
            Terms and Conditions
          </Link>
          <a
            href={REPORT_PROBLEM_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="text-navy underline underline-offset-2"
          >
            Report a problem
          </a>
        </div>
      </div>
    </footer>
  );
}
