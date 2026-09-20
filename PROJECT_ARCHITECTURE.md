# 📋 Task Compliance Portal — Kiến trúc dự án

> **Version:** 5.0.0 (`FastAPI(title="Task Compliance Portal", version="5.0.0")`) · **Team:** SecurityZone · **Stack:** FastAPI + Next.js + PostgreSQL + AI · **Brands:** Markee / SecurityZone · **Roles:** `super_admin` / `leader` / `member` / `viewer` · **Workspaces:** `infra` (INFRA) / `dev` (DEV)

---

## 1. Tổng quan

Hệ thống **Task Compliance Portal** (KPI Portal) quản lý và theo dõi tiến độ dự án theo cấu trúc 4 cấp (Project → Phase → TaskGroup → Task), tính toán chỉ số hiệu suất KPI, đánh giá sức khỏe dự án bằng AI, hỗ trợ đồng bộ/tóm tắt biên bản họp (Zoom & Google Meet) với **Meeting Intelligence** (prep → execution → result → followthrough → feedback), **Personal Calendar** gắn Task lên lịch cá nhân, **Multi-team Project Comparison (Team Load)** + **KPI Matrix**, quản lý **Project Prototype** + **WIP log** + **public share-link** cho khách hàng xem, **Zalo group summary** (digest theo lịch), quản lý yêu cầu vắng mặt (Leave Request), đăng ký suất ăn trưa, tích hợp giao tiếp Telegram + **Zalo (2 mode)** + **meeting-host-bot** Chrome extension, và lưu vết thao tác (System Audit). Hệ thống hỗ trợ multi-brand deployment (Markee / SecurityZone) và phân quyền theo Workspace (INFRA / DEV) với **System Audit** dành cho `super_admin` (full) và `leader` (scope theo Workspace được cấp qua `user_workspace_access`).

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
       │                       │     │  (Calendar/Drive│
       │                       │     │  /Meet)         │
       │                       │     └─────────────────┘
       │                       │     ┌─────────────────┐
       │                       └────▶│  Zoom APIs      │
       │                             │  (S2S OAuth)    │
       │                             └─────────────────┘
       │                             ┌─────────────────┐
       └────────────────────────────▶│  meeting-host-bot│
                                     │  Chrome ext.     │
                                     └─────────────────┘
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
| `frontend` | Next.js 14 (standalone, multi-brand via `NEXT_PUBLIC_PORTAL_BRAND`) | 3000 (local) / 3100 (dev nginx) / 3000+3300 (prod) | default |
| `zalo-worker` | Persistent Node.js sidecar giữ `zca-js` session cho **Zalo — Task Assignment** (cookie login, gửi / nhận tin nhắn thời gian thực) | 8090 (internal) | default |
| `zalo-crawler` | QR-login crawler, AI trích task từ Zalo (1 chiều, không lưu session) | — | `crawler` |
| `meeting-host-bot` | Chrome extension (host side) — record audio + drive upload cho Meeting | — | (browser, không thuộc compose) |

---

## 2. Cấu trúc thư mục

