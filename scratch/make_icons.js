// Builds the square extension icons from logo.png - no image library, just zlib.
//
// Why it exists at all: logo.png is 528x473 (RGBA), i.e. **not square** and far larger than any icon
// slot. Handing a non-square file to Chrome as the toolbar icon makes the browser squash it into a
// 16x16 / 32x32 square, so the shield comes out distorted and soft. What this does instead:
//
//   1. decodes logo.png (8-bit RGBA, non-interlaced - all it has to support),
//   2. cuts the uniform white page background away from the *outside* (flood fill from the borders),
//      so the shield sits on transparency and survives a light and a dark toolbar alike, while the
//      white check **inside** the shield is left untouched,
//   3. trims the leftover margin and re-centres the mark on a square canvas (aspect never stretched),
//   4. box-downscales it, weighted by alpha, to every icon size the manifests ask for.
//
// Usage:  node scratch/make_icons.js [--keep-background] [sizes...]
//         node scratch/make_icons.js 16 32 48 128 512
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'logo.png');
const OUT_DIR = path.join(ROOT, 'icons');

const args = process.argv.slice(2);
const keepBackground = args.includes('--keep-background');
const sizes = args.filter((a) => /^\d+$/.test(a)).map(Number);
const SIZE_LIST = sizes.length ? sizes : [16, 32, 48, 128, 512];

// --------------------------------------------------------------------------- PNG decoding
let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c;
  }
  return CRC_TABLE;
}

