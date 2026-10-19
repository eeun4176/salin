# OCR Benchmarks & Accuracy

How Salin's on-device text recognition performs, measured with the app's own tools. Recognition accuracy (characters, words) and extraction accuracy (fields) are recorded separately.

> **Status:** desktop results below were measured in Chrome on the development PC. **The target Android phone has not been benchmarked yet.** Follow section 3 to run it there and add the results to section 4.

## 1. How it's measured

- **Device benchmark** (Settings → Text recognition → Benchmark → *Test this device*). Draws a printed pet registration form (A4, 150 dpi) with 12 known values and measures:
  - the model download (if it wasn't stored yet);
  - engine start (cold);
  - page preparation;
  - reading time, cold and warm;
  - JS heap (Chromium's `performance.memory`, where exposed);
  - CER and WER against the printed text;
  - fields correct through the registration template.
  
  Results are saved on the device, and *Copy results* gives Markdown and JSON for this document.
- **Difficult-conditions evaluation** (`e2e/ocr-quality.spec.ts`). The same kind of form rendered clean, blurred, shadowed, skewed 4°, faint, speckled, stamped over, and with handwriting-style values. All are read in one scan through the real workflow, and CER/WER are written to `test-results/ocr-quality.json`.
- **Field accuracy on templates** (`e2e/ocr.spec.ts`, `src/core/ocr/templates/templates.test.ts`). The registration form and census sheet are checked against manually verified values.

CER = character edit distance ÷ reference length; WER = the same over words. Text is compared after normalising spaces and case.

## 2. Desktop results (development PC)

Chrome 156 on Windows 11 · 4 CPU cores · ~8 GB memory (as reported) · WASM relaxed SIMD · WebGPU available (not used) · engine build `core-relaxed-simd` · English only.

| Profile | Model files | Download (local server) | Engine start | Prepare page | Read (cold) | Read (warm) | JS heap | CER | WER | Fields |
|---|---|---|---|---|---|---|---|---|---|---|
| Standard | 6.5 MB (8.7 MB stored*) | 0.43 s | 0.57 s | 1.04 s | 1.85 s | 1.52 s | 31 MB | 0.0% | 0.0% | 12/12 |
| Accurate | same | — | 0.51 s | 0.56 s | 2.03 s | 1.01 s | 32 MB | 0.0% | 0.0% | 12/12 |

\* The local preview server decompresses the gzipped language file on the way, so more is stored than downloaded. Production hosts serving the `.gz` as-is store 6.5 MB.

JS heap excludes the WebAssembly memory of the OCR worker, which browsers don't expose to pages. Peak worker memory needs Chrome DevTools → Memory on the device.

### Difficult conditions (Standard profile, same PC)

| Condition | CER | WER | Mean confidence | Notes |
|---|---|---|---|---|
| Clean print | 0.0% | 0.0% | 95 | |
| Blur (1.6 px) | 0.0% | 0.0% | 94.8 | |
| Shadow / uneven light | 0.0% | 0.0% | 95.0 | fixed by "Fix shadows & lighting" (on by default) |
| Skew 4° | 0.0% | 0.0% | 94.7 | straightened automatically |
| Faint print (33% ink) | 0.0% | 0.0% | 94.9 | contrast boost (on by default) |
| Speckle noise | 1.8% | 7.7% | 76.6 | was 90% CER before automatic speckle removal was added |
| Stamp over text | 8.0% | 7.7% | 95.2 | stamp text is read too; overlaps are flagged in review |
| Handwriting-style values (script font) | 2.5% | 11.5% | 84.7 | **Proxy only:** a script font is far more regular than real handwriting. Handwriting stays *experimental*. |

### Templates (manually verified values)

| Document | Result |
|---|---|
| Registration form (HTML render, 5 fields + checkbox choice) | All present fields correct; the missing required "Address" was flagged and blocked saving until typed |
| Census sheet (ruled table, 3 records) | All 3 records' owner, pet and species correct; the "Total dogs: 3" vs 2 dog rows mismatch was flagged, not changed |

### A note on CPU throttling

Chrome's DevTools CPU throttling (4×) was tried as a stand-in for a slower phone. It doesn't slow down Web Workers, where Salin's preparation and OCR run, so the numbers didn't change. **It is not a valid substitute for a real Android device.**

## 3. Benchmarking the target Android phone

1. Serve the production build over HTTPS (camera and service worker need it), e.g. deploy it, or run `npx vite build && npx vite preview --host` and use Chrome's port forwarding (`chrome://inspect` → *Port forwarding* 4173 → `localhost:4173` on the phone).
2. On the phone in Chrome, open Salin. Optionally install it (*Install Salin*) to test the installed PWA too.
3. Settings → Text recognition → download the files → Benchmark → **Test this device**. Run it twice, with *Standard* and *Accurate*.
4. Tap **Copy results** and paste them into section 4, together with the phone model, Android version and Chrome version.
5. Turn on airplane mode, reopen Salin (browser tab and installed app), scan a printed form with the camera, read it, and save it. Note anything that fails.
6. Optional peak memory: connect via `chrome://inspect`, open DevTools → Memory / Performance while reading a page.

## 4. Android results

| Date | Phone (model, RAM) | Android / Chrome | Profile | Engine start | Read (cold / warm) | JS heap | CER | WER | Fields | Offline (tab / installed) |
|---|---|---|---|---|---|---|---|---|---|---|
| _to do_ | | | Standard | | | | | | | |
| _to do_ | | | Accurate | | | | | | | |
