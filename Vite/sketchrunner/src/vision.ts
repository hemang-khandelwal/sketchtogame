// src/vision.ts
// Step 1 of the sketch -> level pipeline: separate dark pen lines from the paper.
// Input: the PNG blob your 'sketchrunner:frame' event already provides.
// Output: a binary ink mask (1 = ink, 0 = paper) plus a helper to preview it.
import cvModule from '@techstark/opencv-js'

// OpenCV.js is a ~10 MB WebAssembly build, so it is loaded once, on first use.
let cvPromise: Promise<any> | null = null
export function loadCv(): Promise<any> {
  cvPromise ??= (async () => {
    const m: any = cvModule
    if (m instanceof Promise) return await m
    if (m.Mat) return m
    await new Promise<void>((resolve) => { m.onRuntimeInitialized = () => resolve() })
    return m
  })()
  return cvPromise
}

export interface InkOptions {
  /** Longest side after downscaling. Smaller = faster, but thin lines can vanish. */
  maxSide?: number
  /** A pixel is ink if it is darker than this fraction of the local paper brightness (0-1).
   *  Black marker: 0.4-0.6. Pencil or pale pen: 0.7-0.8. */
  inkLevel?: number
  /** Fraction of each edge to ignore (table, shadows, page border). */
  edgeMargin?: number
}

export interface InkMask {
  width: number
  height: number
  /** Row-major, 1 = ink, 0 = paper. */
  data: Uint8Array
}

const odd = (n: number) => Math.max(3, Math.round(n) | 1)

export async function extractInk(blob: Blob, opts: InkOptions = {}): Promise<InkMask> {
  const { maxSide = 1280, inkLevel = 0.65, edgeMargin = 0.02 } = opts
  const cv = await loadCv()

  // 1. Blob -> canvas at a manageable size
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  const src = cv.imread(canvas) // RGBA
  const gray = new cv.Mat()
  const paper = new cv.Mat()
  const flat = new cv.Mat()
  const mask = new cv.Mat()
  const closeKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(odd(Math.max(w, h) / 30), odd(Math.max(w, h) / 30)))
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)

    // 2. Estimate the paper's brightness everywhere. A morphological "close" with a kernel
    //    wider than any pen stroke erases the dark lines; the blur smooths the result.
    cv.morphologyEx(gray, paper, cv.MORPH_CLOSE, closeKernel)
    const blur = odd(Math.max(w, h) / 25)
    cv.GaussianBlur(paper, paper, new cv.Size(blur, blur), 0)

    // 3. Divide the photo by the paper estimate: shadows and uneven light cancel out,
    //    paper becomes ~255 everywhere and ink stays clearly darker.
    cv.divide(gray, paper, flat, 255, -1)

    // 4. Threshold relative to the paper, then remove isolated speckles.
    cv.threshold(flat, mask, inkLevel * 255, 255, cv.THRESH_BINARY_INV)
    cv.medianBlur(mask, mask, 3)

    // 5. Copy out as 0/1, ignoring a thin border where desk and page edge show up.
    const data = new Uint8Array(w * h)
    const mx = Math.round(w * edgeMargin)
    const my = Math.round(h * edgeMargin)
    const px: Uint8Array = mask.data
    for (let y = my; y < h - my; y++) {
      for (let x = mx; x < w - mx; x++) {
        if (px[y * w + x] > 0) data[y * w + x] = 1
      }
    }
    return { width: w, height: h, data }
  } finally {
    // OpenCV.js objects live in WASM memory and are NOT garbage collected.
    ;[src, gray, paper, flat, mask, closeKernel].forEach((m) => m.delete())
  }
}

/** Draw the mask as black ink on white so you can eyeball it while tuning. */
export function drawMask(ink: InkMask, canvas: HTMLCanvasElement) {
  canvas.width = ink.width
  canvas.height = ink.height
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(ink.width, ink.height)
  for (let i = 0; i < ink.data.length; i++) {
    const v = ink.data[i] ? 20 : 255
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
}