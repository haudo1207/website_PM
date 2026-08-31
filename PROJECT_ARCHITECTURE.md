# 📋 Task Compliance Portal — Kiến trúc dự án

> **Version:** 5.0.0 · **Team:** SecurityZone · **Stack:** FastAPI + Next.js + PostgreSQL + AI · **Brands:** Markee / SecurityZone

---

## 1. Tổng quan

Hệ thống **Task Compliance Portal** (KPI Portal) quản lý và theo dõi tiến độ dự án theo cấu trúc 4 cấp (Project → Phase → TaskGroup → Task), tính toán chỉ số hiệu suất KPI, đánh giá sức khỏe dự án bằng AI, hỗ trợ đồng bộ/tóm tắt biên bản họp (Zoom & Google Meet), quản lý yêu cầu vắng mặt (Leave Request), đăng ký suất ăn trưa, tích hợp giao tiệp Telegram và Zalo, và lưu vết thao tác (System Audit). Hệ thống hỗ trợ multi-brand deployment (Markee / SecurityZone) và phân quyền theo Workspace (INFRA / DEV) với **System Audit Super Admin** dành cho người giám sát toàn hệ thống.

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Frontend    │────▶│  Backend API     │────▶│  AI Provider    │
│  (Next.js)   │◀────│  (FastAPI)       │◀────│  (OpenAI-compat │
│  Port 3000   │     │  Port 8000       │     │   / Gemini)     │
└──────────────┘     │                  │     └─────────────────┘
       │             │                  │
       │             │   ┌──────────┐   │     ┌─────────────────┐
       │             └───│  DB      │───┘     │  AssemblyAI     │
       │                 │ (Supa PG)│         │  (Speech-To-Text)│
       │                 └──────────┘         └─────────────────┘
       │                       │     ┌─────────────────┐
       │                       │────▶│  Google APIs    │
       │                       │     │  (Calendar)     │
       │                       │     └─────────────────┘
       │                       │     ┌─────────────────┐
       │                       └────▶│  Zoom APIs      │
       │                             │  (S2S OAuth)    │
       │                             └─────────────────┘
       │
       │     ┌──────────────────┐    ┌────────────────────┐
       └────▶│  zalo-worker     │    │  zalo-crawler      │ (profile: crawler)
            │  Node sidecar    │    │  QR-login extractor │
            │  :8090           │    └────────────────────┘
            └──────────────────┘
