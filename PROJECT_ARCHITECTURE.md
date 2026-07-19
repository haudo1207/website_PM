# 📋 Task Compliance Portal — Kiến trúc dự án

> **Version:** 6.0.0 · **Team:** SecurityZone · **Stack:** FastAPI + Next.js + PostgreSQL + AI

---

## 1. Tổng quan

Hệ thống **Task Compliance Portal** (KPI Portal) quản lý và theo dõi tiến độ dự án theo cấu trúc 4 cấp (Project → Phase → TaskGroup → Task), tính toán chỉ số hiệu suất KPI, đánh giá sức khỏe dự án bằng AI, và hỗ trợ đồng bộ/tóm tắt biên bản họp (Zoom & Google Meet). Hệ thống hỗ trợ multi-brand deployment (Markee / SecurityZone).

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Frontend    │────▶│  Backend API │────▶│  AI API      │
│  (Next.js)  │◀────│  (FastAPI)   │◀────│  (OpenAI-    │
│  Port 3000  │     │  Port 8000   │     │   compatible)│
└─────────────┘     │              │     └──────────────┘
                    │              │
                    │   ┌──────┐   │     ┌──────────────┐
                    └───│  DB  │───┘     │  AssemblyAI  │
                        │(Supa)│         │  (Speech-To) │
                        └──────┘         └──────────────┘
                                   │     ┌──────────────┐
                                   │────▶│  Google APIs │
                                   │     │  (Calendar)  │
                                   │     └──────────────┘
                                   │     ┌──────────────┐
                                   └────▶│  Zoom APIs   │
                                         │  (S2S OAuth) │
                                         └──────────────┘
