# 📋 Task Compliance Portal — Kiến trúc dự án

> **Version:** 4.0.0 · **Team:** SecurityZone · **Stack:** FastAPI + Next.js + Celery + Google Sheets API + AI

---

## 1. Tổng quan

Hệ thống **Task Compliance Portal** tự động đọc dữ liệu công việc (tasks) từ Google Sheets, kiểm tra tuân thủ quy tắc (policy), gọi AI đánh giá chất lượng, và hiển thị kết quả trên giao diện web.

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Frontend    │────▶│  Backend API │────▶│  Google      │
│  (Next.js)   │◀────│  (FastAPI)   │◀────│  Sheets API  │
│  Port 3000   │     │  Port 8000   │     └──────────────┘
└─────────────┘     │              │
                    │   ┌────────┐ │     ┌──────────────┐
                    │   │Worker  │─│────▶│  AI API      │
                    │   │(Celery)│ │     │  (GPT-4o)    │
                    │   └────────┘ │     └──────────────┘
                    │              │
                    │  ┌─────┐ ┌──────┐
                    └──│ DB  │ │Redis │
                       └─────┘ └──────┘
```

---

## 2. Cấu trúc thư mục

```
Plane.so/
├── .env                          # Biến môi trường (DB, Redis, AI keys)
├── .env.example                  # Mẫu cấu hình môi trường
├── docker-compose.yml            # Orchestration 6 services
├── vercel.json                   # Deploy frontend lên Vercel
├── init-db.sql                   # File dữ liệu khởi tạo database (auto-seeded)
│
├── secrets/
│   └── google-service-account.json   # Service Account Google API
│
├── backend/                      # ===== BACKEND (Python) =====
│   ├── Dockerfile
│   ├── requirements.txt          # Dependencies Python
│   ├── create_admin.py           # Script tiện ích tạo/cập nhật admin (optional)
│   ├── init_settings.py          # Script tiện ích reset cấu hình (optional)
│   │
│   └── app/
│       ├── __init__.py
│       ├── main.py               # FastAPI entry point, đăng ký routers
│       ├── config.py             # Pydantic Settings (đọc .env)
│       ├── database.py           # SQLAlchemy engine (PostgreSQL/SQLite)
│       │
│       ├── models/               # ORM Models (SQLAlchemy)
│       │   ├── user.py           # Bảng users
│       │   ├── sheet.py          # Bảng sheets (dự án)
│       │   ├── violation.py      # Bảng violations (kết quả check)
│       │   └── setting.py        # Bảng settings + audit_logs
│       │
│       ├── routers/              # API Endpoints (FastAPI Router)
│       │   ├── auth.py           # POST /api/auth/login
│       │   ├── users.py          # CRUD /api/users
│       │   ├── sheets.py         # CRUD /api/sheets + check + logs
│       │   ├── violations.py     # GET /api/violations (lọc, phân trang)
│       │   └── settings_router.py # Cấu hình cột, policy, AI
│       │
│       ├── utils/
│       │   ├── auth.py           # JWT token, bcrypt password, middleware
│       │   └── redis_fallback.py # Redis wrapper (fallback sang dict)
│       │
│       └── worker/               # Background Jobs (Celery)
│           ├── celery_app.py     # Celery instance config
│           ├── google_sheet.py   # Đọc/tạo Google Sheets
│           ├── policy_engine.py  # Kiểm tra luật cứng
│           ├── ai_evaluator.py   # Gọi AI API đánh giá task
│           └── tasks.py          # Celery tasks: check_sheet, periodic
│
└── frontend/                     # ===== FRONTEND (Next.js) =====
    ├── Dockerfile
    ├── package.json              # Dependencies: next, react, axios
    ├── tailwind.config.js        # TailwindCSS config
    ├── tsconfig.json             # TypeScript config
    │
    └── src/
        ├── lib/
        │   ├── api.ts            # Axios instance + tất cả API functions
        │   └── auth.ts           # Token helpers (localStorage)
        │
        ├── components/
        │   └── Navbar.tsx        # Sidebar navigation
        │
        └── app/
            ├── layout.tsx        # Root layout
            ├── page.tsx          # Trang chủ (redirect)
            ├── globals.css       # Global styles
            ├── login/            # Trang đăng nhập
            ├── dashboard/        # Bảng điều khiển chính
            ├── project/          # Quản lý dự án
            ├── projects/new/     # Tạo dự án mới
            └── settings/         # Cài đặt hệ thống (admin)