```
pm-new/
├── .env                          # Biến môi trường (DB, AI keys, Zoom, Google, Outlook, Telegram, Zalo, Zalo summary, extension)
├── .env.example                  # Mẫu cấu hình môi trường
├── docker-compose.yml            # Orchestration local dev (Frontend + Backend + zalo-worker; zalo-crawler gated by profile `crawler`)
├── deploy.sh                     # Script deploy thủ công local (down + no-cache build + up — `git pull origin main`)
├── init-db.sql                   # File dữ liệu khởi tạo database PostgreSQL (legacy first-boot snapshot, KHÔNG còn dùng để khởi tạo — chỉ tham chiếu lịch sử)
├── DESIGN.md                     # Design tokens (màu, typography, status) — nguồn cho build-design.js
├── PROJECT_ARCHITECTURE.md       # File này
├── DEVELOPMENT.md                # Hướng dẫn phát triển local
├── GIT_WORKFLOW.md               # Quy trình làm việc với Git
├── MEETING_INTELLIGENCE.md       # Tài liệu module Meeting
├── members-light.json            # Dump thành viên rút gọn (tham chiếu)
├── zalo-automation-tho.json      # Cấu hình automation zalo-crawler (tham chiếu)
│
├── deploy/                       # ===== DEPLOYMENT (CI/CD compose files) =====
│   ├── security-dev.compose.yml  # Dev: single brand (markee) + nginx gateway (port 3100) + zalo-worker sidecar
│   ├── security-prod.compose.yml # Prod: dual brand (securityzone :3000, markee :3300) + zalo-worker sidecar (zalo-crawler KHÔNG chạy ở prod)
│   └── dev-gateway.conf          # Nginx reverse proxy config
│
├── extensions/                   # ===== CHROME EXTENSIONS =====
│   ├── zalo-login/               # Zalo login extension (build thành frontend/public/zalo-login-extension.zip qua npm run extension:build) — Phase 1 cookie import
│   └── meeting-host-bot/         # Meeting host-bot Chrome extension (record audio → Drive upload cho `/api/meeting-bot/queue|ended|drive-token`)
│
├── .github/workflows/            # ===== CI/CD =====
│   ├── deploy-dev.yml            # Auto deploy on push to dev branch (build backend + frontend_markee + zalo-worker + nginx gateway)
│   └── deploy-production.yml     # Manual deploy với confirmation keyword "DEPLOY" (dual-brand)
│
├── prompts/                      # ===== TASK PROMPTS =====
│   └── project.md                # Task spec cho System Audit (Sections 2/3/4 — team / member / multi-team comparison)
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
│   ├── migrate_display_names.py  # Backfill display_name cho users/members cũ
│   ├── migrate_parent_remark.py  # Backfill parent_remark cho performance_settings
│   ├── parse_xlsx_to_db.py       # Import dữ liệu từ Excel
│   ├── export_real_data.py       # Export dữ liệu thật
│   ├── grant_google_access.py    # Script grant Google access cho tài khoản
│   ├── seed_workspace_demo.py    # Seed workspace demo data
│   ├── sync_members.py           # Đồng bộ thành viên
│   ├── sync_all_accepted_candidates.py  # Đồng bộ ứng viên đã accept từ Recruitment
│   ├── Skill_Master_From_Sheet.xlsx # Nguồn Excel cho Skill taxonomy 3 cấp
│   └── app/
│       ├── __init__.py
│       ├── main.py               # FastAPI entry point, `run_startup_once()` (create_all + apply_schema_updates + init_db_defaults) + 3 background loops (auto-sync ended meetings / zalo summary / meeting reminders)
│       ├── config.py             # Pydantic Settings (đọc .env)
│       ├── database.py           # SQLAlchemy engine & session maker (PostgreSQL) + BackgroundSessionLocal
│       │
│       ├── models/               # ===== ORM Models (SQLAlchemy) =====
│       │   ├── user.py                # users (auth + role + data_scope + member_id FK + outlook_sub + google_sub + telegram_chat_id + avatar_url)
│       │   ├── member.py              # members + leader_member_id self-FK + leader_name legacy + cv_link + zalo_name + zalo_uid + is_recruitment_synced + employment_status
│       │   ├── workspace_access.py    # user_workspace_access (multi-Workspace grants cho Leaders, is_primary flag)
│       │   ├── project.py             # projects + project_members_v2 + Platform (AI status, customer_id, sales_id, business, share_token, last_activity_at)
│       │   ├── phase.py               # phases (Giai đoạn của dự án + AI status)
│       │   ├── task_group.py          # task_groups (assigned_ids/support_ids JSON arrays)
│       │   ├── task.py                # tasks_v2 (Công việc chi tiết + KPI columns + AI status + review workflow + is_blocked workflow + scheduled_at + zalo_demo_skip + skill_solution_id + skill_vendor_id)
│       │   ├── system_category.py     # teams / positions / departments / task_priorities / task_statuses / customers (+business_unit) / Workspace
│       │   ├── master_phase.py        # master_phases (single source of truth cho Project Progress + progress_pct)
│       │   ├── skill_master.py        # categories → groups → skills (3-level taxonomy)
│       │   ├── performance_setting.py # performance_settings (Cấu hình KPI thưởng/phạt + remark_type + description + parent_remark)
│       │   ├── workload_setting.py    # workload_settings (configurable thresholds cho Section 4 Not working/Capacity/Normal/Overload)
│       │   ├── meeting.py             # meetings + prep + AI summary + scoring columns + reminder + n8n notify tracking + soft delete + google_event_id + organizer_google_email
│       │   ├── meeting_project.py     # meeting ↔ project junction
│       │   ├── meeting_attendance.py  # Meeting attendance (Google bot API + manual)
│       │   ├── meeting_feedback.py    # meeting effectiveness per-attendee feedback
│       │   ├── ai_review.py           # ai_prompts + ai_review_logs (AI đánh giá dự án / phase / task)
│       │   ├── ai_skill.py            # AI Skills (Skill Solutions + Skill Vendors cho Task assignment)
│       │   ├── ai_task_inbox.py       # chat_ai_tasks (AI xử lý yêu cầu Inbox + meeting_id + zalo link)
│       │   ├── google_token.py        # google_tokens (OAuth Google tokens per user — legacy)
│       │   ├── workspace_google_account.py  # workspace-scoped Google OAuth override (per Workspace)
│       │   ├── refresh_token.py       # refresh_tokens (HttpOnly cookie sessions, SHA-256 hashed)
│       │   ├── notification.py        # notifications (recipient/sender/task_id/task_group_id/project_id/zalo_conversation_id)
│       │   ├── telegram_connection.py # telegram_connections (short-lived link tokens)
│       │   ├── zalo.py                # zalo_accounts + zalo_conversations + zalo_messages + zalo_demo_requests + zalo_conversation_summaries
│       │   ├── leave_request.py       # leave_requests (Đơn xin nghỉ / WFH / công tác)
│       │   ├── lunch_record.py        # lunch_records (Đăng ký suất ăn trưa)
│       │   ├── project_template.py    # project_templates + phases/task_groups/tasks (Mẫu dự án + skill_solution_id + skill_vendor_id)
│       │   ├── project_feature.py     # project_features + project_feature_logs (KPI Prototype + WIP log + attachments + share_token linking)
│       │   ├── document.py            # project_documents (file đính kèm dự án + synced_from_task_link)
│       │   ├── review_checklist.py    # review_checklist_items (Task Review checklist)
│       │   ├── audit_log.py           # audit_logs (Lưu vết thao tác toàn hệ thống — severity/ip_risk/snapshot_json/correlation_id/...)
│       │   └── setting.py             # settings (cấu hình runtime)
│       │
│       ├── routers/               # ===== API Routers (FastAPI) =====
│       │   ├── auth.py                 # POST /api/auth/login (OAuth2 form, mặc định tắt) + /google + /outlook + /refresh + /logout + GET /config
│       │   ├── users.py                # /api/users (profile người dùng hiện tại + avatar upload)
│       │   ├── accounts.py             # /api/accounts (admin CRUD tài khoản + workspace_ids + primary-workspace + reset-password/lock/unlock/delete)
│       │   ├── projects.py             # /api/projects (+ pin/sidebar-tree/audit-logs/audit-logs/export/recent-activity/chat-groups/platforms/bulk-delete)
│       │   ├── project_features.py     # /api/projects/{id}/features + feature-logs (+ attachments + push-tasks + ai-tasks + share-link)
│       │   ├── project_templates.py    # /api/project-templates (CRUD templates)
│       │   ├── project_documents.py    # /api/projects/{id}/documents (upload + categories + approve/reject/star/file/history)
│       │   ├── task_groups.py          # /api/task-groups + /api/tasks + /api/all-tasks-global + /api/all-tasks-global/summary
│       │   ├── settings_router.py      # /api/settings (platforms, statuses…)
│       │   ├── skills.py               # /api/skills (categories → groups → skills)
│       │   ├── system_categories.py    # /api/system-categories (positions, departments, teams, customers, workspaces, master-phases)
│       │   ├── system_audit.py         # /api/system-audit (super_admin + leader — stats/logs/analytics/team-comparison/team-detail/export/session-timeline, scope enforced via audit_log_query_for_user)
│       │   ├── members.py              # /api/members (CRUD + kpi-summary + workspace-roles + workspace-leaders + sync-candidate + sync-from-recruitment + meta/teams + meta/leaders)
│       │   ├── meetings.py             # /api/meetings (CRUD + Google/Zoom sync + n8n webhook + scoring + transcript + attendance + push-tasks + insights/hosts/attendance-summary/feedback/recalculate-score/generate-ai-content/manual-ended)
│       │   ├── meeting_bot.py          # /api/meeting-bot (queue + ended + drive-token — Chrome extension)
│       │   ├── performance_settings.py # /api/performance-settings
│       │   ├── workload_settings.py    # /api/workload-settings (Super Admin)
│       │   ├── ai_review.py            # /api/ai-review + /api/projects/{id}/ai-review + /ai-review/history + /ai-review/logs/{id} + /ai-prompts
│       │   ├── ai_skills.py            # /api/ai-skills (AI Skill Solutions/Vendors + favorites + recents + attachments)
│       │   ├── ai_sessions.py          # /api/ai-sessions + /ai-usage-stats
│       │   ├── chat_ai.py              # /api/projects/{id}/ai-task-inbox (+ analyze/import/bulk-import/sync + chat-sync-logs) + /api/chat/{telegram-webhook,zalo-webhook,zalo-status}
│       │   ├── leave_requests.py       # /api/leave-requests
│       │   ├── lunch.py                # /api/lunch + /api/lunch/monthly-summary
│       │   ├── notifications.py        # /api/notifications + /my-alerts + /remind + /remind-bulk + /remind-group + /inbox + /{id}/read
│       │   ├── telegram.py             # /api/telegram (connect / disconnect / status / webhook)
│       │   ├── zalo.py                 # /api/zalo (status / auth / disconnect / conversations / create-task / send / messages / link-project / refresh-names)
│       │   ├── calendar.py             # /api/calendar (tasks + meetings + project-colors cho Personal Calendar)
│       │   └── public_share.py         # /api/projects/share/{token} (token-based public project view + features + logs)
│       │
│       ├── services/              # ===== Business Services =====
│       │   ├── ai_client.py             # OpenAI-compatible / Gemini client wrapper
│       │   ├── document_storage.py      # Project document upload/storage backend
│       │   ├── meeting_sync.py          # Zoom S2S, Google Calendar, AssemblyAI, AI Summary, retry_pending_n8n_notifies, _save_workspace_google_tokens
│       │   ├── meeting_reminders.py     # dispatch_due_reminders (pre-start) + dispatch_start_link_notifications (at-start)
│       │   ├── meeting_score_engine.py  # Meeting effectiveness scoring (prep/exec/result/followthrough/feedback → total)
│       │   ├── project_feature_ai.py    # AI summary + AI tasks generation cho project feature logs
│       │   ├── telegram.py              # Telegram bot integration
│       │   ├── zalo.py                  # Zalo worker bridge (zca-js)
│       │   ├── zalo_task_parser.py      # AI parse task from Zalo message (zalo-crawler webhook)
│       │   └── zalo_summary.py          # Daily Zalo group digest (executive summary / decisions / recommended_tasks / issues / next_steps)
│       │
│       └── utils/                 # ===== Cross-cutting utils =====
│           ├── auth.py                  # JWT HS256, bcrypt password, deps: require_super_admin / require_manager / require_manager_write / require_route_project_access / require_zalo_user / require_skill_creator / require_audit_user + legacy require_admin / require_admin_write
│           ├── access.py                # Data scope authorization (per-project / per-member / per-customer) + workspace_leader_names + audit_log_query_for_user
│           ├── audit_service.py         # Helper ghi AuditService.record(...)
│           ├── kpi_engine.py            # Công thức & quy trình tính toán KPI (Base / Perform / OT / Split)
│           ├── project_progress.py      # Project progress % từ master_phases.progress_pct + task completion
│           ├── skill_validation.py      # Skill taxonomy validation
│           └── timezone.py              # Asia/Ho_Chi_Minh helper
│
├── services/                     # ===== SIDECAR SERVICES (Node.js) =====
│   ├── zalo-worker/               # Persistent zca-js session sidecar (port 8090, persistent volume zalo-worker-artifacts)
│   └── zalo-crawler/              # QR-login crawler (profile-gated; AI task extraction)
│
└── frontend/                     # ===== FRONTEND (Next.js 14 - TypeScript) =====
    ├── Dockerfile                # Node 20 alpine, multi-stage, output: "standalone"
    ├── package.json              # Dependencies (next, react, @tanstack/react-query, axios, tailwindcss, recharts, @azure/msal-browser, react-datepicker, lucide-react, @dnd-kit, date-fns, react-markdown, csv-parser)
    ├── next.config.js            # Next.js config + proxy rewrite /api → BACKEND_INTERNAL_URL
    ├── tailwind.config.js        # TailwindCSS config + custom theme (load từ tailwind.theme.json)
    ├── tailwind.theme.json       # Theme tokens (colors, fonts) — single source of truth cho build-design.js
    ├── DESIGN.md                 # Mirror của root DESIGN.md (để build-design.js đọc trong container)
    ├── tsconfig.json             # TypeScript config
    ├── scripts/                  # Build-time scripts (chạy qua predev/prebuild hooks)
    │   ├── build-design.js       # Sinh ra globals.css + tailwind theme từ DESIGN.md/tailwind.theme.json
    │   ├── build-extension-zip.js # Đóng Chrome extension (zalo-login) thành public/zalo-login-extension.zip
    │   ├── generate-location.ts  # Sinh dữ liệu location.ts từ csv
    │   └── zip-utils.js
    │
    └── src/
        ├── lib/
        │   ├── api.ts                  # Axios instance + TẤT CẢ API functions gọi backend (typed) + restoreSession()
        │   ├── auth.ts                 # Token helpers (localStorage) + isSuperAdmin/isLeader/isMember/isViewer/isAdmin (back-compat = isAdmin→super_admin|leader)
        │   ├── brand.ts                # Multi-brand config (markee / securityzone) — logo, name, footer
        │   ├── leave-request.ts        # Types và utils cho leave request
        │   ├── location.ts             # Dữ liệu tỉnh thành Việt Nam (generated từ csv)
        │   ├── msal.ts                 # Azure MSAL PublicClientApp cho Outlook login
        │   ├── business-date.ts        # Helper ngày tháng theo workspace business date
        │   ├── sidebarCollapse.tsx     # Shared SidebarCollapseProvider (context + localStorage)
        │   ├── workspaceFilter.tsx     # Shared WorkspaceFilterProvider (context + localStorage key 'selected_workspace_code')
        │   └── zaloExtension.ts        # Helper giao tiếp với zalo-login Chrome extension
        │
        ├── components/
        │   ├── Navbar.tsx              # Sidebar navigation + WorkspaceSwitcher + sidebar collapse toggle
        │   ├── Portal.tsx              # Portal container
        │   ├── KPIsView.tsx            # Quản lý cấu hình KPI thưởng/phạt
        │   ├── WorkloadSettingsView.tsx# Quản lý thresholds cho Section 4 workload
        │   ├── MembersView.tsx         # Quản lý danh sách thành viên
        │   ├── SystemCategoriesView.tsx# Quản lý danh mục hệ thống
        │   ├── AIPromptsView.tsx       # Cấu hình AI prompts
        │   ├── AIReviewDrawer.tsx      # Panel hiển thị kết quả AI review (legacy component)
        │   ├── AIReviewPanel.tsx       # Panel hiển thị kết quả AI review (active, dùng chung cho project/phase/task)
        │   ├── SystemAuditView.tsx     # Audit Logs view (orphaned)
        │   ├── AuditLogsTab.tsx        # Audit Logs tab component (active)
        │   ├── ProjectTemplatesView.tsx# Quản lý Project Templates
        │   ├── ProjectPrototypeTab.tsx # Tab "KPI Prototype" + WIP log + attachments + push-tasks
        │   ├── ProjectZaloSummaryTab.tsx # Tab Zalo group digest (executive summary / decisions / recommended tasks / issues / next steps)
        │   ├── ExportProjectTemplateModal.tsx # Modal export project template
        │   ├── CustomersProjectsView.tsx# Quản lý Customers và Dự án
        │   ├── ProjectListContent.tsx  # Project list rendering + filters
        │   ├── ProjectFormModal.tsx    # Project create/edit modal
        │   ├── ProjectDocumentsTab.tsx # Project documents tab (upload + list + approve/reject/star)
        │   ├── LinkChipsEditor.tsx     # Editor danh sách link chips cho Project
        │   ├── WipLogDetailModal.tsx   # Modal chi tiết WIP log
        │   ├── meetings/               # Components cuộc họp (Create, Card, Summarize, PromptSettings, Detail, Guide, Playbook, Attendance, Score Explainer)
        │   ├── leave-request/          # Components vắng mặt (LeaveRequestForm, StatusBadge, SummaryCard)
        │   ├── common/                 # Shared utilities (SearchableSelect, PhaseTaskGroupSelect)
        │   ├── calendar/               # Personal Calendar components (CalendarGrid, CalendarToolbar, MonthGrid, QuickCreateDrawer, SummaryCards, TaskBlock, MeetingBlock, dateUtils, colorPalette)
        │   ├── tasks/                  # Task-specific drawer (TaskEditDrawer)
        │   ├── zalo/                   # Zalo components (ZaloConversationPane, ZaloSummaryCard)
        │   └── dashboard/              # Dashboard-specific components
        │       ├── KpiCard.tsx         # Single-number KPI tile
        │       ├── ProgressBar.tsx     # Tailwind bar 0-100
        │       ├── BarChartCard.tsx    # Recharts bar chart wrapper
        │       ├── LineChartCard.tsx   # Recharts line chart wrapper
        │       ├── PieChartCard.tsx    # Recharts pie chart wrapper
        │       ├── MemberTaskAlerts.tsx# Member-side overdue/pending alerts
        │       ├── MemberDetailModal.tsx # Member detail modal (skill area / project breakdown, per Workspace scope)
        │       ├── MemberKpiMatrix.tsx  # KPI Matrix table (monthly KPI per member)
        │       ├── MultiTeamProjectComparison.tsx # Team Load — multi-team project comparison
        │       ├── FormulaTooltip.tsx  # Tooltip giải thích công thức KPI
        │       └── Icons.tsx           # SvgIcon — switch on name (tasks / user / chart / alert / project …)
        │
        └── app/
            ├── layout.tsx              # Root layout (mounts Providers)
            ├── page.tsx                # Trang chủ (redirect → login/dashboard)
            ├── globals.css             # CSS toàn cục
            ├── providers.tsx           # React Query + WorkspaceFilterProvider + SidebarCollapseProvider + SessionBootstrap
            ├── login/                  # Trang đăng nhập (Google + Outlook)
            ├── dashboard/
            │   ├── layout.tsx          # Dashboard layout (6 tabs: report / overview / calendar / system-audit / kpi-matrix / team-load)
            │   ├── constants.ts        # projectStatusBadge / projectBarColor / calculateDaysLate
            │   ├── page.tsx            # Dashboard root (redirect to /dashboard/overview)
            │   ├── report/page.tsx     # Tab 1 — KPI report
            │   ├── overview/page.tsx   # Tab 2 — Project overview (Leader Cards + Workload)
            │   ├── calendar/page.tsx   # Tab 3 — Personal Calendar (Tasks + Meetings + project-colors)
            │   ├── system-audit/page.tsx # Tab 4 — System Audit (super_admin + leader)
            │   │   - Section 1: 4 hero KPI cards + Project progress + Phase Distribution + Risk + KPI distribution
            │   │   - Section 2: Team comparison (per-Leader table)
            │   │   - Section 3: Project comparison by team
            │   │   - Section 4: Member comparison (Overload / Balanced / Available) — dùng workload_settings thresholds
            │   │   - Audit Logs table (filterable by module)
            │   ├── kpi-matrix/page.tsx # Tab 5 — KPI Matrix (monthly KPI per member × leader, super_admin + leader)
            │   └── team-load/page.tsx  # Tab 6 — Team Load (multi-team project comparison, super_admin + leader)
            ├── project/
            │   └── detail/              # Chi tiết dự án (4-level spreadsheet + phases + tasks + KPIs + documents + Prototype tab + Zalo summary tab)
            ├── project-hub/             # Project Hub (centralized project view + filters; pagination + member break-down)
            │   └── [code]/              # Project Hub view scoped theo workspace code (dynamic route)
            ├── customers/               # Quản lý khách hàng
            ├── meetings/                # Quản lý cuộc họp
            ├── leave-request/
            │   ├── new/                 # Tạo đơn mới
            │   ├── check-lunch/         # Trang check đăng ký suất ăn trưa của tôi
            │   └── calendar-team/       # Lịch vắng mặt team
            ├── settings/                # Cài đặt hệ thống (categories, skills, platforms, KPIs, AI, workload)
            ├── accounts/                # Quản lý tài khoản (Super Admin only)
            ├── kpi/                     # Bảng theo dõi và đánh giá KPI
            ├── profile/                 # User profile page
            ├── zalo-account/            # Zalo account connect/disconnect UI (link / portal) — mỗi user có account riêng
            ├── share/                   # Public (no-auth) share routes
            │   └── project/[token]/     # Token-based public project view (cho khách hàng xem prototype + WIP log, dùng public_share router)
            └── api/                     # Next.js API Routes (proxy to backend)
                ├── ai/settings/
                ├── ai/summarize/
                ├── extension/ai-tracker/version/  # Extension auto-update version checker (gọi backend `/api/extension/ai-tracker/version`)
                ├── health/
                └── meetings/[id]/
```

