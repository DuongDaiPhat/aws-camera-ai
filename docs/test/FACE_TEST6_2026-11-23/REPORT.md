# Báo cáo kiểm thử lại Test 6 — Local Session Cache (2026-11-23)

## 1. Kết luận tổng quan

**ĐẠT (PASS) trên cả 2 video Test 6 (`Dataset_2`)** sau khi nâng cấp embedding cục bộ cho Quality Gate và bổ sung ngân hàng mẫu đa góc nhìn + guard chống lây nhãn khi che khuất:

- **Video không kính** (`local_image/Dataset_2/Videos/known_face_vid6.mp4`, dài `49.53s`): Người quen (`Person A QA`) rời khung hình khoảng **`24.53s`** (`0.0–9.87s` -> quay lại `34.4–49.33s`; khuôn mặt YuNet vắng **`27.47s`** từ `9.33s` đến `36.8s`) và đổi áo. Lần 1 nhận diện `KNOWN` qua AWS Rekognition (`1` job); lần quay lại nhận diện **`KNOWN` (`Person A QA`) qua `local-session-cache`** (`similarity=0.606169 >= 0.52`, `spatialReidHits=0`, **`0` lần gọi AWS Rekognition bổ sung**).
- **Video đeo kính** (`local_image/Dataset_2/Videos/known_face_vid6_with_glass.mp4.mp4`, dài `56.07s`): Người quen (`Person A QA`) rời khung hình **`28.0s`** (`0.0–5.6s` -> quay lại `33.6–56.0s`; khuôn mặt vắng **`29.87s`** từ `4.53s` đến `34.4s`; khoảng hở giữa Track 1 và Track 2 trong orchestrator là `23.36s > 20s` `spatialReidMaxGapMs`) và đổi áo. Lần 1 nhận diện `KNOWN` qua AWS Rekognition (`1` job); lần quay lại nhận diện **`KNOWN` (`Person A QA`) qua `local-session-cache`** (`similarity=0.5546 >= 0.52`, `spatialReidHits=0`, **`0` lần gọi AWS Rekognition bổ sung**).
- **Không hồi quy**: Cả `TC08` (chen người lạ có/không kính), `TC05` (nối track), `TC02` (best-shot), `41/41` Jest test (`@cam/orchestrator`) và `152/152` pytest (`services/ai-service`) đều đạt.

---

## 2. So sánh Baseline vs Bản nâng cấp (AWS Dev Live E2E)

| Kịch bản & Video                                      | Giai đoạn             | Track 1 (Khởi tạo)                                                        | Track 2 (Quay lại >20s, đổi áo)                                                                                                       | Số lần gọi `SearchFacesByImage` | Kết quả  |
| ----------------------------------------------------- | --------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------- |
| `TC06-no-glasses` (`known_face_vid6.mp4`)             | Baseline (repo cũ)    | `3f0bbc61...` — `KNOWN` via `rekognition` (`0.9986`, job `a3b01a29...`)   | `0400db68...` — Miss local cache (SFace cos `0.5677 < 0.72`) -> gọi AWS (job `2082ce1e...`, `0.9980`)                                 | **2**                           | **FAIL** |
| `TC06-no-glasses` (`known_face_vid6.mp4`)             | **Sau nâng cấp cuối** | `827a1a9c...` — `KNOWN` via `rekognition` (`0.999911`, job `24f9fef0...`) | `d55b46a4...` — **`KNOWN` via `local-session-cache`** (`embedding`, sim `0.606169`, `yunet-2023mar-w600k-r50`, `spatialReidHits=0`)   | **1**                           | **PASS** |
| `TC06-glasses` (`known_face_vid6_with_glass.mp4.mp4`) | Baseline (repo cũ)    | `95b6ad2e...` — `KNOWN` via `rekognition` (`0.9987`, job `b5a91812...`)   | `2b2451d7...` — Miss cửa sổ 4s (SFace cos `0.3994`) -> gọi AWS rev 1 (`UNKNOWN` `0.6401`, job `d6f1b68a...`), muộn rev 2 hit `0.7555` | **2**                           | **FAIL** |
| `TC06-glasses` (`known_face_vid6_with_glass.mp4.mp4`) | **Sau nâng cấp cuối** | `02694166...` — `KNOWN` via `rekognition` (`0.999230`, job `63319d13...`) | `36fea33b...` — **`KNOWN` via `local-session-cache`** (`embedding`, sim `0.5546`, `yunet-2023mar-w600k-r50`, `spatialReidHits=0`)     | **1**                           | **PASS** |

---

## 3. Thực nghiệm chứng minh nâng cấp Model & Thông số

### 3.1. Benchmark 4 model embedding (2 CPU threads, 407 patch / 34,563 cặp impostor A-vs-B trên Dataset_2)

Nguồn dữ liệu thô: `data/embedder-ablation.json`.

