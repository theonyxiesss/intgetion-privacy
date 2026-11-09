import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const dir = join(import.meta.dirname, "..", "migrations");
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

try {
  await sql`
    create table if not exists public.privacy_schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `;
  const done = new Set(
    (await sql<{ name: string }[]>`select name from public.privacy_schema_migrations`).map(
      (row) => row.name,
    ),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const text = await readFile(join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into public.privacy_schema_migrations (name) values (${file})`;
    });
    console.log(`applied ${file}`);
  }
  console.log("privacy migrations up to date");
} finally {
  await sql.end();
}