---

## 3. Backend API

### 3.1 Framework & Dependencies

`backend/requirements.txt`:

- **FastAPI** 0.111.0 + **Uvicorn** 0.29.0 (`[standard]` → websockets / watchgod)
- **SQLAlchemy** 2.0.30 + **psycopg2-binary** (PostgreSQL driver)
- **python-jose[cryptography]** 3.3.0 (JWT HS256) + **passlib[bcrypt]** 1.7.4 + **bcrypt** 4.1.3
- **python-dotenv** 1.0.1
- **pydantic-settings** 2.2.1
- **google-auth** 2.29.0, **google-auth-httplib2** 0.2.0, **google-api-python-client** 2.127.0, **google-auth-oauthlib** 1.2.0 (Google APIs — Calendar / Drive / Meet / OAuth)
- **python-multipart** 0.0.9 (OAuth2 form + multipart uploads)
- **requests** 2.31.0 (external API calls: Zoom / Google / Telegram / AssemblyAI / AI / n8n)
- **openpyxl** (Excel import for Skill Master — seeded khi DB rỗng)

### 3.2 API Routes

Mọi router được mount trong `app/main.py` qua `app.include_router(<router>, prefix="/api/...")`. Một số router có `prefix="/api"` + sub-`@router.get("")` để gom full path (vd. `projects`, `task_groups`, `ai_review`...). Một số endpoint **public** đặt thẳng trong `app/main.py`: `/health` + `/api/health`, `/api/extension/ai-tracker/version`, `/api/meetings/webhook/n8n-summary`, `/api/meetings/google/auth-direct`, `/api/meetings/google/callback`.

