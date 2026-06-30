#!/bin/bash
# -----------------------------------------------------------------------------
# 🚀 AUTOMATIC DEPLOYMENT & UPDATE SCRIPT - TASK COMPLIANCE PORTAL
# -----------------------------------------------------------------------------

# Thiết lập màu sắc hiển thị
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=================================================================${NC}"
echo -e "${GREEN}    🚀 BẮT ĐẦU CẬP NHẬT GIAO DIỆN & HỆ THỐNG TRÊN VM   ${NC}"
echo -e "${BLUE}=================================================================${NC}"

# Bước 1: Pull mã nguồn mới nhất từ Git
echo -e "\n${YELLOW}[1/4] Đang lấy mã nguồn mới nhất từ Git...${NC}"
git pull origin main
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✔ Đồng bộ mã nguồn thành công!${NC}"
else
    echo -e "${RED}❌ Thất bại khi pull code từ Git. Vui lòng kiểm tra lại kết nối hoặc phân quyền.${NC}"
    exit 1
fi

# Bước 2: Dừng các container hiện tại
echo -e "\n${YELLOW}[2/4] Đang dừng các dịch vụ hiện tại...${NC}"
docker compose down
echo -e "${GREEN}✔ Đã dừng hệ thống thành công!${NC}"

# Bước 3: Build lại toàn bộ service (Không sử dụng cache)
echo -e "\n${YELLOW}[3/4] Đang build lại các Docker Image...${NC}"
docker compose build --no-cache
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✔ Đã build và đồng bộ Design Tokens thành công!${NC}"
else
    echo -e "${RED}❌ Thất bại trong quá trình build dự án. Vui lòng xem log ở trên.${NC}"
    exit 1
fi

# Bước 4: Khởi động lại các container dưới nền
echo -e "\n${YELLOW}[4/4] Đang khởi chạy hệ thống ở chế độ chạy ngầm...${NC}"
docker compose up -d
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✔ Hệ thống đã khởi động lại thành công!${NC}"
else
    echo -e "${RED}❌ Khởi chạy hệ thống thất bại.${NC}"
    exit 1
fi

# In trạng thái các container sau cùng
echo -e "\n${GREEN}=================================================================${NC}"
echo -e "${GREEN}    🎉 CẬP NHẬT HOÀN TẤT! TRẠNG THÁI CÁC DỊCH VỤ:                 ${NC}"
echo -e "${GREEN}=================================================================${NC}"
docker compose ps
