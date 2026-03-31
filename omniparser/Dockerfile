# OmniParser v2 — REST API wrapper
# Serves POST /parse  →  { annotated_image, parsed_elements }
#
# Model weights (~300 MB) are downloaded on first run and cached in the
# omniparser-weights volume so subsequent restarts are instant.
#
# GPU recommended but not required (CPU inference: ~5-10s/frame on a modern host).

FROM python:3.12-slim

# System deps
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends \
        git curl libgl1 libglib2.0-0 libsm6 libxrender1 libxext6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Clone OmniParser v2
RUN git clone --depth 1 https://github.com/microsoft/OmniParser.git .

# Python deps
RUN pip install --no-cache-dir \
    fastapi \
    uvicorn[standard] \
    torch torchvision --index-url https://download.pytorch.org/whl/cpu \
    transformers \
    ultralytics \
    Pillow \
    huggingface_hub \
    easyocr

# Download model weights at build time so the container starts instantly.
# Set HF_HOME to a directory that maps to the named volume.
ENV HF_HOME=/app/weights/hf_cache
RUN python - <<'EOF'
from huggingface_hub import snapshot_download
import os
os.makedirs("/app/weights", exist_ok=True)
snapshot_download(
    repo_id="microsoft/OmniParser-v2.0",
    local_dir="/app/weights/omniparser-v2",
    ignore_patterns=["*.git*"],
)
EOF

# REST API server
COPY server.py /app/server.py

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
