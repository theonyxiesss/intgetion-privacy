import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@intgetion/kit";
import { useTestPorts } from "../../test-support";
import { resetPrivacyContributorsForTests } from "./service/contributors";
import {
  deleteMyAccount,
  exportMyData,
  registerPrivacyContributors,
  runRetention,
  type DeletionContext,
} from "./service";

type Tx = { execute: ReturnType<typeof getDb>["execute"] };

const alice = { id: randomUUID(), authUid: randomUUID() };
const bob = { id: randomUUID(), authUid: randomUUID() };
const admin = { id: randomUUID(), authUid: randomUUID() };
let world = useTestPorts();
let remoteCalls: string[] = [];
let remoteFails = false;
let failInTx = false;

/** One module's slice on its own table, inside the deletion transaction. */
const notesSlice = {
  name: "notes",
  mode: "in-process" as const,
  exportFor: async (userId: string) => ({
    notes: await getDb().execute(sql`select body from public.privacy_test_notes where user_id = ${userId} order by body`),
  }),
  anonymize: async (userId: string, ctx: DeletionContext) => {
    if (failInTx) throw new Error("slice refused");
    const gone = await (ctx.tx as Tx).execute(
      sql`delete from public.privacy_test_notes where user_id = ${userId} returning 1`,
    );
    return { notes: (gone as unknown as unknown[]).length };
  },
  purge: async () => ({ oldNotes: 2 }),
};

/** A slice in another service: called after the commit, retried by retention. */
const remoteSlice = {
  name: "remote",
  mode: "remote" as const,
  exportFor: async () => ({ remoteThings: ["kept elsewhere"] }),
  anonymize: async (userId: string) => {
    remoteCalls.push(userId);
    if (remoteFails) throw new Error("remote down");
    return { remoteRows: 1 };
  },
  purge: async () => ({ oldNotes: 1 }),
};

beforeAll(async () => {
  const db = getDb();
  for (const [u, role] of [
    [alice, "user"],
    [bob, "user"],
    [admin, "admin"],
  ] as const) {
    await db.execute(sql`insert into public.users (id, auth_uid, platform_role) values (${u.id}, ${u.authUid}, ${role})`);
    await db.execute(sql`insert into public.privacy_test_notes (user_id, body) values (${u.id}, 'a'), (${u.id}, 'b')`);
  }
  resetPrivacyContributorsForTests();
  registerPrivacyContributors([notesSlice, remoteSlice]);
});

beforeEach(() => {
  world = useTestPorts();
  remoteCalls = [];
  remoteFails = false;
  failInTx = false;
});

afterAll(async () => {
  for (const u of [alice, bob, admin]) {
    await getDb().execute(sql`delete from public.users where id = ${u.id}`);
  }
});

const status = async (id: string) =>
  (await getDb().execute<{ status: string }>(sql`select status from public.users where id = ${id}`))[0]?.status;
const noteCount = async (id: string) =>
  (await getDb().execute<{ n: number }>(sql`select count(*)::int as n from public.privacy_test_notes where user_id = ${id}`))[0]?.n;

describe("data export (section 17)", () => {
  it("joins every slice with the login email and the cookie choices, rate limited and audited", async () => {
    const data = await exportMyData(alice, new Date());
    expect(data).toMatchObject({
      exportVersion: 1,
      email: `${alice.authUid.slice(0, 8)}@login.test`,
      notes: [{ body: "a" }, { body: "b" }],
      remoteThings: ["kept elsewhere"],
      cookieConsents: [],
    });
    expect(world.rateHits).toEqual([`dataExport:${alice.id}`]);
    expect(world.audit.map((a) => a.action)).toEqual(["user.data_exported"]);
  });
});

describe("account deletion (D28)", () => {
  it("keeps everything when an in-process slice fails: one transaction", async () => {
    failInTx = true;
    await expect(deleteMyAccount(bob, "ip")).rejects.toThrow("slice refused");
    expect(await status(bob.id)).toBe("active");
    expect(await noteCount(bob.id)).toBe(2);
    expect(remoteCalls).toEqual([]);
  });

  it("refuses an admin", async () => {
    await expect(deleteMyAccount(admin, "ip")).rejects.toMatchObject({ status: 422, code: "ADMIN_PROTECTED" });
    expect(await status(admin.id)).toBe("active");
  });

  it("deletes the account and every slice, then the login, and audits the counts", async () => {
    const result = await deleteMyAccount(alice, "ip");
    expect(result).toEqual({ deleted: true, authUser: "deleted" });
    expect(await status(alice.id)).toBe("deleted");
    expect(await noteCount(alice.id)).toBe(0);
    expect(remoteCalls).toEqual([alice.id]);
    expect(world.loginDeletes).toEqual([alice.authUid]);
    expect(world.audit[0]).toMatchObject({
      action: "user.deleted",
      diff: { notes: 2, remoteRows: 1, authUser: "deleted" },
    });
    await expect(deleteMyAccount(alice, "ip")).rejects.toMatchObject({ status: 404 });
  });

  it("still deletes when a remote slice is down; retention retries it with the login", async () => {
    remoteFails = true;
    world.loginResult = "failed";
    const result = await deleteMyAccount(bob, "ip");
    expect(result.authUser).toBe("failed");
    expect(await status(bob.id)).toBe("deleted");
    expect(await noteCount(bob.id)).toBe(0);

    remoteFails = false;
    remoteCalls = [];
    world.loginResult = "deleted";
    const retention = await runRetention(new Date());
    expect(remoteCalls).toContain(bob.id);
    expect(world.loginDeletes).toContain(bob.authUid);
    expect(retention.authRetried).toBeGreaterThanOrEqual(1);
  });
});

describe("retention (section 17)", () => {
  it("adds up every slice's counts and purges old cookie choices", async () => {
    await getDb().execute(sql`
      insert into public.consent_records (id, user_id, choice, policy_version, gpc, source, created_at)
      values (${randomUUID()}, null, 'necessary', 'old', false, 'banner', now() - interval '4 years')
    `);
    const result = await runRetention(new Date());
    expect(result.oldNotes).toBe(3);
    expect(result.consentRecords).toBeGreaterThanOrEqual(1);
  });
});
