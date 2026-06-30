---
version: "alpha"
name: "SecurityZone-Dark"
description: "Hệ thống thiết kế tối màu (Dark Theme) cho Plane.so SecurityZone"
colors:
  primary: "#12141c"        # Nền tối chủ đạo (Deep navy/slate)
  secondary: "#1a1d27"      # Nền phụ cho card, container và hover
  accent: "#4f46e5"         # Màu nhấn Indigo-600 (đạt độ tương phản WCAG AA với chữ sáng)
  accent-hover: "#4338ca"   # Màu nhấn khi hover (Indigo-700)
  border: "#2e3250"         # Viền (border) tinh tế
  text-primary: "#f8fafc"   # Chữ chính (Slate-50)
  text-secondary: "#94a3b8" # Chữ phụ, caption (Slate-400)
  danger: "#b91c1c"         # Màu cảnh báo (Red-700 - đạt chuẩn tương phản với chữ trắng)
  danger-hover: "#991b1b"   # Màu cảnh báo khi hover (Red-800)
typography:
  h1:
    fontFamily: "Inter, sans-serif"
    fontSize: "2rem"
    fontWeight: "700"
  h2:
    fontFamily: "Inter, sans-serif"
    fontSize: "1.5rem"
    fontWeight: "600"
  body:
    fontFamily: "Inter, sans-serif"
    fontSize: "0.875rem"
    fontWeight: "400"
  caption:
    fontFamily: "Inter, sans-serif"
    fontSize: "0.75rem"
    fontWeight: "500"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  navbar:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.text-secondary}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-danger-hover:
    backgroundColor: "{colors.danger-hover}"
---

## Overview

SecurityZone Dark Theme mang phong cách Cyberpunk tinh giản và tập trung vào bảo mật. Giao diện được tối ưu hóa cho lập trình viên và quản trị viên bảo mật làm việc ban đêm, giảm mỏi mắt và tăng độ tương phản của thông tin.

## Colors

Bảng màu sử dụng các tông tối dịu mắt phối cùng màu nhấn Indigo-500 rực rỡ:

- **Primary (#12141c):** Làm nền tảng chính (Sidebar, nền layout).
- **Secondary (#1a1d27):** Làm nền phụ để phân cấp thông tin (Card, Button hover).
- **Accent (#6366f1):** Đại diện cho hành động chính, nút kêu gọi hành động (CTA), và trạng thái active.
- **Border (#2e3250):** Đường chia cắt thanh mảnh.

## Typography

Sử dụng font chữ **Inter** hiện đại, bo viền sạch sẽ, phù hợp cho hiển thị dữ liệu bảng biểu và mã nguồn.

- **h1:** Dùng cho tiêu đề trang lớn.
- **h2:** Dùng cho tiêu đề nhóm hoặc card lớn.
- **body:** Dùng cho các đoạn văn mô tả và dữ liệu bảng.
- **caption:** Dùng cho thẻ nhãn, metadata, hoặc văn bản nhỏ trong Sidebar.

## Components

### Button Primary
Các nút tương tác chính sử dụng màu nền nhấn (Accent) và chữ sáng để đảm bảo tỷ lệ tương phản đạt chuẩn AA trở lên.

### Navbar
Thanh điều hướng bên trái sử dụng màu tối `primary` để hướng sự chú ý của người dùng vào khu vực làm việc chính ở bên phải.
