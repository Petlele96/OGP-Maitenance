/**
 * Payment trust wording, verbatim. Kept in a plain module (not a client component) so server components like
 * the footer can use the strings too. The Payfast statements are for CARD payments only - cash and EFT are
 * handled by OGP Services directly, so nothing here may imply Payfast covers them.
 */
export const PAYFAST_CARD_STATEMENT =
  "Card payments are processed by Payfast, a South African payment gateway. OGP Services never sees or stores your card details.";
export const PAY_LATER_STATEMENT = "Prefer not to use a card? Choose book now, pay on your service day.";
export const PAYFAST_FOOTER_LINE = "Card payments processed securely by Payfast.";
