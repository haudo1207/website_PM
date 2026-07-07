# 📋 Cloned Repository Checklist: `feature/meeting-logs`

The repository `markeeai-dev/pm-new` (branch `feature/meeting-logs`) is cloned locally in `pm-new/` and is fully up-to-date with the remote tracking branch.

---

## 🕒 Recent Commit History

Here is a summary of the latest commits in the `feature/meeting-logs` branch:

| Commit Hash | Author | Date | Commit Message |
|:---|:---|:---|:---|
| `7392662` | Nguyen Thu Trang | 2026-07-02 | `feat: auto-sync Zoom AI summaries via background polling API` |
| `3ca3257` | Nguyen Thu Trang | 2026-07-02 | `feat: enhance meeting UI, fix delete logic & add custom confirm modal` |
| `508e2b7` | NhutNguyen25 | 2026-07-02 | `finish project-manager` |
| `7d75275` | NhutNguyen25 | 2026-07-01 | `project-manager` |
| `cca6be7` | NhutNguyen25 | 2026-06-29 | `finish task` |

---

## 🛠️ Core Functional Modules

### 1. Meetings & Zoom Auto-Sync
This module handles creating, displaying, editing, and deleting meetings, with a background polling mechanism that automatically fetches AI summaries from ended Zoom meetings.

* **UI Components**:
  * `app/dashboard/meetings/page.tsx`: Main meeting list with platform filters, date/month filtering, a custom delete confirmation dialog, and a background poll that hits `/api/zoom/sync` every 15 seconds.
  * `components/meetings/MeetingCard.tsx`: Individual card rendering platform badges, meeting metadata, and the extracted AI summaries.
  * `components/meetings/CreateMeetingModal.tsx`: Form modal for entering meeting titles, selecting platforms, entering links, dates, and times.
* **API Endpoints**:
  * `app/api/meetings/route.ts`: `GET` meetings list / `POST` to append new meetings.
  * `app/api/meetings/[id]/route.ts`: `PUT` to update / `DELETE` to remove a meeting by ID.
  * `app/api/zoom/sync/route.ts`: Authorizes with Zoom (Account Credentials Grant) and pulls meeting details/AI summaries (`/meeting_summary`) for any scheduled or processing Zoom meetings.
* **Storage**:
  * `data/meetings.json`: Simple JSON file acted upon as the database for meetings.

### 2. Project Manager & Google Sheets Integration
This module displays active projects grouped hierarchically by **Year → Customer Name → Project ID**, drawing live data directly from Google Sheets.

* **UI Components**:
  * `app/dashboard/years/page.tsx`: Renders the hierarchical file-tree view of years, customers, and projects. Supports adding new projects and custom modals for managing structure (cascade deleting or moving).
  * `components/EditProjectModal.tsx`: Form for updating project details (status, sale assignee, contract ID, customer ID).
  * `components/KpiCard.tsx` / `components/WeeklyChart.tsx`: Analytics KPI cards and double-bar task activity charts.
* **API Endpoints**:
  * `app/api/yearly-report/route.ts`: Fetches spreadsheet rows (columns B, C, D, E, G, J, K, L, N) and updates values.
  * `app/api/add-project/route.ts`: Appends a new project row to Google Sheets.
  * `app/api/manage-structure/route.ts`: Handles addition/deletion of years and customers. Updates rows or deletes rows via batch requests.
  * `lib/db.ts`: Instantiates JWT client authentication using the Google credentials.

---

## 📂 Complete File Checklist

Here is the list of key files and directories in `pm-new`:

```
pm-new/
├── app/
│   ├── api/
│   │   ├── add-project/route.ts          # API to add a new project row to Sheets
│   │   ├── delete-project/               # Project deletion API (unused)
│   │   ├── manage-structure/route.ts     # Batch edit Sheets for Years/Customers
│   │   ├── meetings/
│   │   │   ├── [id]/route.ts             # Detail API (PUT/DELETE) for meetings
│   │   │   └── route.ts                  # List/Create API (GET/POST) for meetings
│   │   ├── yearly-report/route.ts        # Main KPI/Project Sheets API
│   │   └── zoom/
│   │       ├── sync/route.ts             # Zoom OAuth & AI Summary Sync endpoint
│   │       └── route.ts                  # General Zoom helper API
│   ├── dashboard/
│   │   ├── kpis/page.tsx                 # Placeholder KPIs page
│   │   ├── meetings/page.tsx             # Main meeting dashboard
│   │   ├── projects/page.tsx             # Placeholder projects page
│   │   ├── weekly-reports/page.tsx       # Placeholder weekly reports page
│   │   ├── years/
│   │   │   ├── page.tsx                  # Project Manager dashboard tree-view
│   │   │   └── years.module.css          # CSS styles for Project Manager
│   │   ├── layout.tsx                    # Shared Sidebar/Topbar dashboard layout
│   │   └── page.tsx                      # Dashboard home overview
│   ├── globals.css                       # Global Tailwind config import
│   └── layout.tsx                        # App router layout
├── components/
│   ├── meetings/
│   │   ├── CreateMeetingModal.tsx        # Modal to create/edit meetings
│   │   └── MeetingCard.tsx               # Renders single meeting cards
│   ├── EditProjectModal.tsx              # Modal for editing project sheets row
│   ├── KpiCard.tsx                       # Reusable KPI stats card
│   ├── Sidebar.tsx                       # Workspace navigation menu
│   └── WeeklyChart.tsx                   # Double-bar charts for task activity
├── data/
│   └── meetings.json                     # Database storage file for meetings
├── docs/
│   ├── PROJECT-MANAGER.MD                # Guide on Project Manager architecture
│   ├── add-project-flow.md               # Flow explanation for adding projects
│   ├── google-sheets-guide.md            # Steps to share sheet with Service Account
│   └── overview.md                       # High-level architecture overview
├── lib/
│   └── db.ts                             # Google JWT Sheet Client library
├── package.json                          # Next.js 16, React 19, Tailwind v4
├── tailwind.config.ts                    # Tailwind styling configuration
└── tsconfig.json                         # TypeScript configuration
```

---

## 🔐 Credentials & Environment Variables

To fully run or migrate this branch, the following environment variables are required:

1. **Google Sheets Integration**:
   * `GOOGLE_CREDENTIALS` (or `GOOGLE_CLIENT_EMAIL` and `GOOGLE_PRIVATE_KEY`): Used by `lib/db.ts` to query the spreadsheet `1IwHmlrjM51-wsQi8oz3OSWImKaEuWEZws63oyP6iy9M` on tab `"Plan Link2"`.
   * **Service Account Email**: `poptech-pm@poptech-pm.iam.gserviceaccount.com` (must be shared with viewer/editor permissions on the sheet).

2. **Zoom API Integration**:
   * `ZOOM_ACCOUNT_ID`: `697wscaGQ-Wr8v5l0pPI5A`
   * `ZOOM_CLIENT_ID`: `4tlSJH6HSMa_aZwKjgCYRw`
   * `ZOOM_CLIENT_SECRET`: `PfvOibOMaqQwy7XLPNPfe9QoSXPv9MkY`
