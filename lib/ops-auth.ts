import crypto from "node:crypto";
import type { NextRequest } from "next/server";

export const OPS_COOKIE_NAME = "ops_session";
const SESSION_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/** Derives the HMAC key from the shared password - no separate secret to configure. */
function getSecret(): string {
  const password = process.env.OPERATIONS_PASSWORD?.trim();
  if (!password) throw new Error("Missing OPERATIONS_PASSWORD");
  return crypto.createHash("sha256").update(`${password}:ops-session`).digest("hex");
}

function hmac(value: string): string {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("hex");
}

export function checkPassword(candidate: string): boolean {
  const password = process.env.OPERATIONS_PASSWORD?.trim();
  if (!password) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(password);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Signed cookie value: "<expiresAtMs>.<hmac>". Stateless - no session table needed. */
export function createSessionToken(): string {
  const expiresAt = String(Date.now() + SESSION_LIFETIME_MS);
  return `${expiresAt}.${hmac(expiresAt)}`;
}

export function isValidSessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const [expiresAt, signature] = token.split(".");
  if (!expiresAt || !signature) return false;
  if (Date.now() > Number(expiresAt)) return false;

  const expected = hmac(expiresAt);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Checked at the top of every /api/ops/* route (except login) - not in Next.js
 * middleware, since middleware runs on the Edge runtime by default in this Next
 * version and doesn't reliably support node:crypto. Route handlers here already
 * run on the Node runtime (see `export const runtime = "nodejs"` in each route).
 */
export function isAuthorized(req: NextRequest): boolean {
  return isValidSessionToken(req.cookies.get(OPS_COOKIE_NAME)?.value);
}
