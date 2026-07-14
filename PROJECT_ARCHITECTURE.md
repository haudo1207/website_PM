# 📋 Task Compliance Portal — Kiến trúc dự án

> **Version:** 5.0.0 · **Team:** SecurityZone · **Stack:** FastAPI + Next.js + PostgreSQL + AI

---

## 1. Tổng quan

Hệ thống **Task Compliance Portal** quản lý và theo dõi tiến độ dự án, tính toán chỉ số hiệu suất KPI của thành viên, đồng thời hỗ trợ đồng bộ, tóm tắt biên bản các cuộc họp (Zoom & Google Meet) bằng AI.

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Frontend    │────▶│  Backend API │────▶│  AI API      │
│  (Next.js)   │◀────│  (FastAPI)   │◀────│  (Shopaikey) │
│  Port 3000   │     │  Port 8000   │     └──────────────┘
└─────────────┘     │              │
                    │   ┌──────┐   │     ┌──────────────┐
                    └───│  DB  │───│────▶│  AssemblyAI  │
                        └──────┘   │     │  (Speech-To) │
                                   │     └──────────────┘
                                   │     ┌──────────────┐
                                   │────▶│  Google APIs │
                                   │     │  (Calendar/  │
                                   │     │   Drive Doc) │
                                   │     └──────────────┘
                                   │     ┌──────────────┐
                                   │────▶│  Zoom APIs   │
                                   │     │  (S2S OAuth) │
                                   │     └──────────────┘
```

---

## 2. Cấu trúc thư mục

```
website_PM/
├── .env                          # Biến môi trường (DB, AI keys, Zoom, Google credentials)
├── .env.example                  # Mẫu cấu hình môi trường
├── docker-compose.yml            # Orchestration 3 services (Frontend, Backend, Postgres)
├── init-db.sql                   # File dữ liệu khởi tạo database PostgreSQL
├── Skill_Master_From_Sheet.xlsx  # Dữ liệu kỹ năng mẫu để tự động seed
│
├── secrets/
│   └── google-service-account.json # Service Account Google API (đọc/ghi Google Sheets)
│
├── backend/                      # ===== BACKEND (FastAPI - Python) =====
│   ├── Dockerfile
│   ├── requirements.txt          # Dependencies Python
│   ├── create_admin.py           # Script thủ công tạo/cập nhật admin (optional)
│   ├── init_settings.py          # Script thủ công reset cấu hình (optional)
│   │
│   └── app/
│       ├── __init__.py
│       ├── main.py               # FastAPI entry point, auto-seeding DB mặc định
│       ├── config.py             # Cấu hình Pydantic Settings (đọc .env)
│       ├── database.py           # SQLAlchemy engine & session maker (PostgreSQL)
│       │
│       ├── models/               # ORM Models (SQLAlchemy)
│       │   ├── user.py           # Bảng users (Tài khoản truy cập hệ thống)
│       │   ├── member.py         # Bảng members (Thành viên công ty/dự án) + member_skills
│       │   ├── project.py        # Bảng projects, platforms, project_links, project_members
│       │   ├── phase.py          # Bảng phases (Giai đoạn của dự án)
│       │   ├── task_group.py     # Bảng task_groups (Nhóm công việc cấp I, II, III...)
│       │   ├── task.py           # Bảng tasks_v2 (Công việc chi tiết, tính toán KPI)
│       │   ├── skill_master.py   # Bảng categories, groups, skills (Quản lý kỹ năng)
│       │   ├── system_category.py # Bảng positions, departments, teams, priorities, statuses, customers
│       │   ├── performance_setting.py # Bảng performance_settings (Cấu hình KPI thưởng/phạt)
│       │   ├── meeting.py        # Bảng meetings, meeting_members (Biên bản họp)
│       │   └── setting.py        # Bảng settings (column_config, policy, ai_config) + audit_logs
│       │
│       ├── routers/              # API Endpoints (FastAPI Routers)
│       │   ├── auth.py           # POST /api/auth/login
│       │   ├── users.py          # CRUD /api/users
│       │   ├── projects.py       # CRUD /api/projects, members, phases, chat-groups
│       │   ├── task_groups.py    # CRUD /api/phases/.../task-groups + /task-groups/.../tasks
│       │   ├── settings_router.py # CRUD /api/settings/... (cột, policy, AI)
│       │   ├── skills.py         # CRUD /api/skills/... (danh mục kỹ năng)
│       │   ├── system_categories.py # CRUD /api/system-categories/... (danh mục hệ thống)
│       │   ├── members.py        # CRUD /api/members (thông tin thành viên)
│       │   ├── meetings.py       # CRUD /api/meetings + sync Zoom/Google Meet
│       │   └── performance_settings.py # CRUD /api/performance-settings
│       │
│       ├── services/
│       │   └── meeting_sync.py   # Zoom S2S, Google Calendar/Drive, AssemblyAI, AI Summary
│       │
│       └── utils/
│           ├── auth.py           # JWT token, bcrypt password, middleware
│           └── kpi_engine.py     # Công thức & quy trình tính toán KPI cho Task/TaskGroup
│
└── frontend/                     # ===== FRONTEND (Next.js - TypeScript) =====
    ├── Dockerfile
    ├── package.json              # Dependencies (next, react, axios, tailwindcss)
    ├── tailwind.config.js        # Cấu hình TailwindCSS
    ├── tsconfig.json             # TypeScript config
    │
    └── src/
        ├── lib/
        │   ├── api.ts            # Axios instance + tất cả API functions gọi backend
        │   └── auth.ts           # Token helpers (localStorage)
        │
        ├── components/
        │   ├── Navbar.tsx        # Sidebar navigation điều hướng chính
        │   ├── KPIsView.tsx      # Quản lý cấu hình thưởng/phạt KPI
        │   ├── MembersView.tsx   # Quản lý danh sách thành viên công ty
        │   ├── SystemCategoriesView.tsx # Quản lý danh mục Position, Team, Customer...
        │   └── meetings/         # Modal tạo/xem/tóm tắt cuộc họp
        │
        └── app/
            ├── layout.tsx        # Root layout
            ├── page.tsx          # Trang chủ (tự động chuyển hướng)
            ├── globals.css       # CSS toàn cục
            ├── login/            # Trang đăng nhập
            ├── dashboard/        # Bảng điều khiển chính
            ├── project/          # Danh sách dự án
            │   ├── page.tsx      # Giao diện Project List
            │   └── detail/       # Chi tiết dự án (Giao diện Spreadsheet 4 cấp)
            │       └── page.tsx  # Spreadsheet tương tác, cập nhật trực tiếp
            ├── projects/new/     # Tạo dự án mới
            └── settings/         # Cài đặt hệ thống (Quản lý User, Kỹ năng, KPI, Danh mục)
