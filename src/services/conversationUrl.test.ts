import { describe, expect, it, vi } from "vitest";
import {
  readConversationIdFromUrl,
  writeConversationIdToUrl,
} from "./conversationUrl";

describe("readConversationIdFromUrl", () => {
  it("读取 ?c=<id>", () => {
    expect(
      readConversationIdFromUrl({ search: "?c=conv-1" }),
    ).toBe("conv-1");
  });

  it("无 ?c= 时返回 null", () => {
    expect(readConversationIdFromUrl({ search: "" })).toBeNull();
    expect(
      readConversationIdFromUrl({ search: "?other=foo" }),
    ).toBeNull();
  });

  it("空值返回 null", () => {
    expect(readConversationIdFromUrl({ search: "?c=" })).toBeNull();
  });

  it("trim 空白后为空返回 null", () => {
    expect(readConversationIdFromUrl({ search: "?c=%20%20" })).toBeNull();
  });

  it("trim 首尾空白", () => {
    expect(
      readConversationIdFromUrl({ search: "?c=%20conv-2%20" }),
    ).toBe("conv-2");
  });

  it("URL 编码的 id 正常解码", () => {
    // 含特殊字符的 id（如 base64 / 时间戳前缀）
    expect(
      readConversationIdFromUrl({ search: "?c=abc%2B123%3D%3D" }),
    ).toBe("abc+123==");
  });

  it("不校验存在性——无效 id 原样返回，存在性校验由调用方做", () => {
    expect(
      readConversationIdFromUrl({ search: "?c=nonexistent" }),
    ).toBe("nonexistent");
  });
});

describe("writeConversationIdToUrl", () => {
  function fakeLocation(search = "", pathname = "/studio", hash = "") {
    return { pathname, search, hash };
  }

  function fakeHistory() {
    return {
      pushState: vi.fn(),
      replaceState: vi.fn(),
    };
  }

  it("replace 模式调用 replaceState（默认 mode）", () => {
    const location = fakeLocation("");
    const history = fakeHistory();

    writeConversationIdToUrl("conv-1", "replace", location, history);

    expect(history.replaceState).toHaveBeenCalledOnce();
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/studio?c=conv-1");
    expect(history.pushState).not.toHaveBeenCalled();
  });

  it("push 模式调用 pushState", () => {
    const location = fakeLocation("");
    const history = fakeHistory();

    writeConversationIdToUrl("conv-1", "push", location, history);

    expect(history.pushState).toHaveBeenCalledOnce();
    expect(history.pushState).toHaveBeenCalledWith(null, "", "/studio?c=conv-1");
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it("省略 mode 默认走 replace（避免遗漏 mode 污染历史栈）", () => {
    const location = fakeLocation("");
    const history = fakeHistory();

    writeConversationIdToUrl("conv-1", undefined, location, history);

    expect(history.replaceState).toHaveBeenCalledOnce();
    expect(history.pushState).not.toHaveBeenCalled();
  });

  it("空 id 删除 ?c= 键", () => {
    const location = fakeLocation("?c=old-id");
    const history = fakeHistory();

    writeConversationIdToUrl("", "replace", location, history);

    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/studio");
  });

  it("保留 URL 上其它 query 参数（只增删 c 键）", () => {
    const location = fakeLocation("?view=embed&token=abc");
    const history = fakeHistory();

    writeConversationIdToUrl("conv-1", "replace", location, history);

    // URLSearchParams.toString() 按插入顺序：原有 view/token + 新增 c
    expect(history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/studio?view=embed&token=abc&c=conv-1",
    );
  });

  it("更新时保留其它参数，c 原位置替换为值", () => {
    const location = fakeLocation("?view=embed&c=old-id&token=abc");
    const history = fakeHistory();

    writeConversationIdToUrl("new-id", "replace", location, history);

    expect(history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/studio?view=embed&c=new-id&token=abc",
    );
  });

  it("hash 段原样保留", () => {
    const location = fakeLocation("", "/studio", "#section");
    const history = fakeHistory();

    writeConversationIdToUrl("conv-1", "push", location, history);

    expect(history.pushState).toHaveBeenCalledWith(
      null,
      "",
      "/studio?c=conv-1#section",
    );
  });

  it("id 含特殊字符被 URL 编码", () => {
    const location = fakeLocation("");
    const history = fakeHistory();

    writeConversationIdToUrl("abc+123==", "replace", location, history);

    // URLSearchParams 会把 + / = 编码成 %2B / %3D
    expect(history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/studio?c=abc%2B123%3D%3D",
    );
  });
});
