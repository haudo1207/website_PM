---
version: "1.1.0"
name: "CompliancePortal-Light"
description: "Hệ thống thiết kế sáng màu (Light Theme) cho Compliance Portal"
colors:
  primary: "#0058be"                 # Xanh dương chủ đạo (Brand Color)
  secondary: "#565e74"               # Màu chữ phụ/icon
  background: "#f8f9ff"              # Nền trang chính
  app-bg: "#f0f2f5"                  # Nền ứng dụng/layout chính
  surface-white: "#ffffff"           # Nền card và container
  outline-variant: "#c2c6d6"         # Đường viền phân cách
  on-background: "#0b1c30"           # Màu chữ chính tối màu

  # ── Status colors (generic compliance / task status) ──
  status-success-bg: "#dcfce7"       # Màu nền trạng thái thành công
  status-success-text: "#15803d"     # Màu chữ trạng thái thành công
  status-warning-bg: "#fef9c3"       # Màu nền trạng thái cảnh báo/chờ
  status-warning-text: "#854d0e"     # Màu chữ trạng thái cảnh báo/chờ
  status-error-bg: "#fee2e2"         # Màu nền trạng thái lỗi/vi phạm
  status-error-text: "#dc2626"       # Màu chữ trạng thái lỗi/vi phạm

  # ── Health colors (System Audit — Team/Project health) ──
  # Dùng trong Dashboard → System Audit Section 2 & 4 (Team comparison,
  # Member comparison). Critical = 🛑, Risk = ⚠️, On Track = 🟢.
  health-critical-bg: "#ffe4e6"       # rose-100 — overloaded / at risk
  health-critical-text: "#9f1239"     # rose-800
  health-critical-border: "#fecdd3"   # rose-200
  health-risk-bg: "#fef3c7"           # amber-100
  health-risk-text: "#92400e"         # amber-800
  health-risk-border: "#fde68a"       # amber-200
  health-on-track-bg: "#ecfdf5"       # emerald-50
  health-on-track-text: "#047857"     # emerald-700
  health-on-track-border: "#a7f3d0"   # emerald-200

  # ── Workload colors (System Audit Section 4 — Member comparison) ──
  # Trạng thái tải của Member: Quá tải / Cân bằng / Còn capacity.
  workload-overload-bg: "#ffe4e6"        # rose-100
  workload-overload-text: "#9f1239"      # rose-800
  workload-overload-border: "#fecdd3"    # rose-200
  workload-overload-dot: "#f43f5e"       # rose-500
  workload-balanced-bg: "#dbeafe"        # blue-100
  workload-balanced-text: "#1e40af"      # blue-800
  workload-balanced-border: "#bfdbfe"    # blue-200
  workload-balanced-dot: "#3b82f6"       # blue-500
  workload-available-bg: "#ecfdf5"       # emerald-50
  workload-available-text: "#047857"     # emerald-700
  workload-available-border: "#a7f3d0"   # emerald-200
  workload-available-dot: "#10b981"      # emerald-500

  # ── Numeric badge tones (System Audit Section 4 counters) ──
  counter-neutral-bg: "#f8fafc"      # slate-50
  counter-neutral-text: "#334155"    # slate-700
  counter-neutral-border: "#e2e8f0"  # slate-200
  counter-rose-bg: "#fff1f2"         # rose-50
  counter-rose-text: "#be123c"       # rose-700
  counter-rose-border: "#fecdd3"     # rose-200
  counter-emerald-bg: "#ecfdf5"      # emerald-50
  counter-emerald-text: "#047857"    # emerald-700
  counter-emerald-border: "#a7f3d0"  # emerald-200
typography:
  fontFamily: "Work Sans, sans-serif"
  hero-title:
    fontSize: "20px"
    fontWeight: "700"
    lineHeight: "28px"
  section-title:
    fontSize: "14px"
    fontWeight: "700"
    lineHeight: "20px"
  body-md-medium:
    fontSize: "13px"
    fontWeight: "500"
    lineHeight: "20px"
  micro-label:
    fontSize: "10px"
    fontWeight: "700"
    lineHeight: "12px"
---

## Overview

Compliance Portal Light Theme mang phong cách hiện đại, trực quan và sạch sẽ. Hệ thống thiết kế phục vụ hiển thị dữ liệu bảng biểu, tiến độ dự án, các cảnh báo tuân thủ và **giám sát workload** giữa các Team / Member trong Dashboard → System Audit (Super Admin only).

Token definitions trong YAML frontmatter được biên dịch tự động sang `frontend/tailwind.theme.json` bởi `npm run design:build` (`scripts/build-design.js` qua `@google/design.md designmd export --format json-tailwind`). Sau đó `tailwind.config.js` load file JSON này để tạo các utility class `bg-*` / `text-*` / `border-*`.

