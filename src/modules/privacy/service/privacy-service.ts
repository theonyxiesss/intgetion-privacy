import { getDb, HttpError, logger, notFound } from "@intgetion/kit";
import { privacyPorts } from "../../../ports";
import * as repo from "../repo/privacy-repo";
import { privacyContributors } from "./contributors";

/** Version of the export format; bump when fields change (D165). */
export const EXPORT_VERSION = 1;

/** Days during which retention retries a failed login delete and remote slices. */
export const AUTH_DELETE_RETRY_DAYS = 7;

export type PrivacyUser = { id: string; authUid: string };

/** Adds counts from several slices; a repeated key is summed. */
function mergeCounts(target: Record<string, number>, add: Record<string, number> | void) {
  for (const [key, value] of Object.entries(add ?? {})) target[key] = (target[key] ?? 0) + value;
}

/**
 * `GET /api/me/export` (section 17): every row the platform stores about the
 * caller as one JSON document, each module adding its own keys. The login
 * email comes from the auth module.
 */
export async function exportMyData(user: PrivacyUser, now = new Date()) {
  const ports = privacyPorts();
  await ports.rateLimit("dataExport", user.id, now);
  const parts = await Promise.all(
    privacyContributors()
      .filter((c) => c.exportFor)
      .map((c) => c.exportFor!(user.id)),
  );
  const [email, cookieConsents] = await Promise.all([
    ports.account.loginEmail(user.authUid),
    repo.readConsentRecords(user.id),
  ]);
  await ports.audit({
    actorId: user.id,
    action: "user.data_exported",
    entityType: "user",
    entityId: user.id,
    diff: { version: EXPORT_VERSION },
  });
  return {
    exportVersion: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    email,
    ...Object.assign({}, ...parts),
    cookieConsents,
  };
}

/** The remote slices of a deleted account; each failure is logged and retried. */
async function anonymizeRemote(userId: string, now: Date): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const c of privacyContributors().filter((c) => c.mode === "remote" && c.anonymize)) {
    try {
      mergeCounts(counts, await c.anonymize!(userId, { now, tx: undefined }));
    } catch (error) {
      logger.warn({ err: error, contributor: c.name }, "privacy: remote deletion failed; retention retries it");
    }
  }
  return counts;
}

/**
 * `DELETE /api/me` `{ confirm: "DELETE" }` (D28, P13). Soft delete with
 * immediate anonymisation: the account row and every in-process slice in one
 * transaction, then the remote slices, then the login is removed; retention
 * retries what failed (D166). Admins cannot delete themselves.
 */
export async function deleteMyAccount(user: PrivacyUser, ip: string | null, now = new Date()) {
  const ports = privacyPorts();
  const row = await ports.account.find(user.id);
  if (!row || row.status === "deleted") throw notFound();
  if (row.platformRole === "admin") {
    throw new HttpError(422, "ADMIN_PROTECTED", "An admin account cannot delete itself");
  }
  const counts = await getDb().transaction(async (tx) => {
    if (!(await ports.account.markDeleted(user.id, now, tx))) return null;
    const inTx: Record<string, number> = {};
    for (const c of privacyContributors().filter((c) => c.mode === "in-process" && c.anonymize)) {
      mergeCounts(inTx, await c.anonymize!(user.id, { now, tx }));
    }
    return inTx;
  });
  if (!counts) throw notFound();
  mergeCounts(counts, await anonymizeRemote(user.id, now));
  const auth = await ports.account.deleteLogin(row.authUid);
  await ports.audit({
    actorId: null,
    action: "user.deleted",
    entityType: "user",
    entityId: user.id,
    diff: { ...counts, authUser: auth },
    ip,
  });
  return { deleted: true as const, authUser: auth };
}

/**
 * Hourly retention (section 17; hourly since D471 for the chat). Every slice
 * purges its own rows; recently deleted accounts get the remote slices and
 * the login delete again until they succeed.
 */
export async function runRetention(
  now = new Date(),
): Promise<Record<string, number> & { authRetried: number }> {
  const ports = privacyPorts();
  const counts: Record<string, number> = {};
  for (const c of privacyContributors().filter((c) => c.purge)) {
    try {
      mergeCounts(counts, await c.purge!(now));
    } catch (error) {
      logger.error({ err: error, contributor: c.name }, "privacy: retention slice failed");
    }
  }
  counts.consentRecords = await repo.purgeConsentRecords(now);
  const since = new Date(now.getTime() - AUTH_DELETE_RETRY_DAYS * 24 * 60 * 60 * 1000);
  let authRetried = 0;
  for (const { userId, authUid } of await ports.account.recentlyDeleted(since)) {
    await anonymizeRemote(userId, now);
    const result = await ports.account.deleteLogin(authUid);
    if (result === "deleted") authRetried += 1;
    if (result === "failed") logger.warn("retention: auth user delete still failing");
  }
  return { ...counts, authRetried };
}
