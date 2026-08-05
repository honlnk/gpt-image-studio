/**
 * 浏览器剪贴板复制。
 *
 * 优先使用 Clipboard API（安全上下文 / https / localhost 下可用），
 * 不可用时降级到隐藏 textarea + `document.execCommand("copy")`。
 * 这是兼容旧浏览器与 Tauri webview 的保守策略。
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 剪贴板 API 不可用或被拒绝（如非安全上下文、权限策略拦截），
      // 回退到隐藏 textarea 方案。
    }
  }
  copyTextWithTextarea(text);
}

function copyTextWithTextarea(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}
