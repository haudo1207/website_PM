# Meeting Intelligence — luồng hoạt động

Tài liệu này giải thích toàn bộ luồng của tính năng **Meeting Intelligence**
(`/meetings`): từ lúc tạo một cuộc họp cho tới lúc điểm hiệu quả được tính và
hiển thị. Viết cho người mới đọc code lần đầu, không giả định đã biết trước
gì về tính năng.

## 1. Tổng quan luồng

```
Tạo meeting ──► AI Summary tự động ──► Tính điểm lần 1
     │                                       │
     ▼                                       ▼
Sửa objective/agenda/transcript ──►  Tính điểm lại
     │
     ▼
Đẩy task đề xuất vào Project ("push-tasks")
     │
     ▼
AITaskInbox (nháp, gắn meeting_id) ──► PM review & Import ở Project Detail
     │                                       │
     │                                       ▼
     │                              Task thật trong tasks_v2 (vào hệ KPI)
     │                                       │
     └───────────────◄──────── hook tự động tính lại điểm meeting
                                             │
                                             ▼
                                  Feedback nhanh (Hữu ích / Chưa hữu ích)
                                             │
                                             ▼
                                     Tính lại điểm Phản hồi
```

Điểm hiệu quả **không phải AI chấm** — toàn bộ là công thức xác định
(deterministic), tính từ dữ liệu thật trong DB. AI chỉ tham gia ở 2 chỗ:
soạn Executive Summary/Decisions/Task đề xuất sau họp, và soạn hộ
Objective/Agenda lúc tạo meeting (người tạo vẫn phải rà soát, xác nhận).

## 2. Bước 1 — Tạo meeting

**UI:** nút "+ Tạo meeting" → `CreateMeetingModal.tsx`.

Form gồm: Tên meeting*, Nền tảng, Ngày*, Giờ*, Link (tùy chọn — tự sinh nếu
để trống), **Mục tiêu & kết quả mong đợi**, **Agenda/vấn đề cần xử lý**.

- **AI Meeting Copilot** (nút "✦ AI đề xuất"): gọi
  `POST /api/meetings/generate-ai-content` với `{title, project_name}` →
  backend gọi AI qua `services/ai_client.py::chat_completion_json()` → trả
  về `{goal, agenda}` để điền sẵn vào 2 ô trên. Người dùng sửa tự do trước
  khi lưu.
- **Thanh "Mức sẵn sàng trước họp"**: tính ngay trên frontend, mô phỏng đúng
  công thức điểm Chuẩn bị ở backend (xem mục 4) để người dùng thấy trước khi
  bấm Tạo.
- Bấm "Tạo meeting" → `POST /api/meetings`. Nút có khóa chống bấm-trùng bằng
  `useRef` (không dùng React state) vì state có thể bị stale-closure khi
  bấm rất nhanh nhiều lần liên tiếp.

## 3. Bước 2 — Tạo xong: AI Summary tự động + tính điểm lần đầu

Ngay trong `create_meeting` (`backend/app/routers/meetings.py`):

1. Nếu meeting có transcript/description, tự gọi
   `services/meeting_sync.py::summarize_meeting_with_ai_structured()` để
   sinh `ai_summary = {executive_summary, decisions, recommended_tasks}`
   (thử Gemini trước, rồi fallback OpenAI-compatible).
2. Gọi `services/meeting_score_engine.py::recalculate_meeting_score()` →
   ghi các cột `score_prep/execution/result/followthrough/feedback/total`
   lên bảng `meetings`.
3. Gửi thông báo Telegram (nếu bật).

Từ lúc này, mọi lần `GET /api/meetings` hoặc `GET /api/meetings/{id}` đều
trả kèm điểm hiện tại.

## 4. Công thức điểm (100 điểm, 5 phần)

File nguồn: `backend/app/services/meeting_score_engine.py`.