```

### Sidecar services

| Service | Vai trò | Port | Profile |
|---|---|---|---|
| `backend` | FastAPI / uvicorn | 8000 | default |
| `frontend` | Next.js 14 (standalone) | 3000 | default |
| `zalo-worker` | Persistent Node.js sidecar giữ `zca-js` session cho **Zalo — Task Assignment** (cookie login, gửi / nhận tin nhắn thời gian thực) | 8090 (internal) | default |
| `zalo-crawler` | QR-login crawler, AI trích task từ Zalo (1 chiều, không lưu session) | — | `crawler` |

---

## 2. Cấu trúc thư mục

```
pm-new/
├── .env                          # Biến môi trường (DB, AI keys, Zoom, Google, Outlook, Telegram, Zalo)
├── .env.example                  # Mẫu cấu hình môi trường
├── docker-compose.yml            # Orchestration local dev (Frontend + Backend + zalo-worker; zalo-crawler gated by profile)
├── deploy.sh                     # Script deploy thủ công (down + no-cache build + up)
├── init-db.sql                   # File dữ liệu khởi tạo database PostgreSQL (legacy first-boot snapshot)
├── DESIGN.md                     # Design tokens (màu, typography, status) — nguồn cho build-design.js
├── PROJECT_ARCHITECTURE.md       # File này
├── DEVELOPMENT.md                # Hướng dẫn phát triển local
├── GIT_WORKFLOW.md               # Quy trình làm việc với Git
├── MEETING_INTELLIGENCE.md       # Tài liệu module Meeting
│
├── deploy/                       # ===== DEPLOYMENT (CI/CD compose files) =====
│   ├── security-dev.compose.yml  # Dev: single brand (markee) + nginx gateway (port 3100)
│   ├── security-prod.compose.yml # Prod: dual brand (securityzone :3000, markee :3300)
│   └── dev-gateway.conf          # Nginx reverse proxy config
│
├── extensions/                   # ===== CHROME EXTENSIONS =====
│   └── zalo-login/               # Zalo login extension (build thành frontend/public/zalo-login-extension.zip qua npm run extension:build)
│
├── .github/workflows/            # ===== CI/CD =====
│   ├── deploy-dev.yml            # Auto deploy on push to dev branch
│   └── deploy-production.yml     # Manual deploy với confirmation keyword "DEPLOY"
│
├── prompts/                      # ===== TASK PROMPTS =====
│   └── dashboard.md              # Task spec cho System Audit (Sections 2/3/4)
│
├── Reports/                      # ===== BÁO CÁO TRIỂN KHAI =====
│   └── system_audit_member_team_comparison_01.md
│
├── backend/                      # ===== BACKEND (FastAPI - Python 3.11) =====
│   ├── Dockerfile                # python:3.11-slim, non-root appuser
│   ├── requirements.txt          # Dependencies Python
│   ├── create_admin.py           # Script thủ công tạo/cập nhật admin
│   ├── init_settings.py          # Script reset cấu hình
│   ├── migrate_db.py             # Script migration schema
│   ├── migrate_meetings_json.py  # Script migration meeting data
│   ├── sync_members.py           # Script đồng bộ thành viên
│   └── app/
│       ├── __init__.py
│       ├── main.py               # FastAPI entry point, auto create_all + apply_schema_updates + init_db_defaults
│       ├── config.py             # Pydantic Settings (đọc .env)
│       ├── database.py           # SQLAlchemy engine & session maker (PostgreSQL)
│       │
│       ├── models/               # ===== ORM Models (SQLAlchemy) =====
│       │   ├── user.py                # users (auth + role + data_scope + member_id FK)
│       │   ├── member.py              # members + leader_member_id self-FK + leader_name legacy text
│       │   ├── workspace_access.py    # user_workspace_access (multi-Workspace grants cho Leaders)
│       │   ├── project.py             # projects + project_members_v2 (Project ↔ Member junction)
│       │   ├── phase.py               # phases (Giai đoạn của dự án)
│       │   ├── task_group.py          # task_groups (Nhóm công việc)
│       │   ├── task.py                # tasks_v2 (Công việc chi tiết + KPI columns)
│       │   ├── system_category.py     # teams / positions / departments / task_priorities / task_statuses / customers / workspaces / master_phases
│       │   ├── skill_master.py        # categories → groups → skills (3-level taxonomy)
│       │   ├── performance_setting.py # performance_settings (Cấu hình KPI thưởng/phạt)
│       │   ├── meeting.py             # meetings + meeting_participants
│       │   ├── meeting_project.py     # meeting ↔ project junction
│       │   ├── meeting_feedback.py    # meeting effectiveness feedback
│       │   ├── ai_review.py           # ai_prompts + ai_review_logs (AI đánh giá dự án)
│       │   ├── ai_task_inbox.py       # chat_ai_tasks (AI xử lý yêu cầu Inbox)
│       │   ├── google_token.py        # google_tokens (OAuth Google tokens per user)
│       │   ├── refresh_token.py       # refresh_tokens (HttpOnly cookie sessions)
│       │   ├── notification.py        # notifications (recipient_id, sender_id, task_id…)
│       │   ├── telegram_connection.py # telegram_connections
│       │   ├── zalo.py                # zalo_accounts + zalo_conversations + zalo_messages + zalo_demo_requests
│       │   ├── leave_request.py       # leave_requests (Đơn xin nghỉ / WFH / công tác)
│       │   ├── lunch_record.py        # lunch_records (Đăng ký suất ăn trưa)
│       │   ├── project_template.py    # project_templates + phases/task_groups/tasks (Mẫu dự án)
│       │   ├── document.py            # project_documents (file đính kèm dự án)
│       │   ├── audit_log.py           # audit_logs (Lưu vết thao tác toàn hệ thống)
│       │   └── setting.py             # settings (cấu hình runtime)
│       │
│       ├── routers/               # ===== API Routers (FastAPI) =====
│       │   ├── auth.py                 # POST /api/auth/login (OAuth2 Password) + /google + /outlook + /refresh + /logout
│       │   ├── users.py                # /api/users (profile người dùng hiện tại)
│       │   ├── accounts.py             # /api/accounts (admin CRUD tài khoản + workspace_ids)
│       │   ├── projects.py             # /api/projects + /api/projects/{id} + /api/projects/{id}/members + /api/projects/{id}/links
│       │   ├── project_templates.py    # /api/project-templates (CRUD templates)
│       │   ├── project_documents.py    # /api/projects/{id}/documents (upload + list)
│       │   ├── task_groups.py          # /api/task-groups + /api/tasks + /api/all-tasks-global + /api/all-tasks-global/summary
│       │   ├── settings_router.py      # /api/settings (platforms, statuses…)
│       │   ├── skills.py               # /api/skills (categories → groups → skills)
│       │   ├── system_categories.py    # /api/system-categories (positions, departments, teams, customers, workspaces, master-phases)
│       │   ├── system_audit.py         # /api/system-audit (Super Admin only — stats/logs/analytics/team-comparison/team-detail/export)
│       │   ├── members.py              # /api/members (CRUD + KPI + meta/leaders + workspace-leaders + sync-candidate)
│       │   ├── meetings.py             # /api/meetings + Google/Zoom sync + n8n webhook + scoring
│       │   ├── performance_settings.py # /api/performance-settings
│       │   ├── ai_review.py            # /api/ai-review + /api/projects/{id}/ai-review + /api/ai-prompts
│       │   ├── chat_ai.py              # /api/projects/{id}/ai-task-inbox
│       │   ├── leave_requests.py       # /api/leave-requests
│       │   ├── lunch.py                # /api/lunch + /api/lunch/monthly-summary
│       │   ├── notifications.py        # /api/notifications + /my-alerts + /remind + /inbox
│       │   ├── telegram.py             # /api/telegram (connect / disconnect / status / webhook)
│       │   └── zalo.py                 # /api/zalo (status / auth / disconnect / conversations / create-task / send / messages)
│       │
│       ├── services/              # ===== Business Services =====
│       │   ├── ai_client.py             # OpenAI-compatible / Gemini client wrapper
│       │   ├── document_storage.py      # Project document upload/storage backend
│       │   ├── meeting_sync.py          # Zoom S2S, Google Calendar, AssemblyAI, AI Summary
│       │   ├── meeting_score_engine.py  # Meeting effectiveness scoring
│       │   ├── telegram.py              # Telegram bot integration
│       │   ├── zalo.py                  # Zalo worker bridge (zca-js)
│       │   └── zalo_task_parser.py      # AI parse task from Zalo message
│       │
│       └── utils/                 # ===== Cross-cutting utils =====
│           ├── auth.py                  # JWT HS256, bcrypt password, deps: require_super_admin / require_manager / require_route_project_access + legacy require_admin / require_admin_write
│           ├── access.py                # Data scope authorization (per-project / per-member / per-customer) + workspace_leader_names
│           ├── audit_service.py         # Helper ghi AuditService.record(...)
│           └── kpi_engine.py            # Công thức & quy trình tính toán KPI (Base / Perform / OT / Split)
│
├── services/                     # ===== SIDECAR SERVICES (Node.js) =====
│   ├── zalo-worker/               # Persistent zca-js session sidecar (port 8090, persistent volume)
│   └── zalo-crawler/              # QR-login crawler (profile-gated; AI task extraction)
│
└── frontend/                     # ===== FRONTEND (Next.js 14 - TypeScript) =====
    ├── Dockerfile                # Node 20 alpine, multi-stage, output: "standalone"
    ├── package.json              # Dependencies (next, react, @tanstack/react-query, axios, tailwindcss, recharts, @azure/msal-browser, react-datepicker)
    ├── next.config.js            # Next.js config + proxy rewrite /api → BACKEND_INTERNAL_URL
    ├── tailwind.config.js        # TailwindCSS config + custom theme (load từ tailwind.theme.json)
    ├── tailwind.theme.json       # Theme tokens (colors, fonts) — single source of truth cho build-design.js
    ├── DESIGN.md                 # Mirror của root DESIGN.md (để build-design.js đọc trong container)
    ├── tsconfig.json             # TypeScript config
    │
    └── src/
        ├── lib/
        │   ├── api.ts                  # Axios instance + TẤT CẢ API functions gọi backend (typed)
        │   ├── auth.ts                 # Token helpers (localStorage) + isSuperAdmin()
        │   ├── brand.ts                # Multi-brand config (markee / securityzone) — logo, name, footer
        │   ├── leave-request.ts        # Types và utils cho leave request
        │   ├── vn-locations.ts         # Dữ liệu tỉnh thành Việt Nam
        │   └── workspaceFilter.tsx     # Shared WorkspaceFilterProvider (context + localStorage key 'selected_workspace_code')
        │
        ├── components/
        │   ├── Navbar.tsx              # Sidebar navigation + WorkspaceSwitcher
        │   ├── Portal.tsx              # Portal container
        │   ├── KPIsView.tsx            # Quản lý cấu hình KPI thưởng/phạt
        │   ├── MembersView.tsx         # Quản lý danh sách thành viên
        │   ├── SystemCategoriesView.tsx# Quản lý danh mục hệ thống
        │   ├── AIPromptsView.tsx       # Cấu hình AI prompts
        │   ├── AIReviewDrawer.tsx      # Panel hiển thị kết quả AI review
        │   ├── SystemAuditView.tsx     # Audit Logs view (orphaned; System Audit page đã dùng page.tsx riêng)
        │   ├── AuditLogsTab.tsx        # Audit Logs tab component (active)
        │   ├── ProjectTemplatesView.tsx# Giao diện quản lý Project Templates
        │   ├── CustomersProjectsView.tsx# Quản lý Customers và Dự án
        │   ├── ProjectListContent.tsx  # Project list rendering + filters
        │   ├── ProjectFormModal.tsx    # Project create/edit modal
        │   ├── ProjectDocumentsTab.tsx # Project documents tab (upload + list)
        │   ├── meetings/               # Components cuộc họp (Create, Card, Summarize, PromptSettings)
        │   ├── leave-request/          # Components vắng mặt (LeaveRequestForm, StatusBadge, SummaryCard)
        │   ├── common/                 # Shared utilities (SearchableSelect, …)
        │   └── dashboard/              # Dashboard-specific components
        │       ├── KpiCard.tsx         # Single-number KPI tile
        │       ├── ProgressBar.tsx     # Tailwind bar 0-100
        │       ├── BarChartCard.tsx    # Recharts bar chart wrapper
        │       ├── LineChartCard.tsx   # Recharts line chart wrapper
        │       ├── PieChartCard.tsx    # Recharts pie chart wrapper
        │       ├── MemberTaskAlerts.tsx# Member-side overdue/pending alerts
        │       └── Icons.tsx           # SvgIcon — switch on name (tasks / user / chart / alert / project …)
        │
        └── app/
            ├── layout.tsx              # Root layout (mounts Providers)
            ├── page.tsx                # Trang chủ (redirect → login/dashboard)
            ├── globals.css             # CSS toàn cục
            ├── providers.tsx           # React Query + WorkspaceFilterProvider + SessionBootstrap
            ├── login/                  # Trang đăng nhập (Google + Outlook)
            ├── dashboard/
            │   ├── layout.tsx          # Dashboard layout (tabs: report / overview / system-audit; system-audit Super-Admin only)
            │   ├── constants.ts        # projectStatusBadge / projectBarColor / calculateDaysLate
            │   ├── page.tsx            # Dashboard root (redirect to /report)
            │   ├── report/page.tsx     # Tab 1 — KPI report
            │   ├── overview/page.tsx   # Tab 2 — Project overview (Leader Cards + Workload)
            │   └── system-audit/page.tsx # Tab 3 — System Audit (Super Admin only)
            │       - Section 1: 4 hero KPI cards + Project progress + Phase Distribution + Risk + KPI distribution
            │       - Section 2: Team comparison (per-Leader table)
            │       - Section 3: Project comparison by team
            │       - Section 4: Member comparison (Overload / Balanced / Available)
            │       - Audit Logs table (filterable by module)
            ├── project/
            │   └── detail/              # Chi tiết dự án (4-level spreadsheet + phases + tasks + KPIs + documents)
            ├── project-hub/             # Project Hub (centralized project view + filters)
            ├── projects/new/            # Tạo dự án mới
            ├── customers/               # Quản lý khách hàng
            ├── meetings/                # Quản lý cuộc họp
            ├── leave-request/
            │   ├── new/                 # Tạo đơn mới
            │   └── calendar-team/       # Lịch vắng mặt team
            ├── settings/                # Cài đặt hệ thống (categories, skills, platforms, KPIs, AI)
            ├── accounts/                # Quản lý tài khoản (Super Admin only)
            ├── kpi/                     # Bảng theo dõi và đánh giá KPI
            ├── profile/                 # User profile page
            ├── zalo-account/            # Zalo account connect/disconnect UI (link / portal)
            └── api/                     # Next.js API Routes (proxy to backend)
                ├── ai/settings/
                ├── ai/summarize/
                ├── health/
                └── meetings/[id]/
