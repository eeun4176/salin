/**
 * Pixel Operations
 * Small, dependency-free image routines used to prepare pages for OCR:
 * grayscale, scaling, shadow/lighting correction, contrast stretch, noise
 * removal, adaptive black-and-white, quarter turns, free rotation, and
 * perspective warping. They work on plain pixel arrays, so they run the same
 * in a Web Worker, on the main thread, and in unit tests (no canvas needed).
 */

import type { Point } from "@/types/ocr";

/** One byte per pixel, 0 = black, 255 = white. */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** RGBA, four bytes per pixel — the same layout as ImageData. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function createGray(width: number, height: number, fill = 255): GrayImage {
  const data = new Uint8ClampedArray(width * height);
  if (fill !== 0) data.fill(fill);
  return { width, height, data };
}

/** Luminance, with transparent pixels treated as white paper. */
export function toGray(image: RgbaImage): GrayImage {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    const a = data[i + 3] / 255;
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    out[p] = y * a + 255 * (1 - a);
  }
  return { width, height, data: out };
}

export function grayToRgba(image: GrayImage): RgbaImage {
  const out = new Uint8ClampedArray(image.width * image.height * 4);
  for (let p = 0, i = 0; p < image.data.length; p++, i += 4) {
    const v = image.data[p];
    out[i] = v;
    out[i + 1] = v;
    out[i + 2] = v;
    out[i + 3] = 255;
  }
  return { width: image.width, height: image.height, data: out };
}

/** Resizes a gray image: area averaging when shrinking (keeps thin strokes), bilinear when enlarging. */
export function resizeGray(image: GrayImage, width: number, height: number): GrayImage {
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  if (width === image.width && height === image.height) return image;
  const out = new Uint8ClampedArray(width * height);
  const sx = image.width / width;
  const sy = image.height / height;
  const src = image.data;
  const sw = image.width;

  if (sx >= 1 && sy >= 1) {
    for (let y = 0; y < height; y++) {
      const y0 = Math.floor(y * sy);
      const y1 = Math.min(image.height, Math.max(y0 + 1, Math.floor((y + 1) * sy)));
      for (let x = 0; x < width; x++) {
        const x0 = Math.floor(x * sx);
        const x1 = Math.min(sw, Math.max(x0 + 1, Math.floor((x + 1) * sx)));
        let sum = 0;
        for (let yy = y0; yy < y1; yy++) {
          const row = yy * sw;
          for (let xx = x0; xx < x1; xx++) sum += src[row + xx];
        }
        out[y * width + x] = sum / ((y1 - y0) * (x1 - x0));
      }
    }
    return { width, height, data: out };
  }

  for (let y = 0; y < height; y++) {
    const fy = Math.min(image.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    for (let x = 0; x < width; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      out[y * width + x] = sample(image, fx, fy, 255);
    }
  }
  return { width, height, data: out };
}

/** Bilinear sample; `fill` outside the image. */
export function sample(image: GrayImage, x: number, y: number, fill: number) {
  if (x < 0 || y < 0 || x > image.width - 1 || y > image.height - 1) return fill;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, image.width - 1);
  const y1 = Math.min(y0 + 1, image.height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const w = image.width;
  const d = image.data;
  const top = d[y0 * w + x0] * (1 - fx) + d[y0 * w + x1] * fx;
  const bottom = d[y1 * w + x0] * (1 - fx) + d[y1 * w + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Box blur with radius `r`, separable, edges clamped. */
export function boxBlur(image: GrayImage, r: number): GrayImage {
  if (r < 1) return image;
  const { width, height } = image;
  const tmp = new Float32Array(width * height);
  const out = new Uint8ClampedArray(width * height);
  const size = 2 * r + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += image.data[row + clamp(k, 0, width - 1)];
    for (let x = 0; x < width; x++) {
      tmp[row + x] = acc / size;
      acc += image.data[row + clamp(x + r + 1, 0, width - 1)] - image.data[row + clamp(x - r, 0, width - 1)];
    }
  }
  for (let x = 0; x < width; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[clamp(k, 0, height - 1) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = acc / size;
      acc += tmp[clamp(y + r + 1, 0, height - 1) * width + x] - tmp[clamp(y - r, 0, height - 1) * width + x];
    }
  }
  return { width, height, data: out };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Evens out shadows and uneven lighting: estimates the paper brightness
 * around every pixel (the brightest values nearby, smoothed) and divides by it,
 * so the paper becomes white everywhere while text keeps its contrast.
 */
export function flattenLighting(image: GrayImage): GrayImage {
  const { width, height } = image;
  // Coarse grid of local maxima ≈ paper colour (text is darker, so it drops out).
  const cell = Math.max(8, Math.round(Math.max(width, height) / 48));
  const gw = Math.ceil(width / cell);
  const gh = Math.ceil(height / cell);
  const grid = createGray(gw, gh, 0);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      // The 90th percentile rather than the max, so one glare speck doesn't win.
      const hist = new Uint32Array(256);
      let count = 0;
      for (let y = gy * cell; y < Math.min(height, (gy + 1) * cell); y++) {
        for (let x = gx * cell; x < Math.min(width, (gx + 1) * cell); x++) {
          hist[image.data[y * width + x]]++;
          count++;
        }
      }
      grid.data[gy * gw + gx] = percentile(hist, count, 0.9);
    }
  }
  // Erode first: at a shadow's edge the darker paper wins, so no dark band is left along it
  // (overestimating darkness only pushes paper to white; text stays far darker).
  const background = resizeGray(boxBlur(erode(grid), 1), width, height);
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0; i < out.length; i++) {
    const bg = Math.max(background.data[i], 24);
    out[i] = Math.min(255, (image.data[i] * 255) / bg);
  }
  return { width, height, data: out };
}

