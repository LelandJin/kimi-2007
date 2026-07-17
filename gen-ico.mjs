// 生成 codex.ico —— 32x32 像素风机器人图标（纯手写 ICO 格式，无依赖）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const S = 32;
const px = new Uint8Array(S * S * 4); // BGRA

function set(x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  px[i] = b; px[i + 1] = g; px[i + 2] = r; px[i + 3] = 255;
}
function rect(x0, y0, x1, y1, r, g, b) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, r, g, b);
}

// 背景：XP 蓝，上半略亮模拟渐变
rect(0, 0, S - 1, S - 1, 0x24, 0x5e, 0xdb);
rect(0, 0, S - 1, 12, 0x3a, 0x7d, 0xe8);
// 天线
rect(15, 2, 16, 5, 0x1c, 0x56, 0xc8);
rect(15, 1, 16, 2, 0x6e, 0xf0, 0xff);
// 头（蓝色圆角矩形）
rect(6, 6, 25, 21, 0x1c, 0x56, 0xc8);   // 描边
rect(7, 7, 24, 20, 0x4d, 0x94, 0xf0);   // 填充
// 面部屏幕（深藏青）
rect(9, 10, 22, 17, 0x14, 0x26, 0x4a);
// 双眼（青色）
rect(12, 12, 13, 15, 0x6e, 0xf0, 0xff);
rect(18, 12, 19, 15, 0x6e, 0xf0, 0xff);
// 身体
rect(11, 22, 20, 26, 0x1c, 0x56, 0xc8);
rect(12, 23, 19, 25, 0x3b, 0x7d, 0xd8);
// 双脚
rect(10, 27, 14, 29, 0x1c, 0x56, 0xc8);
rect(17, 27, 21, 29, 0x1c, 0x56, 0xc8);

// ---- ICO 文件 ----
const andMask = Buffer.alloc((S * S) / 8, 0); // 全不透明
const bi = Buffer.alloc(40);
bi.writeUInt32LE(40, 0);            // BITMAPINFOHEADER 大小
bi.writeInt32LE(S, 4);              // 宽
bi.writeInt32LE(S * 2, 8);          // 高 = XOR + AND
bi.writeUInt16LE(1, 12);            // planes
bi.writeUInt16LE(32, 14);           // 位深
bi.writeUInt32LE(0, 16);            // BI_RGB
bi.writeUInt32LE(S * S * 4, 20);    // 图像大小

// XOR 位图（自下而上）
const xor = Buffer.alloc(S * S * 4);
for (let y = 0; y < S; y++) {
  const src = (S - 1 - y) * S * 4;
  Buffer.from(px.buffer, src, S * 4).copy(xor, y * S * 4);
}

const img = Buffer.concat([bi, xor, andMask]);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry.writeUInt8(S, 0); entry.writeUInt8(S, 1);
entry.writeUInt8(0, 2); entry.writeUInt8(0, 3);
entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(img.length, 8); entry.writeUInt32LE(22, 12);

fs.writeFileSync(path.join(ROOT, 'codex.ico'), Buffer.concat([header, entry, img]));
console.log('codex.ico 生成完成');
