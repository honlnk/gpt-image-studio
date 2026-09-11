import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DOWNLOAD_FAQS, DOWNLOAD_PAGE } from "./content";
import { renderDownloadTemplate } from "./ssgTemplate";

// 直接读仓库里真实的 index.html 做回归：首页模板结构变化导致改写失配时，
// renderDownloadTemplate 会抛错，本测试同步失败（这是设计好的 fail-loud 行为）。
const indexHtml = readFileSync(new URL("../../../index.html", import.meta.url), "utf8");

describe("renderDownloadTemplate", () => {
  const out = renderDownloadTemplate(indexHtml);

  it("replaces title / description / canonical with download-page values", () => {
    expect(out).toContain(`<title>${DOWNLOAD_PAGE.title}</title>`);
    expect(out).toContain(`<link rel="canonical" href="${DOWNLOAD_PAGE.url}" />`);
    expect(out).toContain(DOWNLOAD_PAGE.description);
    expect(out).not.toContain('<link rel="canonical" href="https://image.honlnk.com/"');
  });

  it("rewrites OG / Twitter urls and titles to the download page", () => {
    expect(out).toContain(`<meta property="og:url" content="${DOWNLOAD_PAGE.url}" />`);
    expect(out).toContain(`<meta property="og:title" content="${DOWNLOAD_PAGE.ogTitle}" />`);
    expect(out).toContain(`<meta name="twitter:url" content="${DOWNLOAD_PAGE.url}" />`);
  });

  it("drops homepage JSON-LD and injects SoftwareApplication + FAQPage", () => {
    expect(out).not.toContain('"WebApplication"');
    expect(out).toContain('"SoftwareApplication"');
    expect(out).toContain('"FAQPage"');
    // FAQ 结构化数据与页面可见内容同源
    for (const faq of DOWNLOAD_FAQS) {
      expect(out).toContain(faq.question.replace(/&/g, "&amp;"));
    }
  });

  it("strips the splash markup and its inline style", () => {
    expect(out).not.toContain("app-splash");
    expect(out).not.toContain("splash-breathe");
  });

  it("removes the homepage keywords meta", () => {
    expect(out).not.toContain('name="keywords"');
  });

  it("fails loudly when the template no longer matches", () => {
    expect(() => renderDownloadTemplate("<html><head></head><body></body></html>")).toThrow(
      /download-ssg/,
    );
  });

  it("tolerates CRLF line endings (Windows CI checkout with autocrlf)", () => {
    const crlfHtml = indexHtml.replace(/\r?\n/g, "\r\n");
    const crlfOut = renderDownloadTemplate(crlfHtml);
    expect(crlfOut).toContain(`<title>${DOWNLOAD_PAGE.title}</title>`);
    expect(crlfOut).not.toContain("app-splash");
    expect(crlfOut).toContain('"SoftwareApplication"');
  });

  // Windows 构建产物里 splash </div> 与 </body> 之间可能没有换行（CI 实测），
  // 源模板里入口 <script> 也可能被 Vite 提升到 <head>——结构变体都要能剔除干净。
  it("strips splash across structural variants of the built template", () => {
    const scriptTag = '    <script type="module" src="/src/main.ts"></script>';
    expect(indexHtml).toContain(scriptTag);

    const hoistedScript = indexHtml.replace(`${scriptTag}\n`, ""); // 脚本提升到 head，body 尾部只剩 </div>\n</body>
    expect(renderDownloadTemplate(hoistedScript)).not.toContain("app-splash");

    const glued = indexHtml.replace(`</div>\n${scriptTag}`, "</div></body>"); // </div> 后直接 </body>
    expect(renderDownloadTemplate(glued)).not.toContain("app-splash");
  });
});