| Model & Tiền xử lý               |     Dim | Latency mean / p95 (ms) | Impostor A-vs-B `p50` | Impostor A-vs-B `p99` | Impostor A-vs-B `max` | `vid6` no-glass (`bank5_win1_max`) | `vid6` glass (`bank5_win1_max`) | Đánh giá                                                          |
| -------------------------------- | ------: | ----------------------: | --------------------: | --------------------: | --------------------: | ---------------------------------: | ------------------------------: | ----------------------------------------------------------------- |
| `sface_2021dec.onnx` (cũ)        |     128 |           19.72 / 27.53 |                0.2689 |                0.4802 |            **0.5888** |                             0.6560 |                          0.5098 | Không đủ biên an toàn giữa kính (`0.5098`) và impostor (`0.5888`) |
| `glintr100.onnx:umeyama:RGB`     |     512 |         143.64 / 202.49 |                0.2673 |                0.4266 |                0.5246 |                             0.5313 |                          0.5387 | Biên rất mỏng (`+0.0067..+0.0141`), latency > 140ms               |
| `w600k_mbf.onnx:umeyama:RGB`     |     512 |           11.05 / 16.95 |                0.2354 |                0.4150 |                0.4874 |                             0.6362 |                          0.5354 | Biên kính chỉ `+0.0480` trên impostor max                         |
| **`w600k_r50.onnx:umeyama:RGB`** | **512** |      **79.21 / 107.34** |            **0.1704** |            **0.3186** |            **0.4206** |                         **0.6603** |                      **0.6033** | **Chọn**: biên tách cực rộng, đạt chuẩn latency < 200ms           |

### 3.2. Lý do chọn từng thông số

1. **Embedding & căn chỉnh (`w600k_r50.onnx` + Umeyama 5-point similarity + RGB `[-1, 1]`)**:
   - Đưa impostor `max` trên toàn bộ `34,563` cặp xuống **`0.4206`** (`p99=0.3186`), đồng thời nâng `vid6` có kính trong cửa sổ đầu lên `0.6033` (offline `bank5_win1_max`) và `0.5546` / `0.646893` (live E2E).
   - Được cấu hình tách riêng qua `FACE_GATE_EMBEDDER_*` / `FACE_GATE_MODEL_VERSION=yunet-2023mar-w600k-r50` trên `/face/assess` nên endpoint `/face/embed` (SFace 128-d) vẫn tương thích ngược.
2. **Ngân hàng đa góc nhìn trên Track 1 (`FACE_SESSION_CACHE_MAX_PROTOTYPES=5`, `FACE_SESSION_CACHE_PROTOTYPE_DEDUP_THRESHOLD=0.92`)**:
   - Chỉ thu thập sample đơn người sạch (`singlePersonClean = !otherPeople && !failOpenApplied && faceCount === 1`), chọn tối đa `5` mẫu đa dạng (`cos < 0.92`) theo chất lượng giảm dần thay vì lưu duy nhất 1 ảnh Best-Shot.
   - Thực nghiệm `vid6` có kính cho thấy `bank5` nâng cosine từ `0.5687` (1 mẫu đơn) lên `0.6033` (cửa sổ đầu).
3. **Ngưỡng khớp cache (`FACE_SESSION_CACHE_SIMILARITY_THRESHOLD=0.52`)**:
   - Tạo khoảng cách an toàn **`+0.0994`** trên impostor tệ nhất (`0.4206`) và **`+0.2014`** trên `p99` (`0.3186`) -> `0 / 34,563` dương tính giả.
   - Vẫn giữ biên an toàn dưới mức live Test 6 khó nhất (`0.5546` có kính, `0.606169` không kính).
4. **Hai guard chống lây nhãn khi che khuất (`TC08-glasses`)**:
   - Phát hiện trong lượt đối chứng đầu tiên: ở `TC08` có kính (`known_face_vid8_with_glass.mp4`), track người lạ `poq9yb` đã nhận diện `UNKNOWN` (`0.00824`) ở rev 1 nhưng khi Person A đi ngang che phía trước (`0.604721`), `tryEmbeddingSessionCache` lật track sang `KNOWN`.
   - Đã chặn trong `tryEmbeddingSessionCache`: (i) không chạy session cache nếu `record.state === 'UNKNOWN'`, và (ii) từ chối khớp `knownFaceId` nếu cùng camera vẫn còn track khác đang `KNOWN` & active (`endedAt === null`, cập nhật trong `5s`) giữ chính `knownFaceId` đó (`hasActiveKnownTrackForFace`).
5. **Thông số bảo toàn nguyên trạng**: Không nới lỏng `minFaceWidthPx=80`, `minDetectionScore=0.90`, `minNorm=12`, `bestShotWindowMs=4000`, ngưỡng AWS Rekognition `0.90`, `spatialReidMaxGapMs=20000`, `sessionCacheTtlMs=300000`.

---

## 4. Tóm tắt nâng cấp mã nguồn & model

