# KPI Portal - bàn giao môi trường phát triển

## Kiến trúc dữ liệu

- Development và tất cả máy local dùng chung project Supabase Cloud `kpi-dev`.
- Production tiếp tục dùng database self-hosted; không dùng connection string development.
- Development và production là hai database độc lập.
- Hai giao diện production (SecurityZone và Markee) dùng chung một backend và cùng database production; branding được chọn lúc build frontend.
- File `.env` thật và mật khẩu database không nằm trong Git.

## Chạy local bằng Docker với database development dùng chung

Tất cả developer và site development cùng dùng project Supabase Cloud. Compose chỉ
dựng frontend/backend, không dựng PostgreSQL local. Máy cá nhân không cần VPN,
Cloudflare WARP, tunnel hay thay đổi code. VPN/WARP đang bật cũng không ảnh hưởng vì
`DATABASE_URL` đi qua hostname public của Supabase Cloud.

```powershell
Copy-Item .env.example .env
# Nhận file .env development qua kênh bảo mật
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

Mở `http://localhost:3000` và chọn **Đăng nhập bằng Google**. Email phải được admin
cấp trước tại `/accounts`; hệ thống không còn nhận mật khẩu ứng dụng.

Dừng stack local (không xóa hay thay đổi database shared):

```powershell
docker compose down
```

Mọi thao tác tạo/sửa/xóa dữ liệu từ local sẽ tác động trực tiếp lên `kpi-dev` mà
toàn team đang dùng. Không chạy migration thủ công, script xóa dữ liệu hoặc test
destructive trên database này. Không copy `.env` production cho máy cá nhân và
không commit bất kỳ URL có mật khẩu nào.

## Biến môi trường bắt buộc

| Biến | Bắt buộc | Mục đích |
|---|---:|---|
| `DATABASE_URL` | Có | Supabase Cloud session-pooler port `5432`, password URL-encoded, `sslmode=require` |
| `DOCKER_NETWORK_MTU` | Không | Mặc định `1420`; không liên quan tới việc truy cập DB Cloud |
| `SECRET_KEY` | Có | Ký JWT; mỗi môi trường phải dùng secret riêng |
| `GOOGLE_LOGIN_ENABLED` | Có | Đặt `true` |
| `PASSWORD_LOGIN_ENABLED` | Có | Đặt `false` để bắt buộc Google |
| `AUTH_SUPERADMIN_EMAILS` | Có | Danh sách email bootstrap admin cao nhất, phân cách bằng dấu phẩy |
| `GOOGLE_CLIENT_ID` | Có | OAuth 2.0 Web Client ID, dùng xác minh Google ID token |
| `DEFAULT_ADMIN_PASSWORD` | Không | Để trống khi dùng Google-only |
| `FRONTEND_URL` | Có | URL callback về frontend |
| `PORTAL_BRAND` | Local/build | `markee` hoặc `securityzone` |
| `GOOGLE_*`, `ZOOM_*`, `AI_*`, `ASSEMBLYAI_API_KEY` | Tùy tính năng | Khóa cho các integration tương ứng |

## Phân quyền tài khoản

Hai thuộc tính hoạt động độc lập:

- `role=admin`: quản lý tài khoản, danh mục hệ thống và có quyền chỉnh sửa.
- `role=group_a`: được xem và chỉnh sửa dữ liệu dự án trong phạm vi được cấp.
- `role=group_b`: chỉ được xem dữ liệu dự án trong phạm vi được cấp.
- `data_scope=all`: xem toàn bộ dự án.
- `data_scope=infrastructure`: chỉ xem dự án có scope Infrastructure.

Admin thêm email và quản lý quyền tại `/accounts`; không cần đặt mật khẩu. Người dùng
sau đó đăng nhập đúng email Google đã được cấp. Các email trong
`AUTH_SUPERADMIN_EMAILS` luôn là `admin`, `data_scope=all`, active và không thể bị
đổi email, hạ quyền, khóa hoặc xóa qua giao diện/API.

## Luồng Git và CI/CD

1. Tạo feature branch từ `dev`, code và mở pull request vào `dev`.
2. Merge pull request vào `dev` sẽ tự chạy workflow **Deploy KPI dev** và cập nhật site development.
3. Kiểm thử trên development, sau đó mở pull request từ `dev` vào `main`.
4. Production không tự deploy khi merge. Vào **Actions → Deploy KPI production → Run workflow**, chọn branch `main`, nhập `DEPLOY` để triển khai đồng thời cả hai frontend production.

Không chạy workflow production từ branch khác `main`.