## Colors (Hệ màu chủ đạo)

- **Primary (`#0058be`):** Màu xanh thương hiệu, sử dụng cho các nút hành động chính, thanh trạng thái active, và các liên kết quan trọng.
- **On-Background (`#0b1c30`):** Màu xanh đen sẫm làm chữ chính, đảm bảo tỷ lệ tương phản cực cao trên nền sáng.
- **Secondary (`#565e74`):** Màu xám xanh làm chữ phụ và mô tả.
- **Outline Variant (`#c2c6d6`):** Màu viền cho các ô lọc và thẻ card dự án, phân tách thông tin tinh tế.
- **App BG (`#f0f2f5`):** Màu nền tổng thể giúp làm nổi bật các Card màu trắng (`#ffffff`).

## Trạng thái kiểm tra (Status Colors)

| Token | Background | Text | Border | Use case |
|---|---|---|---|---|
| `status-success` | `#dcfce7` | `#15803d` | — | Hoàn thành (Done) |
| `status-warning` | `#fef9c3` | `#854d0e` | — | Thiết kế / chờ |
| `status-error`   | `#fee2e2` | `#dc2626` | — | Vi phạm chính sách / cần sửa |

## Health colors (System Audit — Team / Project Health)

Dùng cho Health badge trong Section 2 (Team comparison) và Section 4 (Member comparison) của Dashboard → System Audit.

| Health | Background | Text | Border | Icon |
|---|---|---|---|---|
| `health-critical` (Critical) | `#ffe4e6` | `#9f1239` | `#fecdd3` | 🛑 |
| `health-risk` (Risk) | `#fef3c7` | `#92400e` | `#fde68a` | ⚠️ |
| `health-on-track` (On Track) | `#ecfdf5` | `#047857` | `#a7f3d0` | 🟢 |

## Workload colors (System Audit Section 4 — Member comparison)

Ba trạng thái tải của Member — pill badge với chấm tròn màu. Member được sắp xếp theo thứ tự: `Overload → Balanced → Available`.

| Workload | Background | Text | Border | Dot |
|---|---|---|---|---|
| `workload-overload` (Quá tải) | `#ffe4e6` | `#9f1239` | `#fecdd3` | `#f43f5e` |
| `workload-balanced` (Cân bằng) | `#dbeafe` | `#1e40af` | `#bfdbfe` | `#3b82f6` |
| `workload-available` (Còn capacity) | `#ecfdf5` | `#047857` | `#a7f3d0` | `#10b981` |

Ngưỡng phân loại (tính từ `manday_actual / manday_est`):

- `Quá tải` ≥ 100%
- `Cân bằng` ≥ 80% và < 100%
- `Còn capacity` < 80% (bao gồm cả Member không có task)

## Counter chip tones (System Audit Section 4)

Counter chip hiển thị 4 chỉ số: `Members / Trống task / Còn capacity / Quá tải`. Mỗi tone là một combo bg / text / border dùng cho các loại counter khác nhau.

| Tone | Background | Text | Border |
|---|---|---|---|
| `counter-neutral` | `#f8fafc` | `#334155` | `#e2e8f0` |
| `counter-rose` | `#fff1f2` | `#be123c` | `#fecdd3` |
| `counter-emerald` | `#ecfdf5` | `#047857` | `#a7f3d0` |

## Typography

Sử dụng font chữ chủ đạo **Work Sans** để hiển thị số liệu và nhãn trực quan, dễ đọc:

- **Hero Title:** Tiêu đề trang lớn, nổi bật (`20px`, Bold).
- **Section Title:** Tiêu đề các thẻ card (`14px`, Bold).
- **Body MD Medium:** Nhãn nội dung (`13px`, Medium).
- **Micro Label:** Các nhãn thông số nhỏ, viết hoa để phân cấp thông tin tốt hơn (`10px`, Bold).

## Component conventions

Các thành phần UI chính của hệ thống dùng chung một bộ quy ước để đảm bảo tính nhất quán:

- **Card chrome:** `bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden`.
- **Section header strip:** `px-5 py-4 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between gap-3`.
- **Section title:** `text-xs font-bold text-[#0b1c30] uppercase tracking-wider`.
- **Section subtitle:** `text-[10px] text-slate-400 mt-0.5`.
- **Vertical scroll container:** `<div class="… max-h-[…] overflow-y-auto custom-scrollbar">`.
- **Status badge:** rounded-full, `text-[10px] font-extrabold`, padding `px-2 py-0.5`, border 1px, dùng tone `health-*` hoặc `workload-*`.
- **Counter chip:** rounded-lg, `text-[9px] font-bold uppercase tracking-wider` cho label, `text-sm font-black leading-tight` cho value.