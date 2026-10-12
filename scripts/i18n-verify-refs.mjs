// 校验给定源码文件里引用的所有 i18n key 都能被 zh-CN 词库解析。
// 用法：node scripts/i18n-verify-refs.mjs <file...>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node scripts/i18n-verify-refs.mjs <file...>");
  process.exit(1);
}

function evalObject(source) {
  return Function(`"use strict"; return (${source});`)();
}

function loadZhDefault(file) {
  const src = fs.readFileSync(file, "utf8");
  const idx = src.indexOf("export default");
  let objSrc = src.slice(idx + "export default".length).trim();
  if (objSrc.endsWith(";")) objSrc = objSrc.slice(0, -1);
  return evalObject(objSrc);
}

function flatten(obj, prefix = "") {
  const out = new Set();
  for (const [key, value] of Object.entries(obj)) {
    const at = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null) {
      for (const k of flatten(value, at)) out.add(k);
    } else {
      out.add(at);
    }
  }
  return out;
}

const modules = ["common", "settings", "chat", "library", "generation", "errors", "prompt", "download", "companion"];
const resolvable = new Set();
for (const mod of modules) {
  for (const k of flatten(loadZhDefault(path.join(root, `src/locales/zh-CN/${mod}.ts`)))) {
    resolvable.add(`${mod}.${k}`);
  }
}

const refs = new Map();
for (const rel of files) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  for (const m of src.matchAll(/\bt\(\s*["']([^"']+)["']/g)) {
    if (!refs.has(m[1])) refs.set(m[1], rel);
  }
}
const unresolved = [...refs.keys()].filter((k) => !resolvable.has(k));
if (unresolved.length) {
  console.error(`unresolved keys:\n${unresolved.map((k) => `  ${k}  (${refs.get(k)})`).join("\n")}`);
  process.exit(1);
}
console.log(`ok: ${refs.size} refs in ${files.length} files all resolvable`);
