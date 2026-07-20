# KPI Portal - bàn giao môi trường phát triển

## Kiến trúc dữ liệu

- Development dùng project Supabase/Supavisor `kpi-dev` trên host DB development.
- Production dùng project Supabase/Supavisor `kpi-prod` trên host DB production.
- Development và production là hai database độc lập.
- Hai giao diện production (SecurityZone và Markee) dùng chung một backend và cùng database production; branding được chọn lúc build frontend.
- File `.env` thật và mật khẩu database không nằm trong Git.

## Chạy local bằng Docker với database development dùng chung

Tất cả developer và site development cùng dùng project Supabase self-host `kpi-dev`.
Compose chỉ dựng frontend/backend, không dựng PostgreSQL local. Trước khi chạy,
developer kết nối **một trong hai** đường mạng tới DB private `10.30.195.67:5432`:

- VPN công ty; hoặc
- Cloudflare WARP đã đăng nhập đúng team và được cấp route tới DB development.

Không cần và không nên bật cả hai cùng lúc vì route VPN có thể xung đột. Dùng cách
nào thì ứng dụng và file `.env` vẫn giữ nguyên.

```powershell
Copy-Item .env.example .env
# Nhận file .env development qua kênh bảo mật
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

Mở `http://localhost:3000` và đăng nhập bằng tài khoản development đã được admin cấp.
Giữ `DEFAULT_ADMIN_PASSWORD` trống vì `kpi-dev` đã có dữ liệu và tài khoản.

Dừng stack local (không xóa hay thay đổi database shared):

```powershell
docker compose down
```

Compose dùng bridge MTU `1420` để container đi được qua Cloudflare WARP trên Linux;
giá trị này cũng dùng được với VPN công ty. Nếu host kết nối DB được nhưng container
không kết nối được, kiểm tra VPN/WARP đang Connected rồi chạy lại `docker compose down`
và `docker compose up -d --build` để Compose tạo lại network đúng MTU.

Mọi thao tác tạo/sửa/xóa dữ liệu từ local sẽ tác động trực tiếp lên `kpi-dev` mà
toàn team đang dùng. Không chạy migration thủ công, script xóa dữ liệu hoặc test
destructive trên database này. Không copy `.env` production cho máy cá nhân và
không commit bất kỳ URL có mật khẩu nào.

## Biến môi trường bắt buộc

| Biến | Bắt buộc | Mục đích |
|---|---:|---|
| `DATABASE_URL` | Có | Connection string trực tiếp tới DB development private qua VPN hoặc WARP |
| `DOCKER_NETWORK_MTU` | Không | Mặc định `1420`, hỗ trợ Docker qua WARP/VPN |
| `SECRET_KEY` | Có | Ký JWT; mỗi môi trường phải dùng secret riêng |
| `DEFAULT_ADMIN_PASSWORD` | Chỉ DB trống | Tạo admin đầu tiên, sau đó để trống |
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

Admin tạo và quản lý tài khoản tại `/accounts`. Hệ thống không cho admin tự khóa,
tự xóa, tự hạ quyền, hoặc làm mất admin hoạt động cuối cùng.

## Luồng Git và CI/CD

1. Tạo feature branch từ `dev`, code và mở pull request vào `dev`.
2. Merge pull request vào `dev` sẽ tự chạy workflow **Deploy KPI dev** và cập nhật site development.
3. Kiểm thử trên development, sau đó mở pull request từ `dev` vào `main`.
4. Production không tự deploy khi merge. Vào **Actions → Deploy KPI production → Run workflow**, chọn branch `main`, nhập `DEPLOY` để triển khai đồng thời cả hai frontend production.

Không chạy workflow production từ branch khác `main`.
