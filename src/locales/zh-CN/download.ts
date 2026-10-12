/**
 * 下载页（/download）词库：页面 UI 文案与 SEO meta（zh 侧，en 侧深层同构）。
 *
 * - 默认导出进主 i18n 词库，组件用 $t("download.ui.xxx")；内嵌 <strong>/<code>/<a>
 *   的长句按「before/bold/after」拆键，拆出的前后段保留渲染所需的空格，
 *   保证与改造前的渲染逐字一致。
 * - FAQ 是数据不是词条：页面手风琴与 JSON-LD FAQPage 共用同一份 faqs，
 *   走具名导出（content.ts 的 downloadFaqs 直接取值，不经 t()）。
 * - 注意：faqs 必须放在默认导出之前（scripts/i18n-verify-refs.mjs 会把默认
 *   导出语句之后到文件末尾的源码当对象字面量求值，注释里也不能出现该关键字）。
 */

/** FAQ 条目（页面手风琴与 JSON-LD FAQPage 共用，两者必须一致）。 */
export const faqs: ReadonlyArray<{ question: string; answer: string }> = [
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

export default {
  "meta": {
    "title": "下载 GPT Image Studio 桌面版 - macOS / Windows / Linux",
    "description":
      "免费开源的本地优先 AI 图片创作工作台桌面版：内嵌 Companion 服务开箱即连，无需安装 Node。提供 macOS（Apple Silicon）/ Windows / Linux 安装包，附 macOS 未签名放行教程。",
    "ogTitle": "下载 GPT Image Studio 桌面版",
    "ogDescription":
      "本地优先的 AI 图片创作工作台桌面版：内嵌 Companion 开箱即连，数据不出本机。macOS / Windows / Linux 安装包免费下载。",
  },
  "ui": {
    // 页头互链（自描述，不翻译）：zh 页显示 English，en 页显示中文
    "langSwitch": "English",
    // 语言提示条：目标读者是另一语言的用户，文案用对方的语言
    "noticeText": "This page is also available in English.",
    "noticeLink": "Switch to English",
    "nav": {
      "releases": "全部版本",
      "openWeb": "打开网页版",
    },
    "hero": {
      "badge": "开源免费 · MIT · v{version}（{date} 发布）",
      "titleLine1": "下载 GPT Image Studio",
      "titleLine2": "桌面版",
      "subtitle":
        "本地优先的 AI 图片创作工作台。桌面版内嵌 Companion 本地服务——安装即用， 无需安装 Node、无需手动配对，多服务商凭据管理都在你自己的电脑上完成。",
      "downloadFor": "下载 {platform} 版",
      "allReleases": "全部版本（GitHub Releases）",
      "unknownPlatformHint": "（未识别系统时已为你推荐主流平台，可在下方卡片切换）",
      // 底部信任行拆三段，中间是 <a> 链接
      "trustPrefix": "无广告 · 数据不出本机 · 安装包未做平台签名（开源免签名分发，",
      "firstRunGuide": "首次打开指引",
      "trustSuffix": "）",
    },
    "platforms": {
      "macArm64": "macOS（Apple Silicon）",
      "windowsX64": "Windows（64 位）",
      "linuxAppImage": "Linux（AppImage）",
      "linuxDeb": "Linux（deb）",
    },
    "cards": {
      "macChip": "Apple Silicon（M 系列芯片）",
      // desc + 链接 + 句号拆三段，中间是 <a> 链接
      "macDesc": "下载 dmg 拖入「应用程序」即可。未签名应用首次打开需放行一次，",
      "macGuideLink": "看图文指引",
      "macGuideSuffix": "。",
      "downloadDmg": "下载 dmg",
      "comingSoon": "敬请期待",
      "macIntelNote": "Intel 芯片版本后续提供",
      "winChip": "64 位 · NSIS 安装包",
      "winDesc":
        "安装包未签名，首次运行 SmartScreen 点「更多信息 → 仍要运行」即可正常使用。",
      "downloadInstaller": "下载安装包",
      "comingSoonNext": "敬请期待 · 随下一版本发布",
      "pipelineReady": "构建流水线已就绪，发版后此按钮自动开放",
      "linuxPipelineReady": "构建流水线已就绪，发版后按钮自动开放",
      "linuxChip": "AppImage · deb",
      "linuxDesc": "无来源检查机制：AppImage 加执行权限即跑，deb 直接安装。",
      // 历史版本行拆前后段，中间是 GitHub Releases 链接（品牌名不翻）
      "historyPrefix": "需要历史版本或校验文件？前往 ",
      "historySuffix": " 下载任意版本。",
    },
    "guide": {
      "title": "macOS 安装指引",
      "recommended": "推荐方式",
      "recommendedTitle": "终端一行命令安装，全程零警告",
      "recommendedDesc":
        "命令行下载的文件不会被 macOS 标记隔离，Gatekeeper 不会拦截——复制下面这行到「终端」执行， 自动完成下载、安装到「应用程序」，装完直接打开，无需下面的手动放行步骤：",
      "copied": "已复制 ✓",
      "copy": "复制",
      "auditNote": "脚本内容公开可审计：",
      "manualTitle": "手动安装（浏览器下载）",
      // 手动安装导语拆五段：文本 + <strong> + 文本 + <a> + 文本
      "manualIntro1":
        "安装包没有购买 Apple 开发者签名（$99/年，对本项目没有性价比），首次打开会被 Gatekeeper 拦一次。这是",
      "manualIntroBold": "开源未签名软件的正常提示，不是病毒",
      "manualIntro2": "—— 整个应用（",
      "manualIntroLink": "源码",
      "manualIntro3": "）都可审计。放行一次，之后与正常应用无异。",
      "step1Title": "安装",
      // 步骤 1 描述拆三段，中间是 <code>.dmg</code> 与 <strong>GPT Image Studio</strong>
      "step1Desc1": "打开下载的 ",
      "step1Desc2": " 文件，把 ",
      "step1Desc3": " 拖进「应用程序」（Applications）文件夹。",
      "step2Title": "首次打开：方式一（图形界面）",
      // 步骤 2 描述含两处加粗，按 文本/加粗/文本/加粗/文本 拆键
      "step2Desc1": "双击打开会提示「无法打开，因为无法验证开发者」。这时前往 ",
      "step2Bold1": "系统设置 → 隐私与安全性",
      "step2Desc2": "，下拉到「安全性」一节，点 GPT Image Studio 旁的「",
      "step2Bold2": "仍要打开",
      "step2Desc3": "」。",
      "step2Note": "（macOS 15 起已不再支持「右键 → 打开」的老旁路。）",
      "step3Title": "首次打开：方式二（终端一行命令）",
      "step3Desc": "更习惯终端的话，清除下载隔离属性即可，与方式一等效：",
      "step4Title": "正常使用",
      "step4Desc":
        "之后从「应用程序」或 Launchpad 正常打开即可。内嵌的 Companion 服务会随应用自动启动并完成连接， 打开设置页即可配置服务商凭据。",
    },
    "why": {
      "title": "为什么用桌面版？",
      "subtitle": "网页版已经够用，桌面版让体验再进一步。",
      "feature1Title": "开箱即连",
      "feature1Desc":
        "内嵌 Companion 本地服务，启动应用自动拉起并完成连接——不用装 Node、不用 npm 全局包、不用复制粘贴连接密钥。和 CLI 版 Companion 共享数据目录，凭据配置两边通用。",
      "feature2Title": "不受浏览器跨域限制",
      "feature2Desc":
        "部分中转服务商只返回图片链接而不返回 base64，网页直连模式受 CDN 的 CORS 策略限制可能取不到图。桌面版由本机服务在服务端取图，没有这个问题。",
      "feature3Title": "数据不出本机",
      "feature3Desc":
        "会话、图片、服务商凭据全部保存在你自己的电脑上（~/.gpt-image-studio），不经过任何第三方服务器。应用本身不联网、不埋点、无广告。",
      "feature4Title": "轻量原生体验",
      "feature4Desc":
        "基于 Tauri v2 系统 webview，安装包只有数 MB（而非 Electron 的数百 MB）。独立窗口、独立数据分区，与浏览器里的网页版互不影响。",
    },
    "faqTitle": "常见问题",
    "footer": {
      "license": "MIT 开源 · © honlnk",
      "web": "网页版",
      "issues": "问题反馈",
    },
    "approxSize": "约 {size} MB",
  },
};
