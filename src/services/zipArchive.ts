type ZipEntry = {
  name: string;
  blob: Blob;
};

type PreparedZipEntry = ZipEntry & {
  crc32: number;
  data: ArrayBuffer;
  localHeaderOffset: number;
};

const textEncoder = new TextEncoder();
const crcTable = createCrcTable();

export async function createZipArchive(entries: ZipEntry[]) {
  let offset = 0;
  const preparedEntries: PreparedZipEntry[] = [];
  const parts: BlobPart[] = [];

  for (const entry of entries) {
    const data = await entry.blob.arrayBuffer();
    const preparedEntry: PreparedZipEntry = {
      ...entry,
      crc32: crc32(new Uint8Array(data)),
      data,
      localHeaderOffset: offset,
    };
    const localHeader = zipLocalHeader(preparedEntry);

    preparedEntries.push(preparedEntry);
    parts.push(localHeader, data);
    offset += localHeader.byteLength + data.byteLength;
  }

  const centralDirectoryOffset = offset;
  const centralDirectoryParts = preparedEntries.map((entry) =>
    zipCentralDirectoryHeader(entry),
  );
  const centralDirectorySize = centralDirectoryParts.reduce(
    (size, part) => size + part.byteLength,
    0,
  );

  parts.push(...centralDirectoryParts);
  parts.push(
    zipEndOfCentralDirectory(
      preparedEntries.length,
      centralDirectorySize,
      centralDirectoryOffset,
    ),
  );

  return new Blob(parts, { type: "application/zip" });
}

function zipLocalHeader(entry: PreparedZipEntry) {
  const nameBytes = textEncoder.encode(entry.name);
  const header = new Uint8Array(30 + nameBytes.byteLength);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, dosTime(), true);
  view.setUint16(12, dosDate(), true);
  view.setUint32(14, entry.crc32, true);
  view.setUint32(18, entry.data.byteLength, true);
  view.setUint32(22, entry.data.byteLength, true);
  view.setUint16(26, nameBytes.byteLength, true);
  view.setUint16(28, 0, true);
  header.set(nameBytes, 30);

  return header;
}

function zipCentralDirectoryHeader(entry: PreparedZipEntry) {
  const nameBytes = textEncoder.encode(entry.name);
  const header = new Uint8Array(46 + nameBytes.byteLength);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, dosTime(), true);
  view.setUint16(14, dosDate(), true);
  view.setUint32(16, entry.crc32, true);
  view.setUint32(20, entry.data.byteLength, true);
  view.setUint32(24, entry.data.byteLength, true);
  view.setUint16(28, nameBytes.byteLength, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, entry.localHeaderOffset, true);
  header.set(nameBytes, 46);

  return header;
}

function zipEndOfCentralDirectory(
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
) {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, 0, true);

  return header;
}

function createCrcTable() {
  return Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date = new Date()) {
  return (
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2)
  );
}

function dosDate(date = new Date()) {
  return (
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate()
  );
}
