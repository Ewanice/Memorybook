import { DomainError } from "../domain/model";

// Read dimensions before asking Chromium to allocate a decoded bitmap.
export function imageDimensions(b: Buffer): { width: number; height: number } {
  let width = 0,
    height = 0;
  if (
    b.length >= 24 &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    width = b.readUInt32BE(16);
    height = b.readUInt32BE(20);
  } else if (b[0] === 255 && b[1] === 216) {
    let p = 2;
    while (p + 4 <= b.length) {
      if (b[p] !== 255) break;
      while (b[p] === 255) p++;
      const marker = b[p++]!;
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = b.readUInt16BE(p);
      if (length < 2 || p + length > b.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        length >= 7
      ) {
        height = b.readUInt16BE(p + 3);
        width = b.readUInt16BE(p + 5);
        break;
      }
      p += length;
    }
  } else if (
    b.length >= 30 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  ) {
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X") {
      width = 1 + b.readUIntLE(24, 3);
      height = 1 + b.readUIntLE(27, 3);
    } else if (
      kind === "VP8 " &&
      b[23] === 0x9d &&
      b[24] === 0x01 &&
      b[25] === 0x2a
    ) {
      width = b.readUInt16LE(26) & 0x3fff;
      height = b.readUInt16LE(28) & 0x3fff;
    } else if (kind === "VP8L" && b[20] === 0x2f) {
      const n = b.readUInt32LE(21);
      width = (n & 0x3fff) + 1;
      height = ((n >>> 14) & 0x3fff) + 1;
    }
  }
  if (!width || !height)
    throw new DomainError("图片尺寸信息无效或格式不受支持。");
  if (width > 30000 || height > 30000 || width * height > 100_000_000)
    throw new DomainError("图片像素尺寸过大。");
  return { width, height };
}
