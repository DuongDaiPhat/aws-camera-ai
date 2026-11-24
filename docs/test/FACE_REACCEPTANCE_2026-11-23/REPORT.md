# Kiểm thử lại BEST-SHOT — 23/11/2026

**Đạt các tiêu chí còn lại trong phạm vi đã điều chỉnh: 25/25 kiểm tra nghiệm thu.** Hai video stress vẫn chưa đạt theo lựa chọn giữ gate 80 px của người yêu cầu; Video 6 được loại khỏi đợt E2E này. Bộ bằng chứng dùng AWS dev thật, tách khỏi benchmark chọn ảnh cục bộ ở `FACE_BEST_SHOT_2026-11-23`.

## 1. Phạm vi và tiêu chí

- Kiểm thử lại các mục chưa đạt/đạt một phần trong báo cáo 22/11: Video 2, 5, tailgating/stress 8, retry 9 và cache invalidation 10. **Không replay Video 6 trong đợt E2E này.**
- Người yêu cầu đã chọn **giữ gate cứng 80 px**, chấp nhận hai video stress `known_face_and_stranger` và `known_face_with_glass_and_stranger` chưa đạt. Không đổi các track chưa phân tích thành UNKNOWN.
- Các ngưỡng nhận diện vẫn giữ: Rekognition 0.90, embedding cache cosine 0.72; không dùng giả kết quả identity để làm xanh testcase.
- Case 5 chỉ đạt đầy đủ khi giữ **một event logic** qua che khuất. Hai raw Frigate ID có thể được nối vào một event sau xác minh; hai event KNOWN với một Search vẫn chỉ là đạt một phần.
- Video gốc và clip control dẫn xuất được phân biệt. Control giữ nguyên mật độ pixel của ảnh nguồn; không dùng kết quả control để thay thế kết quả video gốc.

## 2. Bản sửa được kiểm tra

Các thay đổi BEST-SHOT trước đó: cửa sổ 4000 ms, tối đa 32 mẫu, tắt early dispatch mặc định, lấy mẫu tối thiểu 150 ms từ frame paired, chặn timestamp lặp, PNG crop trung gian, JPEG bridge 98, mặt tối thiểu 80 px và detail chuẩn hóa tối thiểu 12. Xem [báo cáo chọn ảnh](../FACE_BEST_SHOT_2026-11-23/REPORT.md).

Đợt E2E bổ sung:

1. **Warm-up AI trước health ready**, giới hạn OpenCV 2 thread để giảm cold timeout và tranh chấp CPU.
2. **Crop vùng đầu ở pixel gốc** trước khi assess/gửi AWS; appearance vẫn tính trên crop người đầy đủ. Vùng đầu không được resize hoặc làm nét.
3. **Kiểm tra face thuộc đúng person** trong cùng paired frame trước khi dùng face/embedding/cache. Mẫu nhập nhằng giữa hai người bị bỏ qua.
4. **Nối incident có xác minh**: canonical proposal chỉ được dùng sau kiểm tra scope/version, track cũ KNOWN đã kết thúc, vị trí và appearance. Mặt qua gate phải corroborate bằng embedding; chặn multi-face/fail-open. Chờ tối đa 1500 ms cho metadata/ảnh paired tới trước khi tạo event thứ hai. Bridge giữ canonical tối đa 20 giây, đồng bộ cửa sổ Spatial Re-ID.
5. **Detector confidence tối thiểu 0.90** trong bản E2E cuối; chặn thêm các detection mặt bị che không ổn định. YuNet/SFace không đổi model.
6. Worker phân biệt lỗi Rekognition: không phát hiện mặt → UNDETERMINED/NO_FACE_DETECTED; không đọc được S3 image → UNDETERMINED/IMAGE_UNAVAILABLE. Các lỗi khác tiếp tục retry theo luồng SQS hiện có.

BEST-SHOT ở đây là ảnh có điểm cao nhất trong **cửa sổ đã quan sát**. Không bảo đảm frame tốt nhất của toàn bộ tương lai track hoặc khôi phục chi tiết không có trong nguồn.

## 3. Môi trường và bằng chứng

QA owner/camera/collection mới, chỉ đăng ký A khi chạy tailgating; B chưa đăng ký. Các dữ liệu private, token, JWT, mật khẩu, cấu hình Lambda đầy đủ và package backup ở thư mục ignored `artifacts/face-reacceptance-2026-11-23`.

Replay native 1920×1080, encode trước H.264 CRF 12/30 FPS rồi RTSP `-re -c:v copy`; Frigate detect 5 FPS. Không encode realtime ở preset ultrafast trong bộ replay cuối. Vẫn ghi nhận rớt frame/thiếu paired image khi xảy ra; không tính lượt thiếu ảnh là đạt.

