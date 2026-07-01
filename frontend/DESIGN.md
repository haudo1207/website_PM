---
version: "1.0.0"
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
  status-success-bg: "#dcfce7"       # Màu nền trạng thái thành công
  status-success-text: "#15803d"     # Màu chữ trạng thái thành công
  status-warning-bg: "#fef9c3"       # Màu nền trạng thái cảnh báo/chờ
  status-warning-text: "#854d0e"     # Màu chữ trạng thái cảnh báo/chờ
  status-error-bg: "#fee2e2"         # Màu nền trạng thái lỗi/vi phạm
  status-error-text: "#dc2626"       # Màu chữ trạng thái lỗi/vi phạm
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

Compliance Portal Light Theme mang phong cách hiện đại, trực quan và sạch sẽ. Hệ thống thiết kế tập trung vào việc hiển thị dữ liệu bảng biểu, tiến độ dự án và các cảnh báo tuân thủ một cách rõ ràng và khoa học.

## Colors (Hệ màu chủ đạo)

- **Primary (#0058be):** Màu xanh thương hiệu, sử dụng cho các nút hành động chính, thanh trạng thái active, và các liên kết quan trọng.
- **On-Background (#0b1c30):** Màu xanh đen sẫm làm chữ chính, đảm bảo tỷ lệ tương phản cực cao trên nền sáng.
- **Secondary (#565e74):** Màu xám xanh làm chữ phụ và mô tả.
- **Outline Variant (#c2c6d6):** Màu viền cho các ô lọc và thẻ card dự án, phân tách thông tin tinh tế.
- **App BG (#f0f2f5):** Màu nền tổng thể giúp làm nổi bật các Card màu trắng (`#ffffff`).

## Trạng thái kiểm tra (Status Colors)

- **Hoàn thành (Success):** Chữ xanh lá `#15803d` trên nền `#dcfce7`.
- **Cảnh báo (Warning/Error):** Chữ đỏ `#dc2626` trên nền `#fee2e2` đại diện cho các task vi phạm chính sách cần sửa đổi.
- **Thiết kế (Warning):** Chữ vàng đất `#854d0e` trên nền `#fef9c3`.

## Typography

Sử dụng font chữ chủ đạo **Work Sans** để hiển thị số liệu và nhãn trực quan, dễ đọc:
- **Hero Title:** Tiêu đề trang lớn, nổi bật (`20px`, Bold).
- **Section Title:** Tiêu đề các thẻ card (`14px`, Bold).
- **Micro Label:** Các nhãn thông số nhỏ, viết hoa để phân cấp thông tin tốt hơn (`10px`, Bold).
