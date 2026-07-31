import { describe, expect, it } from "vitest";
import { buildPickerCommand, parsePickerPath } from "./directoryPicker.js";

/**
 * directoryPicker 纯函数测试：命令构建（按平台）+ 输出解析。
 * pickDirectoryNative 实际弹原生对话框，不进测试（CI/开发机不可控）。
 */

describe("buildPickerCommand", () => {
  it("macOS 用 osascript choose folder", () => {
    const cmd = buildPickerCommand("darwin");
    expect(cmd?.cmd).toBe("osascript");
    expect(cmd?.args.join(" ")).toContain("choose folder");
  });

  it("Windows 用 PowerShell FolderBrowserDialog", () => {
    const cmd = buildPickerCommand("win32");
    expect(cmd?.cmd).toBe("powershell.exe");
    expect(cmd?.args.join(" ")).toContain("FolderBrowserDialog");
  });

  it("Linux 用 zenity 目录选择", () => {
    const cmd = buildPickerCommand("linux");
    expect(cmd?.cmd).toBe("zenity");
    expect(cmd?.args).toContain("--directory");
  });

  it("不支持的平台返回 undefined", () => {
    expect(buildPickerCommand("freebsd")).toBeUndefined();
  });
});

describe("parsePickerPath", () => {
  it("去掉 osascript 输出的尾斜杠", () => {
    expect(parsePickerPath("/Users/x/Pictures/\n")).toBe("/Users/x/Pictures");
  });

  it("去掉 Windows 输出的尾反斜杠", () => {
    expect(parsePickerPath("C:\\Users\\x\\Pictures\\\r\n")).toBe("C:\\Users\\x\\Pictures");
  });

  it("根目录保留", () => {
    expect(parsePickerPath("/\n")).toBe("/");
  });

  it("空输出（取消）返回空串", () => {
    expect(parsePickerPath("  \n")).toBe("");
  });

  it("无尾斜杠原样返回", () => {
    expect(parsePickerPath("/Users/x/Pictures")).toBe("/Users/x/Pictures");
  });
});
