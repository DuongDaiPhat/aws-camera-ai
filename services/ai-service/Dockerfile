# syntax=docker/dockerfile:1
FROM python:3.11.13-slim-bookworm@sha256:86adf8dbadc3d6e82ee5dd2c74bec2e1c2467cdad47886280501df722372d2e1 AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# libgl/libglib can cho opencv o Sprint 2/3; cai san de khoi rebuild image
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libportaudio2 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-runtime.lock ./
RUN python -m pip install --require-hashes -r requirements.txt

COPY app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
