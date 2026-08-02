/**
 * 解析 public 目录静态资源的运行时 URL。
 *
 * 嵌入态（qiankun）下，模板里的绝对路径（如 /favicon.svg）会按宿主
 * document.baseURI 解析到宿主 origin → 404（URL 解析不经沙箱）。
 * 需要用 qiankun 执行子应用 entry 前注入的
 * window.__INJECTED_PUBLIC_PATH_BY_QIANKUN__（= 宿主 registerMicroApps 的
 * entry 地址）拼出子应用源的完整 URL。独立态原样返回。
 */
export function resolvePublicAssetUrl(path: string): string {
  if (
    typeof window !== "undefined" &&
    window.__POWERED_BY_QIANKUN__
  ) {
    const publicPath = (
      window as unknown as Record<string, unknown>
    ).__INJECTED_PUBLIC_PATH_BY_QIANKUN__ as string | undefined;
    if (publicPath) return new URL(path, publicPath).href;
  }
  return path;
}