| Prefix | Router | Mô tả | Auth gate |
|---|---|---|---|
| `POST /api/auth/login` | `auth.py` | Đăng nhập OAuth2 Password (mặc định tắt) | public |
| `POST /api/auth/google` | `auth.py` | Google Identity Services (GIS) login (legacy alias: `/google`) | public |
| `POST /api/auth/outlook` | `auth.py` | Microsoft (Outlook / Entra) login (MSAL) | public |
| `POST /api/auth/refresh` | `auth.py` | Xác thực refresh session (HttpOnly cookie) + trả access JWT mới | refresh cookie |
| `POST /api/auth/logout` | `auth.py` | Revoke refresh session | user |
| `GET /api/auth/config` | `auth.py` | Login UI config (Google/Outlook enabled, brand) | public |
| `GET /api/users/me` | `users.py` | Profile người dùng hiện tại (kèm permissions) | user |
| `POST /api/users/avatar` | `users.py` | Upload avatar (cookie upload) | user |
| `GET/POST/PUT/DELETE /api/accounts*` | `accounts.py` | CRUD tài khoản (create, lock, unlock, reset password, delete, available-members, primary-workspace, workspace_ids) | super_admin |
| `GET/POST /api/projects*` (+ `PATCH`, `DELETE`) | `projects.py` | CRUD dự án + pin/sidebar-tree/audit-logs/audit-logs/export/recent-activity + phases (CRUD + reorder/move) + project_members (CRUD) + chat-groups (CRUD) + links + platforms + bulk-delete | `require_route_project_access` |
| `GET/POST/PUT/DELETE /api/projects/{id}/documents*` | `project_documents.py` | Documents upload/list/categories/approve/reject/star/file/history | `require_route_project_access` |
| `GET/POST/PUT/DELETE /api/projects/{id}/features*` | `project_features.py` | KPI Prototype — features + feature-logs + attachments + ai-tasks + push-tasks | `require_route_project_access` |
| `POST /api/projects/{id}/share-link` | `project_features.py` | Mint public share token cho project view | `require_route_project_access` |
| `GET/POST/PUT/DELETE /api/project-templates*` | `project_templates.py` | Project templates CRUD | user |
| `GET/POST/PUT/DELETE /api/task-groups*` + `/api/tasks*` | `task_groups.py` | Task groups + tasks CRUD + bulk + gantt + Review checklist | `require_route_project_access` |
| `GET /api/all-tasks-global` | `task_groups.py` | All tasks flat dump (dashboard) | leader+ |
| `GET /api/all-tasks-global/summary` | `task_groups.py` | Global per-status / per-member / per-project aggregations | leader+ |
| `GET /api/settings/*` | `settings_router.py` | platforms / statuses / categories config | admin |
| `GET/POST/PUT/DELETE /api/skills/*` (incl. `/groups`, `/skills` create-only qua require_skill_creator) | `skills.py` | categories → groups → skills CRUD + Excel import | admin (create-only allow leader/member) |
| `GET/POST/PUT/DELETE /api/system-categories/*` | `system_categories.py` | positions, departments, teams, customers, workspaces, master-phases CRUD | admin |
| `GET /api/system-audit/*` (stats / logs / analytics / export / export-json / session-timeline / team-comparison / team-detail) | `system_audit.py` | **super_admin + leader** — stats, logs (filterable), analytics, CSV/JSON export, team-comparison, team-detail, session timeline. Workspace scope enforced per-endpoint via `audit_log_query_for_user`. | `require_audit_user` (= super_admin OR leader) |
| `GET/POST/PUT/DELETE /api/members*` (+ workspace-roles, workspace-leaders, kpi-summary, sync-candidate, sync-from-recruitment, account-prefill) | `members.py` | Thành viên CRUD + KPI + meta/leaders + workspace-leaders + sync-candidate + sync-from-recruitment + employment_status | user (write qua `require_manager_write`) |
| `GET/POST/PUT/DELETE /api/meetings*` (+ `/generate-link`, `/check-conflict`, `/insights`, `/hosts`, `/attendance-summary`, `/{id}/{transcript,attendance,members,sync,push-tasks,recalculate-score,feedback,manual-ended}`) | `meetings.py` | Meetings + Google/Zoom sync + n8n webhook + scoring + attendance + push-tasks | `require_route_project_access` |
| `GET /api/meetings/google/{status,auth}` | `meetings.py` | Google OAuth status / initiate auth | user |
| `GET /api/meetings/google/auth-direct` | `main.py` | Public Google OAuth kickoff (legacy) | public |
| `GET /api/meetings/google/callback` | `main.py` | Public OAuth callback → save token (per-user hoặc per-Workspace qua `state=user_id:workspace_id`) | public |
| `POST /api/meetings/generate-ai-content` | `meetings.py` | AI generate lại prep/followthrough | user |
| `GET/POST /api/meeting-bot/{queue,ended,drive-token}` | `meeting_bot.py` | meeting-host-bot Chrome extension handshake + Drive upload | `require_zalo_user` pattern (host bot auth) |
| `GET/POST/PUT/DELETE /api/performance-settings*` | `performance_settings.py` | KPI thresholds CRUD (parent/child) | `require_manager_write` |
| `GET/POST/PUT/DELETE /api/workload-settings*` | `workload_settings.py` | Workload thresholds (Section 4 buckets) | `require_super_admin` |
| `GET/POST /api/ai-review/*` (incl. `/check`, `/history`, `/logs/{id}`, `/prompts`, `/projects/{id}/ai-review`) | `ai_review.py` | AI review dự án / phase / task + prompt management | `require_manager_write` (prompts) |
| `GET/POST/PATCH/DELETE /api/ai-skills*` (incl. `/{id}/{favorite,recent,attachments/{idx}}`) | `ai_skills.py` | AI Skill Solutions/Vendors marketplace | user |
| `POST /api/ai-sessions`, `POST /api/ai-usage-stats` | `ai_sessions.py` | AI session/usage tracking | user |
| `GET/POST/PATCH/DELETE /api/projects/{pid}/ai-task-inbox*` (+ analyze/import/bulk-import/sync + chat-sync-logs) | `chat_ai.py` | AI xử lý Task Inbox cho Project | user |
| `POST /api/chat/telegram-webhook`, `/zalo-webhook`, `GET /chat/zalo-status` | `chat_ai.py` | Inbound webhooks từ Telegram/Zalo crawler + status | public (webhook), user (status) |
| `GET/POST/PUT/DELETE /api/leave-requests*` (incl. `/{id}/approve`) | `leave_requests.py` | Đơn vắng mặt / WFH / công tác | user |
| `GET/POST /api/lunch*` (+ `/monthly-summary`, `{record_id}/delete`) | `lunch.py` | Đăng ký suất ăn trưa + monthly-summary | user (`monthly-summary`: super_admin) |
| `GET/POST /api/notifications/*` (incl. `/my-alerts`, `/remind`, `/remind-bulk`, `/remind-group`, `/inbox`, `/{id}/read`) | `notifications.py` | In-app notifications + remind actions + inbox | user |
| `GET/POST /api/telegram/*` | `telegram.py` | Telegram bot status / connect / disconnect / webhook | user |
| `GET/POST /api/zalo/*` (incl. conversations/messages/create-task/send/link-project/refresh-names) | `zalo.py` | Zalo account connect (cookie import) / conversations / messages / create-task (per-user account) | `require_zalo_user` (= super_admin/leader/member) |
| `GET /api/calendar/tasks`, `/meetings`, `/project-colors` (+ PUT) | `calendar.py` | Personal Calendar data — chỉ trả tasks của (assigned_id OR support_id) = current user | user |
| `GET /api/projects/share/{token}` (+ features, feature-logs, attachments) | `public_share.py` | Public (no-auth) share view cho khách hàng xem prototype + WIP log | public (token-gated) |
| `GET /api/extension/ai-tracker/version` | `main.py` | Extension auto-update nudge (no auth) | public |
| `POST /api/meetings/webhook/n8n-summary` | `main.py` | n8n callback ingest summary (X-N8N-Webhook-Secret) | public |
| `GET /health`, `GET /api/health` | `main.py` | `{status, version, commit, timestamp}` | public |

### 3.3 Business Logic

- **KPI Engine** (`utils/kpi_engine.py`): Tính toán hiệu suất task/taskgroup dựa trên `priority.kpi_base × manday_est` + perform bonus/penalty (remark-based, lookup `performance_settings`) + OT (`|days_late| × priority_mult`, capped at 50% of base) → split into `kpi_assigned` / `kpi_support` theo `kpi_ratio_assign/support`. Được trigger lại mỗi khi task chuyển `Done`. Per-member KPI fiscal-cycle tổng hợp ở `members.py` (`kpi_total / kpi_avg / kpi_bonus / manday_total / manday_est_total`, dùng cho `/api/members/kpi-summary` + KPI Matrix tab).
- **Access Control** (`utils/access.py`): `user_allowed_scopes`, `project_query_for_user`, `member_query_for_user`, `customer_query_for_user` lọc dữ liệu theo `data_scope` của user + `user_workspace_access`. Scope `all` xem toàn bộ; scope khác chỉ xem projects có cùng `data_scope`. `audit_log_query_for_user` thêm vào để System Audit leader chỉ thấy audit logs của workspaces họ được grant.
- **Workspace Leader Resolution** (`utils/access.py:workspace_leader_names`): Lấy Leaders khả dụng trong workspace dựa trên `user_workspace_access` (multi-grant, `is_primary`), fallback về `User.data_scope`.
- **System Audit aggregator** (`routers/system_audit.py:_aggregate_team_comparison`): Một SQL group duy nhất gom `tasks_v2` theo `assigned_id` và `support_id` → per-member `assigned_total/done/overdue/md_est/md_act/kpi` + `support_total/...` + project rollup. Eligibility: `User.role='leader' AND is_active=True AND data_scope khớp`; Leaders rỗng (0 managed Members) bị loại bỏ. Endpoint: `/api/system-audit/team-comparison?workspace=…` + `/team-detail?leader_id=…`. Workspace scope enforced cho leader qua `audit_log_query_for_user` ở `/stats` + `/logs` + `/analytics`.
- **Auth** (`utils/auth.py`): JWT HS256 (`python-jose`) + bcrypt password; helpers:
  - `require_super_admin` — chỉ `super_admin`.
  - `require_manager` — `super_admin` hoặc `leader`.
  - `require_manager_write` — GET/HEAD/OPTIONS cho mọi user active; mutation chỉ `super_admin`/`leader`.
  - `require_audit_user` — `super_admin` hoặc `leader` (System Audit).
  - `require_route_project_access` — per-route data scope check (member được write Task trong projects của họ).
  - `require_zalo_user` — `super_admin`/`leader`/`member` (viewer excluded).
  - `require_skill_creator` — `super_admin`/`leader`/`member` (create-only).
  - Legacy `require_admin` (= `require_super_admin`), `require_admin_write` (= `require_manager_write`) — giữ back-compat.
- **Refresh sessions** (`models/refresh_token.py`): Opaque SHA-256 hashed token lưu DB + HttpOnly cookie (`REFRESH_COOKIE_NAME=portal_refresh`), TTL `REFRESH_TOKEN_EXPIRE_DAYS` (mặc định 20 ngày), không rotate (Phase 1).
- **Meeting Sync** (`services/meeting_sync.py`): Đồng bộ lịch họp từ Google Calendar (per-user OAuth token hoặc per-Workspace override qua `WorkspaceGoogleAccount` với `state=user_id:workspace_id`) + Zoom (S2S OAuth), transcription qua AssemblyAI, tóm tắt bằng AI qua n8n; n8n notify status tracked qua `Meeting.n8n_notify_status` + `retry_pending_n8n_notifies` (background loop); meeting scoring engine tách riêng (`meeting_score_engine.py`).
- **Meeting Reminder Dispatch** (`services/meeting_reminders.py`): Background loop gồm 2 phase — `dispatch_due_reminders` (gửi nhắc trước `reminder_minutes`) + `dispatch_start_link_notifications` (gửi lại link meeting đúng `start_time`, track qua `Meeting.start_link_sent_at`). Cùng loop chạy mỗi 60s.
- **Meeting-bot Recorder** (`routers/meeting_bot.py`): Chrome extension `extensions/meeting-host-bot/` gọi `/api/meeting-bot/queue` (pull recordings) + `/api/meeting-bot/ended` (upload audio đã transcribe) + `/api/meeting-bot/drive-token` (lấy Drive OAuth token).
- **Zalo Summary** (`services/zalo_summary.py`): Background loop chạy daily tại `ZALO_SUMMARY_DAILY_AT` (Asia/Ho_Chi_Minh) hoặc interval `ZALO_SUMMARY_INTERVAL_SECONDS`. Mỗi tick tổng hợp các Zalo group conversation theo cửa sổ digest → lưu `zalo_conversation_summaries` với 4 section JSON: `executive_summary`, `decisions`, `recommended_tasks`, `issues`, `next_steps` — render parity với Meeting Intelligence.
- **Project Progress** (`utils/project_progress.py`): Tính % từ `master_phases.progress_pct` (single source of truth — cấu hình ở Settings → Giai đoạn dự án) + completion của tasks. `apply_schema_updates()` backfill `progress_pct` cho các master_phase cũ từ `sort_order` (idempotent).
- **Workload Settings** (`models/workload_setting.py`): 4 buckets configurable — `not_working` (KPI < 50), `capacity` (50..89.99), `normal` (90..120), `overload` (> 120.01). Super Admin CRUD ở `/api/workload-settings` và `/settings` UI. Section 4 của System Audit phân loại Member theo các ngưỡng này.
- **AI integration** (`services/ai_client.py`): OpenAI-compatible endpoint (`AI_BASE_URL`, mặc định `https://api.shopaikey.com/v1`, model `gpt-4o`) hoặc Gemini (`generativelanguage.googleapis.com/v1beta/openai`); 3 prompt types: PROJECT / PHASE / TASK; AI Skill Solutions/Vendors marketplace qua `/api/ai-skills`.
- **Zalo integration (2 mode)**:
  - `zalo-worker` (Node.js sidecar, persistent session qua volume `zalo-worker-artifacts`) bridge với backend thông qua `ZALO_WORKER_INTERNAL_TOKEN`; backend gọi worker qua HTTP để send/receive/list conversations/create-task. Mỗi `zalo_accounts` có `owner_user_id` (multi-user, mỗi leader/member có account riêng).
  - `zalo-crawler` (profile `crawler`) là QR-login AI task extraction 1 chiều — mỗi crawler instance scan 1 QR, AI parse từ Zalo message, POST lên `/api/chat/zalo-webhook`.

