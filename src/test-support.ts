import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { getDb } from "@intgetion/kit";
import { setPrivacyPorts, type AuditEntry, type AuthDeleteResult, type PrivacyPorts } from "./ports";

type Tx = { execute: ReturnType<typeof getDb>["execute"] };

/**
 * The account side as the auth module does it, on the test users table: the
 * row stays with status `deleted` and its personal fields cleared (D28).
 */
export function useTestPorts(overrides: Partial<PrivacyPorts> = {}) {
  const world = {
    audit: [] as AuditEntry[],
    rateHits: [] as string[],
    loginDeletes: [] as string[],
    /** What the next login delete answers. */
    loginResult: "deleted" as AuthDeleteResult,
  };
  setPrivacyPorts({
    account: {
      find: async (userId) => {
        const [row] = await getDb().execute<{ id: string; auth_uid: string; status: string; platform_role: string }>(
          sql`select id, auth_uid, status, platform_role from public.users where id = ${userId}`,
        );
        return row ? { id: row.id, authUid: row.auth_uid, status: row.status, platformRole: row.platform_role } : null;
      },
      markDeleted: async (userId, now, tx) => {
        const db = (tx as Tx | undefined) ?? getDb();
        const updated = await db.execute(sql`
          update public.users set status = 'deleted', deleted_at = ${now.toISOString()}::timestamptz
          where id = ${userId} and status <> 'deleted' returning id
        `);
        return (updated as unknown as unknown[]).length > 0;
      },
      recentlyDeleted: async (since) => {
        const rows = await getDb().execute<{ id: string; auth_uid: string }>(sql`
          select id, auth_uid from public.users
          where status = 'deleted' and deleted_at >= ${since.toISOString()}::timestamptz
        `);
        return rows.map((r) => ({ userId: r.id, authUid: r.auth_uid }));
      },
      loginEmail: async (authUid) => `${authUid.slice(0, 8)}@login.test`,
      deleteLogin: async (authUid) => {
        world.loginDeletes.push(authUid);
        return world.loginResult;
      },
    },
    audit: async (entry) => {
      world.audit.push(entry);
    },
    rateLimit: async (bucket, subject) => {
      world.rateHits.push(`${bucket}:${subject}`);
    },
    ...overrides,
  });
  return world;
}


/** The platform users table, as tests insert into it (test stub columns). */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  authUid: uuid("auth_uid"),
  locale: text("locale").notNull().default("en"),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  termsVersion: text("terms_version"),
});