```

---

## 3. Backend — Chi tiết từng thành phần

### 3.1 `main.py` — Khởi tạo và Tự động Seed Database
Khi backend khởi chạy, hàm `init_db_defaults()` được kích hoạt để tự động điền (seed) các dữ liệu mặc định nếu cơ sở dữ liệu trống:
1. **Settings**: Tạo sẵn cấu hình cột mặc định (`column_config`), quy tắc Policy kiểm tra cứng (`policy`), và cấu hình AI (`ai_config` dùng model mặc định `gpt-4o-mini`).
2. **Admin**: Tạo tài khoản admin mặc định: `admin@company.com` / mật khẩu `admin123`.
3. **Kỹ năng (Skills)**: Tự động phân tích file Excel `Skill_Master_From_Sheet.xlsx` (nếu có) để tạo cấu trúc 3 cấp Category → Group → Skill.
4. **Danh mục hệ thống**: Điền sẵn dữ liệu mặc định cho Position, Department, Team, TaskPriority, TaskStatus, Customer.
5. **Nền tảng (Platforms)**: Tạo các nền tảng chat mặc định như Telegram, Zalo, Slack, MS Teams, Discord, WhatsApp.
6. **Thành viên (Members)**: Seed danh sách thành viên ban đầu với thông tin Telegram và nhóm làm việc.
7. **KPI Thưởng/Phạt (Performance Settings)**: Seed các quy tắc tính điểm KPI thưởng phạt (ví dụ: hoàn thành sớm, trễ hạn, làm việc ngoài giờ OT, lỗi nội bộ...).

### 3.2 Cấu hình môi trường (`config.py` & `.env`)
| Biến môi trường | Mô tả |
|-----------------|-------|
| `DATABASE_URL`  | Địa chỉ kết nối PostgreSQL chính (Ví dụ: `postgresql://task_user:MyPass2026@postgres:5432/task_portal`) |
| `SECRET_KEY`    | Khóa bí mật dùng để ký và xác thực JWT token |
| `AI_BASE_URL`   | API endpoint của AI (tương thích OpenAI, ví dụ: Shopaikey API) |
| `AI_API_KEY`    | API key dùng để gọi AI |
| `AI_MODEL`      | Tên model AI sử dụng (mặc định: `gpt-4o-mini`) |
| `ASSEMBLYAI_API_KEY` | API key của AssemblyAI dùng cho chức năng speech-to-text cuộc họp Zoom |
| `GOOGLE_CLIENT_ID` / `SECRET` | Google OAuth credentials dùng để kết nối Google Calendar & Drive |
| `ZOOM_ACCOUNT_ID` / `CLIENT_ID` / `SECRET` | Zoom S2S OAuth credentials để tự động tạo và đồng bộ cuộc họp Zoom |

