# syntax=docker/dockerfile:1
FROM python:3.11.13-slim-bookworm@sha256:86adf8dbadc3d6e82ee5dd2c74bec2e1c2467cdad47886280501df722372d2e1

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 YOLO_AUTOINSTALL=false
WORKDIR /training
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements-cpu-linux.lock ./
RUN python -m pip install --require-hashes -r requirements-cpu-linux.lock \
    && python -m pip check
COPY smoke.py ./
CMD ["python", "smoke.py"]
