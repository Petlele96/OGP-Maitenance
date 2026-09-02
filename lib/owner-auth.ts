import crypto from "node:crypto";
import type { NextRequest } from "next/server";

/** Mirrors lib/ops-auth.ts but with its own password/cookie so the two logins are fully independent. */
export const OWNER_COOKIE_NAME = "owner_session";
const SESSION_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function getSecret(): string {
  const password = process.env.OWNER_PASSWORD?.trim();
  if (!password) throw new Error("Missing OWNER_PASSWORD");
  return crypto.createHash("sha256").update(`${password}:owner-session`).digest("hex");
}

function hmac(value: string): string {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("hex");
}

export function checkPassword(candidate: string): boolean {
  const password = process.env.OWNER_PASSWORD?.trim();
  if (!password) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(password);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

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

export function isAuthorized(req: NextRequest): boolean {
  return isValidSessionToken(req.cookies.get(OWNER_COOKIE_NAME)?.value);
}