```

---

## 2. Cấu trúc thư mục

```
pm-new/
├── .env                          # Biến môi trường (DB, AI keys, Zoom, Google credentials)
├── .env.example                  # Mẫu cấu hình môi trường
├── docker-compose.yml            # Orchestration local dev (Frontend + Backend)
├── init-db.sql                   # File dữ liệu khởi tạo database PostgreSQL (~608KB)
├── Skill_Master_From_Sheet.xlsx  # Dữ liệu kỹ năng mẫu để import
├── deploy.sh                     # Script deploy thủ công
│
├── deploy/                       # ===== DEPLOYMENT =====
│   ├── security-dev.compose.yml  # Dev: single brand + nginx gateway (port 3100)
│   ├── security-prod.compose.yml # Prod: dual brand (Markee :3000, SecurityZone :3300)
│   └── dev-gateway.conf          # Nginx reverse proxy config
│
├── .github/workflows/            # ===== CI/CD =====
│   ├── deploy-dev.yml            # Auto deploy on push to dev branch
│   └── deploy-production.yml     # Manual deploy with confirmation
│
├── backend/                      # ===== BACKEND (FastAPI - Python) =====
│   ├── Dockerfile
│   ├── requirements.txt          # Dependencies Python
│   ├── create_admin.py           # Script thủ công tạo/cập nhật admin
│   ├── init_settings.py          # Script reset cấu hình
│   ├── migrate_db.py             # Script migration schema
│   ├── migrate_meetings_json.py  # Script migration meeting data
│   ├── sync_members.py           # Script đồng bộ thành viên
│   ├── parse_xlsx_to_db.py       # Import skill data từ Excel
│   │
│   └── app/
│       ├── __init__.py
│       ├── main.py               # FastAPI entry point, auto create_all + apply_schema_updates
│       ├── config.py             # Pydantic Settings (đọc .env)
│       ├── database.py           # SQLAlchemy engine & session maker (PostgreSQL)
│       │
│       ├── models/               # ORM Models (SQLAlchemy)
│       │   ├── user.py           # Bảng users (Tài khoản + role + data_scope)
│       │   ├── member.py         # Bảng members + member_skills (Thành viên công ty)
│       │   ├── project.py        # Bảng projects, platforms, project_links, project_members_v2
│       │   ├── phase.py          # Bảng phases (Giai đoạn của dự án)
│       │   ├── task_group.py     # Bảng task_groups (Nhóm công việc)
│       │   ├── task.py           # Bảng tasks (Công việc chi tiết)
│       │   ├── skill_master.py   # Bảng categories, groups, skills (Quản lý kỹ năng)
│       │   ├── system_category.py # Bảng positions, departments, teams, priorities, statuses, customers
│       │   ├── performance_setting.py # Bảng performance_settings (Cấu hình KPI)
│       │   ├── meeting.py        # Bảng meetings, meeting_members (Biên bản họp)
│       │   ├── ai_review.py      # Bảng ai_prompts, ai_review_logs (AI đánh giá dự án)
│       │   ├── google_token.py   # Bảng google_tokens (OAuth tokens)
│       │   └── setting.py        # Bảng settings + audit_logs
│       │
│       ├── routers/              # API Endpoints (FastAPI Routers)
│       │   ├── auth.py           # POST /api/auth/login (OAuth2 Password Bearer)
│       │   ├── users.py          # CRUD /api/users (profile)
│       │   ├── accounts.py       # CRUD /api/accounts (admin quản lý tài khoản)
│       │   ├── projects.py       # CRUD /api/projects + phases + members + links
│       │   ├── task_groups.py    # CRUD /api/task-groups + tasks
│       │   ├── settings_router.py # CRUD /api/settings (platforms, priorities, statuses)
│       │   ├── skills.py         # CRUD /api/skills (danh mục kỹ năng)
│       │   ├── system_categories.py # CRUD /api/system-categories
│       │   ├── members.py        # CRUD /api/members (thông tin thành viên)
│       │   ├── meetings.py       # CRUD /api/meetings + sync Zoom/Google
│       │   ├── performance_settings.py # CRUD /api/performance-settings
│       │   └── ai_review.py      # /api/ai-review (AI đánh giá dự án)
│       │
│       ├── services/
│       │   └── meeting_sync.py   # Zoom S2S, Google Calendar, AssemblyAI, AI Summary
│       │
│       └── utils/
│           ├── auth.py           # JWT token (HS256), bcrypt password, middleware
│           ├── access.py         # Data scope authorization (per-project access control)
│           └── kpi_engine.py     # Công thức & quy trình tính toán KPI
│
└── frontend/                     # ===== FRONTEND (Next.js 14 - TypeScript) =====
    ├── Dockerfile
    ├── package.json              # Dependencies (next, react, axios, tailwindcss)
    ├── next.config.js            # Next.js config
    ├── tailwind.config.js        # TailwindCSS config + custom theme
    ├── tailwind.theme.json       # Theme tokens (colors, fonts)
    ├── tsconfig.json             # TypeScript config
    │
    └── src/
        ├── lib/
        │   ├── api.ts            # Axios instance + tất cả API functions gọi backend
        │   ├── auth.ts           # Token helpers (localStorage)
        │   └── brand.ts          # Multi-brand config (Markee / SecurityZone)
        │
        ├── components/
        │   ├── Navbar.tsx        # Sidebar navigation
        │   ├── KPIsView.tsx      # Quản lý cấu hình KPI thưởng/phạt
        │   ├── MembersView.tsx   # Quản lý danh sách thành viên
        │   ├── SystemCategoriesView.tsx # Quản lý danh mục hệ thống
        │   ├── AIPromptsView.tsx # Cấu hình AI prompts
        │   ├── AIReviewDrawer.tsx # Panel hiển thị kết quả AI review
        │   └── meetings/         # Components cuộc họp (Create, Card, Summarize, PromptSettings)
        │
        └── app/
            ├── layout.tsx        # Root layout
            ├── page.tsx          # Trang chủ (redirect → login/dashboard)
            ├── globals.css       # CSS toàn cục (Work Sans font)
            ├── login/            # Trang đăng nhập
            ├── dashboard/        # Bảng điều khiển (thống kê dự án)
            ├── project/          # Danh sách dự án
            │   └── detail/       # Chi tiết dự án (phases, tasks, KPIs)
            ├── projects/new/     # Tạo dự án mới
            ├── meetings/         # Quản lý cuộc họp
            ├── settings/         # Cài đặt hệ thống (categories, skills, platforms, KPIs, AI)
            ├── accounts/         # Quản lý tài khoản (admin only)
            └── api/              # Next.js API Routes (proxy to backend)
                ├── ai/settings/  # AI configuration proxy
                ├── ai/summarize/ # AI summarization proxy
                └── meetings/[id]/ # Meeting detail proxy
