> Implementation update: OCR now uses GLM-OCR (0.9B, bf16) through MLX on Apple Silicon/Metal. The earlier dots.ocr CUDA runtime and PaddleOCR proposals are superseded. The recognition path returns text with page markers; localized bounding boxes are not available. See README.md for native setup and verification.

# PLAN.md — Nearby Wells Intelligence System (NWIS)

## 1. Summary and fixed decisions

Build NWIS as a standalone, on-prem-ready decision-support platform alongside eRTMAC. It will convert historical drilling documents into structured, searchable evidence; correlate offset wells by location, formation, and depth; monitor live drilling conditions; and produce explainable risk alerts and recommendations.

Initial constraints:

- MVP duration: 1–2 weeks.
- Frontend: React, TypeScript, and Vite.
- Target hardware: CPU-only laptop.
- Demo data: clearly labeled synthetic wells, telemetry, events, and documents.
- Documents: scanned PDFs and full handwritten pages in English and Hindi.
- Visual direction: “Subsurface Mission Control.”
- Design workflow: high-fidelity comp first, then React implementation.
- All processing remains local; the presentation must work without internet access.
- NWIS provides advisory evidence, never autonomous drilling control.

### OCR decision

Use a two-stage PaddleOCR pipeline:

1. PP-OCR/PP-Structure provides fast page segmentation and preliminary text so boxes appear immediately.
2. PaddleOCR-VL 1.6 refines handwritten, Hindi, and low-confidence regions.

PaddleOCR-VL is preferred over DeepSeek-OCR and Unlimited OCR for the MVP because its current pipeline supports local CPU inference, multilingual text, handwriting, complex layouts, and localized document elements. Official documentation reports 109-language support and strong scan, handwriting, table, and irregular-box performance. [PaddleOCR-VL documentation](https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/PaddleOCR-VL.html)

