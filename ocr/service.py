"""GLM-OCR on Apple Silicon. Images and inference stay on this machine."""
import asyncio
import base64
import binascii
import io
import logging
import os
import platform
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from PIL import Image, UnidentifiedImageError

MODEL_ID = os.environ.get("MLX_OCR_MODEL", "mlx-community/GLM-OCR-bf16")
MAX_TOKENS = int(os.environ.get("MLX_OCR_MAX_TOKENS", "8192"))
Image.MAX_IMAGE_PIXELS = 40_000_000
log = logging.getLogger("uvicorn.error")
# Keep model loading and Metal inference on the same worker thread.
executor = ThreadPoolExecutor(max_workers=1)
model = processor = None
busy = asyncio.Lock()


def load_model():
    global model, processor
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise RuntimeError("This OCR runtime requires an Apple Silicon Mac.")
    import mlx.core as mx
    from mlx_vlm import load
    if not mx.metal.is_available():
        raise RuntimeError("Metal GPU is unavailable on this machine.")
    log.info("Loading %s on Metal (first start downloads weights)…", MODEL_ID)
    model, processor = load(MODEL_ID)
    log.info("GLM-OCR loaded and ready on Metal.")


@asynccontextmanager
async def lifespan(_app):
    await asyncio.get_running_loop().run_in_executor(executor, load_model)
    yield
    executor.shutdown(wait=True)


app = FastAPI(lifespan=lifespan)


class Page(BaseModel):
    imageBase64: str = Field(min_length=1, max_length=28_000_000)


def recognize(encoded):
    from mlx_vlm import generate
    from mlx_vlm.prompt_utils import apply_chat_template
    import mlx.core as mx
    try:
        raw = base64.b64decode(encoded, validate=True)
        image = Image.open(io.BytesIO(raw))
        image.load()
        image = image.convert("RGB")
    except (binascii.Error, ValueError, UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(400, "Invalid or oversized page image.") from exc
    try:
        prompt = apply_chat_template(processor, model.config, "Text Recognition:", num_images=1)
        result = generate(model, processor, prompt, image=[image], max_tokens=MAX_TOKENS, temperature=0.0, verbose=False)
        if result.generation_tokens >= MAX_TOKENS:
            raise HTTPException(422, "OCR reached its output limit. Split this dense page into smaller images and retry.")
        return {"text": result.text.strip(), "engine": "GLM-OCR", "model": MODEL_ID, "device": "metal"}
    finally:
        image.close()
        mx.clear_cache()


@app.get("/health")
def health():
    return {"engine": "GLM-OCR", "model": MODEL_ID, "device": "metal", "ready": model is not None, "busy": busy.locked()}


@app.post("/ocr")
async def ocr(page: Page):
    if busy.locked():
        raise HTTPException(429, "GLM-OCR is processing another page. Retry after it finishes.")
    async with busy:
        try:
            return await asyncio.get_running_loop().run_in_executor(executor, recognize, page.imageBase64)
        except HTTPException:
            raise
        except Exception as exc:
            log.exception("Local OCR failed")
            raise HTTPException(500, "Local GLM-OCR failed. Check npm run ocr:logs for details.") from exc


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("MLX_OCR_PORT", "8080")))
