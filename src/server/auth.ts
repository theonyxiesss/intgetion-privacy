import { timingSafeEqual } from "node:crypto";
import { HttpError, validationError } from "@intgetion/kit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function unauthorized(): HttpError {
  return new HttpError(401, "UNAUTHENTICATED", "Invalid service token");
}

export function requireServiceToken(request: Request, token: string): void {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw unauthorized();
  }
}

export type Caller = {
  userId: string;
  email: string | null;
  locale: string;
};

/** The platform authenticates the person and forwards who they are. */
export function optionalCaller(request: Request): Caller | null {
  const userId = request.headers.get("x-user-id");
  if (!userId) return null;
  if (!UUID.test(userId)) throw validationError({ header: "x-user-id" });
  return {
    userId,
    email: request.headers.get("x-user-email"),
    locale: request.headers.get("x-user-locale") ?? "en",
  };
}

export function requireCaller(request: Request): Caller {
  const caller = optionalCaller(request);
  if (!caller) throw new HttpError(401, "UNAUTHENTICATED", "Missing x-user-id");
  return caller;
}

export function isUuid(value: string): boolean {
  return UUID.test(value);
}