```

---

## 3. Backend — Chi tiết từng thành phần

### 3.1 `main.py` — Entry Point

- Tự động chạy Database Seeding (Khởi tạo mặc định cấu hình cột, policy, AI prompt và tạo tài khoản `admin@company.com` / `admin123` nếu database rỗng)
- Tạo bảng DB tự động (`Base.metadata.create_all`)
- Thêm cột mới vào bảng `sheets` nếu chưa có (migration đơn giản)
- Đăng ký 5 router: `auth`, `users`, `sheets`, `violations`, `settings`
- CORS cho phép tất cả origins (dev mode)
- Health check endpoint: `GET /health`

### 3.2 `config.py` — Cấu hình

| Biến | Mô tả |
|------|-------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `SECRET_KEY` | JWT signing key |
| `GOOGLE_APPLICATION_CREDENTIALS` | Đường dẫn file service account |
| `AI_BASE_URL` | API endpoint của AI (OpenAI-compatible) |
| `AI_API_KEY` | API key cho AI |
| `AI_MODEL` | Model AI sử dụng (mặc định: gpt-4o-mini) |
| `CHECK_INTERVAL_SECONDS` | Chu kỳ check tự động (mặc định: 3600s) |

### 3.3 `database.py` — Kết nối Database

- **Chỉ sử dụng PostgreSQL** — Kết nối trực tiếp đến PostgreSQL qua `DATABASE_URL` (không còn cơ chế fallback sang SQLite để đảm bảo tính nhất quán dữ liệu).
- **Auto-seeded Database** — Khi khởi tạo container database PostgreSQL trống, hệ thống tự động chạy file `init-db.sql` nếu được mount, hoặc backend sẽ tự sinh các dữ liệu cài đặt mặc định trên PostgreSQL.
- Cung cấp `get_db()` dependency cho FastAPI

### 3.4 Models (ORM)

#### `User` — Người dùng
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `id` | Integer PK | ID tự tăng |
| `email` | String unique | Email đăng nhập |
| `full_name` | String | Tên hiển thị |
| `hashed_pw` | String | Mật khẩu đã hash (bcrypt) |
| `role` | String | `admin`, `group_a`, `group_b` |
| `is_active` | Boolean | Trạng thái tài khoản |

#### `Sheet` — Dự án / Google Sheet
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `spreadsheet_id` | String | Google Sheet ID |
| `name` | String | Tên dự án |
| `owner_id` | FK → users | Người tạo |
| `leader_email` | String | Email Leader |
| `pm_email` | String | Email PM |
| `member_emails` | String | Danh sách email members (phân cách bởi dấu phẩy) |
| `project_code` | String | Mã dự án |
| `customer_name` | String | Tên khách hàng |
| `current_phase` | String | Giai đoạn hiện tại |
| `spreadsheet_url` | String | URL Google Sheet |

#### `Violation` — Kết quả đánh giá từng dòng
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `sheet_id` | FK → sheets | Sheet liên quan |
| `tab_name` | String | Tên tab (1.Sale/Admin, 2.Init, ...) |
| `row_number` | Integer | Số dòng trong sheet |
| `row_data` | Text (JSON) | Dữ liệu toàn bộ dòng |
| `violation_code` | String | `PASS`, `AI_EVAL`, `SECTION`, `MANDAY_TOO_HIGH`, ... |
| `ai_verdict` | String | `PASS`, `FAIL`, `REVIEW`, `SECTION` |
| `ai_reason` | Text | Lý do AI đánh giá |
| `ai_suggestion` | Text | Gợi ý cải thiện từ AI |

#### `Setting` + `AuditLog` — Cấu hình hệ thống
- **Setting**: key-value store (`column_config`, `policy`, `ai_config`)
- **AuditLog**: ghi lại mọi thay đổi cấu hình

### 3.5 Routers (API Endpoints)

#### `auth.py` — Xác thực
| Method | Path | Mô tả |
|--------|------|-------|
| POST | `/api/auth/login` | Đăng nhập, trả JWT token |

#### `users.py` — Quản lý user (Admin only)
| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/users` | Danh sách users |
| GET | `/api/users/me` | Thông tin user hiện tại |
| POST | `/api/users` | Tạo user mới |
| PUT | `/api/users/{id}` | Cập nhật user |
| DELETE | `/api/users/{id}` | Xóa user |