---

## 4. Frontend

### 4.1 Framework & Dependencies

`frontend/package.json`:

- **Next.js** 14.2.35 (App Router, `output: "standalone"`) + **React** 18 + **TypeScript** 5
- **TanStack Query** ^5.101.4 (server state, deduped cache keys)
- **Tailwind CSS** 3 + custom theme (`tailwind.theme.json` → compiled vào Tailwind qua `tailwind.config.js` qua `scripts/build-design.js`)
- **Axios** ^1.6.8 cho HTTP requests (`withCredentials: true` để gửi refresh cookie)
- **Recharts** ^3.10.1 cho charts
- **MSAL Browser** (`@azure/msal-browser` ^5.18.0) cho Microsoft (Outlook) login
- **react-datepicker** ^9.1.0 + **@types/react-datepicker** cho calendar UI (Leave Request, Quick Create Drawer)
- **@dnd-kit/core** ^6.3.1 + **@dnd-kit/utilities** ^3.2.2 cho drag-and-drop (task group detail drawer, Prototype logs)
- **date-fns** ^4.4.0 cho date formatting
- **react-markdown** ^9.0.1 + **remark-gfm** ^4.0.0 cho AI summary / chat rendering
- **csv-parser** ^3.2.1 cho Excel/CSV import
- **lucide-react** ^1.24.0 cho icons
- Font: **Work Sans** (loaded globally)
- Predev/Prebuild hooks: chạy `scripts/build-design.js` (regenerate tokens) + `scripts/build-extension-zip.js` (đóng Chrome extension zalo-login thành `public/zalo-login-extension.zip`).

### 4.2 Pages

| Route | Mô tả | Auth |
|---|---|---|
| `/login` | Đăng nhập (Google + Outlook) | public |
| `/dashboard` | Redirect → `/dashboard/overview` | user |
| `/dashboard/report` | Tab 1 — KPI report (project progress, phase distribution, risk projects, KPI distribution per Workspace) | user |
| `/dashboard/overview` | Tab 2 — Project overview + Leader Cards + Workload. **Member / Viewer được bounce về `/report`** (layout filter) | user (filtered to non-member/non-viewer) |
| `/dashboard/calendar` | Tab 3 — Personal Calendar (Tasks + Meetings + project color swatches). Chỉ hiển thị Task của `assigned_id` OR `support_id` = current user. Không có role gate (route) — server-side filter enforce. | user |
| `/dashboard/system-audit` | Tab 4 — System Audit (Sections 1–4 + Audit Logs). Member / Viewer excluded; Leader + Super Admin allowed (workspace-scope enforced server-side via `audit_log_query_for_user`) | super_admin + leader |
| `/dashboard/kpi-matrix` | Tab 5 — KPI Matrix (monthly KPI per member × leader). Member / Viewer excluded. | super_admin + leader |
| `/dashboard/team-load` | Tab 6 — Team Load (multi-team project comparison). Member / Viewer excluded; workspace-scope server-side. | super_admin + leader |
| `/project` | (Lazy redirect → `/project-hub`) | user |
| `/project-hub` | Centralized project hub (filters + list + pagination) | user |
| `/project-hub/[code]` | Project Hub view scope theo workspace code (infrastructure/dev) | user |
| `/project/detail?id=X` | Chi tiết dự án (4-level spreadsheet + phases + tasks + KPIs + documents + **Prototype tab** + **Zalo summary tab**) | user |
| `/projects/new` | Tạo dự án mới (now lives at `/project-hub` create flow) | leader+ |
| `/meetings` | Quản lý cuộc họp (CRUD + scoring + AI summary + Insight Mode + Host list + Attendance Summary + Member attendance drawer + Playbook + Guide) | user |
| `/leave-request` | Đơn vắng mặt của tôi | user |
| `/leave-request/new` | Tạo đơn mới | user |
| `/leave-request/check-lunch` | Check suất ăn trưa của tôi | user |
| `/leave-request/calendar-team` | Lịch vắng mặt team | leader+ |
| `/settings` | Cài đặt (Categories, Skills, Platforms, KPIs, AI Prompts, **Workload thresholds**) | admin |
| `/accounts` | Quản lý tài khoản (Super Admin only) | super_admin |
| `/customers` | Quản lý khách hàng | user |
| `/kpi` | Bảng theo dõi và đánh giá KPI | user |
| `/profile` | User profile + avatar | user |
| `/zalo-account` | Zalo account connect/disconnect UI (per-user, owner_user_id) | user (require_zalo_user) |
| `/share/project/[token]` | **Public** (no-auth) project view — hiển thị Prototype + WIP log + attachments + AI tasks cho khách hàng xem qua share-token (do leader mint) | public (token-gated) |

### 4.3 Workspace filter (shared) & Sidebar collapse

`useWorkspaceFilter()` (React Context trong `lib/workspaceFilter.tsx`) là filter **chia sẻ toàn cục**, được mount tại app root trong `app/providers.tsx`. Persist vào `localStorage['selected_workspace_code']`. Tất cả các trang dashboard đều đọc filter này — không bao giờ tạo filter riêng cho từng section.

`useSidebarCollapse()` (React Context trong `lib/sidebarCollapse.tsx`) điều khiển collapse/expand của Navbar sidebar; persist state qua localStorage. Mount tại app root trong `providers.tsx`.

Workspace switcher (UI) nằm trong `components/Navbar.tsx` (`WorkspaceSwitcher`).

### 4.4 Multi-brand

Biến build-time `NEXT_PUBLIC_PORTAL_BRAND` quyết định thương hiệu (`markee` | `securityzone`). Cấu hình brand (logo, tên, màu, login subtitle, footer) nằm trong `src/lib/brand.ts`.

| Brand | Tên hiển thị | Local port | Dev (CI/CD) | Prod (CI/CD) |
|---|---|---|---|---|
| `securityzone` | SecurityZone KPI Portal | 3000 (`FRONTEND_PORT`) | — (chỉ markee ở dev) | **3000** (`FRONTEND_PORT`) |
| `markee` | Markee Work Portal | (override `FRONTEND_PORT`) | **3100** (nginx) | **3300** (`MARKEE_FRONTEND_PORT`) |

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
- `BackgroundSessionLocal` (trong `database.py`) là session factory riêng cho 3 background loop (auto-sync ended meetings, retry n8n notify, zalo summary, meeting reminders) — tách khỏi request session để lỗi ở loop không ảnh hưởng request.

### 5.2 ORM & Migration

- **SQLAlchemy** 2.0.30 (declarative models).
- Không dùng Alembic — migration inline bằng `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` trong `apply_schema_updates()` tại startup + `Base.metadata.create_all(engine)`. Tất cả idempotent.
- Trong CI/CD: `docker compose run --rm --no-deps backend python -c "from app.main import run_startup_once; run_startup_once()"` chạy trước khi start web workers. Web workers không chạy schema migration.
- Script thủ công: `backend/migrate_db.py`, `backend/migrate_meetings_json.py`, `backend/migrate_display_names.py`, `backend/migrate_parent_remark.py`.

### 5.3 Bảng chính

