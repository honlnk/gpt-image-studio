import { describe, expect, it } from "vitest";
import { createZipArchive } from "./zipArchive";

describe("createZipArchive", () => {
  it("creates a zip with recoverable file names and contents", async () => {
    const zip = await createZipArchive([
      {
        name: "manifest.json",
        blob: new Blob([JSON.stringify({ app: "gpt-image-studio" })], {
          type: "application/json",
        }),
      },
      {
        name: "blobs/%E5%9B%BE%E7%89%87",
        blob: new Blob(["image-bytes"], { type: "image/png" }),
      },
    ]);

    expect(zip.type).toBe("application/zip");

    const files = await readLocalZipFiles(zip);
    expect(files.get("manifest.json")).toBe(
      JSON.stringify({ app: "gpt-image-studio" }),
    );
    expect(files.get("blobs/%E5%9B%BE%E7%89%87")).toBe("image-bytes");
  });

  it("writes the central directory and end of central directory records", async () => {
    const zip = await createZipArchive([
      { name: "a.txt", blob: new Blob(["A"]) },
      { name: "b.txt", blob: new Blob(["B"]) },
    ]);
    const buffer = await zip.arrayBuffer();
    const view = new DataView(buffer);
    const endOfCentralDirectoryOffset = buffer.byteLength - 22;

    expect(view.getUint32(endOfCentralDirectoryOffset, true)).toBe(0x06054b50);
    expect(view.getUint16(endOfCentralDirectoryOffset + 8, true)).toBe(2);
    expect(view.getUint16(endOfCentralDirectoryOffset + 10, true)).toBe(2);

    const centralDirectoryOffset = view.getUint32(
      endOfCentralDirectoryOffset + 16,
      true,
    );
    expect(view.getUint32(centralDirectoryOffset, true)).toBe(0x02014b50);
  });
});

async function readLocalZipFiles(zip: Blob) {
  const buffer = await zip.arrayBuffer();
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const files = new Map<string, string>();
  let offset = 0;

  while (offset + 30 <= buffer.byteLength) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) break;

    const compressedSize = view.getUint32(offset + 18, true);
    const filenameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + filenameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const name = decoder.decode(new Uint8Array(buffer, nameStart, filenameLength));
    const content = decoder.decode(new Uint8Array(buffer, dataStart, compressedSize));

    files.set(name, content);
    offset = dataEnd;
  }

  return files;
}
