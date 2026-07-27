# 阶段三 PR5：前端 qiankun 嵌入改造

> 状态：⬜ 待启动
> 依赖：PR2（JWT + req.user 已就位，前端注入 JWT 即可对接）
> 纲领：[`./phase3-overview.md`](./phase3-overview.md) §三 D14 + roadmap §8「前端子项目化」

## 一、目标

让前端既能独立运行（阶段二行为不变），也能作为 qiankun 子应用嵌入宿主（如 Vben/RuoYi-Plus）：
1. 导出 qiankun 生命周期（`bootstrap`/`mount`/`unmount`），独立态走原有 `mount('#app')`。
2. 运行环境感知：检测 `__POWERED_BY_QIANKUN__`，嵌入态从宿主 props 注入配置（companionUrl + JWT）。
3. 资源路径相对化，支持从 CDN 加载（D14 默认模式）。
4. 嵌入态 `connectionMode` 固定 `localCompanion`，禁止 direct 模式（凭据安全由平台负责）。

## 二、设计决策

### 2.1 注入点：settingsStore 三 refs

经探查，`settingsStore` 的 `companionUrl`/`companionAccessKey`/`connectionMode` 三个 ref 是唯一真相源：
- 所有 Companion 请求的 URL + Bearer token 都从这两个 ref 读（getter 闭包）。
- `resolveStorage` 在 ViewModel 装配时读一次 `connectionMode.value` 决定存储后端。

**注入策略**：qiankun `mount(props)` 时，创建 app + Pinia 后、挂载前，调 `useSettingsStore()` 覆盖三个 ref：
- `companionUrl.value = props.companionUrl`
- `companionAccessKey.value = props.jwt`（宿主签发的 JWT，作为 Bearer token）
- `connectionMode.value = "localCompanion"`

这样 `resolveStorage` 拿到 `localCompanion` → 走 CompanionStorage，所有 fetch 带 JWT。

### 2.2 qiankun 生命周期

```ts
// main.ts
let app: App | null = null;

// 独立态：直接挂载
if (!window.__POWERED_BY_QIANKUN__) {
  render({});
}

// 嵌入态：导出生命周期
export async function bootstrap() {}
export async function mount(props) {
  render(props);
}
export async function unmount() {
  app?.unmount();
  app = null;
}

function render(props: { companionUrl?: string; jwt?: string }) {
  app = createApp(App);
  app.use(createPinia());
  app.directive('track', trackDirective);
  // 嵌入态：挂载前注入宿主配置
  if (window.__POWERED_BY_QIANKUN__) {
    const store = useSettingsStore();
    if (props.companionUrl) store.companionUrl = props.companionUrl;
    if (props.jwt) store.companionAccessKey = props.jwt;
    store.connectionMode = 'localCompanion';
    store.__embedded = true; // 标记嵌入态，禁用设置面板的连接编辑
  }
  app.mount(props.container ?? '#app');
}
```

### 2.3 资源路径相对化

qiankun 从 CDN/宿主加载子应用时，绝对 `/assets/xxx.js` 会请求宿主域名。改为动态 base：
- vite.config.ts 的 `base` 改为函数或用 qiankun 的 `__INJECTED_PUBLIC_PATH__`。
- qiankun 沙箱会在子应用 entry 执行前注入正确的 public path。

实际做法：保留 `base: '/'` 用于独立态（GitHub Pages 根路径）；qiankun 加载时由其 `import-entry` 处理资源路径重写（qiankun 默认行为）。本 PR 不改 vite base，靠 qiankun 的资源加载机制。

### 2.4 嵌入态禁用连接编辑

嵌入态下，Companion 连接信息由宿主管，用户不应在设置面板手动改。`settingsStore` 加 `__embedded` 标记，`ApiSettingsPanel` 据此禁用 connectionMode 切换 + companionUrl/accessKey 输入。

## 三、改造清单

### 3.1 main.ts 生命周期改造

**改 `src/main.ts`**（见 §2.2）：
- 导出 `bootstrap`/`mount`/`unmount`。
- 独立态（无 `__POWERED_BY_QIANKUN__`）直接 render。
- `render(props)` 统一入口，嵌入态注入配置。

### 3.2 全局类型声明

**新建 `src/qiankun.d.ts`**（或加到 `src/env.d.ts`）：
```ts
interface Window {
  __POWERED_BY_QIANKUN__?: boolean;
  __INJECTED_PUBLIC_PATH__?: string;
}
```

### 3.3 settingsStore 嵌入态标记 + 注入函数

**改 `src/stores/settingsStore.ts`**：
- 新增 `isEmbedded` ref（默认 false）。
- 新增 `applyEmbeddedConfig({ companionUrl, jwt })` action：设置三 refs + `isEmbedded = true`。
- `isEmbedded` 为 true 时，持久化 watch 跳过 companionUrl/accessKey（不覆盖宿主注入值）。

### 3.4 设置面板禁用嵌入态连接编辑

**改 `src/components/settings/ApiSettingsPanel.vue`**（或 StudioShell 透传）：
- `isEmbedded` 时禁用 connectionMode 单选 + companionUrl/accessKey 输入框 + 提示"嵌入态由宿主管控"。

需要把 `isEmbedded` 透传到 SettingsModal → ApiSettingsPanel。

### 3.5 vite 配置（可选优化）

vite.config.ts 暂不改 base（qiankun import-entry 处理资源）。但加注释说明嵌入态的资源加载由 qiankun 接管。

## 四、验收门槛

### 独立态回归（不能破）

- [ ] `pnpm dev` 独立运行，行为同阶段二（connectionMode 可切换、companionUrl 可编辑）
- [ ] `pnpm build` 产物正常，`index.html` 入口不变
- [ ] 无 `__POWERED_BY_QIANKUN__` 时走原有 `mount('#app')`

### 嵌入态（需手动验证或 mock 测试）

- [ ] 设置 `window.__POWERED_BY_QIANKUN__ = true` 后，main.ts 导出生命周期
- [ ] `mount({ companionUrl, jwt })` 后，settingsStore 三 refs 被正确注入
- [ ] 嵌入态 `connectionMode` 固定 `localCompanion`，resolveStorage 走 CompanionStorage
- [ ] 嵌入态所有 fetch 带 `Authorization: Bearer <jwt>`
- [ ] 嵌入态设置面板禁用连接编辑
- [ ] `unmount()` 正确卸载 app 实例

### 测试

- [ ] 新建 `src/main.test.ts`：mock `__POWERED_BY_QIANKUN__`，验证生命周期导出 + 注入逻辑（用 happy-dom）
- [ ] `pnpm test` 全绿 + `pnpm typecheck` 无错

## 五、回滚策略

main.ts 改动是核心。回滚 = `git revert`，revert 后回到纯独立态（无 qiankun 生命周期导出）。settingsStore 的 `isEmbedded` 是新增字段，不影响现有逻辑。

## 六、实施记录

> （PR 合并后填写）