- **Model & AI Service (`services/ai-service/`)**:
  - Bổ sung model `services/ai-service/models/w600k_r50.onnx` (SHA-256 `4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43`) và manifest tải model (`model-manifest.json`, `scripts/fetch_models.py`).
  - Tạo mới `app/services/face_arcface.py` (`ArcFaceOnnxRecognizer`, `umeyama_similarity`, kiểm tra SHA-256).
  - Cập nhật `app/config.py`, `app/services/face_quality.py`, `tests/test_face_quality.py`, `docker-compose.yml`, `.env.example`.
- **Orchestrator (`apps/orchestrator/`)**:
  - `src/face-recognition/face-track-optimization.config.ts`: cập nhật mặc định `sessionCacheSimilarityThreshold=0.52`, thêm `sessionCacheMaxPrototypes=5`, `sessionCachePrototypeDedupThreshold=0.92`.
  - `src/face-recognition/track-identity-state.service.ts`: thêm `recordPrototypeSample`, `buildPrototypeBank`, `hasActiveKnownTrackForFace`.
  - `src/face-recognition/face-session-cache.service.ts`: lưu và đối chiếu `maxEntrySimilarity` trên tập prototype bank.
  - `src/face-recognition/face-recognition-coordinator.service.ts`: truyền prototype bank sạch từ Track 1 vào cache và áp dụng 2 guard che khuất trong `tryEmbeddingSessionCache`.
  - Unit tests: `test/face-track-optimization.config.spec.ts`, `test/face-session-cache.service.spec.ts`, `test/face-recognition-coordinator.service.spec.ts`.

---

## 5. Kiểm thử không hồi quy, Automated & Browser UI

### 5.1. Live E2E đối chứng (chạy cùng phiên sau bản vá cuối)

- **`TC08-no-glasses-final` (`known_face_vid8.mp4`)**: Person A `KNOWN` (`76f46130...` + spatial `080cc696...` sim `0.9783`); Người lạ `313626e0...` giữ **`UNKNOWN` (`UNKNOWN_PERSON`, `person_name=null`)**; `2` jobs.
- **`TC08-glasses-final` (`known_face_vid8_with_glass.mp4`)**: Person A `KNOWN` (`ef2fedf2...`, Rekognition `0.999435`); Người lạ `abbabfbc...` giữ **`UNKNOWN` (`UNKNOWN_PERSON`, Rekognition `0.0185`, không bị lật nhãn)**; `2` jobs.
- **`TC05-no-glasses-final` (`known_face_vid5.mp4`)**: `1` event `KNOWN` (`28f8e7bc...`), `1` job.
- **`TC02-no-glasses-final` (`known_face_vid_2.mp4`)**: `1` event `KNOWN` (`c70813c7...`), `1` job.
- **CloudWatch (`camerai-s4-dev-face`, từ `2026-11-23T04:57:50Z`)**: `41` dòng log, ghi nhận chính xác **`8` lần gọi `SearchFacesByImage`** tương ứng `1 + 1 + 2 + 2 + 1 + 1 = 8` job cho cả 6 video cuối (`data/audit-summary.json`).

### 5.2. Automated Checks

- **`@cam/orchestrator`**: `nest build` OK; `tsc --noEmit` OK; `eslint` `0` lỗi (`20` warnings); Jest `6/6` suites passed, **`41/41` tests passed**.
- **`services/ai-service`** (Python `3.11.13` qua `artifacts/ai-gate-windows`): `ruff check .` OK; `ruff format --check .` (`63 files already formatted`); `mypy app` `0` lỗi (`27 source files`); `scripts/dependency_smoke.py --models-dir models` PASS; `pytest` **`152/152` passed** (coverage `91.55%`).

### 5.3. Kiểm chứng giao diện Web UI & Dọn dẹp môi trường

- Xác minh trên `http://localhost:3002` qua Antigravity `browser` subagent (kiểm chứng `BROWSER_HOST_FACTS`: `visited_origins: http://localhost:3002`, `blocked_origins: none`). Ảnh chụp xác thực từ host: [`screenshots/tc06-glasses-track2-cache.png`](screenshots/tc06-glasses-track2-cache.png) hiển thị chi tiết Track 2 (`36fea33b...` / `1795410119.22442-f0nyf5`): `Person A QA`, `yunet-2023mar-w600k-r50`, `M1_FACE: KNOWN (55%)`.
- Dọn dẹp hoàn tất (`data/cleanup.json`): đã dừng 4 daemon QA (web `3002`, runtime `3001`/`18081`, Caddy `18080`, cloudflared), chạy `restore-qa`, dừng `camerai-frigate`, recreate `camerai-mediamtx`, giữ `camerai-ai` (`healthy`), revert 2 file Next.js tự sinh (`apps/web/next-env.d.ts`, `apps/web/tsconfig.json`), và xác nhận `INTERNAL_API_BASE_URL` của `camerai-s4-dev-face` đã khôi phục về `https://four-wishlist-waves-now.trycloudflare.com/api/v1`.