```

---

## 3. Backend API

### 3.1 Framework & Dependencies

- **FastAPI** 0.111.0 + **Uvicorn** 0.29.0 (`[standard]` → websockets / watchgod)
- **SQLAlchemy** 2.0.30 + **psycopg2-binary**
- **python-jose** (JWT HS256) + **passlib** + **bcrypt** 4.1.3
- **requests** (external API calls: Zoom / Google / Telegram / AssemblyAI / AI)
- **pydantic-settings** 2.2.1
- **google-auth**, **google-auth-httplib2**, **google-api-python-client**, **google-auth-oauthlib** (Google APIs)
- **python-multipart** (OAuth2 form + multipart uploads)
- **openpyxl** (Excel import for Skill Master)

### 3.2 API Routes

| Prefix | Router | Mô tả | Auth gate |
|---|---|---|---|
| `POST /api/auth/login` | `auth.py` | Đăng nhập OAuth2 Password (mặc định tắt) | public |
| `POST /api/auth/google` | `auth.py` | Google Identity Services (GIS) login | public |
| `POST /api/auth/outlook` | `auth.py` | Microsoft (Outlook / Entra) login (MSAL) | public |
| `POST /api/auth/refresh` | `auth.py` | Rotate refresh session (HttpOnly cookie) | refresh cookie |
| `POST /api/auth/logout` | `auth.py` | Revoke refresh session | user |
| `GET /api/users/me` | `users.py` | Profile người dùng hiện tại | user |
| `POST /api/users/avatar` | `users.py` | Upload avatar | user |
| `GET/POST/PUT/DELETE /api/accounts*` | `accounts.py` | Admin CRUD tài khoản (create, lock, unlock, reset password, delete, available-members, workspace_ids) | super_admin |
| `GET/POST/PUT/DELETE /api/projects*` | `projects.py` | CRUD dự án + phases + project members + links + AI review trigger | `require_route_project_access` |
| `GET/POST/PUT/DELETE /api/projects/{id}/documents` | `project_documents.py` | Project documents upload / list | `require_route_project_access` |
| `GET/POST/PUT/DELETE /api/project-templates*` | `project_templates.py` | Project templates CRUD | user |
| `GET/POST/PUT/DELETE /api/task-groups*` | `task_groups.py` | Task groups + tasks CRUD + bulk + gantt | `require_route_project_access` |
| `GET /api/all-tasks-global` | `task_groups.py` | All tasks flat dump (dashboard) | leader+ |
| `GET /api/all-tasks-global/summary` | `task_groups.py` | Global per-status / per-member / per-project aggregations | leader+ |
| `GET /api/settings/*` | `settings_router.py` | platforms / statuses / categories config | admin |
| `GET/POST/PUT/DELETE /api/skills/*` | `skills.py` | categories → groups → skills CRUD | admin |
| `GET/POST/PUT/DELETE /api/system-categories/*` | `system_categories.py` | positions, departments, teams, customers, workspaces, master-phases CRUD | admin |
| `GET /api/system-audit/*` | `system_audit.py` | Super Admin — stats, logs (filterable), analytics, CSV/JSON export, **team-comparison**, **team-detail**, session timeline | `require_admin` (= super_admin) |
| `GET/POST/PUT/DELETE /api/members*` | `members.py` | Thành viên CRUD + KPI + meta/leaders + workspace-leaders + sync-candidate + sync-from-recruitment | user |
| `GET/POST/PUT/DELETE /api/meetings*` | `meetings.py` | Meetings + Google/Zoom sync + n8n webhook + scoring | `require_route_project_access` |
| `GET/POST/PUT/DELETE /api/performance-settings*` | `performance_settings.py` | KPI thresholds CRUD | `require_admin_write` |
| `GET/POST/PUT/DELETE /api/ai-review*` | `ai_review.py` | AI review dự án + prompt management | `require_admin_write` |
| `GET/POST/PUT/DELETE /api/projects/{pid}/ai-task-inbox*` | `chat_ai.py` | AI xử lý Task Inbox | user |
| `GET/POST/PUT/DELETE /api/leave-requests*` | `leave_requests.py` | Đơn vắng mặt / WFH / công tác | user |
| `GET/POST/PUT/DELETE /api/lunch*` | `lunch.py` | Đăng ký suất ăn trưa + `/monthly-summary` | user (`monthly-summary`: super_admin) |
| `GET/POST /api/notifications/*` | `notifications.py` | In-app notifications (`/my-alerts`, `/remind`, `/remind-bulk`, `/remind-group`, `/inbox`) | user |
| `GET/POST /api/telegram/*` | `telegram.py` | Telegram bot status / connect / disconnect / webhook | user |
| `GET/POST /api/zalo/*` | `zalo.py` | Zalo account connect (cookie import) / conversations / create-task / send / messages / link-project / refresh-names | user |
| `GET /health` | `main.py` | Health check (returns `{status, version, commit, timestamp}`) | public |

### 3.3 Business Logic

- **KPI Engine** (`utils/kpi_engine.py`): Tính toán hiệu suất task/taskgroup dựa trên `priority.kpi_base × manday_est` + perform bonus/penalty (remark-based) + OT (`|days_late| × priority_mult`, capped at 50% of base) → split into `kpi_assigned` / `kpi_support` theo `kpi_ratio_assign/support`. Được trigger lại mỗi khi task chuyển `Done`.
- **Access Control** (`utils/access.py`): `user_allowed_scopes`, `project_query_for_user`, `member_query_for_user`, `customer_query_for_user` lọc dữ liệu theo `data_scope` của user + `user_workspace_access`. Scope `all` xem toàn bộ; scope khác chỉ xem projects có cùng `data_scope`. Member được phân công dự án có quyền xem và cập nhật task trong dự án đó.
- **Workspace Leader Resolution** (`utils/access.py:workspace_leader_names`): Lấy Leaders khả dụng trong workspace dựa trên `user_workspace_access` (multi-grant), fallback về `User.data_scope`.
- **System Audit aggregator** (`routers/system_audit.py:_aggregate_team_comparison`): Một SQL group duy nhất gom `tasks_v2` theo `assigned_id` và `support_id` → per-member assigned_total/done/overdue/md_est/md_act/kpi + support_total/... + project rollup. Eligibility: `User.role='leader' AND is_active=True AND data_scope khớp`; Leaders rỗng (0 managed Members) bị loại bỏ.
- **Auth** (`utils/auth.py`): JWT HS256 (`python-jose`) + bcrypt password; `require_super_admin` / `require_manager` / `require_route_project_access` / legacy `require_admin` (= super_admin) / `require_admin_write` (= manager_write).
- **Refresh sessions** (`models/refresh_token.py`): Opaque token lưu trong `HttpOnly` cookie (`REFRESH_COOKIE_NAME=portal_refresh`), TTL `REFRESH_TOKEN_EXPIRE_DAYS` (mặc định 20 ngày), không rotate (Phase 1).
- **Meeting Sync** (`services/meeting_sync.py`): Đồng bộ lịch họp từ Google Calendar + Zoom (S2S OAuth), transcription qua AssemblyAI, tóm tắt bằng AI; meeting scoring engine tách riêng (`meeting_score_engine.py`).
- **AI integration** (`services/ai_client.py`): OpenAI-compatible endpoint (`AI_BASE_URL`) hoặc Gemini (`generativelanguage.googleapis.com/v1beta/openai`); hỗ trợ 3 prompt types: PROJECT / PHASE / TASK.
- **Zalo integration**: `zalo-worker` (Node.js sidecar, persistent session qua volume `zalo-worker-artifacts`) bridge với backend thông qua `ZALO_WORKER_INTERNAL_TOKEN`; backend gọi worker qua HTTP để send/receive/list conversations/create-task. Riêng `zalo-crawler` (profile `crawler`) là QR-login AI task extraction 1 chiều.

---

## 4. Frontend

### 4.1 Framework & Dependencies

- **Next.js** 14.2.35 (App Router, `output: "standalone"`) + **React** 18 + **TypeScript** 5
- **TanStack Query** 5 (server state, deduped cache keys)
- **Tailwind CSS** 3 + custom theme (`tailwind.theme.json` → compiled into Tailwind via `tailwind.config.js`)
- **Axios** cho HTTP requests (`withCredentials: true` để gửi refresh cookie)
- **Recharts** cho charts
- **MSAL Browser** (`@azure/msal-browser` 5.18.0) cho Microsoft (Outlook) login
- **react-datepicker** cho calendar UI (Leave Request)
- Font: **Work Sans** (loaded globally)

### 4.2 Pages

| Route | Mô tả | Auth |
|---|---|---|
| `/login` | Đăng nhập (Google + Outlook) | public |
| `/dashboard` | Redirect → `/dashboard/report` | user |
| `/dashboard/report` | Tab 1 — KPI report (project progress, phase distribution, risk projects, KPI distribution per Workspace) | user |
| `/dashboard/overview` | Tab 2 — Project overview + Leader Cards + Workload | user |
| `/dashboard/system-audit` | Tab 3 — **Super Admin only**. Sections 1–4 + Audit Logs | super_admin |
| `/project` | Danh sách dự án | user |
| `/project-hub` | Centralized project hub (filters + list) | user |
| `/project/detail?id=X` | Chi tiết dự án (4-level spreadsheet + phases + tasks + KPIs + documents) | user |
| `/projects/new` | Tạo dự án mới | leader+ |
| `/meetings` | Quản lý cuộc họp | user |
| `/leave-request` | Đơn vắng mặt của tôi | user |
| `/leave-request/new` | Tạo đơn mới | user |
| `/leave-request/calendar-team` | Lịch vắng mặt team | leader+ |
| `/settings` | Cài đặt (Categories, Skills, Platforms, KPIs, AI Prompts) | admin |
| `/accounts` | Quản lý tài khoản | super_admin |
| `/customers` | Quản lý khách hàng | user |
| `/kpi` | Bảng theo dõi và đánh giá KPI | user |
| `/profile` | User profile + avatar | user |
| `/zalo-account` | Zalo account connect/disconnect UI | user |

### 4.3 Workspace filter (shared)

`useWorkspaceFilter()` (React Context trong `lib/workspaceFilter.tsx`) là filter **chia sẻ toàn cục**, được mount tại app root trong `app/providers.tsx`. Persist vào `localStorage['selected_workspace_code']`. Tất cả các trang dashboard đều đọc filter này — không bao giờ tạo filter riêng cho từng section.

Workspace switcher (UI) nằm trong `components/Navbar.tsx` (`WorkspaceSwitcher`).

### 4.4 Multi-brand

Biến build-time `NEXT_PUBLIC_PORTAL_BRAND` quyết định thương hiệu (`markee` | `securityzone`). Cấu hình brand (logo, tên, màu, login subtitle, footer) nằm trong `src/lib/brand.ts`.

| Brand | Tên hiển thị | Local port | Dev (CI/CD) | Prod (CI/CD) |
|---|---|---|---|---|
| `securityzone` | SecurityZone KPI Portal | 3000 | 3100 (nginx) | **3000** (`FRONTEND_PORT`) |
| `markee` | Markee Work Portal | 3300 (override `FRONTEND_PORT`) | — | **3300** (`MARKEE_FRONTEND_PORT`) |

Trong production CI/CD (`deploy/security-prod.compose.yml`), **hai frontend container** chạy song song cùng một backend:
- `frontend` (brand=`securityzone`) → cổng `3000`
- `frontend_markee` (brand=`markee`) → cổng `3300`

Trong dev CI/CD (`deploy/security-dev.compose.yml`) chỉ chạy **một** frontend (`markee`) đằng sau nginx gateway cổng `3100`. Local `docker-compose.yml` chạy **một** frontend với brand mặc định từ `PORTAL_BRAND` (mặc định `markee`) trên `FRONTEND_PORT` (mặc định `3000`).

---

## 5. Database

### 5.1 Engine

- **PostgreSQL development** dùng chung Supabase Cloud qua session pooler TLS (`?sslmode=require`); local không cần VPN/WARP.
- **PostgreSQL production** tiếp tục dùng Supabase self-hosted, tách biệt hoàn toàn với development.
- Truy cập yêu cầu VPN công ty hoặc Cloudflare WARP.
- Connection pool: `DB_POOL_SIZE=3`, `DB_MAX_OVERFLOW=2` (giữ dưới 20 connections của Supabase session pooler).

### 5.2 ORM & Migration

- **SQLAlchemy** 2.0.30 (declarative models)
- Không dùng Alembic — migration inline bằng `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` trong `apply_schema_updates()` tại startup + `Base.metadata.create_all(engine)`.
- Script `backend/migrate_db.py` cho major schema changes.

### 5.3 Bảng chính

| Model | Bảng | Mô tả |
|---|---|---|
| `User` | `users` | Tài khoản (email, role, data_scope, member_id FK, telegram_chat_id, google_sub, outlook_sub, hashed_pw) |
| `RefreshToken` | `refresh_tokens` | Opaque refresh sessions (HttpOnly cookie) |
| `Member` | `members` | Thành viên (display_name, full_name, position, department, team, leader_member_id self-FK, leader_name legacy, skills) |
| `WorkspaceAccess` | `user_workspace_access` | User ↔ Workspace multi-grant (UNIQUE `(user_id, workspace_id)`) |
| `Workspace` | `workspaces` | Master data workspace (code `infra` / `dev`; seed INFRA/DEV tại startup) |
| `Project` | `projects` | Dự án (tên, customer_id, year, pm_id, technical_leader_id, sales_id, status, data_scope, business) |
| `ProjectMemberV2` | `project_members_v2` | Project ↔ Member (role: PM/Leader/Member/Sales) |
| `ProjectTemplate` | `project_templates` + phases/task_groups/tasks | Mẫu dự án chuẩn |
| `Phase` | `phases` | Giai đoạn dự án |
| `TaskGroup` | `task_groups` | Nhóm công việc (cấp I, II, III) |
| `Task` | `tasks_v2` | Công việc chi tiết (assignee, support, deadline, status, manday_est, manday_actual, kpi_base, kpi_perform, kpi_ot, kpi_final, kpi_assigned, kpi_support, days_late) |
| `Meeting` | `meetings` + `meeting_participants` | Cuộc họp (transcript, AI summary, effectiveness score) |
| `MeetingProject` | `meeting_projects` | Meeting ↔ Project junction |
| `MeetingFeedback` | `meeting_feedback` | Per-attendee effectiveness feedback |
| `Skill` | `skills` (under `groups` under `categories`) | Kỹ năng 3-level taxonomy |
| `SystemCategory` | `teams`, `positions`, `departments`, `task_priorities`, `task_statuses`, `customers`, `master_phases` | Danh mục hệ thống |
| `PerformanceSetting` | `performance_settings` | Ngưỡng KPI thưởng/phạt (parent / child rows) |
| `GoogleToken` | `google_tokens` | OAuth tokens Google (1 per user) |
| `AIPrompt` | `ai_prompts` | Template prompt AI cho từng dự án (PROJECT/PHASE/TASK) |
| `AIReviewLog` | `ai_review_logs` | Log kết quả AI review (score, issues, suggestions) |
| `ChatAITask` | `chat_ai_tasks` | Task yêu cầu xử lý từ AI (Inbox) |
| `Notification` | `notifications` | In-app notifications |
| `TelegramConnection` | `telegram_connections` | Telegram bot connect state per user |
| `ZaloAccount` | `zalo_accounts` + `zalo_conversations` + `zalo_messages` + `zalo_demo_requests` | Zalo account + conversations + messages |
| `LeaveRequest` | `leave_requests` | Đơn vắng mặt (Work Remotely / Offline / Go on Business…) |
| `LunchRecord` | `lunch_records` | Đăng ký suất ăn trưa (unique `(member_id, date)`) |
| `ProjectDocument` | `project_documents` | File đính kèm dự án |
| `AuditLog` | `audit_logs` | Lưu vết thao tác (action, module, severity, IP risk, snapshot_json…) |
| `Setting` | `settings` | Runtime configuration |

### 5.4 Junction Tables

| Bảng | Quan hệ |
|---|---|
| `project_members_v2` | Project ↔ Member (role: PM/Leader/Member/Sales) |
| `member_skills` | Member ↔ Skill |
| `user_skills` | User ↔ Skill |
| `user_workspace_access` | User ↔ Workspace (multi-grant cho Leaders) |
| `meeting_projects` | Meeting ↔ Project |
| `meeting_participants` | Meeting ↔ Member (attendees) |

### 5.5 Hierarchy

```
Project → Phase → TaskGroup → Task (4 cấp)
Workspace → User (data_scope + user_workspace_access)
          → Leader → Members (via Member.leader_member_id)
          → Project (via Project.data_scope / business)
```

---

## 6. Authentication & Authorization

### 6.1 Authentication

- **Google Identity Services (GIS)** — xác thực email đã được Admin cấp trước; hệ thống không tự tạo Account. `User.google_sub` liên kết ở lần đăng nhập đầu, tên/avatar được đồng bộ từ Google.
- **Microsoft (Outlook / Entra)** — additive provider qua `@azure/msal-browser` + backend `/api/auth/outlook`. `OUTLOOK_TENANT_ID=common` chấp nhận cả personal account và Entra (work/school).
- **Password (OAuth2 form)** — mặc định **tắt** (`PASSWORD_LOGIN_ENABLED=false`); chỉ bật khi cần debug.
- **JWT nội bộ (HS256)** qua `python-jose`:
  - Access token TTL: `ACCESS_TOKEN_EXPIRE_MINUTES` (mặc định 30 phút).
  - Refresh token: opaque random, lưu `refresh_tokens` table + HttpOnly cookie `REFRESH_COOKIE_NAME=portal_refresh`, TTL `REFRESH_TOKEN_EXPIRE_DAYS` (mặc định 20 ngày, Phase 1 — không rotate).
- Frontend lưu access token trong `localStorage`, gửi qua `Authorization: Bearer`; refresh cookie được `axios` gửi kèm (`withCredentials: true`).

### 6.2 Authorization — Role-based (4-Role System)

| Role | Quyền |
|---|---|
| `super_admin` | Toàn quyền toàn hệ thống (kể cả System Audit, Account Management, Performance Settings, AI Review). Bootstrap từ env `AUTH_SUPERADMIN_EMAILS` (seeded tại startup). |
| `leader` | Quản lý dự án, task, meeting trong phạm vi các Workspace được cấp (`user_workspace_access` ∪ `data_scope`). |
| `member` | Xem dự án được phân công, có quyền cập nhật (write) Task trong dự án đó. |
| `viewer` | Chỉ được xem (read-only) dự án được phân công. |

### 6.3 Authorization — Workspace / Data Scope

`workspaces` là **single source of truth**, seed `infra` / `dev` tại startup; legacy `infrastructure` / `markee` được tự động migrate về `infra` / `dev` (cả trên `users`, `projects`, `customers`, `audit_logs`).

| Scope | Mô tả |
|---|---|
| `all` | Xem toàn bộ (chỉ dành cho `super_admin`) |
| `infra` | Workspace INFRA — Infrastructure |
| `dev` | Workspace DEV — Markee |

Leader có thể có nhiều Workspace thông qua `user_workspace_access`. Khi chuyển Workspace, leader list lấy từ `workspace_leader_names` (`utils/access.py:287-349`).

### 6.4 Safeguards

- Không thể xóa/demote `super_admin` cuối cùng (`ensure_superadmin_remains`).
- `super_admin` không thể tự demote chính mình.
- Email super-admin trong `AUTH_SUPERADMIN_EMAILS` là **immutable**.
- Write operations (CRUD dự án/settings) giới hạn ở `super_admin` và `leader` (theo scope). `member` chỉ được write Task. `viewer` bị chặn mọi write operation (403).
- ALL WORKSPACES Leaders KHÔNG bao giờ tự động bao gồm tất cả Members — chỉ các Member thực sự được gán qua Member Management (`Member.leader_member_id` hoặc fallback `Member.leader_name`).

---

## 7. Tính năng chính

### 7.1 Quản lý dự án (Project Management)

CRUD dự án với cấu trúc 4 cấp. Giao diện spreadsheet tương tác cho phép cập nhật trực tiếp. Hỗ trợ gán thành viên (PM/Leader/Member/Sales), liên kết platforms, theo dõi status, **Project Documents** upload/list, **Project Hub** (centralized list với filters).

### 7.2 Project Hub

Centralized project view (`/project-hub`) với filters: workspace, status, year, customer, PM. Liệt kê tất cả projects trong các Workspace mà user có quyền.

### 7.3 Dashboard System Audit (Super Admin only)

Tab `/dashboard/system-audit` với 4 sections:

- **Section 1** — Hero KPIs + Project progress + Phase Distribution + Projects at Risk + Member KPI Distribution (Infrastructure / Markee) + Audit Logs table (filterable by module).
- **Section 2** — **Team comparison** trong Workspace. Một dòng / Leader với KPI / Plan MD / Actual MD / Utilization / Efficiency / On-time / Trễ / Health. Có **Chi tiết** drawer.
- **Section 3** — **Project comparison** theo nhiều Team. Chọn nhiều Leader rồi "Apply Comparison" để so sánh project cards.
- **Section 4** — **Member comparison** giữa các Team. Mỗi Team = 1 card với Team summary (Members / Trống task / Còn capacity / Quá tải / Cân bằng) + danh sách Member được sort theo workload priority (`Quá tải` → `Cân bằng` → `Còn capacity`).

Backend endpoint phục vụ Sections 2/3/4: `GET /api/system-audit/team-comparison?workspace=…` (super_admin only, `require_admin`).

### 7.4 Dashboard Overview & Leader Cards

Tab `/dashboard/overview`: Leader Cards (canonical `User.role='leader' AND is_active`) + Project Overview + Workload view.

### 7.5 KPI Engine

Tính toán hiệu suất dựa trên `priority.kpi_base × manday_est`, deadline vs done date, ngưỡng thưởng/phạt cấu hình trong `performance_settings` (`utils/kpi_engine.py`). Per-member KPI fiscal-cycle tổng hợp ở `members.py` (`kpi_total / kpi_avg / kpi_bonus / manday_total / manday_est_total`).

### 7.6 AI Project Review

- Gọi OpenAI-compatible API (`AI_BASE_URL`, mặc định `https://api.shopaikey.com/v1`) hoặc Gemini (`AI_MODEL=gemini-2.5-flash`).
- 3 loại prompt: PROJECT, PHASE, TASK — tùy chỉnh cho từng dự án trong `/api/ai-prompts`.
- Prompt mặc định bằng tiếng Việt (phân tích rủi ro, tài nguyên, overdue).
- Kết quả: score + issues + suggestions (JSON).
- Status flow: `NOT_CHECKED` → `CHECKING` → `CHECKED` / `HAS_ISSUE` / `NEED_RECHECK`.
- Audit trail: `ai_review_logs` lưu ai đánh giá, khi nào, prompt snapshot.

### 7.7 Quản lý cuộc họp (Meeting Management)

- Tạo/chỉnh sửa cuộc họp, liên kết dự án, mời attendees (`meeting_participants`).
- Đồng bộ từ Google Calendar + Zoom (Server-to-Server OAuth).
- Transcription qua AssemblyAI (`ASSEMBLYAI_API_KEY`).
- Tóm tắt biên bản bằng AI qua n8n webhook (`/api/meetings/webhook/n8n-summary`).
- Effectiveness scoring engine (`services/meeting_score_engine.py`).

### 7.8 Quản lý yêu cầu vắng mặt (Leave Request)

- Nhân viên tạo yêu cầu: WFH / Nghỉ phép / Công tác / Workshop / Cuối tuần.
- Leader duyệt; Admin xem toàn hệ thống.
- Lịch team (`/leave-request/calendar-team`).
- Telegram notification (khi được cấu hình).

### 7.9 Quản lý thành viên (Members) & Workspace Filter

Danh bạ nhân sự (tên, bộ phận, vị trí, kinh nghiệm, kỹ năng). Gán kỹ năng từ Skill Master. Self-FK `Member.leader_member_id` là canonical link Leader → Member; fallback text `Member.leader_name` cho dữ liệu legacy.

`useWorkspaceFilter()` (chia sẻ toàn cục qua React Context) cho phép user chọn 1 Workspace để lọc Members / Projects / KPIs trên tất cả dashboard pages.

### 7.10 Skill Master

Import từ Excel (`Skill_Master_From_Sheet.xlsx`). Cấu trúc 3 cấp: Category → Group → Skill. Gán many-to-many cho members.

### 7.11 Quản lý tài khoản (Account Management)

Super Admin panel: tạo/sửa/khóa/mở khóa/xóa tài khoản. Liên kết account với member qua `users.member_id`. Reset password. Cấp nhiều Workspace cho Leader qua `user_workspace_access` (chỉ super_admin được grant/revoke).

### 7.12 System Categories & Platforms

Danh mục hệ thống cấu hình: positions, departments, teams, customers, **workspaces**, **master_phases**. Liên kết kênh giao tiếp (Zalo, Telegram, Slack…) cho từng dự án.

### 7.13 Đăng ký suất ăn trưa (Lunch Registration)

Quản lý đăng ký ăn trưa (`lunch_records`, unique `(member_id, date)`). `/api/lunch/monthly-summary` cung cấp tổng hợp `lunch_count / bonus_count / no_lunch_count / off_count / total_cost` per member (super_admin only).

### 7.14 Telegram Bot Integration

`/api/telegram/*` — connect / disconnect / webhook. Gửi notification về Meeting / Leave Request với deep link `APP_BASE_URL`. Config qua `TELEGRAM_BOT_TOKEN`, `TELEGRAM_GROUP_CHAT_ID`, `TELEGRAM_MESSAGE_THREAD_ID`, `TELEGRAM_WEBHOOK_SECRET`.

### 7.15 Zalo Integration (2 mode)

- **Zalo Task Assignment** (`zalo-worker` sidecar, default profile): persistent `zca-js` session lưu trong volume `zalo-worker-artifacts`. Hỗ trợ connect / disconnect / conversations / create-task / send / link-project / refresh-names. Authenticate qua **cookie import** (Phase 1, không có QR login).
- **Zalo AI Task Extraction** (`zalo-crawler`, profile `crawler`): QR-login crawler, AI parse task từ Zalo message → backend webhook `/api/chat/zalo-webhook`.

### 7.16 Notifications

In-app notifications qua `/api/notifications/*`: `my-alerts`, `remind`, `remind-bulk`, `remind-group`, `inbox`. Recipient + sender + task_id + project_id + zalo_conversation_id.

### 7.17 Chrome Extension — Zalo Login

`extensions/zalo-login/` — Chrome extension bundle, build thành `frontend/public/zalo-login-extension.zip` qua `npm run extension:build`. Phục vụ Phase 1 cookie import cho Zalo.

---

## 8. Tích hợp bên ngoài (External Integrations)

| Service | Mục đích | Config |
|---|---|---|
| OpenAI-compatible API (hoặc Gemini) | AI review dự án + tóm tắt meeting | `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` |
| AssemblyAI | Transcription cuộc họp | `ASSEMBLYAI_API_KEY` |
| Google Identity Services (GIS) | Login | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` |
| Microsoft (MSAL) | Login (Outlook / Entra) | `OUTLOOK_CLIENT_ID`, `OUTLOOK_TENANT_ID` |
| Google Calendar | Đồng bộ lịch họp | OAuth2 tokens trong DB (`google_tokens`) |
| Zoom | Đồng bộ cuộc họp | `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` |
| Telegram Bot | Notifications | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_GROUP_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET` |
| Zalo (`zca-js`) | Task assignment chat | `ZALO_WORKER_URL`, `ZALO_WORKER_INTERNAL_TOKEN` (Node sidecar) |
| n8n | Meeting summary webhook | `N8N_WEBHOOK_SECRET` (header `X-N8N-Webhook-Secret`) |
| Supabase | PostgreSQL cloud (dev) | `DATABASE_URL` (session pooler TLS) |

---

## 9. Deployment

### 9.1 Infrastructure

- Self-hosted runner (label: `[self-hosted, security]`).
- PostgreSQL trên Supabase (VPN/WARP required cho prod, không cần cho dev vì dùng Supabase Cloud).
- Docker bridge MTU: 1420 (tương thích VPN encapsulation).
- Backend chỉ expose trên `127.0.0.1` (không public trực tiếp).
- Nginx gateway xử lý traffic bên ngoài (`deploy/dev-gateway.conf`).
- Named volumes: `backend_uploads` (file upload), `zalo-worker-artifacts` (Zalo session).

### 9.2 Environments

| Env | Trigger | Compose file | Brands | Host ports |
|---|---|---|---|---|
| Local dev | `docker compose up -d` | `docker-compose.yml` (root) | 1 brand theo `PORTAL_BRAND` | `3000` (FE) / `8000` (BE) |
| Dev (CI/CD) | Push to `dev` branch | `deploy/security-dev.compose.yml` | markee (single) | `3100` (nginx) |
| Prod (CI/CD) | Manual `workflow_dispatch` keyword "DEPLOY" | `deploy/security-prod.compose.yml` | securityzone + markee (dual) | `3000` (securityzone) / `3300` (markee) |

### 9.3 CI/CD Flow (GitHub Actions)

1. rsync code to target (excluding `.git`, `.env`, `secrets`, `backups`).
2. Copy compose file phù hợp.
3. Run `docker compose run --rm --no-deps backend python -c "from app.main import run_startup_once; run_startup_once()"` để áp dụng `apply_schema_updates()` + `init_db_defaults()`.
4. `docker compose build …` + `docker compose up -d`.
5. Health gate (timeout 180s).

### 9.4 Production targets

```
Dev:     /home/webpm/kpi-dev             → nginx :3100 (markee)
Prod:    /home/portalkpi/website_PM       → FE :3000 (securityzone) + :3300 (markee)
```

---

## 10. Biến môi trường chính (.env)

| Biến | Mô tả | Mặc định |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Supabase session pooler + TLS) | required |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` / `DB_POOL_TIMEOUT` | SQLAlchemy pool sizing | 3 / 2 / 30 |
| `RUN_DB_STARTUP_ON_IMPORT` | Chạy `run_startup_once()` khi import `app.main` | `false` (CI/CD chạy explicit) |
| `SECRET_KEY` | JWT signing key | required (random 64 hex) |
| `ALGORITHM` | JWT alg | `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Access token TTL | 30 |
| `REFRESH_TOKEN_EXPIRE_DAYS` | Refresh token TTL | 20 |
| `REFRESH_COOKIE_NAME` / `REFRESH_COOKIE_SECURE` | HttpOnly cookie | `portal_refresh` / `true` |
| `INTERNAL_SYNC_TOKEN` | Shared secret giữa backend ↔ zalo-worker | required |
| `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD` | Bootstrap admin khi DB trống | `admin@company.com` / rỗng |
| `GOOGLE_LOGIN_ENABLED` | Bật Google login | `true` |
| `PASSWORD_LOGIN_ENABLED` | Bật OAuth2 password login (default tắt) | `false` |
| `OUTLOOK_LOGIN_ENABLED` / `OUTLOOK_CLIENT_ID` / `OUTLOOK_TENANT_ID` | Microsoft login | `false` |
| `AUTH_SUPERADMIN_EMAILS` | Comma-separated email auto-promote lên super_admin | required |
| `PORTAL_BRAND` / `FRONTEND_PORT` | Brand build-time + host port | `markee` / `3000` |
| `NEXT_PUBLIC_API_BASE_URL` | Frontend axios baseURL | `/api` |
| `FRONTEND_URL` | OAuth callback host | `http://localhost:3000` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` / `GOOGLE_APPLICATION_CREDENTIALS` | Google OAuth | — |
| `ZOOM_ACCOUNT_ID` / `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET` | Zoom S2S OAuth | — |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` / `AI_TIMEOUT_SECONDS` / `CHECK_INTERVAL_SECONDS` | AI integration (OpenAI-compatible hoặc Gemini) | `gemini-2.5-flash` / 60 / 3600 |
| `ASSEMBLYAI_API_KEY` | Speech-to-text | — |
| `N8N_WEBHOOK_SECRET` | n8n meeting-summary webhook | — |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` / `TELEGRAM_GROUP_CHAT_ID` / `TELEGRAM_MESSAGE_THREAD_ID` / `TELEGRAM_BOT_USERNAME` / `APP_BASE_URL` | Telegram notifications | — |
| `ZALO_WORKER_URL` / `ZALO_WORKER_INTERNAL_TOKEN` | Zalo worker sidecar (default `http://zalo-worker:8090`) | — |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Supabase HTTP API (nếu feature gọi trực tiếp) | — |
| `DOCKER_NETWORK_MTU` | Bridge MTU | 1420 |
| `REDIS_URL` | (legacy — không dùng trong stack hiện tại) | rỗng |