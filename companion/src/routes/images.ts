import type { FastifyInstance } from "fastify";
import { loadCredentials } from "../credentials.js";
import type { CompanionSecurityConfig } from "../securityConfig.js";

type ImagesRoutesOptions = {
  security: CompanionSecurityConfig;
};

export async function imagesRoutes(app: FastifyInstance, opts: ImagesRoutesOptions) {
  app.post("/images/generations", async (req, reply) => {
    const creds = loadCredentials();
    if (!creds) {
      return reply.status(503).send({ error: "Companion 未配置凭据，请先运行 login" });
    }

    if (!isJsonRequest(req.headers["content-type"])) {
      return reply.status(415).send({ error: "请求 Content-Type 必须是 application/json" });
    }

    const body = req.body as Record<string, unknown>;
    const validationError = validateGenerationBody(body);
    if (validationError) {
      return reply.status(400).send({ error: validationError });
    }

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

  app.post("/images/edits", { bodyLimit: opts.security.maxEditBodyBytes }, async (req, reply) => {
    const creds = loadCredentials();
    if (!creds) {
      return reply.status(503).send({ error: "Companion 未配置凭据，请先运行 login" });
    }

    if (!isMultipartRequest(req.headers["content-type"])) {
      return reply.status(415).send({ error: "请求 Content-Type 必须是 multipart/form-data" });
    }

    const apiUrl = `${creds.apiBaseUrl.replace(/\/+$/, "")}/edits`;
    const contentType = req.headers["content-type"]!;
    const rawBody = req.body as Buffer;
    const validationError = validateEditMultipart(rawBody, opts.security);
    if (validationError) {
      return reply.status(400).send({ error: validationError });
    }

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

function isJsonRequest(contentType: string | undefined): boolean {
  return contentType?.toLowerCase().split(";")[0]?.trim() === "application/json";
}

function isMultipartRequest(contentType: string | undefined): boolean {
  return contentType?.toLowerCase().startsWith("multipart/form-data") ?? false;
}

function validateGenerationBody(body: Record<string, unknown>): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "请求体必须是 JSON object";
  }
  if (typeof body.model !== "string" || !body.model.trim()) {
    return "缺少 model";
  }
  if (typeof body.prompt !== "string" || !body.prompt.trim()) {
    return "缺少 prompt";
  }
  if ("b64_json" in body || "image" in body || "image[]" in body) {
    return "文生图请求不能包含图片内容";
  }
  return null;
}

export function validateEditMultipart(body: Buffer, security: CompanionSecurityConfig): string | null {
  const text = body.toString("latin1");
  const imagePartNames = [...text.matchAll(/name="image(?:\[\])?"/g)];
  if (imagePartNames.length === 0) {
    return "编辑请求至少需要一张引用图片";
  }
  if (imagePartNames.length > security.maxEditImages) {
    return `编辑请求最多支持 ${security.maxEditImages} 张引用图片`;
  }

  const partHeaders = text.match(/Content-Disposition:[\s\S]*?(?=\r\n\r\n)/g) ?? [];
  for (const header of partHeaders) {
    if (!/name="(?:image(?:\[\])?|mask)"/.test(header)) continue;
    const mime = /Content-Type:\s*([^\r\n]+)/i.exec(header)?.[1]?.trim().toLowerCase();
    if (!mime) {
      return "图片 part 缺少 Content-Type";
    }
    if (/name="mask"/.test(header) && mime !== "image/png") {
      return "mask 必须是 image/png";
    }
    if (/name="image(?:\[\])?"/.test(header) && !security.allowedEditImageMimeTypes.includes(mime)) {
      return `不支持的图片类型：${mime}`;
    }
  }

  return null;
}
