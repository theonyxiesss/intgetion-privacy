import { HttpError } from "@intgetion/kit";
import type { PrivacyContributor } from "../modules/privacy/service";
import type { PrivacyPorts } from "../ports";

export type Endpoint = { url: string; token: string };

async function post(fetchImpl: typeof fetch, to: Endpoint, path: string, body: unknown) {
  const response = await fetchImpl(`${to.url.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${to.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await response.json().catch(() => null)) as
    | { result?: unknown; error?: { code: string; message: string } }
    | null;
  if (!response.ok) {
    if (response.status < 500 && json?.error) throw new HttpError(response.status, json.error.code, json.error.message);
    throw new Error(`${path} answered ${response.status}`);
  }
  return json?.result;
}

/**
 * The account, audit and rate limits live in the platform:
 * `POST /api/internal/privacy/:op` with `{args}` answers `{result}`. Over
 * HTTP the account is marked deleted on its own (no shared transaction).
 */
export function httpPrivacyPorts(config: { platform: Endpoint; fetchImpl?: typeof fetch }): PrivacyPorts {
  const doFetch = config.fetchImpl ?? fetch;
  const call = (op: string, ...args: unknown[]) =>
    post(doFetch, config.platform, `/api/internal/privacy/${op}`, { args });
  return {
    account: {
      find: (userId) => call("account.find", userId) as never,
      markDeleted: async (userId, now) => Boolean(await call("account.mark-deleted", userId, now.toISOString())),
      recentlyDeleted: (since) => call("account.recently-deleted", since.toISOString()) as never,
      loginEmail: (authUid) => call("account.login-email", authUid) as never,
      deleteLogin: (authUid) => call("account.delete-login", authUid) as never,
    },
    audit: async (entry) => {
      await call("audit", entry);
    },
    rateLimit: async (bucket, subject, now) => {
      await call("rate-limit", bucket, subject, now.toISOString());
    },
  };
}

/**
 * A module in its own service: `POST /v1/privacy/{export,anonymize,purge}`
 * on that service, answering `{result}`. Remote slices run after the deletion
 * commits and are retried by retention, so the module's delete is idempotent.
 */
export function httpContributor(
  name: string,
  to: Endpoint,
  fetchImpl: typeof fetch = fetch,
): PrivacyContributor {
  return {
    name,
    mode: "remote",
    exportFor: async (userId) => ((await post(fetchImpl, to, "/v1/privacy/export", { userId })) ?? {}) as Record<string, unknown>,
    anonymize: async (userId, ctx) =>
      ((await post(fetchImpl, to, "/v1/privacy/anonymize", { userId, now: ctx.now.toISOString() })) ?? {}) as Record<string, number>,
    purge: async (now) => ((await post(fetchImpl, to, "/v1/privacy/purge", { now: now.toISOString() })) ?? {}) as Record<string, number>,
  };
}