function crc32(buf) {
  const table = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function decodePng(file) {
  const buf = fs.readFileSync(file);
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIG[i]) throw new Error('not a PNG: ' + file);
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  let pos = 8;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG is not supported');
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }

    pos += 12 + len;
  }

  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported PNG: bitDepth=${bitDepth} colorType=${colorType}`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));

    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 0xff;
      else if (filter === 2) line[i] = (line[i] + b) & 0xff;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        line[i] = (line[i] + pred) & 0xff;
      }
    }

    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      rgba[d] = line[s];
      rgba[d + 1] = line[s + 1];
      rgba[d + 2] = line[s + 2];
      rgba[d + 3] = channels === 4 ? line[s + 3] : 255;
    }

    prev = line;
  }

  return { width, height, rgba };
}

// --------------------------------------------------------------------------- PNG encoding
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --------------------------------------------------------------------------- the tool itself
// The page the logo was exported on is pure white. Only pixels *connected to the border* are cleared,
// so the white check inside the shield survives - a plain "make white transparent" would punch a hole
// straight through the mark.
function cutBackground({ width, height, rgba }, threshold) {
  const out = Buffer.from(rgba);
  const seen = new Uint8Array(width * height);
  const queue = [];
  const lightEnough = (i) => {
    const r = out[i * 4];
    const g = out[i * 4 + 1];
    const b = out[i * 4 + 2];
    return r >= threshold && g >= threshold && b >= threshold;
  };

  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (seen[i] || !lightEnough(i)) return;
    seen[i] = 1;
    queue.push(i);
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }

  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % width;
    const y = (i - x) / width;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  let cleared = 0;
  for (let i = 0; i < seen.length; i++) {
    if (!seen[i]) continue;
    cleared++;
    out[i * 4 + 3] = 0;
  }

  return { rgba: out, cleared };
}

// White-ish pixels that the flood fill did *not* reach are the check inside the shield. Counted so the
// run can prove the cut-out did not eat it.
function interiorOpaqueWhite({ width, height, rgba }) {
  const seen = new Uint8Array(width * height);
  const queue = [];
  const lightEnough = (i) => rgba[i * 4] >= 235 && rgba[i * 4 + 1] >= 235 && rgba[i * 4 + 2] >= 235;
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (seen[i] || !lightEnough(i)) return;
    seen[i] = 1;
    queue.push(i);
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % width;
    const y = (i - x) / width;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  let interior = 0;
  for (let i = 0; i < seen.length; i++) {
    if (!seen[i] && lightEnough(i)) interior++;
  }
  return interior;
}

function alphaBBox({ width, height, rgba }, minAlpha) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] <= minAlpha) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: width, h: height };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// Crops the mark, centres it on a square canvas (aspect preserved) and box-downscales it, weighted by
// alpha so the transparent edge cannot darken the mark's outline.
function renderSquare({ width, rgba }, box, size, padRatio) {
  const side = Math.max(box.w, box.h);
  const pad = Math.round(side * padRatio);
  const canvas = side + pad * 2;
  const src = Buffer.alloc(canvas * canvas * 4);
  const offsetX = Math.round((canvas - box.w) / 2);
  const offsetY = Math.round((canvas - box.h) / 2);

  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) {
      const s = ((box.y + y) * width + (box.x + x)) * 4;
      const d = ((offsetY + y) * canvas + (offsetX + x)) * 4;
      src[d] = rgba[s];
      src[d + 1] = rgba[s + 1];
      src[d + 2] = rgba[s + 2];
      src[d + 3] = rgba[s + 3];
    }
  }

  const out = Buffer.alloc(size * size * 4);
  const scale = canvas / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.min(canvas, Math.max(x0 + 1, Math.ceil((x + 1) * scale)));
      const y0 = Math.floor(y * scale);
      const y1 = Math.min(canvas, Math.max(y0 + 1, Math.ceil((y + 1) * scale)));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const s = (sy * canvas + sx) * 4;
          const alpha = src[s + 3] / 255;
          r += src[s] * alpha;
          g += src[s + 1] * alpha;
          b += src[s + 2] * alpha;
          a += alpha;
          n++;
        }
      }

      const d = (y * size + x) * 4;
      const avgAlpha = a / n;
      if (avgAlpha <= 0) {
        out[d] = 0;
        out[d + 1] = 0;
        out[d + 2] = 0;
        out[d + 3] = 0;
      } else {
        out[d] = Math.round(r / a);
        out[d + 1] = Math.round(g / a);
        out[d + 2] = Math.round(b / a);
        out[d + 3] = Math.round(avgAlpha * 255);
      }
    }
  }

  return out;
}

function main() {
  const source = decodePng(SRC);
  const ratio = (source.width / source.height).toFixed(3);
  console.log(`source: ${source.width}x${source.height} (aspect ${ratio}), ${fs.statSync(SRC).size} bytes`);

  const pixel = (x, y) => {
    const i = (y * source.width + x) * 4;
    return `rgba(${source.rgba[i]},${source.rgba[i + 1]},${source.rgba[i + 2]},${source.rgba[i + 3]})`;
  };
  console.log(
    `corners: TL ${pixel(0, 0)} | TR ${pixel(source.width - 1, 0)} | BL ${pixel(0, source.height - 1)} | BR ${pixel(source.width - 1, source.height - 1)}`
  );

  // Proof that the check survives: the flood fill must not reach any white that is not border-bound.
  const interiorWhite = interiorOpaqueWhite(source);
  const cut = keepBackground
    ? { rgba: Buffer.from(source.rgba), cleared: 0 }
    : cutBackground(source, 235);
  console.log(
    `background: ${keepBackground ? 'kept as-is' : `cleared ${cut.cleared}px (outside only)`}; interior white left untouched: ${interiorWhite}px`
  );

  const marked = { width: source.width, height: source.height, rgba: cut.rgba };
  const box = alphaBBox(marked, 8);
  console.log(
    `trimmed mark: ${box.w}x${box.h} (aspect ${(box.w / box.h).toFixed(3)}) at ${box.x},${box.y}`
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });
  SIZE_LIST.forEach((size) => {
    const out = renderSquare(marked, box, size, 0.04);
    const file = path.join(OUT_DIR, `icon${size}.png`);
    fs.writeFileSync(file, encodePng(size, size, out));

    const check = decodePng(file);
    const checkBox = alphaBBox(check, 8);
    console.log(
      `wrote ${path.relative(ROOT, file)} - ${size}x${size}, ${fs.statSync(file).size} bytes, ` +
        `mark inside ${checkBox.w}x${checkBox.h} (aspect ${(checkBox.w / checkBox.h).toFixed(3)})`
    );
  });
}

main();
