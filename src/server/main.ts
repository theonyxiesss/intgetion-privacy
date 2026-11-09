import { createServer, type IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { logger } from "@intgetion/kit";
import { registerPrivacyContributors, setPrivacyPorts } from "../modules/privacy/service";
import { createApp } from "./app";
import { httpContributor, httpPrivacyPorts } from "./remote-ports";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function toRequest(req: IncomingMessage, origin: string): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(new URL(req.url ?? "/", origin), {
    method: req.method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    duplex: "half",
  } as RequestInit);
}

required("DATABASE_URL");
setPrivacyPorts(
  httpPrivacyPorts({
    platform: { url: required("PLATFORM_URL"), token: required("PLATFORM_CALLBACK_TOKEN") },
  }),
);
/**
 * Module services that hold personal data, as JSON:
 * [{"name":"bot","url":"https://…","token":"…"}]. Each answers /v1/privacy/*.
 */
const contributors = JSON.parse(process.env.PRIVACY_CONTRIBUTORS || "[]") as {
  name: string;
  url: string;
  token: string;
}[];
registerPrivacyContributors(contributors.map((c) => httpContributor(c.name, { url: c.url, token: c.token })));
const handle = createApp({ serviceToken: required("PRIVACY_SERVICE_TOKEN") });
const port = Number(process.env.PORT ?? 4230);

createServer(async (req, res) => {
  const response = await handle(toRequest(req, `http://localhost:${port}`));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => {
  logger.info({ port }, "privacy service listening");
});
