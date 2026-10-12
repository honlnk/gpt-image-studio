// 阶段 2 通用合并脚本：node scripts/i18n-merge.mjs <moduleName> <draftJson...>
// 把 scripts/i18n-pending/ 下的草稿合并进 src/locales/{zh-CN,en-US}/<module>.ts。
// 校验：草稿 zh/en key 对齐、key 都落在指定命名空间、无冲突、目标模块引用可解析。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [moduleName, ...draftNames] = process.argv.slice(2);
if (!moduleName || draftNames.length === 0) {
  console.error("usage: node scripts/i18n-merge.mjs <moduleName> <draftJson...>");
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const draftDir = path.join(root, "scripts/i18n-pending");
const zhPath = path.join(root, `src/locales/zh-CN/${moduleName}.ts`);
const enPath = path.join(root, `src/locales/en-US/${moduleName}.ts`);

function evalObject(source, label) {
  const value = Function(`"use strict"; return (${source});`)();
  if (typeof value !== "object" || value === null) {
    throw new Error(`${label}: parsed value is not an object`);
  }
  return value;
}

// 占位/已填模块都是「export default <object>;」形式（zh）或
// 「type Zh<Module> = ...; const <module>: Zh<Module> = <object>; export default <module>;」（en）。
// settings.ts 的 en 侧锚点名是 settings，其余模块按模块名推导。
function loadModule(file, varName) {
  const src = fs.readFileSync(file, "utf8");
  const anchor = `const ${varName}: Zh${varName[0].toUpperCase()}${varName.slice(1)} = `;
  let prefix = "";
  let objSrc;
  if (src.includes(anchor)) {
    const start = src.indexOf(anchor);
    prefix = src.slice(0, start);
    const end = src.indexOf(`export default ${varName};`);
    objSrc = src.slice(start + anchor.length, end).trim();
  } else {
    const idx = src.indexOf("export default");
    if (idx === -1) throw new Error(`${file}: cannot find object literal`);
    prefix = src.slice(0, idx);
    objSrc = src.slice(idx + "export default".length).trim();
  }
  if (objSrc.endsWith(";")) objSrc = objSrc.slice(0, -1);
  return { object: evalObject(objSrc, file), prefix };
}

function nestDotted(dotted, namespace) {
  const result = {};
  for (const [key, value] of Object.entries(dotted)) {
    if (!key.startsWith(`${namespace}.`)) {
      throw new Error(`key "${key}" outside namespace "${namespace}.*"`);
    }
    const parts = key.split(".").slice(1);
    let node = result;
    for (const part of parts.slice(0, -1)) {
      node[part] ??= {};
      if (typeof node[part] !== "object") throw new Error(`key type conflict: ${key}`);
      node = node[part];
    }
    const leaf = parts[parts.length - 1];
    if (leaf in node) throw new Error(`duplicate key in draft: ${key}`);
    node[leaf] = value;
  }
  return result;
}

function deepMerge(target, patch, where) {
  for (const [key, value] of Object.entries(patch)) {
    const at = `${where}.${key}`;
    if (!(key in target)) {
      target[key] = value;
      continue;
    }
    const existing = target[key];
    if (typeof value === "object" && value !== null) {
      if (typeof existing !== "object" || existing === null) {
        throw new Error(`type conflict at ${at}: existing is not an object`);
      }
      deepMerge(existing, value, at);
    } else if (typeof existing === "object" && existing !== null) {
      throw new Error(`type conflict at ${at}: existing is an object`);
    } else if (existing !== value) {
      throw new Error(`value conflict at ${at}:\n  existing: ${JSON.stringify(existing)}\n  draft:    ${JSON.stringify(value)}`);
    }
  }
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

// ---- 1. 读草稿并校验 ----
const drafts = draftNames.map((name) => {
  const raw = JSON.parse(fs.readFileSync(path.join(draftDir, name), "utf8"));
  const zhKeys = Object.keys(raw["zh-CN"] ?? {});
  const enKeys = Object.keys(raw["en-US"] ?? {});
  const enSet = new Set(enKeys);
  for (const k of zhKeys) if (!enSet.has(k)) throw new Error(`${name}: en-US missing key ${k}`);
  for (const k of enKeys) if (!(k in raw["zh-CN"])) throw new Error(`${name}: zh-CN missing key ${k}`);
  return { name, zh: raw["zh-CN"], en: raw["en-US"], keys: new Set(zhKeys) };
});
const seen = new Map();
for (const d of drafts) {
  for (const k of d.keys) {
    if (seen.has(k)) throw new Error(`key ${k} appears in both ${seen.get(k)} and ${d.name}`);
    seen.set(k, d.name);
  }
}

// ---- 2. 合并进模块词库 ----
const zhLoaded = loadModule(zhPath, moduleName);
const enLoaded = loadModule(enPath, moduleName);
for (const d of drafts) {
  deepMerge(zhLoaded.object, nestDotted(d.zh, moduleName), `zh.${moduleName}`);
  deepMerge(enLoaded.object, nestDotted(d.en, moduleName), `en.${moduleName}`);
}
const zhKeys = flatten(zhLoaded.object);
const enKeys = flatten(enLoaded.object);
for (const k of zhKeys) if (!enKeys.has(k)) throw new Error(`en missing ${moduleName}.${k}`);
for (const k of enKeys) if (!zhKeys.has(k)) throw new Error(`zh missing ${moduleName}.${k}`);

// ---- 3. 回写（保留文件头注释/类型锚点；占位注释升级为域说明） ----
zhLoaded.prefix = zhLoaded.prefix.replace(
  /\/\*\* 词条占位：阶段 2\/3 按波次填充。 \*\/\n/,
  `/** ${moduleName} 域词条。 */\n`,
);
fs.writeFileSync(zhPath, `${zhLoaded.prefix}export default ${JSON.stringify(zhLoaded.object, null, 2)};\n`);
fs.writeFileSync(
  enPath,
  `${enLoaded.prefix}const ${moduleName}: Zh${moduleName[0].toUpperCase()}${moduleName.slice(1)} = ${JSON.stringify(enLoaded.object, null, 2)};\n\nexport default ${moduleName};\n`,
);

const total = drafts.reduce((sum, d) => sum + d.keys.size, 0);
console.log(`merged ${total} keys into ${moduleName} (zh ${zhKeys.size} keys total)`);
