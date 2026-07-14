import type { FastifyInstance } from "fastify";
import type { CompanionLogsTailResponse } from "../types.js";
import { getLogFilePath, readLastLines, readManagedProcessInfo } from "../processManager.js";

/**
 * 日志查看路由（Web 面板专用，替代 CLI `gpt-image-studio logs`）。
 *
 * 鉴权：走现有配对 session token（在 authMiddleware 之后注册，自动受 bearer 守卫保护）。
 * 只有已配对的 Web 端能看日志——日志里可能含少量运行时信息，不应向未配对方暴露。
 *
 * 第一版只做拉取（tail），不做 SSE 实时流。前端配"刷新"按钮即可。
 */
export async function logsRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { lines?: string; date?: string };
    Reply: CompanionLogsTailResponse;
  }>("/logs/tail", async (req) => {
    const requestedLines = Math.min(1000, Math.max(1, Number(req.query?.lines) || 100));
    const today = formatLocalDate(new Date());
    const requestedDateRaw = req.query?.date?.trim();
    const requestedDate = requestedDateRaw || today;

    // 选日志文件：优先按 date 参数对应的每日文件；
    // 没传 date 时回退到托管进程记录的 logFile（managed 模式下更准），再退到今天。
    let logFile: string | null = null;
    if (requestedDateRaw) {
      const parsed = parseDateParam(requestedDateRaw);
      if (parsed) logFile = getLogFilePath(parsed);
    } else {
      const managed = readManagedProcessInfo();
      if (managed?.logFile) logFile = managed.logFile;
      else logFile = getLogFilePath();
    }

    const lines = logFile ? readLastLines(logFile, requestedLines) : [];
    return { lines, logFile, date: requestedDate };
  });
}

/** 把 YYYY-MM-DD 解析成本地时区的 Date，非法返回 null。 */
function parseDateParam(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 本地时区的 YYYY-MM-DD，与 processManager.formatLocalDate 保持一致。 */
function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
