import crypto from "node:crypto";
import dns from "node:dns/promises";
import type { Plan } from "./plans";

/**
 * PayFast integration, ported from the official PHP SDK (github.com/Payfast/payfast-php-sdk)
 * since PayFast's interactive docs site doesn't expose static content.
 *
 * Field order for the signature is NOT alphabetical and NOT "whatever order you post
 * fields in" for PayFast's own validation of the checkout form the way you might think -
 * their SDK relies on the caller building the data object in the documented order.
 * CHECKOUT_FIELD_ORDER below mirrors that canonical order exactly. For ITN, we sign over
 * whatever order PayFast actually posted (which is stable and documented).
 */

export interface PayFastConfig {
  merchantId: string;
  merchantKey: string;
  passphrase: string;
  testMode: boolean;
  baseUrl: string;
}

export function getPayFastConfig(): PayFastConfig {
  // .trim() defensively strips stray whitespace/newlines that sneak in when env vars are
  // copy-pasted into a dashboard - a bare newline in merchant_id would silently corrupt
  // every signature.
  const merchantId = process.env.PAYFAST_MERCHANT_ID?.trim();
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY?.trim();
  const passphrase = process.env.PAYFAST_PASSPHRASE?.trim();
  const testMode = (process.env.PAYFAST_MODE?.trim() ?? "sandbox") !== "live";

  if (!merchantId || !merchantKey || !passphrase) {
    throw new Error(
      "Missing PayFast configuration - set PAYFAST_MERCHANT_ID, PAYFAST_MERCHANT_KEY, PAYFAST_PASSPHRASE"
    );
  }

  return {
    merchantId,
    merchantKey,
    passphrase,
    testMode,
    baseUrl: testMode ? "https://sandbox.payfast.co.za" : "https://www.payfast.co.za",
  };
}

/** Matches PHP's urlencode(): space -> '+', and RFC1738 percent-encoding (stricter than encodeURIComponent). */
export function phpUrlEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/[!'()~*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** For the outgoing checkout form: PayFast's SDK drops empty fields (PHP !empty() check). */
function paramStringFromEntries(entries: [string, string][]): string {
  return entries
    .filter(([key, value]) => key !== "signature" && value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${phpUrlEncode(String(value))}`)
    .join("&");
}

/**
 * For incoming ITN payloads: PayFast includes empty optional fields (e.g. custom_str2=)
 * in the signature it computed, so only the signature field itself is excluded here -
 * dropping empty values (like the outgoing builder does) breaks the signature match.
 */
function paramStringFromItnEntries(entries: [string, string][]): string {
  return entries
    .filter(([key, value]) => key !== "signature" && value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${phpUrlEncode(String(value))}`)
    .join("&");
}

function md5(input: string): string {
  return crypto.createHash("md5").update(input, "utf8").digest("hex");
}

/** Canonical field order PayFast documents for the checkout / custom-integration form. */
const CHECKOUT_FIELD_ORDER = [
  "merchant_id",
  "merchant_key",
  "return_url",
  "cancel_url",
  "notify_url",
  "name_first",
  "name_last",
  "cell_number",
  "m_payment_id",
  "amount",
  "item_name",
  "item_description",
  "custom_str1",
  "subscription_type",
  "recurring_amount",
  "frequency",
  "cycles",
] as const;

export interface CheckoutInput {
  signupId: string;
  fullName: string;
  whatsappNumber: string;
  plan: Plan;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
}

export interface CheckoutResult {
  actionUrl: string;
  fields: Record<string, string>;
}

function splitName(fullName: string): { first: string; last: string } {
  const trimmed = fullName.trim().replace(/\s+/g, " ");
  const idx = trimmed.indexOf(" ");
  if (idx === -1) return { first: trimmed, last: "" };
  return { first: trimmed.slice(0, idx), last: trimmed.slice(idx + 1) };
}

/** Builds the signed hidden-form fields for a PayFast recurring-subscription checkout. */
export function buildCheckoutFields(input: CheckoutInput): CheckoutResult {
  const config = getPayFastConfig();
  const { first, last } = splitName(input.fullName);

  const values: Record<(typeof CHECKOUT_FIELD_ORDER)[number], string> = {
    merchant_id: config.merchantId,
    merchant_key: config.merchantKey,
    return_url: input.returnUrl,
    cancel_url: input.cancelUrl,
    notify_url: input.notifyUrl,
    name_first: first,
    name_last: last,
    cell_number: input.whatsappNumber,
    m_payment_id: input.signupId,
    amount: input.plan.amount.toFixed(2),
    item_name: input.plan.itemName,
    item_description: input.plan.itemDescription,
    custom_str1: input.signupId,
    subscription_type: "1",
    recurring_amount: input.plan.amount.toFixed(2),
    frequency: String(input.plan.frequency),
    cycles: "0",
  };

  const entries = CHECKOUT_FIELD_ORDER.map((key) => [key, values[key]] as [string, string]);
  const paramString = paramStringFromEntries(entries);
  const signature = md5(`${paramString}&passphrase=${phpUrlEncode(config.passphrase)}`);

  const fields: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (value !== undefined && value !== null && value !== "") fields[key] = value;
  }
  fields.signature = signature;

  return { actionUrl: `${config.baseUrl}/eng/process`, fields };
}

