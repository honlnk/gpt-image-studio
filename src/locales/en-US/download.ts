/**
 * Download page copy (en-US side). Deep-isomorphic with zh-CN/download:
 * the default export is typed as the zh-CN schema (vue-tsc enforces every
 * key), and the faqs named export mirrors the zh-CN FAQ list 1:1.
 *
 * Segment keys that were split around embedded <strong>/<code>/<a> markup
 * keep the surrounding spaces the English sentences need.
 */
type ZhDownload = typeof import("../zh-CN/download").default;
type ZhDownloadFaqs = typeof import("../zh-CN/download").faqs;

/** FAQ entries (page accordion and JSON-LD FAQPage share this list). */
export const faqs: ZhDownloadFaqs = [
  {
    question:
      "macOS says the app can't be opened because the developer can't be verified. What should I do?",
    answer:
      "This is the normal warning for unsigned open-source software, not a virus. Two ways to approve it: System Settings → Privacy & Security → \"Open Anyway\"; or run xattr -cr /Applications/GPT\\ Image\\ Studio.app in Terminal, then open the app normally.",
  },
  {
    question: "Is the desktop app paid?",
    answer:
      "Completely free, open source under the MIT license. No ads, no data collection — image generation calls the provider APIs you configure yourself.",
  },
  {
    question: "Does the desktop app share data with the web app?",
    answer:
      "No. Desktop conversations and images live in a separate app data partition and don't affect the web app in your browser; both do share the Companion provider credentials on this machine (~/.gpt-image-studio).",
  },
  {
    question: "When will Windows / Linux builds arrive?",
    answer:
      "The three-platform build pipeline is ready (GitHub Actions produces the packages automatically). Windows (NSIS installer) and Linux (AppImage / deb) will ship with the next desktop release, and the buttons on this page will unlock automatically then.",
  },
  {
    question: "How is the desktop app different from just using the web app?",
    answer:
      "The desktop app embeds the Companion local service: it works right after installation with no manual pairing, multi-provider adaptation and credential management all happen on your machine, and it isn't subject to browser CORS limits — some providers only return image URLs, which the web app's direct mode can't always fetch automatically. The desktop app has no such problem.",
  },
];

