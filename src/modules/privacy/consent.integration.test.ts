import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@intgetion/kit";
import { CONSENT_POLICY_VERSION } from "@intgetion/analytics/consent";
import { useTestPorts, users } from "../../test-support";
import { resetPrivacyContributorsForTests } from "./service/contributors";
import { runRetention } from "./service";
import { recordConsent, storedConsent } from "./service";

const userId = randomUUID();
const guestRecord = randomUUID();

beforeAll(async () => {
  useTestPorts();
  resetPrivacyContributorsForTests();
  await getDb()
    .insert(users)
    .values({
      id: userId,
      authUid: randomUUID(),
      termsAcceptedAt: new Date("2026-10-05T00:00:00Z"),
      termsVersion: "2026-10-03",
      locale: "en",
    });
});

afterAll(async () => {
  await getDb().execute(
    sql`delete from public.consent_records where user_id = ${userId} or id = ${guestRecord}`,
  );
  await getDb().delete(users).where(eq(users.id, userId));
});

const body = (choice: string, id = randomUUID()) => ({
  id,
  choice,
  version: CONSENT_POLICY_VERSION as typeof CONSENT_POLICY_VERSION,
  source: "banner" as const,
});

describe("consent journal (D220)", () => {
  it("journals a guest's choice with a hashed IP and no user", async () => {
    await recordConsent({
      body: body("preferences", guestRecord),
      userId: null,
      gpc: false,
      ip: "203.0.113.7",
    });
    const [row] = await getDb().execute<{
      user_id: string | null;
      choice: string;
      ip_hash: string;
    }>(
      sql`select user_id, choice, ip_hash from public.consent_records where id = ${guestRecord}`,
    );
    expect(row?.user_id).toBeNull();
    expect(row?.choice).toBe("preferences");
    expect(row?.ip_hash).not.toContain("203.0.113.7");
  });

  it("ignores a repeated record id", async () => {
    await recordConsent({
      body: body("all", guestRecord),
      userId: null,
      gpc: false,
      ip: "203.0.113.7",
    });
    const [row] = await getDb().execute<{ choice: string }>(
      sql`select choice from public.consent_records where id = ${guestRecord}`,
    );
    expect(row?.choice).toBe("preferences");
  });

  it("gives a signed-in user's latest choice to a new device", async () => {
    expect(await storedConsent(userId)).toBeNull();
    await recordConsent({
      body: body("all"),
      userId,
      gpc: false,
      ip: "203.0.113.8",
    });
    await recordConsent({
      body: { ...body("necessary"), source: "settings" },
      userId,
      gpc: false,
      ip: "203.0.113.8",
    });
    expect(await storedConsent(userId)).toEqual({
      preferences: false,
      analytics: false,
    });
  });

  it("stores analytics off when the browser sends GPC", async () => {
    const consent = await recordConsent({
      body: body("all"),
      userId,
      gpc: true,
      ip: "203.0.113.8",
    });
    expect(consent).toEqual({ preferences: true, analytics: false });
    expect(await storedConsent(userId)).toEqual(consent);
  });

  it("purges records older than three years", async () => {
    const old = randomUUID();
    await getDb().execute(sql`
      insert into public.consent_records (id, user_id, choice, policy_version, source, created_at)
      values (${old}, ${userId}, 'all', 'old', 'banner', now() - interval '1100 days')
    `);
    await runRetention();
    const found = await getDb().execute(
      sql`select 1 from public.consent_records where id = ${old}`,
    );
    expect(found).toHaveLength(0);
  });
});