#### `sheets.py` — Quản lý dự án
| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/sheets` | Danh sách sheets (lọc theo quyền) |
| POST | `/api/sheets` | Thêm sheet (nhập URL hoặc tự tạo mới) |
| DELETE | `/api/sheets/{id}` | Xóa sheet |
| POST | `/api/sheets/{id}/check` | Trigger scan ngay |
| GET | `/api/sheets/{id}/status` | Trạng thái + số violation |
| GET | `/api/sheets/{id}/logs` | Realtime logs từ Redis |

#### `violations.py` — Kết quả đánh giá
| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/violations` | Lọc theo sheet, verdict, search, leader, PM, phân trang |

#### `settings_router.py` — Cấu hình (Admin only)
| Method | Path | Mô tả |
|--------|------|-------|
| GET/PUT | `/api/settings/column-config` | Cấu hình cột + tab names |
| GET/PUT | `/api/settings/policy` | Quy tắc kiểm tra (luật cứng) |
| GET/PUT | `/api/settings/ai-config` | Cấu hình AI (URL, key, model, prompt) |
| GET | `/api/settings/ai-models` | Liệt kê models từ AI API |
| GET | `/api/settings/audit-log` | Lịch sử thay đổi cấu hình |

### 3.6 Worker (Celery Background Jobs)

#### `celery_app.py`
- Celery instance sử dụng Redis làm broker + backend
- Timezone: `Asia/Ho_Chi_Minh`

#### `google_sheet.py` — Đọc/Tạo Google Sheets
- **`get_credentials()`**: Load Service Account từ JSON file
- **`read_tabs()`**: Đọc tất cả tabs, lọc theo `tab_names`, parse headers, trả về danh sách rows
- **`create_new_sheet()`**: Tạo Google Sheet mới với 6 tabs (master + 5 phases), ghi headers, công thức consolidation, share quyền

#### `policy_engine.py` — Kiểm tra luật cứng
- Kiểm tra `manday_max`, `manday_min` (Manday vượt ngưỡng)
- Kiểm tra `min_words` (Mô tả quá ngắn)
- Kiểm tra `required_fields` (Thiếu trường bắt buộc)

#### `ai_evaluator.py` — Gọi AI đánh giá
- Gửi dữ liệu task đến OpenAI-compatible API
- System prompt bằng tiếng Việt
- Trả về JSON: `{verdict, reason, suggestion}`
- Fallback `REVIEW` nếu API lỗi

#### `tasks.py` — Celery Tasks chính
- **`check_sheet()`**: Quy trình scan 1 sheet:
  1. Đọc cấu hình (cột, policy, AI) từ DB
  2. Gọi `read_tabs()` đọc Google Sheet
  3. Xóa violations cũ
  4. Với mỗi row: phân loại SECTION / kiểm tra policy / gọi AI
  5. Lưu kết quả vào bảng `violations`
  6. Ghi log realtime vào Redis
- **`check_all_sheets()`**: Periodic task scan tất cả sheets active
- **`setup_periodic_tasks()`**: Đăng ký task định kỳ (mặc định 1h)

### 3.7 Utils

#### `auth.py` — JWT + Password
- Hash/verify password bằng `bcrypt`
- Tạo/decode JWT token bằng `python-jose`
- Middleware `get_current_user` và `require_admin`

