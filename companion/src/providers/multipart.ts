import type { EditImage } from "./types.js";

/**
 * route 层解析后的编辑请求。
 * 文本字段（model/prompt/size/background/output_format + stream/partial_images 等）
 * 全部进 fields；图片进 images[]；mask 单独。
 *
 * 这层只负责「把 multipart 拆开」，不做语义校验（校验在 validateEditMultipart）。
 */
export type ParsedEditBody = {
  images: EditImage[];
  mask?: EditImage;
  /** 所有非文件 part，key=字段名 value=字段值。web 额外带的字段都在这里。 */
  fields: Record<string, string>;
};

export type ParseMultipartError = { message: string };

/**
 * 从 multipart/form-data 的原始字节里拆出各 part。
 *
 * 实现说明：
 * - boundary 从 Content-Type 头取；body 里以 `\r\n--<boundary>` 分隔。
 * - 每个 part 的 header 区（到第一个 `\r\n\r\n`）用 latin1 解析——
 *   header 全是 ASCII，latin1 安全。
 * - part 正文用 Buffer.slice 保留原始字节（图片二进制不能转字符串）。
 *
 * 与 routes/images.ts 现有 validateEditMultipart 的 latin1 文本扫描思路一致，
 * 区别是这里要真正切出字节，不只是正则匹配 header。
 */
export function parseMultipart(
  raw: Buffer,
  boundary: string,
): ParsedEditBody | ParseMultipartError {
  if (!boundary) return { message: "multipart 请求缺少 boundary" };

  const dashBoundary = Buffer.from(`--${boundary}`);
  const images: EditImage[] = [];
  let mask: EditImage | undefined;
  const fields: Record<string, string> = {};

  // 按 --boundary 切分。第一段是 preamble（通常空），最后是 --boundary-- 的 epilogue。
  let cursor = 0;
  while (cursor < raw.length) {
    const start = raw.indexOf(dashBoundary, cursor);
    if (start === -1) break;

    // boundary 后可能是 \r\n（正常 part）或 --（结束标记）
    const afterBoundary = start + dashBoundary.length;
    if (raw[afterBoundary] === 0x2d /* '-' */ && raw[afterBoundary + 1] === 0x2d) {
      break; // --boundary--，结束
    }

    // 跳过 boundary 后的 \r\n
    let partStart = afterBoundary;
    if (raw[partStart] === 0x0d /* \r */ && raw[partStart + 1] === 0x0a /* \n */) {
      partStart += 2;
    } else {
      // 非标准分隔，跳到下一个 boundary
      cursor = afterBoundary;
      continue;
    }

    // 找下一个 \r\n--boundary 作为本 part 的结束
    const nextBoundary = Buffer.from(`\r\n--${boundary}`);
    const partEnd = raw.indexOf(nextBoundary, partStart);
    if (partEnd === -1) break;

    // header/body 分界：第一个 \r\n\r\n
    const headerEnd = raw.indexOf(Buffer.from("\r\n\r\n"), partStart);
    if (headerEnd === -1 || headerEnd > partEnd) {
      cursor = partEnd;
      continue;
    }

    const headerText = raw.subarray(partStart, headerEnd).toString("latin1");
    const bodyStart = headerEnd + 4;
    const bodyEnd = partEnd;
    const body = raw.subarray(bodyStart, bodyEnd);

    const disposition = /Content-Disposition:\s*form-data;[^\r\n]*/i.exec(headerText)?.[0] ?? "";
    const nameMatch = /name="([^"]*)"/.exec(disposition);
    if (!nameMatch) {
      cursor = partEnd;
      continue;
    }
    const name = nameMatch[1];

    const filenameMatch = /filename="([^"]*)"/.exec(disposition);
    const mimeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerText);
    const mimeType = mimeMatch?.[1]?.trim().toLowerCase() ?? "application/octet-stream";

    if (filenameMatch) {
      // 文件 part
      const image: EditImage = {
        blob: Buffer.from(body),
        name: filenameMatch[1],
        mimeType,
      };
      if (name === "mask") {
        mask = image;
      } else {
        // image / image[] / 任意带 filename 的 part 都当图片收
        images.push(image);
      }
    } else {
      // 文本字段
      fields[name] = body.toString("utf8");
    }

    cursor = partEnd;
  }

  return { images, mask, fields };
}

/** 从 Content-Type 头里提取 boundary 参数。 */
export function extractBoundary(contentType: string): string | null {
  const match = /boundary=("?)([^";\s]+)\1/i.exec(contentType);
  return match?.[2] ?? null;
}
