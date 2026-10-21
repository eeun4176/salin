# Phase 5 accuracy improvement

Implemented on 2026-10-21 from `SALIN AI — Phase 5 Accuracy Improvement.md`.

## Pipeline audit

The existing parsers already preserve PDF page text, workbook sheets and cell ranges in IndexedDB. OCR stores line coordinates/confidence and reviewed field flags. Dataset conversion preserves source regions but does not carry all unresolved OCR flags into dataset rows. The old Ask SALIN page primarily queried a dataset: the model saw column descriptions and example values, not the underlying document prose. This prevented reliable document questions even when the parser had extracted the answer correctly.

The rule reader already computes counts, sums, filtering, sorting and grouping over every row in TypeScript. That engine is retained. Its previous fallback could return a partial reading of a question it did not fully understand. Model-generated filters could also lose ungrounded conditions, broadening an operation. The new answer path refuses partial readings, and the shared command action rejects plans whose conditions were dropped.

Chat history previously included questions and replies from other dataset selections. Follow-ups now use only a previous user question for the same selected source, recomputed against the current saved snapshot. Model-written answers are never used as evidence.

Both existing inference backends already disable Qwen thinking and use deterministic generation: greedy ONNX generation or WebLLM temperature zero. Model selection was not the root cause. Qwen3-1.7B for laptops, Qwen3-0.6B for phones, Tesseract.js and the existing parsers are retained. No dependencies or embedding models were added.

## Implementation

- `src/core/ai/document-evidence.ts` builds local evidence from cached parser output, OCR lines/headings/tables, reviewed fields and dataset rows. It retains document IDs, pages/sheets, row/cell references, field/cell boxes, confidence and warnings. Long text uses overlapping bounded blocks. Retrieval uses keywords and shared English/Filipino aliases.
- `src/features/ai/document-sources.ts` loads only the selected file, scan or dataset. Parser output is cached through the existing repository. Each question uses fresh saved data. Unresolved scan content is carried into dataset calculations; reviewed dataset values remain authoritative.
- `src/features/ai/grounded-answers.ts` routes field questions, document questions, calculations, table requests, dataset queries, summaries, commands and exports. Fully understood structured queries execute in the existing TypeScript engine. Page and sheet constraints restrict the calculation scope. Ambiguous questions ask for clarification instead of presenting a partial result.
- Exact field values are copied from source evidence. Qwen interprets semantic questions by selecting exact excerpts. Every model-selected source must exist in the retrieved evidence and every displayed excerpt must be a contiguous exact match. Invented IDs, changed numbers, extra model claims, malformed output and unresolved evidence produce an uncertainty answer.
- English, Filipino and Taglish response framing follows the question. Names, dates, IDs and numbers remain in their original form. Source text is quoted rather than translated, making factual wording independently verifiable.
- Ask SALIN now has a source picker covering imported documents, scans and datasets, expandable citations and a CSV download for the displayed result. CSV uses the existing exporter, including formula protection. Dataset changes still open the existing preview/confirmation/undo workflow. Read-only answers never save dataset changes.
- Evidence prompts are bounded to 4,800 UTF-8 bytes of complete evidence blocks. ONNX additionally checks the actual prompt plus output token budget against 4,096 tokens; WebLLM retains its 4,096-token context. Existing worker serialization, cancellation, OCR shutdown before LLM use, single-model residency and idle unloading remain in effect.

## Benchmarks and acceptance

The same 22 regression cases use an actual text notice, a two-page PDF, CSV registrations and a two-sheet XLSX workbook, plus a deliberately unresolved OCR extraction fixture. The PDF/XLSX are reproducible from `src/test/phase5-fixtures.ts`; generated files are included in `docs/benchmarks/phase5/`. The OCR error fixture is synthetic. A separate browser test generates `contact-form.png`, runs it through the real Tesseract scan workflow, then asks for the contact number offline. Neither test measures accuracy on real camera photographs.

The baseline runs the original `answerDataQuestion` implementation without a downloaded LLM. The after run exercises `answerGroundedQuestion` with the same parsed content and no LLM. This measures the deterministic offline path, not general Qwen accuracy on unseen documents.

| Metric | Baseline | Grounded path |
|---|---:|---:|
| Correct exact answers or appropriate refusals | 8/22 (36.4%) | 22/22 (100%) |
| Calculation correctness | 7/7 (100%) | 7/7 (100%) |
| Valid citations or appropriate uncited refusal | 2/22 (9.1%) | 22/22 (100%) |
| Unsupported answers presented as results, divided by all questions | 5/22 (22.7%) | 0/22 (0%) |