| Model | Bảng | Mô tả |
|---|---|---|
| `User` | `users` | Tài khoản (email, role, data_scope, member_id FK UNIQUE, hashed_pw, telegram_chat_id UNIQUE, google_sub UNIQUE, outlook_mail UNIQUE, outlook_sub UNIQUE, avatar_url, is_active) |
| `RefreshToken` | `refresh_tokens` | Opaque SHA-256 hashed refresh sessions (HttpOnly cookie) |
| `Member` | `members` | Thành viên (display_name, full_name, position, department, team, leader_member_id self-FK, leader_name/leader_email legacy, cv_link, zalo_name, zalo_uid UNIQUE, is_recruitment_synced, employment_status ON/OFF) |
| `WorkspaceAccess` | `user_workspace_access` | User ↔ Workspace multi-grant (UNIQUE `(user_id, workspace_id)`, `is_primary`) |
| `Workspace` | `workspaces` | Master data workspace (code `infra` / `dev`; seed tại startup; `n8n_webhook_url` per-workspace, `expected_google_email`) |
| `WorkspaceGoogleAccount` | `workspace_google_accounts` | Per-Workspace Google OAuth override (route qua `/api/meetings/google/auth?workspace=…`) |
| `Project` | `projects` | Dự án (tên, customer_id FK, year, pm_id, technical_leader_id, sales_id FK, status, data_scope, business, ai_status, share_token UNIQUE, last_activity_at) |
| `ProjectMemberV2` | `project_members_v2` | Project ↔ Member (role: PM/Leader/Member/Sales) |
| `ProjectTemplate` | `project_templates` + phases/task_groups/tasks | Mẫu dự án chuẩn (Task có `skill_solution_id`/`skill_vendor_id`) |
| `Phase` | `phases` | Giai đoạn dự án (ai_status, last_ai_score) |
| `TaskGroup` | `task_groups` | Nhóm công việc (cấp I, II, III; assigned_ids/support_ids JSON arrays) |
| `Task` | `tasks_v2` | Công việc chi tiết (assignee, support, deadline, status, manday_est/actual, kpi_*, days_late, ai_status, review workflow, is_blocked workflow, skill_solution_id, skill_vendor_id, scheduled_at, ticket_id, zalo_demo_skip) |
| `Meeting` | `meetings` | Cuộc họp (transcript, ai_summary, prep fields, score_*, notify_channels JSON, google_event_id, organizer_google_email, n8n_notify_status, soft delete, reminder_minutes, reminder_sent_at, start_link_sent_at) |
| `MeetingProject` | `meeting_projects` | Meeting ↔ Project junction |
| `MeetingParticipant` | `meeting_participants` | Meeting ↔ Member (attendees) |
| `MeetingAttendance` | `meeting_attendance` | Per-attendee attendance records (Google bot + manual) |
| `MeetingFeedback` | `meeting_feedback` | Per-attendee effectiveness feedback (score 1–5) |
| `MasterPhase` | `master_phases` | Pipeline master data (1..15 + 0.Huỷ) + `progress_pct` (single source of truth cho Project Progress) |
| `Skill` / `Group` / `Category` | `categories` → `groups` → `skills` | Kỹ năng 3-level taxonomy |
| `SystemCategory` | `teams`, `positions`, `departments`, `task_priorities`, `task_statuses`, `customers`, `workspaces` | Danh mục hệ thống; `customers.business_unit` |
| `PerformanceSetting` | `performance_settings` | KPI thresholds (parent/child, `remark_type` Bonus/Penalty, `description`, `parent_remark`) |
| `WorkloadSetting` | `workload_settings` | 4 buckets thresholds cho Section 4 (not_working/capacity/normal/overload) |
| `GoogleToken` | `google_tokens` | OAuth tokens Google (legacy 1-per-user) |
| `AIPrompt` | `ai_prompts` | Template prompt AI cho từng dự án (PROJECT/PHASE/TASK) |
| `AIReviewLog` | `ai_review_logs` | Log kết quả AI review (score, issues, suggestions, prompt snapshot) |
| `AISkill` | `ai_skills` | AI Skill Solutions/Vendors marketplace |
| `ChatAITask` | `chat_ai_tasks` | Task yêu cầu xử lý từ AI (Inbox) + `meeting_id` + ticket_id + skill_* + `target_status` |
| `Notification` | `notifications` | In-app notifications (recipient/sender/task_id/task_group_id/project_id/zalo_conversation_id) |
| `TelegramConnection` | `telegram_connections` | Short-lived Telegram link tokens (token UNIQUE) |
| `ZaloAccount` | `zalo_accounts` + `zalo_conversations` + `zalo_messages` + `zalo_demo_requests` + `zalo_conversation_summaries` | Zalo account per-user (`owner_user_id` FK) + conversations (linked to projects) + daily digest summaries (executive_summary/decisions/recommended_tasks/issues/next_steps JSON) |
| `ZaloConversationSummary` | `zalo_conversation_summaries` | Daily Zalo digest (parity shape với Meeting Intelligence) |
| `LeaveRequest` | `leave_requests` | Đơn vắng mặt (Work Remotely / Offline / Go on Business…) |
| `LunchRecord` | `lunch_records` | Đăng ký suất ăn trưa (UNIQUE `(member_id, date)`) |
| `ProjectDocument` | `project_documents` | File đính kèm dự án (`synced_from_task_link`) |
| `ProjectFeature` | `project_features` | KPI Prototype — toplevel feature per project |
| `ProjectFeatureLog` | `project_feature_logs` | WIP log entries (attached_files JSON, author_display_name, ai_summary TEXT, ai_tasks JSON) |
| `ReviewChecklistItem` | `review_checklist_items` | Per-task review checklist items |
| `AuditLog` | `audit_logs` | Lưu vết thao tác (action, module, severity, IP risk, correlation_id, snapshot_json, outcome, ip_risk, is_new_ip/is_new_device, browser/os/device_type…) |
| `Setting` | `settings` | Runtime configuration (column_config, policy, ai_config, zalo_summary_config…) |

### 5.4 Junction Tables

| Bảng | Quan hệ |
|---|---|
| `project_members_v2` | Project ↔ Member (role: PM/Leader/Member/Sales) |
| `member_skills` | Member ↔ Skill |
| `user_skills` | User ↔ Skill |
| `user_workspace_access` | User ↔ Workspace (multi-grant cho Leaders, is_primary) |
| `meeting_projects` | Meeting ↔ Project |
| `meeting_participants` | Meeting ↔ Member (attendees) |
| `meeting_attendance` | Meeting ↔ Member (attendance records) |
| `zalo_conversations` ↔ `zalo_messages` | Zalo conversation ↔ messages (threaded) |
| `zalo_conversations` ↔ `projects` | Zalo conversation linked to project (enables `/task` command in Zalo) |
| `tasks_v2` ↔ `tasks_v2` (self-FK `blocked_by_task_id`) | Task ↔ Task (blocking) |

### 5.5 Hierarchy

```
Project → Phase → TaskGroup → Task (4 cấp) + ProjectFeature → ProjectFeatureLog
Workspace → User (data_scope + user_workspace_access + is_primary)
          → Leader → Members (via Member.leader_member_id, fallback Member.leader_name)
          → Project (via Project.data_scope / business)
Member → employment_status ON/OFF (sync từ Recruitment)
tasks_v2.scheduled_at → Personal Calendar (assigned_id OR support_id = current user)
tasks_v2.{review_status, is_blocked} → 2 workflow layer độc lập với `status`
MasterPhase.progress_pct → Project Progress (single source of truth ở Settings)
```

---

## 6. Authentication & Authorization

### 6.1 Authentication

- **Google Identity Services (GIS)** — xác thực email đã được Admin cấp trước; hệ thống không tự tạo Account. `User.google_sub` liên kết ở lần đăng nhập đầu, tên/avatar được đồng bộ từ Google.
- **Microsoft (Outlook / Entra)** — additive provider qua `@azure/msal-browser` + backend `/api/auth/outlook`. `OUTLOOK_TENANT_ID=common` chấp nhận cả personal account và Entra (work/school). Match qua `outlook_mail` (admin pre-provisioned) → liên kết `outlook_sub` ở lần đăng nhập đầu.
- **Password (OAuth2 form)** — mặc định **tắt** (`PASSWORD_LOGIN_ENABLED=false`); chỉ bật khi cần debug.
- **JWT nội bộ (HS256)** qua `python-jose`:
  - Access token TTL: `ACCESS_TOKEN_EXPIRE_MINUTES` (mặc định 30 phút). Header `X-Error-Code: TOKEN_EXPIRED` khi hết hạn → frontend trigger refresh.
  - Refresh token: opaque random (`secrets.token_urlsafe(48)`), lưu SHA-256 hash `refresh_tokens` table + HttpOnly cookie `REFRESH_COOKIE_NAME=portal_refresh`, TTL `REFRESH_TOKEN_EXPIRE_DAYS` (mặc định 20 ngày, **Phase 1 — không rotate**).
- Frontend lưu access token trong `localStorage`, gửi qua `Authorization: Bearer`; refresh cookie được `axios` gửi kèm (`withCredentials: true`).

### 6.2 Authorization — Role-based (4-Role System)

Collapsed từ legacy 2-role (`admin`/`member`) và 3-role (`group_a`/`group_b`/`member`); seed script trong `apply_schema_updates()` migrate one-shot.

| Role | Quyền |
|---|---|
| `super_admin` | Toàn quyền toàn hệ thống (kể cả System Audit, Account Management, Performance Settings, AI Review, Workload Settings, assign primary workspace). Bootstrap từ env `AUTH_SUPERADMIN_EMAILS` (seeded tại startup). |
| `leader` | Quản lý dự án, task, meeting trong phạm vi các Workspace được cấp (`user_workspace_access` ∪ `data_scope`). Truy cập System Audit + KPI Matrix + Team Load với scope giới hạn theo Workspace (server-side enforce). |
| `member` | Xem dự án được phân công, có quyền cập nhật (write) Task trong dự án đó; dùng được Zalo (owner account), Calendar, Lunch, Leave Request, Skill inline-create, AI Skill marketplace. |
| `viewer` | Chỉ được xem (read-only) dự án được phân công — không có Dashboard Overview/Calendar/Audit/KPI Matrix/Team Load. |

Helper helpers trong `utils/auth.py`: `require_super_admin`, `require_manager`, `require_manager_write`, `require_route_project_access`, `require_zalo_user`, `require_skill_creator`, `require_audit_user`. Legacy back-compat: `require_admin` = `require_super_admin`, `require_admin_write` = `require_manager_write`.

### 6.3 Authorization — Workspace / Data Scope

`workspaces` là **single source of truth**, seed `infra` / `dev` tại startup; legacy `infrastructure` / `markee` được tự động migrate về `infra` / `dev` (cả trên `users`, `projects`, `customers`, `audit_logs`, `projects.business`, `customers.business_unit`).

| Scope | Mô tả |
|---|---|
| `all` | Xem toàn bộ (chỉ dành cho `super_admin`) |
| `infra` | Workspace INFRA — Infrastructure |
| `dev` | Workspace DEV — Markee |

Leader có thể có nhiều Workspace thông qua `user_workspace_access` (cờ `is_primary` đánh dấu workspace "Chính" — backfilled tại startup). Khi chuyển Workspace, leader list lấy từ `workspace_leader_names` (`utils/access.py`).

`Workspace.n8n_webhook_url` cho phép mỗi Workspace route n8n meeting-discovery webhook sang workflow riêng (vd. n8n workflow watch đúng Google account của workspace đó) mà không cần đổi env hay deploy code. `Workspace.expected_google_email` là gợi ý account nên kết nối (hiển thị ở UI trước khi OAuth lần đầu).