| Phần | Điểm | Công thức |
|---|---|---|
| **Chuẩn bị** | 25 | tên(2) + đúng dự án(3) + Mục tiêu(8) + Agenda(10) + ngày giờ(2). **Thiếu Mục tiêu hoặc Agenda → khóa cứng tối đa 5/25.** |
| **Điều hành** | 15 | đúng giờ(5) + đủ thành phần HOST/PM(5) + có transcript/AI Summary(5). 2 mục đầu chỉ tính được khi có dữ liệu `joined_at` thật (Zoom/Google sync); không có thì mặc định coi là đạt. |
| **Kết quả & KPI Tasks** | 35 | có quyết định(10) + có task đề xuất hoặc có lý do "không phát sinh task"(5) + %task đã đồng bộ thật×10 + %task đủ dự án/owner/hạn×10. **Có task đề xuất nhưng chưa cái nào đồng bộ xong → khóa mục này tối đa 15/35 VÀ tổng điểm cả meeting ≤ 69/100.** |
| **Thực thi** | 20 | %task đồng bộ hoàn thành đúng hạn×15 + 5đ mặc định "không phải họp lại". Meeting hợp lệ kiểu "không phát sinh task" (có lý do + có quyết định) → thẳng 20/20, không bị chấm 0 oan. |
| **Phản hồi** | 5 | tỷ lệ người bấm "Hữu ích" trong widget đánh giá nhanh × 5. |

`score_status`: `provisional` (còn task chưa tới hạn hoặc chưa đồng bộ) hay
`final` (mọi task liên kết đã tới hạn/hoàn tất, hoặc không có task nào cần
theo dõi).

**Thời điểm tính lại điểm** — gọi `recalculate_meeting_score()`:
tạo meeting, sửa meeting (`PUT`), push task
(`POST /{id}/push-tasks`), sau khi PM Import task thật ở Project Detail
(hook trong `chat_ai.py`), gửi feedback (`POST /{id}/feedback`), hoặc bấm
nút "↻ Tính lại điểm" thủ công (`POST /{id}/recalculate-score`).

## 5. Bước 3 — Đẩy task đề xuất vào KPI Tasks của dự án

Đây là phần hay bị hiểu nhầm nhất, vẽ chi tiết luồng:

1. Trong tab "Task đề xuất" ở chi tiết meeting, bấm "Tạo KPI Task" cho từng
   task AI đề xuất → `POST /api/meetings/{id}/push-tasks`.
2. Backend tạo 1 dòng **`AITaskInbox`** (bảng `chat_ai_tasks`) cho mỗi task,
   gắn `meeting_id` để trace ngược lại meeting nguồn. Đây **chưa phải** Task
   thật, chỉ là bản nháp chờ duyệt — dùng chung cơ chế với task bóc tách từ
   chat Telegram/Zalo.
3. `ai_task_inbox_id` được ghi ngược lại vào
   `meeting.ai_summary.recommended_tasks[i]` để biết task nào đã push rồi
   (chống push trùng).
4. PM vào **Project Detail → AI Task Inbox**, review từng dòng (chọn Phase,
   TaskGroup, Assigned, Support, Skill...), bấm **Import** →
   `POST /projects/{pid}/ai-task-inbox/{task_id}/import`
   (`backend/app/routers/chat_ai.py`) → tạo **Task thật** trong `tasks_v2`
   (bảng KPI chính thức, `recalculate_task()` chạy tính `kpi_base/kpi_final`
   ngay).
5. Đúng lúc import xong: `imported_task_id` được ghi lại vào
   `AITaskInbox.imported_task_id` **và** stamp ngược vào
   `meeting.ai_summary.recommended_tasks[i].imported_task_id`, đồng thời
   **tự động gọi lại `recalculate_meeting_score()`** cho meeting nguồn.

→ Chỉ khi qua đúng bước 4 (Import thành Task thật), task đó mới được tính
là "đã đồng bộ KPI" trong công thức điểm ở mục 4. Push xong ở bước 2 mà
chưa Import thì vẫn tính là "chưa đồng bộ", điểm Kết quả bị khóa.

## 6. Bước 4 — Xem chi tiết 1 meeting (`MeetingDetailModal.tsx`)

6 tab, mở bằng nút "Chi tiết" ở bảng danh sách:

| Tab | Nội dung |
|---|---|
| Tổng quan | Thông tin cuộc họp, thành viên, nhật ký hoạt động, AI tóm tắt + quyết định chính |
| AI Summary | Bản tóm tắt chi tiết dạng Sheet: ngày/tuần/thời lượng/team/organizer, "Task cha đã chốt" với đủ trường |
| Task đề xuất | Danh sách task AI bóc tách, nút "Tạo KPI Task" (→ mục 5) |
| Biên bản | Transcript thô, dán biên bản / chạy lại AI |
| Thông tin chi tiết | ID, link, dự án, payload AI thô (JSON) |
| **Hiệu quả** | Điểm 5 phần (mục 4) dạng progress bar, danh sách đồng bộ KPI Tasks theo từng item (Chưa push / Chờ import / Đã vào KPI Tasks), widget đánh giá nhanh |

Badge điểm ở đầu modal (`Hiệu quả xx/100`) và trên mỗi dòng bảng danh sách
đều đọc trực tiếp từ `meeting.score_total` — không tính riêng ở frontend.

## 7. Trang danh sách `/meetings`

Thứ tự đúng theo file thiết kế gốc, từ trên xuống: KPI grid (5 chỉ số) →
bộ lọc + lọc nhanh → **Cách tính điểm & kiểm tra tự động** (giải thích công
thức mục 4 cho người dùng) → **Hướng dẫn sử dụng & đặc tả triển khai**
(tab Nhân sự / Dev) → biểu đồ xu hướng + cảnh báo → bảng danh sách meeting →
insight grid 3 thẻ (tải theo dự án, top nhân sự, chất lượng vận hành).

Toàn bộ số liệu ở đây (KPI grid, chart, alerts, insight grid) lấy từ
`GET /api/meetings/insights` — tổng hợp thật từ bảng `meetings`, không có
số liệu giả.

## 8. Danh sách endpoint liên quan

```
GET    /api/meetings                       Danh sách (lọc theo project/status/ngày)
GET    /api/meetings/insights               Số liệu tổng hợp cho dashboard
GET    /api/meetings/{id}                    Chi tiết 1 meeting
POST   /api/meetings                         Tạo meeting (tự chạy AI Summary + tính điểm)
PUT    /api/meetings/{id}                    Sửa meeting (tính điểm lại)
POST   /api/meetings/{id}/transcript         Cập nhật biên bản
POST   /api/meetings/{id}/sync                Đồng bộ Zoom/Google Meet
POST   /api/meetings/{id}/push-tasks          Đẩy task đề xuất vào AI Task Inbox
POST   /api/meetings/{id}/recalculate-score   Tính lại điểm thủ công
POST   /api/meetings/{id}/feedback            Gửi đánh giá nhanh
POST   /api/meetings/generate-ai-content      AI Copilot soạn Mục tiêu/Agenda
POST   /api/meetings/generate-link            Tự sinh link Zoom/Google Meet
POST   /projects/{pid}/ai-task-inbox/{id}/import   Import task nháp → Task thật (chat_ai.py)
```

## 9. Giới hạn đã biết (chưa xử lý)

- "Đúng giờ" / "đủ thành phần bắt buộc" chỉ chính xác khi có dữ liệu
  `joined_at` thật từ Zoom/Google sync — meeting nhập tay mặc định coi là
  đạt vì không có gì để đối chiếu.
- Task hợp lệ hiện chỉ check đủ **Dự án + Owner + Hạn hoàn thành** (chưa có
  field KPI/Đầu ra mong đợi riêng — xem lý do trong lịch sử trao đổi, việc
  thêm 2 field này cần sửa vào màn hình review AI Task Inbox ở Project
  Detail, đang chủ động không đụng vào).
- Chống push trùng task dựa theo so khớp chuỗi `detail_task`, không phải ID
  — tương đối chứ chưa tuyệt đối.
- Không có cron tự tính lại điểm theo thời gian (ví dụ khi task vừa quá
  hạn) — chỉ tính lại khi có hành động cụ thể tác động tới meeting/task đó.