/** 3×3 minimum filter. */
function erode(image: GrayImage): GrayImage {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let min = 255;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = clamp(y + dy, 0, height - 1);
        for (let dx = -1; dx <= 1; dx++) min = Math.min(min, data[yy * width + clamp(x + dx, 0, width - 1)]);
      }
      out[y * width + x] = min;
    }
  }
  return { width, height, data: out };
}

function percentile(hist: Uint32Array, count: number, fraction: number) {
  const target = count * fraction;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen >= target) return v;
  }
  return 255;
}

export function histogram(image: GrayImage) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < image.data.length; i++) hist[image.data[i]]++;
  return hist;
}

/** Stretches the darkest 0.5% to black and the brightest 0.5% to white. */
export function stretchContrast(image: GrayImage, low = 0.005, high = 0.995): GrayImage {
  const hist = histogram(image);
  const n = image.data.length;
  const lo = percentile(hist, n, low);
  const hi = percentile(hist, n, high);
  if (hi - lo < 16) return image;
  const scale = 255 / (hi - lo);
  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) out[i] = (image.data[i] - lo) * scale;
  return { width: image.width, height: image.height, data: out };
}

/** 3×3 median filter: removes speckles without blurring letter edges much. */
export function median3(image: GrayImage): GrayImage {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data);
  const win = new Uint8Array(9);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const row = (y + dy) * width + x;
        win[k++] = data[row - 1];
        win[k++] = data[row];
        win[k++] = data[row + 1];
      }
      win.sort();
      out[y * width + x] = win[4];
    }
  }
  return { width, height, data: out };
}

/** Otsu's global threshold. */
export function otsuThreshold(image: GrayImage) {
  const hist = histogram(image);
  const total = image.data.length;
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v];
  let sumB = 0;
  let weightB = 0;
  let best = 0;
  let threshold = 127;
  for (let v = 0; v < 256; v++) {
    weightB += hist[v];
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += v * hist[v];
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const between = weightB * weightF * (meanB - meanF) ** 2;
    if (between > best) {
      best = between;
      threshold = v;
    }
  }
  return threshold;
}

/**
 * Adaptive black-and-white (Bradley–Roth): a pixel is ink when it is clearly
 * darker than the average of its neighbourhood. Copes with uneven lighting
 * far better than one global threshold. Returns 1 = ink, 0 = paper.
 */
