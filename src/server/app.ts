import { ZodError } from "zod";
import { HttpError, httpErrorResponse, notFound, reportError, validationError } from "@intgetion/kit";
import * as privacy from "../modules/privacy/service";
import { isUuid, optionalCaller, requireServiceToken } from "./auth";

export type AppConfig = { serviceToken: string };

const MAX_JSON = 4 * 1024;

async function body(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_JSON) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Body too large");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw validationError([{ path: [], message: "invalid_json" }]);
  }
}

/** The signed-in person; the platform also passes the login id for the email. */
function person(request: Request): privacy.PrivacyUser {
  const caller = optionalCaller(request);
  const authUid = request.headers.get("x-user-auth-uid");
  if (!caller || !authUid) throw new HttpError(401, "UNAUTHENTICATED", "Sign in first");
  if (!isUuid(authUid)) throw validationError({ header: "x-user-auth-uid" });
  return { id: caller.userId, authUid };
}

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });

type Route = { method: string; pattern: RegExp; run: (request: Request) => Promise<Response> };

const routes: Route[] = [
  {
    // One cookie choice for the journal (D220); guests too.
    method: "POST",
    pattern: /^\/v1\/consent$/,
    run: async (request) => {
      const input = privacy.consentInput.parse(await body(request));
      const consent = await privacy.recordConsent({
        body: input,
        userId: optionalCaller(request)?.userId ?? null,
        gpc: request.headers.get("sec-gpc") === "1",
        ip: request.headers.get("x-client-ip") ?? "unknown",
      });
      return json({ consent }, 201);
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/consent$/,
    run: async (request) => {
      const caller = optionalCaller(request);
      if (!caller) throw new HttpError(401, "UNAUTHENTICATED", "Sign in first");
      return json({ consent: await privacy.storedConsent(caller.userId) });
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/me\/export$/,
    run: async (request) => json(await privacy.exportMyData(person(request))),
  },
  {
    // `{ confirm: "DELETE" }` (D28, P13).
    method: "DELETE",
    pattern: /^\/v1\/me$/,
    run: async (request) => {
      const who = person(request);
      privacy.deleteAccountInput.parse(await body(request));
      return json(await privacy.deleteMyAccount(who, request.headers.get("x-client-ip")));
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/tasks\/retention$/,
    run: async () => json(await privacy.runRetention()),
  },
];

export function toResponse(error: unknown): Response {
  if (error instanceof HttpError) return httpErrorResponse(error);
  if (error instanceof ZodError) return httpErrorResponse(validationError(error.issues));
  reportError(error, "privacy-service");
  return Response.json({ error: { code: "INTERNAL", message: "Internal error" } }, { status: 500 });
}

export function createApp(config: AppConfig) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") return Response.json({ ok: true });
      requireServiceToken(request, config.serviceToken);
      for (const route of routes) {
        if (route.method !== request.method) continue;
        if (!route.pattern.test(url.pathname)) continue;
        return await route.run(request);
      }
      throw notFound();
    } catch (error) {
      return toResponse(error);
    }
  };
}