```

---

## 3. Backend API

### 3.1 Framework & Dependencies

- **FastAPI** 0.111.0 + **Uvicorn** 0.29.0
- **SQLAlchemy** 2.0.30 + psycopg2-binary
- **python-jose** (JWT HS256) + **passlib** (bcrypt)
- **requests** (external API calls)

### 3.2 API Routes

| Prefix | Router | Mô tả |
|--------|--------|--------|
| `POST /api/auth/login` | auth.py | Đăng nhập (OAuth2 Password form) |
| `/api/users` | users.py | Profile người dùng hiện tại |
| `/api/accounts` | accounts.py | Admin CRUD tài khoản (create, lock, unlock, reset password, delete) |
| `/api/projects` | projects.py | CRUD dự án + phases + project members + links |
| `/api/task-groups` | task_groups.py | CRUD task groups + tasks |
| `/api/settings` | settings_router.py | Cấu hình platforms, priorities, statuses |
| `/api/skills` | skills.py | CRUD categories → groups → skills |
| `/api/system-categories` | system_categories.py | Positions, departments, teams, customers |
| `/api/members` | members.py | CRUD thành viên + skills assignment |
| `/api/meetings` | meetings.py | CRUD cuộc họp + sync Google/Zoom |
| `/api/performance-settings` | performance_settings.py | Cấu hình KPI thresholds |
| `/api/ai-review` | ai_review.py | AI đánh giá dự án + prompt management |
| `GET /health` | main.py | Health check |

### 3.3 Business Logic

- **KPI Engine** (`utils/kpi_engine.py`): Tính toán hiệu suất task/taskgroup dựa trên thời gian, deadline, trạng thái hoàn thành. Cấu hình thưởng/phạt từ `performance_settings`.
- **Access Control** (`utils/access.py`): Lọc dữ liệu theo `data_scope` của user. Scope `all` xem toàn bộ, scope khác chỉ xem projects có cùng `data_scope`.
- **Meeting Sync** (`services/meeting_sync.py`): Đồng bộ lịch họp từ Google Calendar + Zoom (S2S OAuth), transcription qua AssemblyAI, tóm tắt bằng AI.

---

## 4. Frontend

### 4.1 Framework & Dependencies

- **Next.js** 14.2.35 (App Router) + **React** 18 + **TypeScript**
- **Tailwind CSS** 3 + custom theme
- **Axios** cho HTTP requests
- Font: **Work Sans**

### 4.2 Pages

| Route | Mô tả |
|-------|--------|
| `/login` | Đăng nhập |
| `/dashboard` | Bảng thống kê dự án |
| `/project` | Danh sách dự án |
| `/project/detail?id=X` | Chi tiết dự án (4-level spreadsheet) |
| `/projects/new` | Tạo dự án mới |
| `/meetings` | Quản lý cuộc họp |
| `/settings` | Cài đặt (Categories, Skills, Platforms, KPIs, AI Prompts) |
| `/accounts` | Quản lý tài khoản (admin only) |

### 4.3 Multi-brand

Biến `NEXT_PUBLIC_PORTAL_BRAND` quyết định thương hiệu:

| Brand | Tên hiển thị | Port (prod) |
|-------|-------------|-------------|
| `markee` | Markee Work Portal | 3000 |
| `securityzone` | SecurityZone KPI Portal | 3300 |

Cấu hình brand (logo, tên, màu sắc) nằm trong `src/lib/brand.ts`.

---

## 5. Database

### 5.1 Engine

- **PostgreSQL** (Supabase self-hosted trên mạng nội bộ `10.30.195.67:6543`)
- Truy cập yêu cầu VPN công ty hoặc Cloudflare WARP

### 5.2 ORM & Migration

- SQLAlchemy 2.0 (declarative models)
- Không dùng Alembic — migration inline bằng `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` trong `apply_schema_updates()` tại startup
- Script `migrate_db.py` cho major schema changes

### 5.3 Bảng chính

| Model | Bảng | Mô tả |
|-------|------|--------|
| User | `users` | Tài khoản đăng nhập (role, data_scope, member_id) |
| Member | `members` | Thành viên công ty (tên, department, position, skills) |
| Project | `projects` | Dự án (tên, khách hàng, PM, status, data_scope) |
| Phase | `phases` | Giai đoạn dự án |
| TaskGroup | `task_groups` | Nhóm công việc (cấp I, II, III) |
| Task | `tasks` | Công việc chi tiết (assignee, deadline, status, KPI) |
| Meeting | `meetings` | Cuộc họp (transcript, project link) |
| Skill | `skills` | Kỹ năng (thuộc group → category) |
| Platform | `platforms` | Nền tảng giao tiếp (Zalo, Telegram, Slack...) |
| ProjectLink | `project_links` | Links liên kết dự án |
| SystemCategory | (nhiều bảng) | positions, departments, teams, priorities, statuses, customers |
| PerformanceSetting | `performance_settings` | Ngưỡng KPI thưởng/phạt |
| GoogleToken | `google_tokens` | OAuth tokens Google |
| AIPrompt | `ai_prompts` | Template prompt AI cho từng dự án |
| AIReviewLog | `ai_review_logs` | Log kết quả AI review (score, issues, suggestions) |

### 5.4 Junction Tables

| Bảng | Quan hệ |
|------|---------|
| `project_members_v2` | Project ↔ Member (role: PM/Leader/Member) |
| `member_skills` | Member ↔ Skill |
| `user_skills` | User ↔ Skill |

### 5.5 Hierarchy

```
Project → Phase → TaskGroup → Task (4 cấp)
```

---

## 6. Authentication & Authorization

### 6.1 Authentication

- JWT token (HS256) qua `python-jose`
- Password hash bằng bcrypt (`passlib`)
- OAuth2 Password Bearer flow (`/api/auth/login`)
- Token expiry: 480 phút (8 giờ)
- Frontend lưu token trong localStorage, gửi qua Bearer header

### 6.2 Authorization — Role-based

| Role | Quyền |
|------|--------|
| `admin` | Toàn quyền: quản lý accounts, members, settings, CRUD projects |
| `group_a` | Đọc + ghi dự án (không quản lý accounts/settings) |
| `group_b` | Chỉ đọc (read-only) |

### 6.3 Authorization — Data Scope

| Scope | Mô tả |
|-------|--------|
| `all` | Xem toàn bộ dự án |
| `infrastructure` (default) | Chỉ xem dự án có cùng `data_scope` |

### 6.4 Safeguards

- Không thể xóa/demote admin cuối cùng
- Admin không thể tự demote chính mình
- Write operations chỉ cho phép admin + group_a

---

## 7. Tính năng chính

### 7.1 Quản lý dự án (Project Management)

CRUD dự án với cấu trúc 4 cấp. Giao diện spreadsheet tương tác cho phép cập nhật trực tiếp. Hỗ trợ gán thành viên (PM/Leader/Member), liên kết platforms, theo dõi status.

### 7.2 KPI Engine

Tính toán hiệu suất dựa trên:
- Thời gian hoàn thành vs deadline
- Trạng thái task (hoàn thành, đang thực hiện, quá hạn)
- Ngưỡng thưởng/phạt cấu hình trong `performance_settings`

### 7.3 AI Project Review

- Gọi OpenAI-compatible API (cấu hình qua `AI_BASE_URL`, mặc định `https://api.shopaikey.com/v1`)
- Model: `gpt-4o-mini` (cấu hình qua `AI_MODEL`)
- 3 loại prompt: PROJECT, PHASE, TASK — tùy chỉnh cho từng dự án
- Prompt mặc định bằng tiếng Việt (phân tích rủi ro, tài nguyên, overdue)
- Kết quả: score + issues + suggestions (JSON)
- Status flow: `NOT_CHECKED` → `CHECKING` → `CHECKED` / `HAS_ISSUE` / `NEED_RECHECK`
- Audit trail: ai_review_logs lưu ai đánh giá, khi nào, prompt snapshot