Cloudflare Quick Tunnel HTTPS tạm thời được người yêu cầu cho phép. Caddy chỉ chuyển tiếp callback `/api/v1/internal/cloud/face-jobs/*`; callback vẫn yêu cầu token. AWS worker dùng S3/SQS/Rekognition dev thật. Fault control chỉ chạy trên backend QA loopback và face object thuộc owner QA này; không sửa kết quả recognition.

- [Trace pipeline](evidence/pipeline.jsonl), [MQTT Frigate](evidence/frigate-events.jsonl).
- [Suite replay cuối](evidence/verified-suite.txt), [source của runner](../../../tools/scripts/face-reacceptance-suite.mjs).
- [Các clip control và SHA-256](data/control-manifest.json), [source tạo control](../../../tools/scripts/face-reacceptance-controls.py).
- Crop dispatch giữ byte thật và SHA-256 trong trace, nằm trong `evidence/crops/`.
- Script tổng hợp chỉ đếm Search có AWS request ID tương ứng job. Thiếu CloudWatch evidence được ghi `null`, không suy thành 0.

## 4. Hai video stress được chấp nhận chưa đạt

Các lượt `TC08-extra-*-candidate` vẫn bỏ lỡ UNKNOWN của B. Face B trong paired crop chỉ khoảng **29–52 px**, dưới gate 80 px. Một số track người còn phân mảnh; không gộp NOT_ANALYZED thành người lạ.

Probe riêng trên sáu crop bị chặn cho thấy Rekognition vẫn có thể detect face, và độ giống A rất thấp. Đây chỉ là chẩn đoán khả năng provider, **không phải một luồng E2E đạt**. [Kết quả probe](data/rejected-crop-probes.json).

Nhánh thử xác minh ảnh nhỏ đã được bỏ theo lựa chọn của người yêu cầu; không có cấu hình bypass gate 80 px được bàn giao.

## 5. Kiểm thử tự động

- Backend: **81/81**, 10 suite — [log](evidence/backend-tests.txt).
- Sau sửa race canonical: **23/23**, coordinator/state — [log](evidence/coordinator-final-tests.txt); đây là nhóm chạy lại, không cộng trùng vào 81.
- AI runtime Docker: **20/20**, quality và warm-up/health — [log](evidence/ai-tests-strict.txt).
- Lambda: **19/19** — [log](evidence/lambda-tests.txt).
- Bridge: xem [log cuối](evidence/bridge-tests.txt), gồm kiểm tra gap 20 giây và tailgating/camera isolation.
- Lint: 0 error, cảnh báo complexity/length/return type được giữ trong [log](evidence/lint-final.txt).

Bridge cuối: **20/20**. TypeScript typecheck/build thành công. Các số lượng test chạy lại không được cộng trùng.

Hook commit dùng Python 3.11.13 trong môi trường riêng `artifacts/commit-venv`. Hai script CLI được tách phần sampling/import để qua lint; benchmark Video 3 sau refactor cho JSON kết quả giống hệt trước refactor. Secret scanner được tăng buffer diff 10 → 64 MiB vì bộ bằng chứng vượt giới hạn cũ; scan staged và regression `check-secrets.test.mjs` đều đạt, giữ nguyên cơ chế từ chối khi quét lỗi.

## 6. Kết quả chốt và số call thật

[Audit 25/25](data/acceptance-checks.json) · [log audit](evidence/acceptance-audit.txt) · [từng lượt và request ID](data/summary.json) · [CloudWatch](evidence/cloudwatch.txt).

| Case                              | Kết quả chốt                                                                                                                                                                   | Job / SearchFacesByImage   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| 2 — Video gốc, không kính/có kính | Mỗi video 1 event KNOWN A                                                                                                                                                      | 1 / 1 mỗi video            |
| 2 — Khóa KNOWN, control 30 giây   | Hai bản giữ KNOWN khi người vẫn được quan sát thêm 21.25/21.10 giây sau kết quả                                                                                                | 1 / 1 mỗi control          |
| 5 — Che khuất, hai video gốc      | Mỗi bản **1 event KNOWN, 1 canonical ID**; hai raw Frigate ID được xác minh nối tiếp, không tạo event thứ hai                                                                  | 1 / 1 mỗi video            |
| 8 — Hai video chính               | Không kính: KNOWN/KNOWN/UNKNOWN, 3 event; có kính: KNOWN/UNKNOWN, 2 event. Có UNKNOWN riêng, không gán B thành A trong các lượt chốt                                           | 2 / 2 mỗi video            |
| 8 — Hai video stress bổ sung      | **Chưa đạt, được chấp nhận**; giữ NOT_ANALYZED khi không đủ gate 80 px                                                                                                         | Không tính là pass         |
| 9 — Hai video gốc                 | Mỗi bản 1 UNKNOWN; file `known_face_vid9` là B chưa đăng ký trong fixture này                                                                                                  | 1 / 1 mỗi video            |
| 9 — Single UNKNOWN recheck        | Cùng event UNKNOWN → UNKNOWN, quality **0.4332 → 0.6180**, gain 0.1848; revision 1/2, không có lần 3. Người còn hiện diện thêm 9.57 giây sau kết quả cuối                      | 2 / 2                      |
| 9 — UNDETERMINED rồi rõ mặt       | AI outage + fail-open chỉ trong control; AWS thật trả NO_FACE_DETECTED. Sau phục hồi, cùng event retry thành KNOWN                                                             | 2 / 2                      |
| 9 — Giới hạn hai retry            | Xóa đúng ảnh face QA sau upload để AWS thật trả IMAGE_UNAVAILABLE. Revision 1/2/3; cooldown **17.085/14.941 giây**. Không có revision 4 dù người còn hiện diện thêm 12.87 giây | 3 / 3                      |
| 10 — Prime và hit embedding       | Prime KNOWN; lượt lặp tắt Spatial, hit **embedding cosine 0.948767**, provider local-session-cache                                                                             | Prime 1 / 1; hit **0 / 0** |
| 10 — Sau xóa A                    | B vẫn đăng ký để collection không rỗng. Version **3 → 4**, UNKNOWN với Search mới, chỉ **168.559 giây từ đầu lượt prime**, trong TTL 300 giây                                  | 1 / 1                      |