#### `redis_fallback.py` — Redis Wrapper
- Thử kết nối Redis thật
- Nếu thất bại → dùng Python dict trong memory
- Hỗ trợ: `set`, `get`, `delete`, `rpush`, `lrange`, `ltrim`

---

## 4. Frontend — Chi tiết từng thành phần

### 4.1 Tech Stack
- **Next.js 14** (App Router)
- **React 18** + **TypeScript**
- **TailwindCSS 3** (dark theme)
- **Axios** (HTTP client)

### 4.2 `src/lib/api.ts` — API Client
- Axios instance với base URL từ env
- Interceptor tự gắn JWT token vào header
- Interceptor tự logout nếu nhận 401
- Export tất cả API functions (login, getSheets, getViolations, ...)

### 4.3 `src/lib/auth.ts` — Auth Helpers
- Lưu/đọc `token`, `role`, `name` từ `localStorage`
- Helpers: `isAdmin()`, `isGroupA()`, `logout()`

### 4.4 `src/components/Navbar.tsx` — Sidebar
- Logo "Task Compliance · SecurityZone"
- Navigation: Dashboard, Dự án, Settings (admin only)
- Danh sách dự án động (load từ API)
- User info + role badge + Sign out

### 4.5 Pages

| Page | Đường dẫn | Chức năng |
|------|-----------|-----------|
| Login | `/login` | Form đăng nhập email/password |
| Dashboard | `/dashboard` | Bảng kết quả đánh giá, 2 chế độ xem (List / Phase) |
| Project | `/project` | Danh sách dự án, thông tin chi tiết, trigger scan |
| New Project | `/projects/new` | Form tạo dự án mới (nhập URL hoặc tự tạo Sheet) |
| Settings | `/settings` | Cấu hình cột, policy, AI, quản lý users (admin) |

### 4.6 Dashboard — 2 chế độ xem

**List View (mặc định):**
- Hiển thị violations theo thứ tự thời gian
- Lọc theo sheet, verdict, search
- Phân trang 25 items/page

**Phase View:**
- 5 tabs: 1.Sale/Admin, 2.Init, 2.1.Lab/PoC, 3.Implement, 4.MA
- Hiển thị đúng thứ tự row number trong Google Sheet
- Section dividers (dòng phân đoạn) hiển thị riêng biệt
- Cột: TASK ID | DETAIL TASK | PRIORITY | MANDAY EST | STATUS | START DATE | ASSIGNED | SUPP

---

## 5. Docker Compose — 6 Services

| Service | Image | Port | Vai trò |
|---------|-------|------|---------|
| `postgres` | postgres:16 | 5432 | Database chính |
| `redis` | redis:7 | 6379 | Message broker + cache |
| `backend` | task-portal-backend | 8000 | FastAPI server |
| `worker` | task-portal-backend | — | Celery worker (2 concurrency) |
| `scheduler` | task-portal-backend | — | Celery beat (periodic tasks) |
| `frontend` | task-portal-frontend | 3000 | Next.js web app |

---

## 6. Luồng xử lý chính

```
[User] ──▶ Tạo dự án (nhập Sheet URL hoặc tự tạo)
           │
           ▼
[Backend] ──▶ Lưu vào DB ──▶ Trigger check_sheet task
                              │
                              ▼
[Worker]  ──▶ Đọc Google Sheet (read_tabs)
           │
           ├── Phân loại SECTION (dòng phân đoạn) ──▶ Lưu DB
           │
           ├── Kiểm tra Policy Engine (luật cứng)
           │   └── Vi phạm? ──▶ Lưu FAIL vào DB
           │
           └── Gọi AI Evaluator
               └── Trả về PASS/FAIL/REVIEW ──▶ Lưu DB
                                               │
                                               ▼
[Frontend] ◀── GET /api/violations ◀── Hiển thị kết quả
```

---

## 7. Phân quyền (RBAC)

| Role | Xem violations | Quản lý sheets | Settings | Quản lý users |
|------|---------------|----------------|----------|---------------|
| `admin` | Tất cả | Tất cả | ✅ | ✅ |
| `group_b` | Tất cả | Theo quyền | ❌ | ❌ |
| `group_a` | Theo quyền | Theo quyền | ❌ | ❌ |

