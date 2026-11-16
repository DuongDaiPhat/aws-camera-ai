# Dữ liệu mẫu (seed)

Thư mục này chứa dữ liệu **demo** cho môi trường dev — khác với `db/migrations/`
là dữ liệu **hệ thống** bắt buộc phải có ở mọi môi trường.

|              | `db/migrations/`                               | `db/seeds/`                             |
| ------------ | ---------------------------------------------- | --------------------------------------- |
| Chạy ở đâu   | Mọi môi trường (dev, CI, AWS)                  | Chỉ dev                                 |
| Nội dung     | Schema + giá trị mặc định bắt buộc (FR-ADM-04) | Tài khoản demo, camera giả, sự kiện mẫu |
| Chạy khi nào | Tự động khi Postgres khởi tạo                  | `pnpm seed` khi cần                     |

## Chạy

### Chạy bằng Docker Compose (khuyến nghị)

```bash
docker compose exec orchestrator sh -lc "cd /workspace && pnpm seed"
```

Lệnh trên vẫn gọi `pnpm seed`, nhưng chạy bên trong container để sử dụng
`DATABASE_URL` có hostname `postgres`.

### Chạy trực tiếp trên máy

Khi orchestrator chạy ngoài Docker, đặt `DATABASE_URL` trỏ tới PostgreSQL trên
`localhost:5432`, sau đó chạy:

```powershell
$env:DATABASE_URL = "postgresql://camerai:<POSTGRES_PASSWORD>@localhost:5432/camerai"
pnpm seed
```

Tài khoản đăng nhập dashboard trong môi trường dev:

```text
Email: admin@camerai.local
Mật khẩu: Admin@12345
```

Mật khẩu trên chỉ dùng để demo local và được lưu trong database dưới dạng Argon2id.

## Tài khoản Cognito theo hộ

`pnpm db:migrate` đồng bộ tài khoản, gateway và camera sau khi chạy migration SQL,
kể cả khi không có migration mới. Đặt tệp cấu hình tại `.env.cognito-households.json`
ở thư mục gốc hoặc đặt `COGNITO_HOUSEHOLD_SEED_FILE` thành đường dẫn trên máy triển khai.
Môi trường thiếu cấu hình mặc định sẽ bỏ qua bước đồng bộ.

Tệp gồm `poolId`, `systemAdmin` và mảng `households` có đúng 5 phần tử.
Mỗi hộ gồm `ownerName`, `slug` và `accounts` chứa ba khóa `ADMIN`, `CAREGIVER`,
`VIEWER`. Mỗi tài khoản (kể cả `systemAdmin`) có `email` và `sub` đã xác minh.
Giữ cấu hình tài khoản bên ngoài Git. Dùng cùng tệp trên các môi trường cần đồng bộ.

Chạy lại cập nhật vai trò và liên kết hộ theo cấu hình, giữ ID, trạng thái kích hoạt
và dữ liệu đang vận hành. Khi email đã liên kết với một danh tính khác hoặc slug
đã thuộc hộ khác, giao dịch đồng bộ bị hủy để tránh cấp nhầm quyền.

## Tài khoản kiểm thử US-20

File `0003_test_users.sql` bổ sung hai tài khoản riêng:

| Email             | Quyền       | Mật khẩu dev  |
| ----------------- | ----------- | ------------- |
| `caregiver@local` | `CAREGIVER` | `Admin@12345` |
| `viewer@local`    | `VIEWER`    | `Admin@12345` |

Runner `pnpm seed` tự đọc file này. Chạy lại cập nhật hai tài khoản theo email,
không tạo tài khoản trùng. Seed chưa gán camera, liên kết khuôn mặt hay Telegram.
Để kiểm thử US-20, cần camera thuộc caregiver, khuôn mặt thật liên kết viewer với
đúng hộ và Telegram đã xác minh cho từng tài khoản.

## Dữ liệu tiếp theo của Sprint 1 (US-07)

Tạo file `0001_demo_data.sql` với:

- 1 `CAREGIVER` bổ sung bên cạnh tài khoản `ADMIN` hiện có
- 2 `devices` → 2 `cameras` (`cam_living_room`, `cam_kitchen`)
- 3 `zones`: 1 `RESTRICTED` (bếp), 1 `REST_AREA` (sofa), 1 `NORMAL`
- 5 `known_faces` — **cần AI service sinh embedding thật**, nên làm sau khi US-10 xong
- 20 `events` đủ các loại và trạng thái, kèm `event_media` trỏ tới ảnh mẫu

Acceptance criteria đầy đủ ở US-07 trong
[Roadmap_Backlog_UserStory_FR_CameraAI.md](../../docs/Roadmap_Backlog_UserStory_FR_CameraAI.md).

## Lưu ý

- Mật khẩu trong seed là **mật khẩu dev**. Không bao giờ dùng ở môi trường thật.
- Script `seed.mjs` từ chối chạy khi `NODE_ENV=production`.