### 6.4 Safeguards

- Không thể xóa/demote `super_admin` cuối cùng (`ensure_superadmin_remains`).
- `super_admin` không thể tự demote chính mình.
- Email super-admin trong `AUTH_SUPERADMIN_EMAILS` là **immutable**.
- Write operations (CRUD dự án/settings) giới hạn ở `super_admin` và `leader` (theo scope). `member` chỉ được write Task (qua `require_route_project_access`). `viewer` bị chặn mọi write operation (403).
- ALL WORKSPACES Leaders KHÔNG bao giờ tự động bao gồm tất cả Members — chỉ các Member thực sự được gán qua Member Management (`Member.leader_member_id` hoặc fallback `Member.leader_name`).
- Frontend `lib/auth.ts` helpers phản ánh 4-role: `isSuperAdmin`/`isLeader`/`isMember`/`isViewer`/`isAdmin` (= super_admin|leader, back-compat với `isGroupA`).

---

## 7. Tính năng chính

### 7.1 Quản lý dự án (Project Management)

CRUD dự án với cấu trúc 4 cấp. Giao diện spreadsheet tương tác cho phép cập nhật trực tiếp. Hỗ trợ gán thành viên (PM/Leader/Member/Sales), liên kết platforms, theo dõi status, **Project Documents** upload/list, **Project Hub** (centralized list với filters).

### 7.2 Project Hub

Centralized project view (`/project-hub`) với filters: workspace, status, year, customer, PM. Liệt kê tất cả projects trong các Workspace mà user có quyền.

### 7.3 Dashboard System Audit (super_admin + leader)

Tab `/dashboard/system-audit` với 4 sections:

- **Section 1** — Hero KPIs + Project progress + Phase Distribution + Projects at Risk + Member KPI Distribution (Infrastructure / Markee) + Audit Logs table (filterable by module).
- **Section 2** — **Team comparison** trong Workspace. Một dòng / Leader với KPI / Plan MD / Actual MD / Utilization / Efficiency / On-time / Trễ / Health. Có **Chi tiết** drawer.
- **Section 3** — **Project comparison** theo nhiều Team. Chọn nhiều Leader rồi "Apply Comparison" để so sánh project cards.
- **Section 4** — **Member comparison** giữa các Team. Mỗi Team = 1 card với Team summary (Members / Trống task / Còn capacity / Quá tải / Cân bằng) + danh sách Member được sort theo workload priority (`Quá tải` → `Cân bằng` → `Còn capacity`). Phân loại dựa trên `workload_settings` (`/api/workload-settings`).

Backend endpoints phục vụ Sections 2/3/4: `GET /api/system-audit/team-comparison?workspace=…` + `/team-detail?leader_id=…` (`require_audit_user` = super_admin OR leader; workspace scope enforced cho leader).

### 7.4 Dashboard Overview & Leader Cards

Tab `/dashboard/overview`: Leader Cards (canonical `User.role='leader' AND is_active`) + Project Overview + Workload view.

### 7.5 KPI Engine

Tính toán hiệu suất dựa trên `priority.kpi_base × manday_est`, deadline vs done date, ngưỡng thưởng/phạt cấu hình trong `performance_settings` (`utils/kpi_engine.py`). Per-member KPI fiscal-cycle tổng hợp ở `members.py` (`kpi_total / kpi_avg / kpi_bonus / manday_total / manday_est_total`).

### 7.6 AI Project Review

- Gọi OpenAI-compatible API (`AI_BASE_URL`, mặc định `https://api.shopaikey.com/v1`) hoặc Gemini (OpenAI-compatible base). Default model `gpt-4o-mini` (init_db_defaults) hoặc `gpt-4o` (prod compose).
- 3 loại prompt: PROJECT, PHASE, TASK — tùy chỉnh cho từng dự án trong `/api/ai-prompts`.
- Prompt mặc định bằng tiếng Việt (phân tích rủi ro, tài nguyên, overdue).
- Kết quả: score + issues + suggestions (JSON).
- Status flow: `NOT_CHECKED` → `CHECKING` → `CHECKED` / `HAS_ISSUE` / `NEED_RECHECK`.
- Audit trail: `ai_review_logs` lưu ai đánh giá, khi nào, prompt snapshot.

### 7.7 Quản lý cuộc họp (Meeting Management)

- Tạo/chỉnh sửa cuộc họp, liên kết dự án, mời attendees (`meeting_participants`).
- Đồng bộ từ Google Calendar (per-user OAuth hoặc per-Workspace override qua `WorkspaceGoogleAccount` + `state=user_id:workspace_id`) + Zoom (Server-to-Server OAuth).
- Transcription qua AssemblyAI (`ASSEMBLYAI_API_KEY`).
- Tóm tắt biên bản bằng AI qua n8n webhook (`/api/meetings/webhook/n8n-summary`, header `X-N8N-Webhook-Secret`). Per-Workspace webhook URL configurable ở `Workspace.n8n_webhook_url`; fallback `N8N_MEETING_WEBHOOK_URL_DEFAULT`.
- Meeting intelligence scoring engine (`services/meeting_score_engine.py`) — 5 trụ: `prep` / `execution` / `result` / `followthrough` / `feedback` → `total`.
- **Reminder dispatch** (`services/meeting_reminders.py`): 2 background passes — `dispatch_due_reminders` gửi trước `reminder_minutes` + `dispatch_start_link_notifications` gửi lại meeting link đúng `start_time` (track qua `Meeting.start_link_sent_at`).
- **Meeting-bot recorder** — Chrome extension `extensions/meeting-host-bot/` chạy ở máy host: `/api/meeting-bot/queue` (pull recordings) + `/api/meeting-bot/ended` (upload audio sau transcribe) + `/api/meeting-bot/drive-token` (lấy Drive OAuth token).
- Zalo join link chỉ gửi đúng `start_time`, KHÔNG gửi ngay khi tạo meeting.

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

### 7.15 Zalo Integration (3 mode)

- **Zalo Task Assignment** (`zalo-worker` sidecar, default profile): persistent `zca-js` session lưu trong volume `zalo-worker-artifacts`. Mỗi user có `zalo_account` riêng (`owner_user_id` FK, multi-account) — kết nối qua **cookie import** từ `zalo-login` Chrome extension (Phase 1, không có QR login). Hỗ trợ connect / disconnect / conversations / messages / create-task / send / link-project / refresh-names / track zalo_uid + zalo_name trên Member.
- **Zalo AI Task Extraction** (`zalo-crawler`, profile `crawler`): QR-login crawler, AI parse task từ Zalo message → backend webhook `/api/chat/zalo-webhook`. Có status endpoint `/api/chat/zalo-status`.
- **Zalo Group Summary** (`services/zalo_summary.py`): background loop daily tổng hợp các Zalo conversation → lưu `zalo_conversation_summaries` với cùng shape 4-section của Meeting Intelligence (`executive_summary`, `decisions`, `recommended_tasks`, `issues`, `next_steps`). Render ở `ProjectZaloSummaryTab.tsx` trong `/project/detail`.

### 7.16 Notifications

In-app notifications qua `/api/notifications/*`: `my-alerts`, `remind`, `remind-bulk`, `remind-group`, `inbox`. Recipient + sender + task_id + project_id + zalo_conversation_id.

### 7.17 Chrome Extension — Zalo Login

`extensions/zalo-login/` — Chrome extension bundle, build thành `frontend/public/zalo-login-extension.zip` qua `npm run extension:build`. Phục vụ Phase 1 cookie import cho Zalo.

### 7.18 Chrome Extension — Meeting Host Bot

`extensions/meeting-host-bot/` (manifest v3) — cài ở máy host cuộc họp. Extension record audio từ tab Google Meet/Zoom → upload lên Google Drive → backend lấy audio về (`/api/meeting-bot/queue` + `/api/meeting-bot/drive-token`), chạy AssemblyAI transcript (`/api/meeting-bot/ended`), đẩy transcript vào Meeting Intelligence. Endpoint public cho extension: `/api/meeting-bot/queue`, `/api/meeting-bot/ended`, `/api/meeting-bot/drive-token`.

### 7.19 Personal Calendar (Dashboard tab `/dashboard/calendar`)

Lịch làm việc cá nhân — chỉ hiển thị Task của `tasks_v2.assigned_id` OR `tasks_v2.support_id` = current user. Tuần/Tháng grid với project color swatches. Quick create meeting/task drawer. `Task.scheduled_at` = naive TIMESTAMP ở Asia/Ho_Chi_Minh (cùng convention với `Meeting`). Composite indexes `(assigned_id, scheduled_at)` + `(support_id, scheduled_at)` cho range queries.

### 7.20 Project Prototype / KPI Prototype + WIP log + Public share

Trong `/project/detail` mỗi project có tab **Prototype** (`ProjectPrototypeTab.tsx`):

- Mỗi project có N `ProjectFeature` (toplevel). Mỗi feature có log entries (`ProjectFeatureLog`) ghi tiến độ theo thời gian.
- Mỗi log entry có `attached_files` (JSON array), `author_display_name`, optional `ai_summary` (sinh bằng `services/project_feature_ai.py`) + `ai_tasks` (JSON).
- Leader mint một `Project.share_token` (qua `POST /api/projects/{id}/share-link`) → khách hàng truy cập `/share/project/[token]` (no-auth) xem prototype + WIP log + AI summaries + attachments.

### 7.21 Multi-team Project Comparison (Team Load) — Dashboard tab `/dashboard/team-load`

Chọn nhiều Leader (đồng nghiệp trong Workspace được grant) → render `MultiTeamProjectComparison.tsx` so sánh project cards giữa các Team. Backend gom `_aggregate_team_comparison` step 3b trong `system_audit.py` restrict eligible Leaders theo `user_allowed_scopes`. super_admin + leader only.

### 7.22 KPI Matrix — Dashboard tab `/dashboard/kpi-matrix`

`MemberKpiMatrix.tsx` — bảng KPI thành viên theo tháng × leader (tổng hợp từ `/api/members/kpi-summary` + per-task `kpi_assigned` / `kpi_support`). super_admin + leader only; workspace scope cho leader.

### 7.23 Project Hub Improvements