### 7.4 Quản lý cuộc họp (Meeting Management)

- Tạo/chỉnh sửa cuộc họp, liên kết dự án
- Đồng bộ từ Google Calendar + Zoom (Server-to-Server OAuth)
- Transcription qua AssemblyAI
- Tóm tắt biên bản bằng AI

### 7.5 Quản lý thành viên (Members)

Danh bạ nhân sự: tên, bộ phận, vị trí, kinh nghiệm, kỹ năng. Gán kỹ năng từ Skill Master.

### 7.6 Skill Master

Import từ Excel (`Skill_Master_From_Sheet.xlsx`). Cấu trúc 3 cấp: Category → Group → Skill. Gán many-to-many cho members.

### 7.7 Quản lý tài khoản (Account Management)

Admin panel: tạo/sửa/khóa/mở khóa/xóa tài khoản. Liên kết account với member. Reset password.

### 7.8 System Categories

Danh mục hệ thống cấu hình: positions, departments, teams, priorities, statuses, customers.

### 7.9 Platform Links

Liên kết kênh giao tiếp cho từng dự án (Zalo, Telegram, Slack, v.v.).

---

## 8. Tích hợp bên ngoài (External Integrations)

| Service | Mục đích | Config |
|---------|----------|--------|
| OpenAI-compatible API | AI review dự án + tóm tắt meeting | `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` |
| AssemblyAI | Transcription cuộc họp | `ASSEMBLYAI_API_KEY` |
| Google Calendar | Đồng bộ lịch họp | OAuth2 tokens trong DB |
| Zoom | Đồng bộ cuộc họp | `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` |