Unlimited OCR should remain an optional production adapter for very long, multi-page documents; its main advantage is constant-memory long-horizon parsing rather than fast page-by-page visual feedback. [Unlimited OCR paper](https://arxiv.org/abs/2606.23050) DeepSeek-OCR remains another pluggable GPU-oriented adapter, but its official deployment path is primarily CUDA/vLLM based. [DeepSeek-OCR repository](https://github.com/deepseek-ai/DeepSeek-OCR)

## 2. Step-by-step implementation

### Step 1 — Build the presentation MVP and UI first

#### Days 1–2: Design and interactive shell

Create one high-fidelity desktop comp for the selected “Subsurface Mission Control” direction, plus a compact laptop layout.

The first viewport contains:

- Interactive nearby-wells map on the left.
- Active-well depth and formation rail in the center.
- Live scanned-document viewer on the right.
- Persistent risk strip showing current depth, formation, telemetry status, and active warnings.
- Navigation for Command Center, Document Intelligence, Embedding Explorer, and Prediction Mode.

Visual behavior:

- Dark graphite operational surface with restrained cyan, amber, and red risk accents.
- Geological contour lines and well trajectories used as functional visual language.
- A synchronized “depth sweep” moves through the active well and highlights related offset events.
- Document regions receive animated segmentation outlines by type: handwriting, printed text, table, stamp, geological section, or unknown.
- OCR text appears progressively beside its source region.
- Confidence is visualized as a heat layer, with uncertain words highlighted for review.
- Respect `prefers-reduced-motion`; expensive effects degrade to static equivalents.

Implement the shell using React, TypeScript, Vite, TanStack Query, and accessible custom components. Use:

- PDF.js for PDF canvas rendering and coordinate transforms. [PDF.js](https://github.com/mozilla/pdf.js)
- MapLibre GL JS for offline-capable GeoJSON well, radius, and trajectory layers. [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/)
- deck.gl `ScatterplotLayer` for the interactive embedding visualization. [deck.gl](https://deck.gl/docs/api-reference/layers/scatterplot-layer)

#### Days 3–5: Real live document ingestion

Implement the complete upload-to-visualization path:

1. Accept PDF, PNG, JPEG, and TIFF uploads.
2. Validate MIME type, file size, page count, and PDF safety limits.
3. Render PDF pages through PyMuPDF at a controlled DPI.
4. Apply orientation correction, deskewing, denoising, contrast enhancement, and page cropping with OpenCV.
5. Run the fast segmentation/OCR pass and immediately emit page and region events.
6. Draw normalized polygon overlays on the PDF.js canvas.
7. Send handwritten and low-confidence regions through PaddleOCR-VL refinement.
8. Replace preliminary text in place instead of waiting for the entire document.
9. Extract entities such as well name, date, depth, formation, mud weight, losses, kicks, stuck pipe, torque, pressure, casing, cementing, NPT, mitigation, and outcome.
10. Store every extracted fact with document, page, polygon, engine, confidence, and processing-version provenance.
11. Chunk the evidence and generate multilingual embeddings.
12. Emit completion or recoverable-error states per page.

Use Server-Sent Events for:

- `document.accepted`
- `page.rendered`
- `layout.detected`
- `ocr.region.created`
- `ocr.region.refined`
- `entity.extracted`
- `embedding.created`
- `document.completed`
- `page.failed`

A failed page must not fail the remaining document.

#### Days 6–8: Add the intelligence views

Build the following functional demo features:

- Nearby-wells map with active-well marker, user-defined radius, distance rings, synthetic offset wells, trajectories, formation filters, and event-severity markers.
- Correlation view aligning wells by MD, TVD/TVDSS, formation top, and distance from formation top.
- Search repository with hybrid keyword, structured-filter, and vector retrieval.
- Embedding Explorer using deterministic UMAP coordinates; color points by event type, well, formation, or severity.
- Hovering a point previews the passage; selecting it opens the corresponding PDF page and segmentation polygon.
- Cross-selection: choosing a well filters the embedding space and document results, while choosing an event highlights its well on the map.

#### Days 8–10: Prediction Mode and presentation hardening

For the MVP, Prediction Mode is an explainable historical-risk estimator, not a trained production predictor.

Inputs:

- Active well and current depth/formation.
- Current synthetic telemetry.
- Engineer’s proposed action.
- Optional expected parameter change, such as mud-weight or flow-rate adjustment.

Processing:

1. Retrieve nearby wells with matching formations and depth intervals.
2. Retrieve relevant historical incidents and mitigation outcomes.
3. Apply transparent risk rules and similarity scoring.
4. Calculate individual mud-loss, kick, stuck-pipe, torque, overpressure, and cementing risk scores.
5. Give the local LLM only the retrieved evidence and structured scores.
6. Require a structured response with risk level, mechanisms, evidence, recommended checks, missing information, confidence, and citations.

Use a small quantized multilingual instruction model through llama.cpp or Ollama. The LLM explains the deterministic evidence; it does not invent the underlying score.

Add a one-click demo reset, model warm-up, local health screen, seeded telemetry replay, offline map assets, and a backup recording. Cached OCR may be shown only as an explicitly labeled replay mode.

### Step 2 — Harden the data foundation

- Replace synthetic inputs incrementally with approved WCRs, DDRs, mud logs, event logs, well surveys, casing records, and geological data.
- Add document versioning, duplicate detection, reprocessing, human correction, and extraction audit history.
- Add configurable field dictionaries, formation aliases, units, well-name aliases, and English/Hindi terminology.
- Normalize units and retain original values.
- Establish MD, TVD, TVDSS, formation-top, and formation-relative depth as distinct fields.
- Introduce human review queues for low-confidence OCR and high-impact events.

### Step 3 — Build production offset-well correlation

- Use PostGIS geodesic distance queries for radius searches.
- Correlate events using spatial distance, formation, lithology, stratigraphic position, trajectory similarity, drilling phase, mud system, and operational parameters.
- Provide synchronized depth tracks across selected wells.
- Generate formation-specific summaries of hazards, successful mitigations, casing practices, cementing outcomes, and NPT.
- Ensure every summary links back to page-level evidence.

### Step 4 — Integrate eRTMAC and real-time alerts

Create an adapter boundary rather than coupling NWIS directly to an assumed eRTMAC protocol.

- Implement CSV/JSON telemetry replay for the MVP.
- Later implement the approved eRTMAC REST, message-bus, historian, or streaming adapter.
- Normalize WOB, ROP, RPM, torque, SPP, flow-in/out, pit volume, mud weight, ECD, gas, hook load, and depth.
- Add windowed features, missing-data checks, sensor-quality flags, and time synchronization.
- Trigger alerts only after persistence, hysteresis, and cooldown conditions.
- Support acknowledge, suppress, escalate, comment, and outcome feedback workflows.

### Step 5 — Develop and validate predictive models

After sufficient labeled OIL data exists:

- Train separate models for mud loss, kick, stuck pipe, torque spike, overpressure, cementing failure, and NPT.
- Use gradient-boosted tabular models for formation/depth/offset-well features.
- Use survival or hazard models for distance-to-event predictions.
- Add time-series anomaly models for telemetry deviations.
- Split validation by well and chronology to prevent leakage between intervals from the same well.
- Calibrate probabilities and measure PR-AUC, Brier score, lead time, recall at an operationally acceptable false-alert rate, and alert burden per drilling day.
- Use SHAP or equivalent feature attribution alongside retrieved offset-well evidence.
- Deploy models in shadow mode before enabling operational alerts.
- Retrain only through versioned, approved datasets and retain rollback capability.

### Step 6 — Production security, governance, and pilot

- Deploy behind OIL authentication with roles for drilling engineer, geologist, reviewer, administrator, and auditor.
- Encrypt documents and databases at rest and in transit.
- Add malware scanning, PDF bomb protection, prompt-injection isolation, audit logs, model registry, and data-retention controls.
- Prevent source documents from leaving the approved network.
- Track OCR corrections, recommendation acceptance, false alerts, missed events, and operational outcomes.
- Pilot with a limited operational area and compare NWIS recommendations against existing engineering workflows before wider rollout.

## 3. Architecture and interfaces

### Deployment units

- `web`: React/Vite dashboard.
- `api`: FastAPI REST and SSE service.
- `worker`: Python OCR, extraction, embedding, and UMAP jobs.
- `redis`: job queue and progress pub/sub.
- `postgres`: PostgreSQL with PostGIS and pgvector.
- `blob-store`: local filesystem for MVP, replaceable by on-prem MinIO.
- `model-runtime`: local PaddleOCR and llama.cpp/Ollama services.

### Core records

- `Well`, `Wellbore`, `SurveyStation`
- `FormationInterval`
- `Document`, `DocumentPage`, `DocumentBlock`
- `DrillingEvent`, `OperationalInterval`
- `TelemetrySample`
- `Embedding`
- `RiskAssessment`, `Alert`
- `RecommendationFeedback`

Every extracted record includes source document, page, normalized polygon, extraction engine, confidence, model version, timestamps, and reviewer state.

### Important API contracts

- `POST /api/documents` — upload and return `documentId`.
- `GET /api/documents/{id}/events` — SSE parsing progress.
- `GET /api/documents/{id}/pages/{page}` — page and block data.
- `PATCH /api/blocks/{id}` — reviewer correction with audit history.
- `GET /api/wells/nearby?lat=&lon=&radiusKm=` — nearby wells as GeoJSON.
- `GET /api/wells/{id}/correlation` — aligned formations, events, and depth tracks.
- `GET /api/search` — hybrid search with well, event, formation, depth, date, and radius filters.
- `GET /api/embeddings` — filtered 2D points and source metadata.
- `POST /api/decision-support/query` — question, proposed action, active state, and structured cited assessment.
- `GET /api/alerts/stream` — live alert stream.
- `POST /api/demo/telemetry-replay` — deterministic MVP-only replay.

`DocumentBlock` stores a normalized polygon rather than only a rectangle so irregular handwritten regions remain accurately linked to the rendered page.

## 4. Verification and presentation acceptance

### OCR evaluation

Create a human-transcribed test set containing full handwritten English pages, full handwritten Hindi pages, mixed scans, rotated pages, faint photocopies, tables, stamps, and drilling terminology.

Measure:

- Character and word error rate by language.
- Layout-region precision/recall and polygon overlap.
- Key drilling-entity precision/recall.
- Event classification accuracy.
- Page throughput and peak memory on the presentation laptop.

Benchmark PaddleOCR-VL, the fast Paddle pipeline, DeepSeek-OCR, and Unlimited OCR against the same pages before making any production-wide engine commitment.

### MVP acceptance criteria

- The first page preview and processing state appear within two seconds of upload.
- Real segmentation polygons appear progressively without freezing the UI.
- A short scanned demo document completes locally within the presentation time budget.
- Selecting any extracted fact or embedding point opens the exact source page and region.
- Radius changes update the offset-well set correctly.
- Formation/depth correlation is consistent across the map, depth rail, documents, and Prediction Mode.
- Every material LLM claim carries source citations or is explicitly marked as an inference.
- Prediction scores change deterministically when telemetry or the proposed action changes.
- The entire judge flow works offline after models and assets are installed.
- Keyboard navigation, contrast, reduced motion, empty states, partial failures, and OCR retry paths are verified.

### Judge demonstration sequence

1. Upload a short scanned English/Hindi handwritten drilling report.
2. Watch page preprocessing, segmentation boxes, OCR refinement, and entity extraction happen live.
3. Show extracted incidents appearing on the nearby-wells map and depth rail.
4. Open the embedding visualization and select a mud-loss cluster.
5. Start synthetic eRTMAC telemetry replay approaching the same formation.
6. Show the risk strip escalate with its historical evidence.
7. Ask whether a proposed mud-weight change could cause problems.
8. Present the cited risk assessment, mitigation checks, confidence, and missing-data warning.
9. Click a citation and zoom directly to the handwritten source region.

## 5. Assumptions and boundaries

- The MVP uses synthetic locations, documents, events, and telemetry clearly labeled as synthetic.
- No OIL accuracy, safety, or operational-impact claims are made until validated on approved OIL data.
- CPU limitations are handled through progressive OCR, bounded demo documents, warm models, and visible queues—not hidden cloud processing.
- Production deployment remains model-provider-neutral through OCR, embedding, LLM, storage, and telemetry adapter interfaces.
- Final operational recommendations require engineer review and must never be sent automatically to drilling-control systems.