### 3.3 Phân cấp dữ liệu 4 cấp (4-Level Hierarchy)
Dự án được thiết kế theo phân cấp nghiêm ngặt nhằm quản lý dự án công nghệ chi tiết:
1. **Project (`projects`)**: Quản lý cấp cao nhất của dự án (mã code, tên, năm, khách hàng, PM, Tech Leader, trạng thái).
2. **Phase (`phases`)**: Giai đoạn dự án (1. Tư vấn, 2. Báo giá, 3. Làm specs... trích xuất động từ cấu hình cột).
3. **TaskGroup (`task_groups`)**: Nhóm công việc trong một Phase, hiển thị dưới dạng tiêu đề la mã (I, II, III...). Chứa các thông tin ước lượng tổng quan (manday_est, start_date_est, progress).
4. **Task (`tasks_v2`)**: Công việc chi tiết nhất thuộc một TaskGroup. **Đây là thực thể duy nhất thực hiện tính toán KPI**.

### 3.4 Logic tính toán KPI (`kpi_engine.py`)
Mọi cập nhật thông tin trên một Task sẽ kích hoạt quy trình tính toán lại KPI tự động trên Server:
* **End Date EST (Ước tính ngày kết thúc)**: 
  $$\text{End Date EST} = \text{Start Date} + \lceil\text{Manday EST}\rceil - 1$$
* **Manday Actual (Thực tế hoàn thành)**: 
  $$\text{Nếu Status = Done: } \text{Manday Actual} = \text{End Date Actual} - \text{Start Date} + 1$$
* **Days Late (Số ngày trễ)**:
  - Nếu trạng thái là `Cancel`: $-1$ ngày.
  - Nếu trạng thái là `Done`: $\text{End Date Actual} - \text{End Date EST}$.
  - Nếu trạng thái chưa hoàn thành (`Waiting`, `Process`, `Rework`):
    * Nếu ngày hiện tại $\le$ `End Date EST`: $-1$ ngày (đúng tiến độ).
    * Nếu ngày hiện tại $>$ `End Date EST`: $\text{Ngày hiện tại} - \text{End Date EST}$ (trễ hạn).
* **KPI Base (KPI cơ sở)**:
  $$\text{KPI Base} = \text{TaskPriority.kpi_base} \times \text{Manday EST}$$
  *(Trong đó KPI Base mặc định theo mức độ ưu tiên: Normal: 6, High: 12, Critical: 20, Interrupt: 6).*
* **KPI Perform & KPI OT (Hiệu suất & Làm ngoài giờ)**:
  - Tự động cộng thưởng điểm hoàn thành sớm (nếu `Days Late < 0`, thưởng tối đa bằng KPI Base).
  - Tự động trừ phạt điểm trễ hạn (nếu `Days Late > 0`, phạt $-1$ điểm/ngày trễ).
  - Duyệt qua cột `Remark` của Task để so khớp các từ khóa thưởng/phạt động trong bảng `performance_settings` (Ví dụ: ghi nhận lỗi nội bộ để trừ điểm, ghi nhận OT ngoài giờ để cộng điểm thưởng).
* **KPI Final (KPI tổng kết cuối cùng)**:
  $$\text{KPI Final} = (\text{KPI Base} + \text{KPI Perform} + \text{KPI OT}) \times \text{Multiplier}$$
  *(Trong đó Multiplier là hệ số nhân nếu remark khớp với quy tắc phạt hệ số như FAIL 1 (0.7), FAIL 2 (0.5), FAIL 3 (0.0). Nếu trạng thái Task là `Cancel`, toàn bộ KPI = 0).*
* **KPI Split (Chia tách KPI)**:
  - Tách KPI Final thành `KPI Assigned` (Người thực hiện chính) và `KPI Support` (Người hỗ trợ) dựa vào tỷ lệ phân chia `kpi_ratio_assign` và `kpi_ratio_support`. Mặc định tỷ lệ là 100% / 0% nếu không có người hỗ trợ.

---

## 4. Frontend — Chi tiết từng thành phần

### 4.1 Tech Stack Frontend
- **Next.js 14** (sử dụng cơ chế App Router hiện đại).
- **React 18** + **TypeScript 5**.
- **TailwindCSS 3** (Giao diện Dark Theme cao cấp).
- **Axios** (Thư viện gọi HTTP API).