Nhóm chốt gồm **16 lượt replay, 19 event, 21 face job, 21 face PutObject, 21 SendMessage và 21 Search có AWS request ID**. [Danh sách lượt được chọn](data/selected-replays.json). Đây không phải tổng mọi lượt chẩn đoán/probe trong đợt làm việc. “0 S3” ở control cache chỉ là **face-crop upload**; snapshot/clip event có thể vẫn được lưu. Audit cũng kiểm tra trực tiếp khoảng thời gian cache hit để loại khả năng có face upload/job send mồ côi.

Các lượt `initial`, `final`, `candidate`, `strict`, `verified` đầu được giữ để kiểm tra lịch sử. Case 5 từng có hai event; sau đồng bộ cửa sổ canonical và sửa race metadata, các lượt `continuity` mới đạt một event. Video 2 kính có một lượt thiếu toàn bộ paired crop (`TC02-glasses-verified`, 0 job), được ghi là không đạt; `TC02-glasses-replay` là lượt chốt KNOWN. Không dùng kết quả của lần thiếu ảnh để chứng minh gate/recognition.

Các control giữ frame nguồn, kéo dài thời gian đứng yên hoặc đảo một đoạn chuyển động để tạo quality gain có thể kiểm chứng. Control UNDETERMINED có fault injection được công bố; nhận diện, lỗi provider, callback và revision đều chạy thật. [Manifest](data/control-manifest.json) ghi derivation/SHA-256. A đã được khôi phục đủ 5 ảnh, B đã được gỡ sau control version; collection cuối version 6. [Known Faces cuối](data/known-faces-current.json), [collection cuối](data/collection-current.json).

## 7. Ước tính khoảng cách cho 1280×720

Người yêu cầu cung cấp độ phân giải **1280×720**, chưa có model camera/HFOV. Kết quả E2E ở trên dùng **1920×1080**; chưa có bộ E2E 720p trong đợt này. Khoảng cách dưới đây là ước tính hình học, chưa phải số đo nhận diện ngoài hiện trường.

Giả định mặt nhìn thẳng rộng **0.16 m**, camera pinhole, không digital zoom: `D ≈ 1280 × 0.16 / (2 × p × tan(HFOV/2))`, với `p` là bề rộng mặt bằng pixel. Công thức suy ra từ phép chiếu camera trong [tài liệu OpenCV](https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html).

| HFOV giả định | Mặt 80 px — biên kích thước của gate | Mặt 120 px | Mặt 160 px — target size của score |
| ------------- | -----------------------------------: | ---------: | ---------------------------------: |
| 60°           |                               2.22 m |     1.48 m |                             1.11 m |
| 70°           |                           **1.83 m** | **1.22 m** |                         **0.91 m** |
| 90°           |                               1.28 m |     0.85 m |                             0.64 m |

Với ví dụ HFOV 70°, có thể lấy **khoảng 1.8 m làm biên kích thước lý thuyết**, và **0.9–1.2 m làm vùng mục tiêu cho crop 120–160 px**. Các kiểm tra detail, pose, detector confidence và match 90% vẫn có thể từ chối trước biên 80 px. Cần HFOV hoặc calibration và phép đo khoảng cách thực tế để chốt con số cho camera của người yêu cầu. Cùng FOV/vị trí, số pixel mặt và biên khoảng cách 720p bằng 2/3 profile 1080p.

## 8. Trạng thái bàn giao

Worker dev giữ handler đã kiểm thử. Callback HTTPS, cấu hình Frigate và tiến trình QA tạm thời được dọn sau khi chốt bằng chứng; kết quả khôi phục lưu trong `data/restore-qa.json` và `data/cleanup.json`. Không push nhánh hoặc công bố dataset ra dịch vụ bên ngoài.