---

## 9. Deployment

### 9.1 Infrastructure

- Self-hosted runner (label: `[self-hosted, security]`)
- PostgreSQL trên Supabase nội bộ (VPN/WARP required)
- Docker bridge MTU: 1420 (tương thích VPN encapsulation)
- Backend chỉ expose trên 127.0.0.1 (không public trực tiếp)
- Nginx gateway xử lý traffic bên ngoài

### 9.2 Environments

| Env | Trigger | Compose file | Brands | Port |
|-----|---------|--------------|--------|------|
| Dev | Push to `dev` branch | `security-dev.compose.yml` | markee | 3100 (nginx) |
| Prod | Manual (keyword "DEPLOY") | `security-prod.compose.yml` | markee + securityzone | 3000, 3300 |

### 9.3 CI/CD Flow (GitHub Actions)

1. rsync code to target (excluding .git, .env, secrets)
2. Copy compose file phù hợp
3. `docker compose up -d --build`
4. Health check (timeout 180s)

### 9.4 Production target

```
/home/portalkpi/website_PM
```

---

## 10. Biến môi trường chính (.env)

| Biến | Mô tả |
|------|--------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SECRET_KEY` | JWT signing key |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Token TTL (default: 480) |
| `AI_BASE_URL` | OpenAI-compatible API base URL |
| `AI_API_KEY` | API key cho AI service |
| `AI_MODEL` | Model name (default: gpt-4o-mini) |
| `ASSEMBLYAI_API_KEY` | AssemblyAI key |
| `ZOOM_ACCOUNT_ID` | Zoom S2S account |
| `ZOOM_CLIENT_ID` | Zoom S2S client ID |
| `ZOOM_CLIENT_SECRET` | Zoom S2S client secret |
| `NEXT_PUBLIC_PORTAL_BRAND` | Brand selector (markee / securityzone) |
| `NEXT_PUBLIC_API_URL` | Backend API URL for frontend |
