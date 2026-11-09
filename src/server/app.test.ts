import { describe, expect, it, vi } from "vitest";
import { useTestPorts } from "../test-support";
import { createApp } from "./app";
import { httpContributor } from "./remote-ports";

useTestPorts();
const token = "test-token";
const app = createApp({ serviceToken: token });
const user = "11111111-1111-4111-8111-111111111111";
const auth = { authorization: `Bearer ${token}` };
const call = (path: string, init: RequestInit = {}) => app(new Request(`http://privacy${path}`, init));

describe("privacy http", () => {
  it("serves health without a token and refuses a missing one", async () => {
    expect((await call("/health")).status).toBe(200);
    expect((await call("/v1/consent")).status).toBe(401);
  });
  it("needs the person and their login id for export and deletion", async () => {
    expect((await call("/v1/me/export", { headers: { ...auth, "x-user-id": user } })).status).toBe(401);
    const del = await call("/v1/me", {
      method: "DELETE",
      headers: { ...auth, "x-user-id": user, "x-user-auth-uid": user },
      body: JSON.stringify({ confirm: "yes" }),
    });
    expect(del.status).toBe(400);
  });
  it("rejects an unknown cookie choice and unknown routes", async () => {
    const bad = await call("/v1/consent", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ id: user, choice: "everything", version: "x", source: "banner" }),
    });
    expect(bad.status).toBe(400);
    expect((await call("/v1/nothing", { headers: auth })).status).toBe(404);
  });
});

describe("remote contributor", () => {
  it("calls the module's privacy endpoints and keeps its 4xx", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith("/v1/privacy/export")) return Response.json({ result: { botMessages: [] } });
      if (path.endsWith("/v1/privacy/anonymize")) return Response.json({ result: { botMessages: 3 } });
      return Response.json({ error: { code: "NOT_FOUND", message: "no" } }, { status: 404 });
    });
    const bot = httpContributor("bot", { url: "http://bot/", token: "t" }, fetchImpl as typeof fetch);
    expect(bot.mode).toBe("remote");
    expect(await bot.exportFor!(user)).toEqual({ botMessages: [] });
    expect(await bot.anonymize!(user, { now: new Date(), tx: undefined })).toEqual({ botMessages: 3 });
    await expect(bot.purge!(new Date())).rejects.toMatchObject({ status: 404 });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("http://bot/v1/privacy/export");
  });
});
