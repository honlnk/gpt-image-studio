/**
 * JWT 吊销黑名单（内存级，TTL 自动清理）—— 阶段三 PR3 SLO。
 *
 * D10 完整 SSO 的单点登出（SLO）落地：
 * - 宿主用户登出/封禁/改密时，调 /admin/revoke 把 user_id（或 jti）加入黑名单。
 * - JWT 中间件验证时检查黑名单，被吊销的 user/jti 立即拒绝。
 *
 * 设计（D10 决策）：
 * - 纯内存 Map（重启清空）。JWT 有效期短（≤1h），重启后残留风险窗口 = 剩余有效期，可接受。
 * - TTL 自动清理：每条记录带 expireAt，后台定时器定期删过期项，避免无限增长。
 * - O(1) 查询：Map.get。
 */

/** 黑名单 key 前缀，区分 user 级和 jti 级吊销。 */
const USER_PREFIX = "user:";
const JTI_PREFIX = "jti:";

/** key → 过期时间（Unix 秒）。 */
const blacklist = new Map<string, number>();

/** 后台清理定时器句柄。 */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/** 清理间隔（5 分钟）。 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/** 默认 TTL（1 小时，覆盖典型 JWT 有效期上限）。 */
const DEFAULT_TTL_SECONDS = 3600;

/**
 * 按用户吊销。ttlSeconds 后黑名单记录自动失效。
 *
 * 覆盖场景：用户登出、封禁、改密码——宿主想让该用户的所有 JWT 立即失效。
 */
export function revokeUser(userId: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): void {
  const expireAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  blacklist.set(`${USER_PREFIX}${userId}`, expireAt);
}

/**
 * 按 JWT jti 吊销。粒度更细：只让单个 JWT 失效，不影响该用户的其他 JWT。
 *
 * 覆盖场景：单设备登出（只吊销当前设备的 JWT，其他设备保持登录）。
 */
export function revokeJti(jti: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): void {
  const expireAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  blacklist.set(`${JTI_PREFIX}${jti}`, expireAt);
}

/** 检查用户是否被吊销（未过期才算吊销）。 */
export function isUserRevoked(userId: string): boolean {
  const expireAt = blacklist.get(`${USER_PREFIX}${userId}`);
  if (expireAt === undefined) return false;
  if (Math.floor(Date.now() / 1000) >= expireAt) {
    // 已过期，视为未吊销（不主动删，留给定时清理）
    return false;
  }
  return true;
}

/** 检查 jti 是否被吊销（未过期才算吊销）。 */
export function isJtiRevoked(jti: string): boolean {
  const expireAt = blacklist.get(`${JTI_PREFIX}${jti}`);
  if (expireAt === undefined) return false;
  if (Math.floor(Date.now() / 1000) >= expireAt) {
    return false;
  }
  return true;
}

/**
 * 启动后台清理定时器（进程级单例）。
 *
 * 每 5 分钟扫一遍黑名单，删除过期项，避免 Map 无限增长。
 * server 模式启动时调用（server.ts）。
 */
export function startCleanupTimer(): void {
  if (cleanupTimer) return; // 已启动
  cleanupTimer = setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (const [key, expireAt] of blacklist) {
      if (now >= expireAt) {
        blacklist.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  // 不阻止进程退出（unref）
  cleanupTimer.unref?.();
}

/** 停止清理定时器（测试用）。 */
export function stopCleanupTimer(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/** 清空黑名单（测试用）。 */
export function clear(): void {
  blacklist.clear();
}

/** 返回当前黑名单大小（测试/调试用）。 */
export function size(): number {
  return blacklist.size;
}
