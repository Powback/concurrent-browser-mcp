"""
Minimal FastAPI wrapper around OmniParser v2.

POST /parse
  body: { base64_image: str, bbox_threshold?: float, iou_threshold?: float }
  returns: { annotated_image: str (base64 PNG), parsed_elements: list }

GET /health
  returns: { status: "ok" }
"""

import base64
import io
import os
import sys
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from PIL import Image

# ---------------------------------------------------------------------------
# Resolve weight paths
# ---------------------------------------------------------------------------
WEIGHTS_DIR = Path(os.getenv("WEIGHTS_DIR", "/app/weights/omniparser-v2"))
ICON_DETECT_MODEL = WEIGHTS_DIR / "icon_detect" / "model.pt"
ICON_CAPTION_DIR  = WEIGHTS_DIR / "icon_caption_florence"

# Add OmniParser repo root to sys.path so we can import its utils
sys.path.insert(0, "/app")

# Lazy-loaded globals
_det_model  = None
_cap_model  = None
_cap_processor = None
_ocr_reader = None

def _load_models():
    global _det_model, _cap_model, _cap_processor, _ocr_reader

    if _det_model is not None:
        return

    from ultralytics import YOLO
    from transformers import AutoProcessor, AutoModelForCausalLM
    import easyocr

    print("Loading OmniParser models …", flush=True)

    _det_model = YOLO(str(ICON_DETECT_MODEL))

    _cap_processor = AutoProcessor.from_pretrained(
        str(ICON_CAPTION_DIR), trust_remote_code=True
    )
    _cap_model = AutoModelForCausalLM.from_pretrained(
        str(ICON_CAPTION_DIR), trust_remote_code=True
    )
    _cap_model.eval()

    _ocr_reader = easyocr.Reader(["en"], gpu=False)
    print("Models loaded.", flush=True)


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="OmniParser v2 REST API")


class ParseRequest(BaseModel):
    base64_image: str
    bbox_threshold: Optional[float] = 0.05
    iou_threshold:  Optional[float] = 0.70


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/parse")
def parse(req: ParseRequest):
    _load_models()

    # Decode image
    try:
        img_bytes = base64.b64decode(req.base64_image)
        image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid image: {exc}")

    width, height = image.size

    # ----- Icon detection (YOLO) ------------------------------------------
    results = _det_model.predict(
        source=image,
        conf=req.bbox_threshold,
        iou=req.iou_threshold,
        verbose=False,
    )
    boxes = results[0].boxes  # xyxy, normalised

    elements = []
    draw_image = image.copy()

    try:
        from PIL import ImageDraw, ImageFont
        draw = ImageDraw.Draw(draw_image)
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 14)
        except Exception:
            font = ImageFont.load_default()
    except Exception:
        draw = None

    for idx, box in enumerate(boxes.xyxyn):  # normalised xyxy
        x1, y1, x2, y2 = [float(v) for v in box]
        cx = int(((x1 + x2) / 2) * width)
        cy = int(((y1 + y2) / 2) * height)

        # Crop for captioning
        crop_box = (int(x1 * width), int(y1 * height), int(x2 * width), int(y2 * height))
        crop = image.crop(crop_box)

        # Caption via Florence-2
        caption = ""
        try:
            inputs = _cap_processor(
                text="<CAPTION>", images=crop, return_tensors="pt"
            )
            out = _cap_model.generate(**inputs, max_new_tokens=32)
            caption = _cap_processor.batch_decode(out, skip_special_tokens=True)[0].strip()
        except Exception:
            caption = "icon"

        # Draw box + label on annotated image
        if draw is not None:
            px1, py1, px2, py2 = int(x1*width), int(y1*height), int(x2*width), int(y2*height)
            draw.rectangle([px1, py1, px2, py2], outline="red", width=2)
            draw.text((px1, max(0, py1 - 16)), str(idx + 1), fill="red", font=font)

        elements.append({
            "id": idx + 1,
            "type": "icon",
            "content": caption,
            "bbox": [x1, y1, x2, y2],
        })

    # ----- OCR pass -------------------------------------------------------
    try:
        ocr_results = _ocr_reader.readtext(image)
        for text, bbox_pts, conf in [
            (r[1], r[0], r[2]) for r in ocr_results if r[2] > 0.4
        ]:
            # bbox_pts is [[x,y], ...] in pixel space — convert to normalised
            xs = [p[0] for p in bbox_pts]
            ys = [p[1] for p in bbox_pts]
            x1, y1, x2, y2 = min(xs)/width, min(ys)/height, max(xs)/width, max(ys)/height

            if draw is not None:
                px1, py1, px2, py2 = int(x1*width), int(y1*height), int(x2*width), int(y2*height)
                draw.rectangle([px1, py1, px2, py2], outline="blue", width=1)
                eid = len(elements) + 1
                draw.text((px1, max(0, py1 - 16)), str(eid), fill="blue", font=font)

            elements.append({
                "id": len(elements) + 1,
                "type": "text",
                "content": text,
                "bbox": [x1, y1, x2, y2],
            })
    except Exception:
        pass  # OCR is best-effort

    # Encode annotated image as base64 PNG
    buf = io.BytesIO()
    draw_image.save(buf, format="PNG")
    annotated_b64 = base64.b64encode(buf.getvalue()).decode()

    return JSONResponse({
        "annotated_image": annotated_b64,
        "parsed_elements": elements,
    })