`/project-hub` + `/project-hub/[code]` (workspace-scoped route) — danh sách project có pagination, filters (status, year, customer, PM, workspace), member breakdown. Sidebar tree (`/api/projects/sidebar-tree`) cho Navbar.

### 7.24 Audit Log Rich Context

Mỗi `AuditLog` ghi thêm `severity` (`INFO`/`WARN`/`ERROR`), `login_method`, `resource_name`, `source` (`WEB`/`API`/`BOT`), `category`, `session_id`, `ip_risk` (`Internal`/`VPN`/`Public`/`Suspicious`), `correlation_id`, `target_user_id`/`target_customer_id`/`target_department`, `snapshot_json` (before/after), `outcome` (`SUCCESS`/`FAILURE`), `duration_ms`, `browser`, `os`, `device_type`, `is_new_ip`, `is_new_device`. Bật phát hiện tấn công + cho System Audit filter mạnh.

### 7.25 Task Review + Task Block workflows

Hai workflow layer **độc lập** với `tasks_v2.status`:

- **Review workflow** — `review_status` (`NULL`/`pending`/`approved`/`changes_requested`) + `review_requested_at/_by`, `approved_at/_by`, `change_requested_at/_by/_reason`, `last_review_action_at`. Legacy backfill 1 lần (`status ILIKE '%review%'` → `pending`) ở `apply_schema_updates()`.
- **Block workflow** — `is_blocked BOOLEAN` + `blocked_at/_by/_reason/_by_task_id`, `unblocked_at/_by`. Legacy backfill 1 lần dựa trên `blocked_at IS NULL` (tránh auto-block lại task đã unblock qua workflow mới).

### 7.26 AI Skill Solutions + Vendors Marketplace

`AISkill` (qua `/api/ai-skills`) — chia 2 bucket: **Skill Solutions** (Group level, dùng cho `tasks_v2.skill_solution_id`) + **Skill Vendors** (Skill level, dùng cho `tasks_v2.skill_vendor_id` và `project_template_tasks.skill_*`). Ứng với mỗi AI Skill: favorites + recents + attachments (file pattern). Member/Leader inline-create từ Task detail mà không cần ra Settings.

### 7.27 Account Pre-fill từ Member

`GET /api/members/{member_id}/account-prefill` — leader/admin tạo account cho Member: trả về email, full_name, role, default data_scope, default Workspace đã pre-fill từ Member record. Giảm nhập tay, tránh typo.

---

## 8. Tích hợp bên ngoài (External Integrations)

| Service | Mục đích | Config |
|---|---|---|
| OpenAI-compatible API (hoặc Gemini) | AI review dự án + tóm tắt meeting + AI Skill generation + Zalo digest | `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_TIMEOUT_SECONDS`, `CHECK_INTERVAL_SECONDS` |
| AssemblyAI | Transcription cuộc họp + meeting-bot audio | `ASSEMBLYAI_API_KEY` |
| Google Identity Services (GIS) | Login | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` |
| Microsoft (MSAL) | Login (Outlook / Entra) | `OUTLOOK_CLIENT_ID`, `OUTLOOK_TENANT_ID` |
| Google Calendar + Drive + Meet | Đồng bộ lịch họp + drive upload (meeting-bot) + auto Meet link | OAuth2 tokens trong DB (`google_tokens` per-user hoặc `workspace_google_accounts` per-Workspace) |
| Zoom | Đồng bộ cuộc họp | `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` |
| Telegram Bot | Notifications | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_GROUP_CHAT_ID`, `TELEGRAM_MESSAGE_THREAD_ID`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME`, `APP_BASE_URL` |
| Zalo (`zca-js`) | Task assignment chat | `ZALO_WORKER_URL`, `ZALO_WORKER_INTERNAL_TOKEN` (Node sidecar) |
| Zalo Summary Loop | Daily group digest | `ZALO_SUMMARY_ENABLED`, `ZALO_SUMMARY_INTERVAL_SECONDS`, `ZALO_SUMMARY_DAILY_AT` |
| Chrome Extensions (auto-update) | zalo-login + meeting-host-bot + ai-tracker nudge | `CURRENT_EXTENSION_VERSION` (compare với `frontend/public/<ext>/manifest.json`) |
| n8n | Meeting summary webhook | `N8N_WEBHOOK_SECRET` (header `X-N8N-Webhook-Secret`), `N8N_MEETING_WEBHOOK_URL_DEFAULT` (fallback), `Workspace.n8n_webhook_url` (per-workspace override) |
| Supabase | PostgreSQL cloud (dev) | `DATABASE_URL` (session pooler TLS) |

---

## 9. Deployment

### 9.1 Infrastructure

- Self-hosted runner (label: `[self-hosted, security]`).
- PostgreSQL trên Supabase (VPN/WARP required cho prod, không cần cho dev vì dùng Supabase Cloud).
- Docker bridge MTU: 1420 (tương thích VPN encapsulation, override qua `DOCKER_NETWORK_MTU`).
- Backend chỉ expose trên `127.0.0.1` (không public trực tiếp) ở local; ở prod thông qua nginx gateway (`deploy/dev-gateway.conf`).
- Named volumes: `backend_uploads` / `backend-uploads` (file upload), `zalo-worker-artifacts` (Zalo session).
- `zalo-worker` sidecar **luôn** chạy ở cả local, dev, prod (default profile). `zalo-crawler` **chỉ local/dev** với `--profile crawler`. Prod KHÔNG chạy crawler.
- Celery/Redis worker đã bỏ (legacy `check_sheet/check_all_sheets` no-op, không có service nào định nghĩa `redis` host, không enqueue task).

### 9.2 Environments

| Env | Trigger | Compose file | Services | Brands | Host ports |
|---|---|---|---|---|---|
| Local dev | `docker compose up -d` | `docker-compose.yml` (root) | backend + frontend + **zalo-worker** + (optional `zalo-crawler` với `--profile crawler`) | 1 brand theo `PORTAL_BRAND` | `3000` (FE) / `8000` (BE, 127.0.0.1) |
| Dev (CI/CD) | Push to `dev` branch | `deploy/security-dev.compose.yml` | backend + frontend + zalo-worker + nginx gateway | markee (single) | `3100` (nginx) |
| Prod (CI/CD) | Manual `workflow_dispatch` keyword "DEPLOY" | `deploy/security-prod.compose.yml` | backend + **frontend (securityzone)** + **frontend_markee** + **zalo-worker** | securityzone + markee (dual) | `3000` (securityzone) / `3300` (markee) |

### 9.3 CI/CD Flow (GitHub Actions)

1. rsync code to target (excluding `.git`, `.env`, `secrets`, `backups`).
2. Copy compose file phù hợp.
3. Run `docker compose run --rm --no-deps backend python -c "from app.main import run_startup_once; run_startup_once()"` để áp dụng `apply_schema_updates()` + `init_db_defaults()` (idempotent).
4. `docker compose build …` + `docker compose up -d`.
5. Health gate (timeout 180s) — verify `/health` returns 200.
6. Manual deploy local (legacy): `./deploy.sh` — `git pull origin main` + `docker compose down` + `docker compose build --no-cache` + `docker compose up -d`. Dùng khi rollback nhanh tại local VM.

### 9.4 Production targets

```
Dev:     /home/webpm/kpi-dev                  → nginx :3100 (markee single-brand)
Prod:    /home/portalkpi/website_PM           → FE :3000 (securityzone) + FE :3300 (markee) + zalo-worker sidecar :8090 internal
Local:   ./ (this repo)                       → docker-compose up :3000 (FE) + :8000 (BE 127.0.0.1) + zalo-worker :8090 internal
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
| `PORTAL_BRAND` / `FRONTEND_PORT` / `MARKEE_FRONTEND_PORT` | Brand build-time + host port | `markee` / `3000` / `3300` |
| `NEXT_PUBLIC_API_BASE_URL` | Frontend axios baseURL | `/api` |
| `FRONTEND_URL` | OAuth callback host | `http://localhost:3000` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` / `GOOGLE_APPLICATION_CREDENTIALS` / `GOOGLE_REFRESH_TOKEN` | Google OAuth | — |
| `ZOOM_ACCOUNT_ID` / `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET` | Zoom S2S OAuth | — |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` / `AI_TIMEOUT_SECONDS` / `CHECK_INTERVAL_SECONDS` | AI integration (OpenAI-compatible shopaikey hoặc Gemini). Defaults: `AI_BASE_URL=https://api.shopaikey.com/v1`, `AI_MODEL=gpt-4o-mini` (init) / `gpt-4o` (prod compose), `AI_TIMEOUT_SECONDS=60`, `CHECK_INTERVAL_SECONDS=3600` | — |
| `GEMINI_API_KEY` | Gemini API key (cho frontend dùng client-side nếu cần) | — |
| `ASSEMBLYAI_API_KEY` | Speech-to-text | — |
| `N8N_WEBHOOK_SECRET` | n8n meeting-summary webhook | — |
| `N8N_MEETING_WEBHOOK_URL_DEFAULT` | Default n8n URL cho meeting-discovery webhook (override per-workspace ở `Workspace.n8n_webhook_url`) | — |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` / `TELEGRAM_GROUP_CHAT_ID` / `TELEGRAM_MESSAGE_THREAD_ID` / `TELEGRAM_BOT_USERNAME` / `APP_BASE_URL` | Telegram notifications | — |
| `ZALO_WORKER_URL` / `ZALO_WORKER_INTERNAL_TOKEN` | Zalo worker sidecar (default `http://zalo-worker:8090`) | — |
| `ZALO_SUMMARY_ENABLED` / `ZALO_SUMMARY_INTERVAL_SECONDS` / `ZALO_SUMMARY_DAILY_AT` | Zalo group digest loop (`HH:MM` VN time) | `false` / 3600 / `18:00` |
| `CURRENT_EXTENSION_VERSION` | Chrome extension manifest version (`/api/extension/ai-tracker/version` returns this for auto-update nudge) | — |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Supabase HTTP API (nếu feature gọi trực tiếp) | — |
| `DOCKER_NETWORK_MTU` | Bridge MTU | 1420 |
| `REDIS_URL` | (legacy — không dùng trong stack hiện tại) | rỗng |