import { sql } from "drizzle-orm";
import { getDb } from "@intgetion/kit";

type Rows = Record<string, unknown>[];

const rows = async (query: ReturnType<typeof sql>): Promise<Rows> =>
  (await getDb().execute(query)) as unknown as Rows;

/** The person's cookie choices, for the export (D220). */
export async function readConsentRecords(userId: string) {
  return rows(
    sql`select choice, policy_version, gpc, source, created_at from public.consent_records where user_id = ${userId} order by created_at`,
  );
}

/** Consent proof is kept three years (section 17). */
export async function purgeConsentRecords(now: Date): Promise<number> {
  const before = new Date(now.getTime() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString();
  const deleted = await getDb().execute(
    sql`delete from public.consent_records where created_at < ${before}::timestamptz returning 1`,
  );
  return (deleted as unknown as unknown[]).length;
}

/** One cookie choice for the journal (D220); a repeated id is ignored. */
export async function insertConsentRecord(input: {
  id: string;
  userId: string | null;
  choice: string;
  version: string;
  gpc: boolean;
  source: "banner" | "settings";
  ipHash: string;
}) {
  await getDb().execute(sql`
    insert into public.consent_records
      (id, user_id, choice, policy_version, gpc, source, ip_hash)
    values (${input.id}, ${input.userId}, ${input.choice}, ${input.version},
            ${input.gpc}, ${input.source}, ${input.ipHash})
    on conflict (id) do nothing
  `);
}

/** A signed-in user's latest choice under the given policy version. */
export async function readStoredConsent(userId: string, version: string) {
  const found = await rows(sql`
    select choice from public.consent_records
    where user_id = ${userId} and policy_version = ${version}
    order by created_at desc
    limit 1
  `);
  return (found[0]?.choice as string | undefined) ?? null;
}
