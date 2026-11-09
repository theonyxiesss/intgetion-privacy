import {
  CONSENT_POLICY_VERSION,
  applyGpc,
  parseChoice,
  serializeChoice,
  type Consent,
} from "@intgetion/analytics/consent";
import { privacyHash } from "../../../lib/privacy-hash";
import * as repo from "../repo/privacy-repo";
import type { ConsentInput } from "../schemas";

/**
 * Journals a cookie choice (D220): the categories, the policy version, the
 * GPC signal and a hashed IP — enough to prove consent, nothing to profile.
 * For a signed-in user the choice also becomes the starting point on any
 * new device. GPC turns analytics off in the stored record too.
 */
export async function recordConsent(input: {
  body: ConsentInput;
  userId: string | null;
  gpc: boolean;
  ip: string;
}): Promise<Consent> {
  const consent = applyGpc(parseChoice(input.body.choice)!, input.gpc);
  await repo.insertConsentRecord({
    id: input.body.id,
    userId: input.userId,
    choice: serializeChoice(consent),
    version: input.body.version,
    gpc: input.gpc,
    source: input.body.source,
    ipHash: privacyHash(input.ip),
  });
  return consent;
}

/** A signed-in user's last choice, if it was made under the current policy. */
export async function storedConsent(userId: string): Promise<Consent | null> {
  return parseChoice(
    await repo.readStoredConsent(userId, CONSENT_POLICY_VERSION),
  );
}
