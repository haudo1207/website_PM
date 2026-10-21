# MSC → PM: đồng bộ KPI Priority theo tuần

MSC (Mua Sắm Công, "Thiết lập KPI Team > Priority") đẩy mỗi tuần KPI thành **1 Task Group** (Task Cha) và mỗi **member** thành **1 Task con cho cả tuần**,
chỉ khi member đã đạt đủ các trạng thái đã đặt mức (Cần xem xét / Presale Check / Tham gia). Priority = mức **thấp nhất** trong các trạng thái đó, status Done.
Khóa `externalKey` của task theo member: `msc-kpi:<team>:<tuần>:<mscUserId>`; số gói từng trạng thái nằm trong `achieved.items`.
Code: `backend/app/routers/msc_sync.py`, test: `backend/tests/test_msc_sync.py`.

## Cấu hình
- Biến môi trường `MSC_SYNC_TOKEN` (chuỗi dài ngẫu nhiên), **giống hệt** `PM_SYNC_TOKEN` bên MSC. Để trống = 2 endpoint bị khóa (503), không phải "tắt xác thực".
- MSC gọi với header `X-MSC-Sync-Token`. Không dùng đăng nhập người dùng.

## Endpoint
- `GET  /api/msc-sync/skills` → `{ groups: [{ id, name, categoryName, skills: [{ id, name }] }] }` (Skill Solution → Skill Vendor đang `is_active`).
- `POST /api/msc-sync/projects/{pid}/weekly-kpi` → tạo/cập nhật Task Group của tuần + task con, **idempotent** theo `externalKey`.
  Trả `{ group: { id, code, action }, tasks: [{ externalKey, id, code, action }], errors: [{ externalKey, message }] }`; một số task lỗi vẫn trả 200, task khác vẫn lưu.

## Quy tắc
- Task Group nằm trong Phase tên **"KPI MSC theo tuần"** (tự tạo nếu chưa có; đổi bằng `phaseName` trong body). Tìm lại Task Group theo `description = externalKey`, rồi `pmGroupId`, rồi tên.
- Task con tìm theo `pmTaskId`, rồi `Task.ticket_id = externalKey`. Có rồi thì cập nhật (priority, manday, người, skill, detail), chưa có thì tạo.
- Ghép người theo **email** (`Member.email`, hoặc `User.email` đã gắn member). Người được giao và người hỗ trợ phải **thuộc project** và **khác nhau**; thiếu thì task đó báo lỗi (không tự thêm vào project).
- Task Group MANDAY EST = tổng manday các task (làm tròn lên, số nguyên 1–10, theo luật PM). Vượt 10 thì từ chối cả yêu cầu với thông báo rõ.
- Ghi bằng chính các hàm route của PM (`create_task_group`, `update_task_group`, `create_task`, `update_task`) với tài khoản hệ thống nên mọi kiểm tra và tính KPI giống tạo trên giao diện. Task Done sẽ gửi thông báo Zalo như bình thường nếu người được giao đã nối Zalo.

## Nguồn thứ hai: MarkeeAI (KPI Priority theo bài đăng)
Cùng 2 endpoint `/api/msc-sync/skills` và `/api/msc-sync/projects/{pid}/weekly-kpi`, nhưng **token riêng quyết định nguồn**:

| Nguồn | Token (header `X-MSC-Sync-Token`) | Tiền tố `externalKey` | Phase mặc định |
|---|---|---|---|
| MSC | `MSC_SYNC_TOKEN` | `msc-kpi:` | KPI MSC theo tuần |
| MarkeeAI | `MARKEEAI_SYNC_TOKEN` | `markeeai-kpi:` | KPI MarkeeAI theo tuần |

- Token nào khớp thì nguồn đó; yêu cầu mang tiền tố của nguồn khác bị từ chối (400), nên hai hệ thống không ghi đè dữ liệu của nhau.
- Chỉ cần đặt `MARKEEAI_SYNC_TOKEN` thì MarkeeAI dùng được (MSC vẫn khóa nếu chưa đặt `MSC_SYNC_TOKEN`). Cả hai trống = 503.
- Ghép người theo email như MSC (người dùng markeeai đăng nhập bằng cùng email với PM).
