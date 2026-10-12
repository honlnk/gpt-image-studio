/** 设置面板词条（通用 / 接口 / 提示词模式等全部 settings 面板 + 设置弹窗骨架）。 */
export default {
  modal: {
    title: "设置",
  },
  general: {
    title: "通用",
    embeddedTitle: "🔗 嵌入模式",
    embeddedDescription:
      "当前作为子应用嵌入宿主系统运行，连接地址与认证令牌由宿主管控，无需手动配置。",
    desktopTitle: "🖥️ 桌面内置服务",
    desktopDescription:
      "内置 Companion 服务随桌面应用自动启动并完成连接，数据与 npm CLI 版共享（~/.gpt-image-studio）。provider 凭据在管理页维护，无需手动配置连接。",
    connectionMode: "连接模式",
    modeDirect: "浏览器直连",
    modeLocalCompanion: "本地 Companion",
    connectionModeHint:
      "切换连接模式后页面会自动重新加载，两种模式的数据互相隔离。",
    switchTitle: "切换到「{target}」",
    switchDescription:
      "切换后，当前「{current}」的内容将不可见（不会删除），新内容会存到新位置。切回「{current}」可找回原有内容。页面将自动重新加载以应用新模式。",
    switchConfirm: "切换",
    autoRetryTitle: "网络失败自动重试",
    autoRetryDescription:
      "开启后，当网络连接失败时会自动重试（指数退避，最多 10 次）。",
    languageTitle: "界面语言",
    languageAuto: "跟随系统",
    languageZh: "中文",
    languageEn: "English",
  },
};
