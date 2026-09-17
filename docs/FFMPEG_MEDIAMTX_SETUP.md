# Cài FFmpeg và phát webcam qua MediaMTX

Webcam được FFmpeg mã hóa thành H.264, đẩy vào MediaMTX bằng RTSP và có thể xem lại bằng
RTSP hoặc WebRTC.

```text
Webcam → FFmpeg → RTSP → MediaMTX → RTSP/WebRTC client
```

## 1. Cài FFmpeg

Mở PowerShell và chạy:

```powershell
winget install --id Gyan.FFmpeg --exact
```

FFmpeg được cài trên máy, không nằm trong repository và không được push lên Git.

Sau khi cài, đóng hoàn toàn IDE đang mở, gồm mọi cửa sổ VS Code hoặc Cursor, rồi mở lại.
Terminal tích hợp kế thừa `PATH` từ tiến trình IDE nên chỉ đóng và mở terminal có thể chưa đủ.

Kiểm tra:

```powershell
ffmpeg -version
ffprobe -version
ffplay -version
```

Nếu chưa muốn khởi động lại IDE, cập nhật `PATH` cho terminal hiện tại:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

ffmpeg -version
```

## 2. Khởi động MediaMTX

Từ thư mục gốc của dự án:

```powershell
docker compose up -d mediamtx
docker compose ps mediamtx
```

Container cần ở trạng thái `Up` và mở các cổng:

| Giao thức   | Cổng mặc định | Mục đích                          |
| ----------- | ------------- | --------------------------------- |
| RTSP        | 8554/TCP      | Nhận và phát luồng camera         |
| WebRTC HTTP | 8889/TCP      | Trang xem video trong trình duyệt |
| WebRTC ICE  | 8189/UDP      | Truyền media WebRTC               |

## 3. Tìm tên webcam

Liệt kê camera DirectShow:

```powershell
ffmpeg -hide_banner -list_devices true -f dshow -i dummy
```

Lệnh này có thể kết thúc bằng `Error opening input file dummy`. Đây là hành vi bình thường:
`dummy` chỉ được dùng để yêu cầu FFmpeg in danh sách thiết bị.

Ví dụ kết quả:

```text
"ACER HD User Facing" (video)
"Camera (NVIDIA Broadcast)" (video)
```

Kiểm tra độ phân giải, FPS và pixel format mà webcam hỗ trợ:

```powershell
ffmpeg -hide_banner -f dshow -list_options true -i video="Tên camera máy"
```

Thay `Tên camera máy` bằng đúng tên webcam trên máy của bạn.


## chạy docker trước khi phát webcam 

  docker compose up -d mediamtx
  docker compose ps mediamtx

## 4. Phát webcam thành RTSP

Lệnh cơ bản:

```powershell
ffmpeg -hide_banner -f dshow -i video="ACER HD User Facing" `
  -c:v libx264 -preset ultrafast -tune zerolatency `
  -pix_fmt yuv420p -f rtsp -rtsp_transport tcp `
  rtsp://localhost:8554/cam_living_room
```

Ví dụ đã kiểm tra trên webcam `ACER HD User Facing` ở 1280×720:

```powershell
ffmpeg -hide_banner -f dshow `
  -video_size 1280x720 -framerate 30 -pixel_format nv12 `
  -i video="ACER HD User Facing" -an `
  -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p `
  -f rtsp -rtsp_transport tcp `
  rtsp://localhost:8554/cam_living_room
```

Giữ terminal này đang chạy trong lúc sử dụng camera. Nhấn `Ctrl+C` để dừng luồng.

## 5. Kiểm tra luồng

Kiểm tra codec và độ phân giải mà không mở cửa sổ video:

```powershell
ffprobe -v error -rtsp_transport tcp `
  -show_entries stream=codec_name,width,height,r_frame_rate `
  -of default=noprint_wrappers=1 `
  rtsp://localhost:8554/cam_living_room
```

Kết quả mong đợi có `codec_name=h264` và độ phân giải của webcam.

Xem bằng RTSP:

```powershell
ffplay -rtsp_transport tcp rtsp://localhost:8554/cam_living_room
```

Xem bằng WebRTC trong trình duyệt:

```text
http://localhost:8889/cam_living_room
```

Nếu video chưa tự phát, nhấn nút Play trên trình phát.

Kiểm tra log MediaMTX:

```powershell
docker compose logs --tail=100 mediamtx
```

Khi hoạt động đúng, log sẽ có các thông báo tương tự:

```text
stream is available and online
is publishing to path 'cam_living_room'
```

## 6. Phát file video thay webcam

File video dùng cho dataset không được commit vào Git. Phát video lặp vô hạn bằng:

```powershell
ffmpeg -re -stream_loop -1 -i .\datasets\fall_01.mp4 `
  -c copy -f rtsp -rtsp_transport tcp `
  rtsp://localhost:8554/cam_test
```

Nếu codec của file không tương thích với client, mã hóa lại thành H.264:

```powershell
ffmpeg -re -stream_loop -1 -i .\datasets\fall_01.mp4 `
  -c:v libx264 -preset ultrafast -tune zerolatency -an `
  -f rtsp -rtsp_transport tcp `
  rtsp://localhost:8554/cam_test
```

## 7. Lỗi thường gặp

### Webcam đang được ứng dụng khác sử dụng

Đóng Camera, Teams, Zoom, OBS hoặc trình duyệt đang giữ webcam, sau đó chạy lại FFmpeg.

### Camera không hỗ trợ định dạng được yêu cầu

Chạy `-list_options true`, sau đó chọn đúng `video_size`, `framerate` và `pixel_format`
mà thiết bị công bố.

### RTSP hoạt động nhưng WebRTC không có hình

Kiểm tra Compose đã publish cả `8889/TCP` và `8189/UDP`, sau đó dựng lại MediaMTX:

```powershell
docker compose up -d --force-recreate mediamtx
```

Nếu truy cập từ máy khác trong LAN, đặt `MEDIAMTX_WEBRTC_ADDITIONAL_HOSTS` trong `.env`
thành địa chỉ IP của máy chạy Docker rồi dựng lại container.

## 8. Nâng cấp hoặc gỡ FFmpeg

Nâng cấp:

```powershell
winget upgrade --id Gyan.FFmpeg --exact
```

Gỡ khỏi máy:

```powershell
winget uninstall --id Gyan.FFmpeg --exact
```

Sau khi nâng cấp hoặc gỡ cài đặt, đóng và mở lại IDE để terminal nhận `PATH` mới.