**Quyền truy cập sheet:** Owner, Leader, PM → write. Members → read only.

---

## 8. Scripts tiện ích

*Lưu ý: Kể từ phiên bản 4.0.0, backend đã tích hợp sẵn cơ chế tự động seed database khi khởi chạy, do đó bạn không cần chạy thủ công các lệnh dưới đây nữa trừ khi muốn reset lại hệ thống.*

```bash
# Tạo/reset admin bằng lệnh thủ công
python create_admin.py admin@company.com "Admin" "password123"

# Reset cấu hình cài đặt về mặc định
python init_settings.py

# Chạy backend dev
uvicorn app.main:app --reload --port 8000

# Chạy frontend dev
npm run dev

# Docker full stack
docker-compose up -d --build
```

---

## 9. Dependencies

### Backend (Python 3.11)
| Package | Vai trò |
|---------|---------|
| fastapi | Web framework |
| uvicorn | ASGI server |
| sqlalchemy | ORM |
| psycopg2-binary | PostgreSQL driver |
| redis | Redis client |
| celery | Task queue |
| python-jose | JWT |
| passlib + bcrypt | Password hashing |
| google-api-python-client | Google Sheets/Drive API |
| google-auth | Google authentication |
| requests | HTTP client (gọi AI API) |
| pydantic-settings | Config management |

### Frontend (Node 20)
| Package | Vai trò |
|---------|---------|
| next 14 | React framework |
| react 18 | UI library |
| axios | HTTP client |
| tailwindcss 3 | CSS framework |
| typescript 5 | Type safety |

---

## 10. Đồng bộ Database & Quy trình Phát triển Nhóm

Để đảm bảo môi trường phát triển của nhiều lập trình viên (multi-developer) đồng bộ dữ liệu với nhau, dự án hỗ trợ 2 hướng tiếp cận chính:

### 10.1 Cách 1: Sử dụng Database chung trên VM (Khuyên dùng)
Kết nối trực tiếp mã nguồn chạy ở máy local tới một database PostgreSQL chung được cài trên VM:
1. **Trên VM:** Mở cổng `5432` trong file `docker-compose.yml` (đặt là `0.0.0.0:5432:5432`) và cấu hình Firewall/Security Group mở cổng `5432` (TCP).
2. **Tại máy Local:** Cập nhật biến `DATABASE_URL` trong file `.env` trỏ về địa chỉ IP của VM:
   ```env
   DATABASE_URL=postgresql://task_user:MyPass2026@<IP_VM>:5432/task_portal
   ```
3. **Kết quả:** Cả 2 lập trình viên cùng làm việc trên 1 cơ sở dữ liệu duy nhất, dữ liệu thêm/sửa/xóa sẽ được đồng bộ thời gian thực.

### 10.2 Cách 2: Sử dụng Database Offline riêng biệt (Auto-seeded)
Nếu muốn phát triển độc lập không phụ thuộc vào internet/VM:
1. Mỗi máy lập trình viên sẽ tự chạy database PostgreSQL riêng thông qua Docker Compose local.
2. File **`init-db.sql`** đặt ở thư mục gốc chứa bản sao lưu cấu trúc và dữ liệu mẫu.
3. Khi khởi chạy Docker Compose lần đầu (hoặc sau khi reset volume bằng `docker compose down -v`), database sẽ tự động nạp dữ liệu từ file `init-db.sql` này để tạo sẵn tài khoản `admin@company.com` và các dự án mẫu.
4. **Cách cập nhật file khởi tạo:** Chạy lệnh dump dữ liệu trên máy có database mới nhất để xuất đè lại file `init-db.sql` rồi commit lên Git:
   ```bash
   # Dump dữ liệu sạch từ container ra host máy tính
   docker exec task_postgres pg_dump -U task_user -d task_portal --clean --no-owner --no-privileges -f /tmp/init-db.sql
   docker cp task_postgres:/tmp/init-db.sql ./init-db.sql
   docker exec task_postgres rm /tmp/init-db.sql
   ```
