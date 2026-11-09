import { createHmac } from "node:crypto";

/**
 * Keyed hash for IP addresses and emails stored in rate-limit keys and
 * audit rows. Plain SHA-256 of an IPv4 address is brute-forceable; HMAC with
 * a server secret is not (D39).
 */
export function privacyHash(
  value: string,
  secret = process.env.PRIVACY_HASH_SECRET,
): string {
  if (!secret) throw new Error("PRIVACY_HASH_SECRET is not set");
  return createHmac("sha256", secret)
    .update(value.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
}