Full per-question results, timings and Node heap snapshots are in `baseline.json` and `after.json`. A Node heap snapshot is not total device memory or peak GPU memory. The suite is a development regression benchmark; these figures are not a claim of 100% accuracy on arbitrary documents.

Table scoring requires the requested columns exactly (excluding the separately generated Source column). The baseline was recorded with this stricter scoring before fixing the original reader's treatment of “name of Ana”; the old reader returned the whole record for that question. Original latency is 2.40 ms mean / 21.98 ms maximum versus 3.61 ms / 19.70 ms after grounding, excluding parsing and model loading. Recorded Node heap snapshots are 47,512,688 and 43,940,344 bytes; these snapshots are not a controlled memory comparison.

Browser acceptance exercises the production PWA with networking disabled: PDF page citations, Filipino field lookup, CSV counts/totals, workbook sheet selection, source-scoped follow-ups and CSV export. Reports distinguish the laptop browser from a phone-sized viewport on the same laptop. A phone viewport is not a physical phone measurement.

The three browser tests passed, including actual Tesseract OCR of the generated contact form followed by a correct offline field answer and page citation. Browser JS heap snapshots and per-question end-to-end latency are recorded separately in the browser JSON reports. The full unit suite, lint and production build are also run; opt-in model evaluations remain separate from ordinary unit tests.

The opt-in model evaluation loads existing cached Qwen weights with remote access disabled. It records exact excerpt matching, citation validation, unsupported-answer rate, latency and sampled process RSS separately for each model profile. Node CPU inference is not WebLLM GPU performance, and running the phone model on a laptop is not a phone measurement. Calculations are covered separately by the deterministic benchmark.

| Model profile, both on the development laptop CPU | Exact excerpt / valid citation | Mean generation latency | Sampled process RSS peak |
|---|---:|---:|---:|
| Qwen3-0.6B | 2/3 (66.7%) | 16.22 s | 1,908,015,104 bytes |
| Qwen3-1.7B | 3/3 (100%) | 74.34 s | 2,680,520,704 bytes |

The 0.6B model returned an empty answer for the English semantic question; the application refuses to invent a replacement. Both profiles refused the missing-information check. These are three development questions, not a held-out multilingual evaluation. The 0.6B run used default ONNX CPU threading; the 1.7B run used two intra-op threads. Latencies also include other activity on the development machine and must not be used as a controlled speed comparison. Source values and all raw replies are retained in the model JSON reports.

## Reproduce

PowerShell commands (use `npm`/`npx` instead of `.cmd` on platforms without PowerShell execution restrictions):

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npx.cmd playwright test e2e/phase5.spec.ts --project=desktop --workers=1

$env:SALIN_PHASE5_RECORD='1'
npx.cmd vitest run src/features/ai/phase5-benchmark.test.ts
Remove-Item Env:SALIN_PHASE5_RECORD

# These require the existing local model files in node_modules/.cache/hf.
$env:SALIN_PHASE5_MODEL='phone'
npx.cmd vitest run src/features/ai/phase5-model-eval.test.ts
$env:SALIN_PHASE5_MODEL='laptop'
npx.cmd vitest run src/features/ai/phase5-model-eval.test.ts
Remove-Item Env:SALIN_PHASE5_MODEL
```

`SALIN_PHASE5_BASELINE=1` exists to reproduce the original-reader baseline. Normal test runs do not overwrite recorded reports.

## Remaining hardware acceptance and limits

Physical-phone latency, memory and offline inference, and the laptop's deployed WebLLM GPU path need measurements on those devices before full hardware acceptance. These must not be inferred from Node CPU or viewport-emulation results.

The assistant favors refusal when a question is ambiguous, OCR is unresolved or a requested calculation is not fully understood. Qwen explanations and summaries are extractive. Summaries over large documents explicitly identify themselves as summaries of selected excerpts. Model-generated prose is not accepted as verified fact. A scan containing multiple distinct dataset structures should be saved as separate datasets before cross-row calculations. Exports contain the displayed table (at most 100 rows), with that scope named on the download button.

Local benchmark results demonstrate an improvement over the original offline answer path. Full physical-device acceptance is pending the hardware measurements above.