### 4.2 Giao diện Detail Project Spreadsheet (`frontend/src/app/project/detail/page.tsx`)
Đây là trung tâm tương tác chính của người dùng, tái hiện một bảng tính Excel/Google Sheet chuyên nghiệp với đầy đủ tính năng:
- **Tương tác trực tiếp**: Thêm, sửa, xóa, nhân bản (duplicate) Task/TaskGroup ngay trên giao diện bảng.
- **Kéo thả sắp xếp**: Hỗ trợ thay đổi thứ tự (reorder) các TaskGroup trong Phase và các Task trong TaskGroup.
- **Di chuyển vị trí**: Hỗ trợ chuyển Task sang TaskGroup khác hoặc chuyển TaskGroup sang Phase khác.
- **Tính toán thời gian thực**: Khi chỉnh sửa thông tin (Manday EST, Ngày bắt đầu, Trạng thái...), kết quả KPI và ngày ước tính lập tức cập nhật lại trên bảng.

---

## 5. Docker Compose Stack

Hệ thống rút gọn còn 3 dịch vụ tối giản, tin cậy, không cần message broker phức tạp:

| Tên Service | Docker Image | Cổng Port | Vai trò |
|-------------|--------------|-----------|---------|
| `postgres`  | `postgres:16` | `5432` | Cơ sở dữ liệu lưu trữ quan hệ chính |
| `backend`   | `task-portal-backend` | `8000` | FastAPI Server chạy RESTful APIs |
| `frontend`  | `task-portal-frontend`| `3000` | Next.js Server phục vụ giao diện Web |

---

## 6. Luồng Tóm tắt Cuộc họp bằng AI (Meeting Sync Pipeline)

Hệ thống tích hợp quy trình đồng bộ và tóm tắt biên bản cuộc họp thông minh:

```
[Người dùng] ──▶ Tạo cuộc họp (Zoom/Google Meet) ──▶ Kết thúc cuộc họp
                                                        │
                                                        ▼
[Người dùng] ────────────────────────────────▶ Bấm nút "Sync Meeting"
                                                        │
                                                        ▼
[Backend] ───────────────────▶ Gọi API Zoom S2S OAuth hoặc Google Drive API
                                                        │
         ┌──────────────────────────────────────────────┴──────────────────────────────────────────────┐
         ▼ (Zoom)                                                                                      ▼ (Google Meet)
Tải phụ đề ghi âm (VTT) hoặc Summary.                                                          Tìm file tài liệu transcript Doc
Nếu chỉ có Audio/Video -> Gửi AssemblyAI dịch giọng nói sang văn bản (vi).                        trên Google Drive bằng mã code.
         │                                                                                             │
         └──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                                        ▼
                                       [Gọi Shopaikey AI API]
                                     Tóm tắt theo prompt mẫu:
                                      - TỔNG QUAN cuộc họp
                                      - TASK CHA ĐÃ CHỐT (Project, deadline, Owner, KPI...)
                                      - VẤN ĐỀ & RỦI RO
                                      - BƯỚC TIẾP THEO
                                                        │
                                                        ▼
[Frontend] ◀───────────────────────── Lưu kết quả vào DB & Hiển thị ◀──────────────────────────────────┘
```

---

## 7. Phân quyền người dùng (RBAC)

Hệ thống phân chia quyền hạn chặt chẽ dựa trên 3 vai trò (`role`):

| Role (Vai trò) | Xem dự án & KPI | Thêm/sửa dự án (Tasks, Phase...) | Cài đặt hệ thống (Settings) | Quản lý Users/Kỹ năng |
|----------------|-----------------|----------------------------------|-----------------------------|-----------------------|
| `admin`        | ✅ Tất cả | ✅ Tất cả | ✅ Có quyền | ✅ Có quyền |
| `group_b`      | ✅ Tất cả | ❌ Không có quyền | ❌ Không có quyền | ❌ Không có quyền |
| `group_a`      | 🔍 Chỉ xem dự án mình tham gia | ❌ Không có quyền | ❌ Không có quyền | ❌ Không có quyền |

---

## 8. Quy trình Phát triển và Đồng bộ

### 8.1 Chạy dưới Local (Development Mode)
```bash
# 1. Khởi chạy Database PostgreSQL dưới local máy tính
docker-compose up -d postgres

# 2. Khởi chạy FastAPI Backend (Dev mode auto-reload)
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 3. Khởi chạy Frontend Next.js (Dev mode)
cd frontend
npm install
npm run dev
```

### 8.2 Triển khai Production bằng Docker Compose
Để triển khai nhanh toàn bộ hệ thống lên môi trường staging hoặc production:
```bash
# Xây dựng và chạy nền tảng ở chế độ background
docker-compose up -d --build
```
Hệ thống sẽ tự động liên kết các container, khởi tạo cấu trúc PostgreSQL thông qua file `init-db.sql` hoặc cơ chế tự sinh bảng của SQLAlchemy ORM.
