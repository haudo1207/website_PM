# 💻 Quy trình Phát triển & Triển khai (Git Workflow & Deployment)

Tài liệu này hướng dẫn chi tiết về quy trình làm việc với Git (branching strategy) và quy trình deploy ứng dụng lên các môi trường (Dev & Production). Tất cả thành viên trong dự án (bao gồm cả các lập trình viên AI/Agents) cần tuân thủ nghiêm ngặt quy trình này.

---

## 1. Quy trình Phát triển Nhánh (Git Branching Strategy)

Hiện tại, nhánh **`dev`** được dùng làm nhánh tích hợp chính cho môi trường thử nghiệm (staging/testing). Tất cả các tính năng mới hoặc bản sửa lỗi phải được tách nhánh từ nhánh `dev`.

### Các bước thực hiện khi phát triển một chức năng mới:

1. **Chuyển sang nhánh `dev` và cập nhật dữ liệu mới nhất:**
   ```bash
   git checkout dev
   git pull origin dev
   ```

2. **Tạo nhánh chức năng mới (feature branch) từ `dev`:**
   Tên nhánh nên tuân theo định dạng: `feature/ten-chuc-nang` hoặc `bugfix/ten-loi`.
   ```bash
   git checkout -b feature/ten-chuc-nang
   ```

3. **Lập trình và Commit thay đổi:**
   Commit message nên tuân theo chuẩn [Conventional Commits](https://www.conventionalcommits.org/) (ví dụ: `feat: mô tả thay đổi` hoặc `fix: sửa lỗi...`).
   ```bash
   git add .
   git commit -m "feat: mo ta thay doi"
   ```

4. **Đẩy nhánh chức năng lên Remote Repository:**
   ```bash
   git push -u origin feature/ten-chuc-nang
   ```

5. **Tạo Pull Request (PR) vào nhánh `dev`:**
   - Sau khi hoàn thành code và push lên GitHub, hãy tạo một Pull Request từ nhánh `feature/ten-chuc-nang` vào nhánh `dev` trên GitHub.
   - Chờ duyệt (Review) và merge vào nhánh `dev`.

---

## 2. Quy trình Triển khai Môi trường Dev (Staging Deployment)

Khi một Pull Request được merge vào nhánh **`dev`**, hệ thống CI/CD (GitHub Actions) sẽ tự động kích hoạt và triển khai mã nguồn mới lên tên miền thử nghiệm:

- **Domain:** [dev.kpi.markeeai.com](https://dev.kpi.markeeai.com)
- **Database:** Sử dụng Database dành riêng cho môi trường Dev.
- **Mục đích:** Để QA/QC và các thành viên kiểm thử chức năng trước khi chuyển sang production.

---

## 3. Quy trình Triển khai Môi trường Production

Sau khi kiểm thử trên môi trường Dev ổn định và không phát sinh lỗi, chúng ta sẽ thực hiện triển khai lên Production theo các bước sau:

1. **Merge nhánh `dev` vào nhánh `main`:**
   - Tạo Pull Request từ nhánh `dev` vào nhánh `main` trên GitHub.
   - Duyệt và merge Pull Request đó vào `main`.

2. **Chạy GitHub Actions Deployment:**
   - Truy cập vào repository trên GitHub.
   - Nhấp vào tab **Actions** ở menu phía trên.
   - Chọn workflow **"Deploy production"** ở thanh menu bên trái.
   - Nhấp vào nút **"Run workflow"** ở góc phải, chọn nhánh **`main`** và chạy.

3. **Hệ thống tự động triển khai đồng thời 2 bản Production:**
   Quá trình deploy sẽ tự động dựng và cập nhật lên 2 tên miền sau:
   - [https://kpi.securityzone.vn](https://kpi.securityzone.vn)
   - [https://kpi.markeeai.com](https://kpi.markeeai.com)

### Các đặc điểm lưu ý ở Production:
- **Branding/Logo:** Hệ thống sẽ tự động điều chỉnh cấu hình và hiển thị đúng Logo cũng như các cấu hình thương hiệu (branding) tương ứng với từng tên miền truy cập.
- **Database:** Cả 2 ứng dụng production đều chạy chung **1 cơ sở dữ liệu (Database)**. Cơ sở dữ liệu này hoàn toàn độc lập và khác biệt so với Database của môi trường Dev.

---

> **Lưu ý quan trọng:** Không được push code trực tiếp lên nhánh `main` hoặc `dev`. Luôn luôn code thông qua nhánh feature và kiểm thử kỹ lưỡng trên môi trường Dev trước khi đẩy lên Production.
