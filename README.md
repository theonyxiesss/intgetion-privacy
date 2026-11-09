# intgetion-privacy

Privacy of the INTGETION platform as a standalone service: the cookie consent
journal (D220) and the orchestrator for section 17 — the data export, the
account deletion (D28, P13) and retention. Not connected to the platform
yet; it is integrated later through a separate branch and PR. The banner and
the settings pages stay in the platform.

- Package `@intgetion/privacy`, HTTP service on port `4230`.
- Depends by git tag on `@intgetion/kit` v0.3.1 and `@intgetion/analytics`
  v0.1.0 (`./consent`: the consent cookie helpers shared with the banner).
- Owns `consent_records` (migration `0001_privacy.sql`, the final state of
  platform migration 0021, with the `app_rw` grant).
- Never reads or writes another module's tables: each module adds its slice.

## Contributors

```ts
import { registerPrivacyContributors } from "@intgetion/privacy";
registerPrivacyContributors([
  { name: "candidates", mode: "in-process", exportFor, anonymize, purge },
  // ...
]);
```

- `exportFor(userId)` — keys merged into the export document (format D165).
- `anonymize(userId, { now, tx })` — removes or anonymises the person's data;
  counts go to the audit row.
- `purge(now)` — retention; counts by name.

**Deletion.** The account row (auth port `markDeleted`) and every
in-process slice run in one transaction, as on the platform: one failing
slice keeps everything. Remote slices (`httpContributor`, a module service
answering `POST /v1/privacy/{export,anonymize,purge}`) run after the commit;
a failure is logged, and retention retries it for accounts deleted in the
last 7 days together with the login delete (D166). A remote slice must be
idempotent.

**Where the platform's SQL goes.** Until each module takes its own slice,
the platform registers its current section 17 SQL as in-process
contributors, split by owner:

| Owner | Export keys | Deletion | Retention |
| --- | --- | --- | --- |
| auth (port, not a contributor) | `user` | the user row (status `deleted`), `telegram_accounts` | login retry |
| candidates | `candidateProfile`, `skills`, `experience`, `preferences` | `candidate_profiles` (cascade) | — |
| contacts | `contacts` | via the `candidate_profiles` cascade | — |
| users | `sharedProfile`, `languages`, `wallet` | `user_profiles`, `user_wallets` | — |
| companies | `companyMemberships`, `employerProfile` | sole-owned companies suspended, `company_members`, `employer_profiles` | — |
| jobs | — | open jobs of those companies closed with history | — |
| applications | `applications` | `cover_note` cleared (rows stay for the employer) | — |
| feedback | `savedJobs`, `jobFeedback` | `saved_jobs` | `user_job_feedback` 365 days |
| moderation | `reports` | — | — |
| notifications | `notifications`, `notificationPreferences` | notifications, emails, preferences | read notifications 90 days |
| matching | — | `matching_results` | 30 days |
| bot | `botMessages`, `spokiMemory`, `spokiReminders`, `spokiActions` | memory, reminders, actions, conversations | chat text 24 h, confirmations, reminders 30 days, messages 180 days, guest threads 30 days, journal sweep, idle goals |
| freelance | — | — | closed room messages 180 days |
| analytics | — | — | events (`purgeAnalytics`) |
| platform | — | — | `audit_logs` 365 days |
| privacy (here) | `cookieConsents` | — | consent records 3 years |

## Ports (`src/ports.ts`)

- account (auth): `find`, `markDeleted(userId, now, tx)`, `recentlyDeleted`,
  `loginEmail`, `deleteLogin`;
- platform: `audit`, `rateLimit` (the export is limited).

Over HTTP: `POST /api/internal/privacy/:op` on the platform with `{args}`.

## HTTP

Every route except `/health` needs `authorization: Bearer $PRIVACY_SERVICE_TOKEN`.
The platform passes the person in `x-user-id` and their login id in
`x-user-auth-uid`, the address in `x-client-ip` and the browser's `sec-gpc`.

| Method | Path | Does |
| --- | --- | --- |
| POST | `/v1/consent` | one cookie choice `{id, choice, version, source}`; guests too |
| GET | `/v1/consent` | the person's latest choice under the current policy |
| GET | `/v1/me/export` | the export document |
| DELETE | `/v1/me` | `{confirm: "DELETE"}` |
| POST | `/v1/tasks/retention` | cron, hourly |

## Run

```bash
cp .env.example .env
npm ci
npm run migrate
npm start
```

## Tests

Unit tests run without a database. Integration tests run when `DATABASE_URL`
is set, on a database prepared as in CI: `test/sql/pre/*.sql`, then
`npm run migrate`. They check the shared deletion transaction (a failing
slice keeps everything), the admin refusal, the export assembly, the remote
retry and retention, with a test table standing in for a module.
