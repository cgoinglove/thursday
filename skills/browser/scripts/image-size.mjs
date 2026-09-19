import { closeSync, openSync, readSync } from "node:fs";

/** Width and height of a PNG or JPEG, read from its header; null for anything else. */
export function imageSize(path) {
  const fd = openSync(path, "r");
  try {
    const head = Buffer.alloc(64 * 1024);
    const n = readSync(fd, head, 0, head.length, 0);
    if (head.readUInt32BE(0) === 0x89504e47)
      return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) };
    if (head[0] === 0xff && head[1] === 0xd8) {
      // Walk the JPEG segments to the first frame header
      for (let i = 2; i + 9 < n; ) {
        if (head[i] !== 0xff) return null;
        const marker = head[i + 1];
        const len = head.readUInt16BE(i + 2);
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          ![0xc4, 0xc8, 0xcc].includes(marker)
        )
          return { w: head.readUInt16BE(i + 7), h: head.readUInt16BE(i + 5) };
        i += 2 + len;
      }
    }
    return null;
  } finally {
    closeSync(fd);
  }
}
