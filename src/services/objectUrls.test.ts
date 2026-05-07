import { afterEach, describe, expect, it, vi } from "vitest";
import { createObjectUrl, revokeObjectUrl, revokeObjectUrls } from "./objectUrls";

describe("object URL helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates object URLs through the browser API", () => {
    const createSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:http://localhost/image");
    const blob = new Blob(["image"]);

    expect(createObjectUrl(blob)).toBe("blob:http://localhost/image");
    expect(createSpy).toHaveBeenCalledWith(blob);
  });

  it("revokes only blob URLs", () => {
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    revokeObjectUrl("blob:http://localhost/image");
    revokeObjectUrl("https://example.com/image.png");
    revokeObjectUrl(undefined);

    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith("blob:http://localhost/image");
  });

  it("revokes URL collections", () => {
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    revokeObjectUrls([
      "blob:http://localhost/one",
      undefined,
      "blob:http://localhost/two",
    ]);

    expect(revokeSpy).toHaveBeenCalledTimes(2);
    expect(revokeSpy).toHaveBeenNthCalledWith(1, "blob:http://localhost/one");
    expect(revokeSpy).toHaveBeenNthCalledWith(2, "blob:http://localhost/two");
  });
});