const download: ZhDownload = {
  "meta": {
    "title": "Download GPT Image Studio Desktop - macOS / Windows / Linux",
    "description":
      "Free and open-source desktop app of a local-first AI image creation workbench: an embedded Companion service connects out of the box — no Node.js required. macOS (Apple Silicon) / Windows / Linux installers, with a guide for approving the unsigned macOS app.",
    "ogTitle": "Download GPT Image Studio Desktop",
    "ogDescription":
      "The desktop app of a local-first AI image creation workbench: embedded Companion, works out of the box, your data never leaves your machine. Free downloads for macOS / Windows / Linux.",
  },
  "ui": {
    // Header cross-link (self-describing, never translated)
    "langSwitch": "中文",
    // Locale notice: written in the language of the page we're pointing to
    "noticeText": "本页提供中文版本。",
    "noticeLink": "切换到中文",
    "nav": {
      "releases": "All releases",
      "openWeb": "Open Web App",
    },
    "hero": {
      "badge": "Open source · MIT · v{version} (released {date})",
      "titleLine1": "Download GPT Image Studio",
      "titleLine2": "for Desktop",
      "subtitle":
        "A local-first AI image creation workbench. The desktop app ships with an embedded Companion service — it works right after installation, with no Node.js to install and no manual pairing; multi-provider credentials are managed on your own computer.",
      "downloadFor": "Download for {platform}",
      "allReleases": "All releases (GitHub Releases)",
      "unknownPlatformHint":
        "(Your system wasn't recognized, so the most common platform is recommended — switch on the cards below.)",
      // Trust line split into three segments around an <a> link
      "trustPrefix":
        "No ads · Your data never leaves your machine · Installers are unsigned (standard for free open-source distribution, ",
      "firstRunGuide": "see the first-launch guide",
      "trustSuffix": ")",
    },
    "platforms": {
      "macArm64": "macOS (Apple Silicon)",
      "windowsX64": "Windows (64-bit)",
      "linuxAppImage": "Linux (AppImage)",
      "linuxDeb": "Linux (deb)",
    },
    "cards": {
      "macChip": "Apple Silicon (M-series chips)",
      // desc + link + period split into three segments around an <a> link
      "macDesc":
        "Download the dmg and drag the app into Applications. Unsigned apps need a one-time approval on first launch — ",
      "macGuideLink": "see the step-by-step guide",
      "macGuideSuffix": ".",
      "downloadDmg": "Download dmg",
      "comingSoon": "Coming soon",
      "macIntelNote": "Intel builds may arrive later",
      "winChip": "64-bit · NSIS installer",
      "winDesc":
        "The installer is unsigned. On first run, click \"More info → Run anyway\" in the SmartScreen prompt and it works normally.",
      "downloadInstaller": "Download installer",
      "comingSoonNext": "Coming soon · ships with the next release",
      "pipelineReady":
        "The build pipeline is ready — this button unlocks automatically once the release is out",
      "linuxPipelineReady":
        "The build pipeline is ready — the buttons unlock automatically once the release is out",
      "linuxChip": "AppImage · deb",
      "linuxDesc":
        "No origin checks to bypass: make the AppImage executable and run it, or install the deb directly.",
      // History line split around the GitHub Releases link (brand name, not translated)
      "historyPrefix": "Need an older version or checksums? Head to ",
      "historySuffix": " to grab any release.",
    },
    "guide": {
      "title": "macOS Installation Guide",
      "recommended": "Recommended",
      "recommendedTitle": "One terminal command, zero warnings",
      "recommendedDesc":
        "Files downloaded from the command line are not quarantined by macOS, so Gatekeeper never intercepts them. Copy the line below into Terminal — it downloads the app, installs it into Applications, and opens it right away, no manual approval needed:",
      "copied": "Copied ✓",
      "copy": "Copy",
      "auditNote": "The install script is fully auditable: ",
      "manualTitle": "Manual install (browser download)",
      // Manual intro split into five segments: text + <strong> + text + <a> + text
      "manualIntro1":
        "The installer is not signed with an Apple Developer certificate ($99/year — hardly worth it for this project), so Gatekeeper blocks the first launch. This is ",
      "manualIntroBold": "the normal warning for unsigned open-source software, not a virus",
      "manualIntro2": " — the entire app (",
      "manualIntroLink": "source code",
      "manualIntro3":
        ") is open for audit. Approve it once and it behaves like any normal app.",
      "step1Title": "Install",
      // Step 1 description split around <code>.dmg</code> and <strong>GPT Image Studio</strong>
      "step1Desc1": "Open the downloaded ",
      "step1Desc2": " file and drag ",
      "step1Desc3": " into the Applications folder.",
      "step2Title": "First launch: option 1 (GUI)",
      // Step 2 description has two bold spans: text/bold/text/bold/text
      "step2Desc1":
        "Double-clicking the app shows \"can't be opened because it cannot be checked for malicious software\". Go to ",
      "step2Bold1": "System Settings → Privacy & Security",
      "step2Desc2":
        ", scroll down to the Security section and click \"",
      "step2Bold2": "Open Anyway",
      "step2Desc3": "\" next to GPT Image Studio.",
      "step2Note":
        "(Since macOS 15 the old \"right-click → Open\" bypass no longer works.)",
      "step3Title": "First launch: option 2 (one terminal command)",
      "step3Desc":
        "If you prefer the terminal, clearing the download quarantine attribute works the same as option 1:",
      "step4Title": "Use it as normal",
      "step4Desc":
        "Afterwards, open it from Applications or Launchpad like any other app. The embedded Companion service starts and connects automatically — open Settings to configure your provider credentials.",
    },
    "why": {
      "title": "Why the desktop app?",
      "subtitle": "The web app already does the job — the desktop app takes it further.",
      "feature1Title": "Works out of the box",
      "feature1Desc":
        "The embedded Companion service starts and connects automatically with the app — no Node.js, no global npm package, no copy-pasting connection keys. It shares its data directory with the CLI Companion, so credentials configured in one work in both.",
      "feature2Title": "No browser CORS limits",
      "feature2Desc":
        "Some proxy providers return only image URLs instead of base64, and browser direct mode can fail to fetch them under CDN CORS policies. The desktop app fetches images locally on the server side — no such problem.",
      "feature3Title": "Your data stays local",
      "feature3Desc":
        "Conversations, images, and provider credentials all live on your own computer (~/.gpt-image-studio) and never pass through any third-party server. The app itself makes no tracking requests and shows no ads.",
      "feature4Title": "Lightweight native feel",
      "feature4Desc":
        "Built on the Tauri v2 system webview, the installer is only a few MB (versus hundreds for Electron). Its own window and separate data partition keep it fully independent from the web app in your browser.",
    },
    "faqTitle": "FAQ",
    "footer": {
      "license": "MIT open source · © honlnk",
      "web": "Web App",
      "issues": "Report an Issue",
    },
    "approxSize": "~{size} MB",
  },
};

export default download;
