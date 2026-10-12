type ZhSettings = typeof import("../zh-CN/settings").default;

/** Settings panel strings (all settings panels + modal shell). */
const settings: ZhSettings = {
  modal: {
    title: "Settings",
  },
  general: {
    title: "General",
    embeddedTitle: "🔗 Embedded Mode",
    embeddedDescription:
      "Running as a sub-application embedded in a host system. The connection address and auth token are managed by the host — no manual configuration needed.",
    desktopTitle: "🖥️ Built-in Desktop Service",
    desktopDescription:
      "The built-in Companion service starts automatically with the desktop app and connects on its own. Data is shared with the npm CLI version (~/.gpt-image-studio). Provider credentials are managed on the admin page — no manual connection setup needed.",
    connectionMode: "Connection Mode",
    modeDirect: "Browser Direct",
    modeLocalCompanion: "Local Companion",
    connectionModeHint:
      "The page reloads automatically after switching connection modes. Data between the two modes is isolated from each other.",
    switchTitle: 'Switch to "{target}"',
    switchDescription:
      'After switching, the content of "{current}" becomes invisible (not deleted) and new content is stored in the new location. Switching back to "{current}" restores the original content. The page will reload automatically to apply the new mode.',
    switchConfirm: "Switch",
    autoRetryTitle: "Auto-retry on Network Failure",
    autoRetryDescription:
      "When enabled, failed network requests are retried automatically (exponential backoff, up to 10 attempts).",
    languageTitle: "Interface Language",
    languageAuto: "Follow System",
    languageZh: "中文",
    languageEn: "English",
  },
};

export default settings;