export function inkMask(image: GrayImage, sensitivity = 0.15): Uint8Array {
  const { width, height, data } = image;
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += data[y * width + x];
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + rowSum;
    }
  }
  const half = Math.max(4, Math.round(Math.max(width, height) / 32));
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(height, y + half + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(width, x + half + 1);
      const count = (y1 - y0) * (x1 - x0);
      const sum = integral[y1 * (width + 1) + x1] - integral[y0 * (width + 1) + x1] - integral[y1 * (width + 1) + x0] + integral[y0 * (width + 1) + x0];
      const v = data[y * width + x];
      // Very light pixels are never ink, whatever the neighbourhood.
      mask[y * width + x] = v < 235 && v * count < sum * (1 - sensitivity) ? 1 : 0;
    }
  }
  return mask;
}

export function maskToGray(mask: Uint8Array, width: number, height: number): GrayImage {
  const data = new Uint8ClampedArray(width * height);
  for (let i = 0; i < mask.length; i++) data[i] = mask[i] ? 0 : 255;
  return { width, height, data };
}

/** Rotates by a multiple of 90° clockwise. Works for gray (1 channel) or RGBA (4 channels). */
export function rotateQuarter<T extends { width: number; height: number; data: Uint8ClampedArray }>(image: T, degrees: number, channels: 1 | 4): T {
  const turns = (((degrees / 90) % 4) + 4) % 4;
  if (turns === 0) return image;
  const { width: w, height: h, data } = image;
  const outW = turns % 2 ? h : w;
  const outH = turns % 2 ? w : h;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number;
      let ny: number;
      if (turns === 1) [nx, ny] = [h - 1 - y, x];
      else if (turns === 2) [nx, ny] = [w - 1 - x, h - 1 - y];
      else [nx, ny] = [y, w - 1 - x];
      const src = (y * w + x) * channels;
      const dst = (ny * outW + nx) * channels;
      for (let c = 0; c < channels; c++) out[dst + c] = data[src + c];
    }
  }
  return { ...image, width: outW, height: outH, data: out };
}

/** Rotates by any angle (degrees, clockwise) about the centre, keeping the size; corners fill with white. */
export function rotateGray(image: GrayImage, degrees: number): GrayImage {
  if (Math.abs(degrees) < 0.05) return image;
  const { width, height } = image;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const out = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Inverse mapping: where in the source does this output pixel come from?
      const dx = x - cx;
      const dy = y - cy;
      const sx = cos * dx + sin * dy + cx;
      const sy = -sin * dx + cos * dy + cy;
      out[y * width + x] = sample(image, sx, sy, 255);
    }
  }
  return { width, height, data: out };
}

/** Solves the 3×3 homography that maps the unit-square corners of the output onto `quad` (pixels). */
export function homography(quad: [Point, Point, Point, Point], width: number, height: number) {
  const dst: [number, number][] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  // 8 equations, 8 unknowns (h33 = 1): output (u, v) → source (x, y).
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = dst[i];
    const { x, y } = quad[i];
    a.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);
    a.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }
  const h = solve(a, b);
  return [...h, 1];
}

/** Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]) {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const p = m[col][col] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / p;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / (row[i] || 1e-12));
}

const distance = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);

/** Output size for a perspective crop: the longer of each pair of opposite edges. */
export function warpSize(quad: [Point, Point, Point, Point]) {
  const [tl, tr, br, bl] = quad;
  return {
    width: Math.max(1, Math.round(Math.max(distance(tl, tr), distance(bl, br)))),
    height: Math.max(1, Math.round(Math.max(distance(tl, bl), distance(tr, br)))),
  };
}

/** Crops the four-cornered region `quad` (pixels) out of the image and flattens it to a rectangle. */
export function warpPerspective(image: GrayImage, quad: [Point, Point, Point, Point], width = warpSize(quad).width, height = warpSize(quad).height): GrayImage {
  const h = homography(quad, width, height);
  const out = new Uint8ClampedArray(width * height);
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const d = h[6] * u + h[7] * v + h[8];
      const x = (h[0] * u + h[1] * v + h[2]) / d;
      const y = (h[3] * u + h[4] * v + h[5]) / d;
      out[v * width + u] = sample(image, x, y, 255);
    }
  }
  return { width, height, data: out };
}

/** Scale that brings the longer side to at most `maxSide` (and small images up to `minSide`). */
export function fitScale(width: number, height: number, maxSide: number, minSide: number) {
  const long = Math.max(width, height);
  if (long > maxSide) return maxSide / long;
  if (long < minSide) return Math.min(2, minSide / long);
  return 1;
}
