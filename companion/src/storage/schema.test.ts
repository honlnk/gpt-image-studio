import { describe, expect, it } from "vitest";
import {
  BUSINESS_DB_DDL,
  BUSINESS_TABLES,
  MASTER_DB_DDL,
  MASTER_DB_MIGRATION_V2,
  MASTER_DB_VERSION,
  isBusinessTable,
} from "./schema.js";

/**
 * schema.ts 的单元测试：DDL 字符串完整性 + 表名白名单校验。
 * 不需要临时目录隔离（纯静态模块）。
 */

describe("schema DDL", () => {
  it("MASTER_DB_VERSION 为 2（阶段三 PR2 多租户升级）", () => {
    expect(MASTER_DB_VERSION).toBe(2);
  });

  it("MASTER_DB_DDL 包含 dataset_registry 表及全部字段（含 user_id）", () => {
    expect(MASTER_DB_DDL).toContain("CREATE TABLE IF NOT EXISTS dataset_registry");
    for (const field of [
      "id", "user_id", "label", "storage_kind", "storage_config", "fingerprint",
      "db_path", "image_store_kind", "created_at", "activated_at", "is_active",
    ]) {
      expect(MASTER_DB_DDL).toContain(field);
    }
  });

  it("MASTER_DB_DDL 包含 users 表（阶段三 PR2 多租户）", () => {
    expect(MASTER_DB_DDL).toContain("CREATE TABLE IF NOT EXISTS users");
    for (const field of ["id", "display_name", "created_at"]) {
      expect(MASTER_DB_DDL).toContain(field);
    }
  });

  it("MASTER_DB_DDL fingerprint 唯一性改为 (user_id, fingerprint) 复合", () => {
    expect(MASTER_DB_DDL).toContain("idx_registry_user_fingerprint");
    expect(MASTER_DB_DDL).toContain("(user_id, fingerprint)");
    // 旧的全局唯一索引不应出现在新库 DDL
    expect(MASTER_DB_DDL).not.toContain("idx_registry_fingerprint");
  });

  it("MASTER_DB_DDL 包含 user_id 索引", () => {
    expect(MASTER_DB_DDL).toContain("idx_registry_user");
  });

  it("MASTER_DB_DDL 包含 is_active 索引", () => {
    expect(MASTER_DB_DDL).toContain("idx_registry_active");
  });

  it("MASTER_DB_MIGRATION_V2 包含 v1→v2 迁移语句", () => {
    expect(MASTER_DB_MIGRATION_V2).toContain("idx_registry_user_fingerprint");
    expect(MASTER_DB_MIGRATION_V2).toContain("DROP INDEX IF EXISTS idx_registry_fingerprint");
  });

  it("BUSINESS_DB_DDL 包含 7 张业务表", () => {
    for (const table of BUSINESS_TABLES) {
      expect(BUSINESS_DB_DDL).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it("BUSINESS_TABLES 顺序与前端 STORE_NAMES 对齐", () => {
    // 顺序对齐确保 db 路由层的表名映射不会错位
    expect(BUSINESS_TABLES).toEqual([
      "conversations",
      "messages",
      "imageAssets",
      "imageBlobs",
      "settings",
      "conversationDrafts",
      "analyticsEvents",
    ]);
  });
});

describe("isBusinessTable", () => {
  it("合法表名返回 true（类型守卫生效）", () => {
    for (const table of BUSINESS_TABLES) {
      expect(isBusinessTable(table)).toBe(true);
    }
  });

  it("非法表名返回 false", () => {
    expect(isBusinessTable("users")).toBe(false);
    expect(isBusinessTable("dataset_registry")).toBe(false);
    expect(isBusinessTable("malicious; DROP TABLE")).toBe(false);
    expect(isBusinessTable("")).toBe(false);
  });

  it("防 SQL 注入：危险字符串不是合法表名", () => {
    expect(isBusinessTable("messages; DROP TABLE messages; --")).toBe(false);
    expect(isBusinessTable("messages' OR '1'='1")).toBe(false);
  });
});