export interface ItnResult {
  valid: boolean;
  reasons: string[];
  data: Record<string, string>;
}

const VALID_PAYFAST_HOSTS = [
  "www.payfast.co.za",
  "sandbox.payfast.co.za",
  "w1w.payfast.co.za",
  "w2w.payfast.co.za",
];

async function sourceIpLooksValid(sourceIp: string | null): Promise<boolean | "unknown"> {
  if (!sourceIp) return "unknown";
  try {
    const resolved = await Promise.all(
      VALID_PAYFAST_HOSTS.map((host) => dns.resolve4(host).catch(() => [] as string[]))
    );
    const validIps = new Set(resolved.flat());
    if (validIps.size === 0) return "unknown";
    return validIps.has(sourceIp);
  } catch {
    return "unknown";
  }
}

async function confirmWithPayFastServer(paramString: string, baseUrl: string): Promise<boolean> {
  const response = await fetch(`${baseUrl}/eng/query/validate`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: paramString,
  });
  const body = (await response.text()).trim();
  return body === "VALID";
}

/**
 * Verifies a PayFast ITN (notify_url) POST. Reproduces the 4 checks from the official SDK's
 * Notification::isValidNotification, with one deliberate deviation: source-IP/host validation
 * is logged but non-fatal (DNS-based allowlists are known to be brittle behind proxies/CDNs).
 * The two checks that actually gate activation are the signature match and PayFast's own
 * server-side "VALID" confirmation - the latter is the authoritative check.
 */
export async function verifyItn(
  rawBody: string,
  sourceIp: string | null,
  expected: { amount: number }
): Promise<ItnResult> {
  const config = getPayFastConfig();
  const reasons: string[] = [];

  const entries = Array.from(new URLSearchParams(rawBody).entries());
  const data: Record<string, string> = {};
  for (const [key, value] of entries) data[key] = value;

  const paramString = paramStringFromItnEntries(entries);

  const submittedSignature = data.signature ?? "";
  const computedSignature = md5(`${paramString}&passphrase=${phpUrlEncode(config.passphrase)}`);
  const signatureValid = submittedSignature.toLowerCase() === computedSignature.toLowerCase();
  if (!signatureValid) reasons.push("signature mismatch");

  const hostCheck = await sourceIpLooksValid(sourceIp);
  if (hostCheck === false) reasons.push(`source ip ${sourceIp} not a recognised PayFast host (logged, non-fatal)`);

  if (data.merchant_id !== config.merchantId) reasons.push("merchant_id mismatch");

  const amountGross = Number.parseFloat(data.amount_gross ?? "");
  if (!Number.isFinite(amountGross) || Math.abs(amountGross - expected.amount) > 0.01) {
    reasons.push(`amount_gross mismatch (got ${data.amount_gross}, expected ${expected.amount.toFixed(2)})`);
  }

  let serverConfirmed = false;
  try {
    serverConfirmed = await confirmWithPayFastServer(paramString, config.baseUrl);
    if (!serverConfirmed) reasons.push("PayFast server confirmation did not return VALID");
  } catch (err) {
    reasons.push(`PayFast server confirmation request failed: ${(err as Error).message}`);
  }

  const fatalReasons = reasons.filter((r) => !r.includes("(logged, non-fatal)"));

  return { valid: fatalReasons.length === 0, reasons, data };
}
