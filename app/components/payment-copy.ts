/**
 * Payment trust wording, verbatim. Kept in a plain module (not a client component) so server components like
 * the footer can use the strings too. The Payfast statements are for CARD payments only - cash and EFT are
 * handled by OGP Services directly, so nothing here may imply Payfast covers them.
 */
export const PAYFAST_CARD_STATEMENT =
  "Card payments are processed by Payfast. OGP Services never sees or stores your card details.";
export const PAYFAST_FOOTER_LINE = "Card payments processed securely by Payfast.";
