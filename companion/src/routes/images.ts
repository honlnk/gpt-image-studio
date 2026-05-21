import type { FastifyInstance } from "fastify";
import { loadCredentials } from "../credentials";

export async function imagesRoutes(app: FastifyInstance) {
  app.post("/images/generations", async (req, reply) => {
    const creds = loadCredentials();
    if (!creds) {
      return reply.status(503).send({ error: "Companion 未配置凭据，请先运行 login" });
    }

    const body = req.body as Record<string, unknown>;
    const apiUrl = `${creds.apiBaseUrl.replace(/\/+$/, "")}/generations`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const payload = await response.text();
    return reply.status(response.status).header("content-type", "application/json").send(payload);
  });

  app.addContentTypeParser("multipart/form-data", function (_req, payload, done) {
    const chunks: Buffer[] = [];
    payload.on("data", (chunk: Buffer) => chunks.push(chunk));
    payload.on("end", () => done(null, Buffer.concat(chunks)));
    payload.on("error", done);
  });

  app.post("/images/edits", { bodyLimit: 50 * 1024 * 1024 }, async (req, reply) => {
    const creds = loadCredentials();
    if (!creds) {
      return reply.status(503).send({ error: "Companion 未配置凭据，请先运行 login" });
    }

    const apiUrl = `${creds.apiBaseUrl.replace(/\/+$/, "")}/edits`;
    const contentType = req.headers["content-type"]!;
    const rawBody = req.body as Buffer;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${creds.apiKey}`,
        "Content-Type": contentType,
      },
      body: new Uint8Array(rawBody),
    });

    const payload = await response.text();
    return reply.status(response.status).header("content-type", "application/json").send(payload);
  });
}
