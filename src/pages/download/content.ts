/**
 * 下载页的文案与 SEO 内容单一来源。
 *
 * 同一份数据喂给两个消费者，保证「页面可见内容」与「给爬虫的结构化数据」一致：
 * - DownloadPage.vue（页面 UI：hero、FAQ 手风琴）；
 * - ssgTemplate.ts（vite-ssg onBeforePageRender 的 meta/JSON-LD 改写）。
 *
 * 注意：本文件被 vite.config.ts（Node 侧）import，必须保持无浏览器依赖的纯数据。
 */

export const DOWNLOAD_PAGE = {
  path: "/download",
  // canonical/OG 用带尾斜杠的最终 URL（GH Pages 对无斜杠目录 URL 返回 301）
  url: "https://image.honlnk.com/download/",
  title: "下载 GPT Image Studio 桌面版 - macOS / Windows / Linux",
  description:
    "免费开源的本地优先 AI 图片创作工作台桌面版：内嵌 Companion 服务开箱即连，无需安装 Node。提供 macOS（Apple Silicon）/ Windows / Linux 安装包，附 macOS 未签名放行教程。",
  ogTitle: "下载 GPT Image Studio 桌面版",
  ogDescription:
    "本地优先的 AI 图片创作工作台桌面版：内嵌 Companion 开箱即连，数据不出本机。macOS / Windows / Linux 安装包免费下载。",
} as const;

/** 平台键 → 中文展示名（hero 推荐按钮与平台卡片共用）。 */
export const PLATFORM_LABELS: Record<import("../../shared/downloads").DesktopPlatformKey, string> = {
  macArm64: "macOS（Apple Silicon）",
  windowsX64: "Windows（64 位）",
  linuxAppImage: "Linux（AppImage）",
  linuxDeb: "Linux（deb）",
};

/** FAQ 条目。页面手风琴与 JSON-LD FAQPage 共用，两者必须一致。 */
export const DOWNLOAD_FAQS: ReadonlyArray<{ question: string; answer: string }> = [
  {
    question: "macOS 打开时提示「无法验证开发者」怎么办？",
    answer:
      "这是未签名开源软件的正常提示，不是病毒。两种放行方式：系统设置 → 隐私与安全性 →「仍要打开」；或终端执行 xattr -cr /Applications/GPT\\ Image\\ Studio.app 后正常打开。",
  },
  {
    question: "桌面版收费吗？",
    answer:
      "完全免费，MIT 协议开源。桌面版不含任何广告、不收集数据，图片生成调的是你自己配置的服务商 API。",
  },
  {
    question: "桌面版和网页版的数据互通吗？",
    answer:
      "不互通。桌面版的会话与图片保存在独立的应用数据分区，与浏览器里的网页版互不影响；但两者共享本机 Companion 的服务商凭据配置（~/.gpt-image-studio）。",
  },
  {
    question: "Windows / Linux 版本什么时候有？",
    answer:
      "三平台构建流水线已就绪（GitHub Actions 自动出包），Windows（NSIS 安装包）和 Linux（AppImage / deb）将随下一个桌面版本一起发布，届时本页面对应按钮会自动开放。",
  },
  {
    question: "桌面版和直接用网页版有什么区别？",
    answer:
      "桌面版内嵌 Companion 本地服务：安装即用、无需手动配对，多服务商适配和凭据管理都在本机完成，也不受浏览器跨域（CORS）限制——部分只返回图片链接的服务商在网页直连模式下无法自动取图，桌面版没有这个问题。",
  },
];

/** JSON-LD SoftwareApplication（下载页专用，替代首页的 WebApplication 块）。 */
export function buildDownloadJsonLd(): string {
  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "GPT Image Studio",
      applicationCategory: "DesignApplication",
      operatingSystem: "macOS, Windows, Linux",
      url: DOWNLOAD_PAGE.url,
      downloadUrl: DOWNLOAD_PAGE.url,
      description: DOWNLOAD_PAGE.description,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      author: {
        "@type": "Organization",
        name: "honlnk",
        url: "https://github.com/honlnk",
      },
    },
    null,
    2,
  );
}

/** JSON-LD FAQPage（内容与页面 FAQ 一致）。 */
export function buildDownloadFaqJsonLd(): string {
  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: DOWNLOAD_FAQS.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    },
    null,
    2,
  );
}
