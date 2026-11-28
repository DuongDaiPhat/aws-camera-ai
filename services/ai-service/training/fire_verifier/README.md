# Local Stage-2 Fire Context Verifier & Hard-Negative Pipeline

Pipeline 100% local giúp giảm báo nhầm từ ánh sáng chói, đèn LED/neon cam-đỏ và màn hình điện thoại mà **không dùng luật màu tĩnh** và **không ảnh hưởng recall lửa nhỏ của YOLO26n v2**.

## 1. Trích xuất crop bối cảnh `2.5×` cho Stage-2 Classifier

Thu thập thêm ảnh/video báo nhầm từ chính camera phòng của bạn (đèn neon, cửa sổ ngược sáng, màn hình điện thoại màu đỏ/cam) bỏ vào 1 thư mục (ví dụ `datasets/m3/custom-neg/`), sau đó chạy từ `services/ai-service`:

```powershell
..\..\artifacts\m3\runtime-dev\Scripts\python.exe -m training.fire_verifier.extract_crops `
  --output-dir ..\..\artifacts\m3\verifier-dataset `
  --pos-video-dir ..\..\datasets\m3\evaluation\firesense-v1\pos `
  --pos-video-dir ..\..\datasets\m3\evaluation\kmu-2012\pos `
  --neg-video-dir ..\..\datasets\m3\evaluation\firesense-v1\neg `
  --neg-video-dir ..\..\datasets\m3\evaluation\kmu-2012\neg `
  --neg-image-dir ..\..\datasets\m3\custom-neg `
  --min-score 0.35 `
  --context-scale 2.5
```

## 2. Train MobileNetV3-Small & Export ONNX (CPU hoặc Colab GPU)

```powershell
..\..\artifacts\m3\export-env\Scripts\python.exe -m training.fire_verifier.train_verifier `
  --data-dir ..\..\artifacts\m3\verifier-dataset `
  --output-dir ..\..\artifacts\m3\verifier-runs\v1 `
  --epochs 15 `
  --batch-size 32
```

Sau khi train xong, copy file `.onnx` vào `services/ai-service/models/` và bật trong `.env` theo `verifier-report.json`:

```env
FIRE_VERIFIER_ENABLED=true
FIRE_VERIFIER_MODEL_PATH=models/fire-verifier-mobilenetv3-v1.onnx
FIRE_VERIFIER_MODEL_SHA256=<sha256-tu-verifier-report.json>
FIRE_VERIFIER_CONFIDENCE_THRESHOLD=0.55
```

## 3. Khai thác Hard Negatives cho YOLO26n v3 (Fine-tune)

```powershell
..\..\artifacts\m3\runtime-dev\Scripts\python.exe -m training.yolo26.mine_hard_negatives `
  --output-dir ..\..\artifacts\m3\hard-negatives-v3 `
  --neg-video-dir ..\..\datasets\m3\evaluation\firesense-v1\neg `
  --neg-video-dir ..\..\datasets\m3\evaluation\kmu-2012\neg `
  --neg-image-dir ..\..\datasets\m3\custom-neg `
  --min-score 0.35
```

Trộn thư mục `images/` và `labels/` (nhãn rỗng `.txt`) vào tập train YOLO (tỷ lệ ~15–25% background negatives) rồi fine-tune từ `best.pt` với learning rate thấp (`lr0=0.001`, `epochs=20–30`), sau đó export và kiểm tra parity bằng `training/yolo26/export_checkpoint.py`.
