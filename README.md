# NWIS Mission Control

## Native Apple Silicon OCR

PDF pages and images are transcribed locally with **GLM-OCR (0.9B, bf16)** using **MLX / Metal**. This replaces the dots.ocr CUDA container. GLM-OCR's documented recognition tasks include printed text, handwriting and formulas; this compact model is a practical fit for an M-series Mac with 16 GB unified memory.

Requirements: Apple Silicon Mac, macOS 14+, Node/npm and [uv](https://docs.astral.sh/uv/getting-started/installation/). Setup creates an isolated Python 3.12 environment at `.venv-ocr`; it does not change your system Python.

```sh
npm install
npm run ocr:setup
npm run ocr:start
npm run ocr:status
npm run dev:all
```

On first start, the runtime downloads `mlx-community/GLM-OCR-bf16` from Hugging Face (roughly 2 GB). Model files are cached outside the repository. OCR stays local after download; no image is sent to a cloud OCR service. `ocr:status` reports ready only after the model loads on Metal. The first page can take longer while Metal kernels warm up.

Create `.env` from `.env.example` only if one does not already exist. Add `GROQ_API_KEY` for the existing report structuring stage. **This is local OCR, not a fully offline application**: report structuring and question answering still use the configured LLM providers, and optional Supabase storage remains.

### Runtime controls

- `npm run ocr:start` starts the model in the background; repeated calls reuse the running process.
- `npm run ocr:status` checks model readiness and whether a page is running.
- `npm run ocr:logs` follows startup and inference logs.
- `npm run ocr:stop` stops the project's model process and retains cached weights.
- `npm run dev:all` starts the OCR runtime, API and frontend. Stopping this command stops the API/frontend; use `ocr:stop` to release the model memory too.

The native model service listens on `127.0.0.1:8080`; the Node API stays on port 8787. Settings are documented in `.env.example`. `MLX_OCR_URL` must use a loopback address. `MLX_OCR_PORT` changes the native port; keep it consistent with `MLX_OCR_URL`. The default output limit is 8192 tokens per page and timeout is ten minutes. Truncated output is reported as an error, rather than indexed as a complete page.

### Processing and output

The existing loader shows filename, page and completed stages. Its percentage measures stages, not model token progress. Pages run sequentially, and overlapping uploads are rejected. Startup, invalid images, timeouts and model errors produce actionable messages; reselect a failed file to retry.

PDFs are rendered in the browser before OCR. PNG, JPEG, WebP and BMP images are supported; convert TIFF to PDF or PNG first. Images retain their aspect ratio and are capped at 2200 pixels on the longest edge to bound memory usage.

GLM-OCR's text-recognition mode returns text/Markdown **without localized bounding boxes or confidence scores**. The adapter returns `words: []`; the viewer indicates text OCR and does not invent section rectangles. Page markers remain in extracted evidence. Existing indexed documents retain their saved regions. Handwriting accuracy depends on scan quality and writing style; Hindi handwriting has not been validated.

### Validation

```sh
npm run test:ocr
npm run build
```

The automated adapter tests use a mock local model service and cover text preservation, image resizing, missing/invalid images, readiness, busy handling and failures. Live verification on the 16 GB Apple Silicon development Mac (2026-09-05):

- Handwritten DDR image: 19.4 seconds, recovering coordinates `26.421112, 93.912445`, depth `2,050`, mud weight `1.22` and cement-channeling notes.
- Printed rig-floor tally image: 28.4 seconds, with text returned successfully by the real model through the main API.
- Browser PDF upload: 18.5 seconds using real GLM-OCR; downstream report structuring was mocked to isolate OCR and avoid cloud calls.
- Desktop/mobile loader, disabled uploads, failure and retry states passed browser checks.

These are small smoke tests, not an accuracy benchmark or a measured comparison against dots.ocr.

Sources: [GLM-OCR handwriting support](https://docs.z.ai/guides/vlm/glm-ocr), [official Apple Silicon deployment guide](https://github.com/zai-org/GLM-OCR/blob/main/examples/mlx-deploy/README.md), [MLX GLM-OCR integration](https://github.com/Blaizzy/mlx-vlm/blob/main/mlx_vlm/models/glm_ocr/README.md).
