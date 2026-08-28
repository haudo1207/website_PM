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
Tạo AITaskInbox (gắn meeting_id) + tạo luôn Task thật trong tasks_v2
(inline, cùng 1 request) ──► hook tự động tính lại điểm meeting
     │
     └─ Lỗi khi tạo Task thật ──► rơi về AITaskInbox nháp ──► PM Import
        thủ công ở Project Detail (AI Task Inbox) ──► Task thật trong
        tasks_v2 ──► hook tự động tính lại điểm meeting
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
  `POST /api/meetings/generate-ai-content` với `{title}` (form Tạo meeting
  không có ô chọn dự án nên `project_name` không được gửi, dù backend có hỗ
  trợ optional) → backend gọi AI qua
  `services/ai_client.py::chat_completion_json()` → trả về `{goal, agenda}`
  để điền sẵn vào 2 ô trên. Người dùng sửa tự do trước khi lưu.
- **Thanh "Mức sẵn sàng trước họp"**: tính ngay trên frontend, mô phỏng 4/5
  thành phần công thức điểm Chuẩn bị ở backend (tên, Mục tiêu, Agenda, ngày
  giờ — xem mục 4). Thiếu thành phần "đúng dự án"(3đ) vì form không có ô
  chọn dự án, nên thanh này tối đa chỉ lên tới 22/25, không phải 25/25.
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

Đây là phần hay bị hiểu nhầm nhất, vẽ chi tiết luồng (đã đổi từ "tạo nháp
rồi PM Import" sang tạo Task thật ngay lập tức, kể từ commit
`feat(meetings): direct-import AI task push, redesign task table as cards,
drop review modal`):

1. Trong tab "Task đề xuất" ở chi tiết meeting, bấm **"📥 Đẩy task vào dự
   án"** cho từng task AI đề xuất (hoặc "📥 Đẩy task đã chọn vào Dự án" cho
   nhiều task cùng lúc) → `POST /api/meetings/{id}/push-tasks`.
2. Backend tạo 1 dòng **`AITaskInbox`** (bảng `chat_ai_tasks`) cho mỗi task,
   gắn `meeting_id` để trace ngược lại meeting nguồn — **và trong cùng
   request, tạo luôn Task thật trong `tasks_v2`** (mirror logic Import của
   `chat_ai.py`), stamp `AITaskInbox.status = "IMPORTED"` +
   `imported_task_id` ngay lập tức. Không còn bước "nháp chờ duyệt" ở giữa
   như trước.
3. `ai_task_inbox_id` và `imported_task_id` được ghi ngược lại vào
   `meeting.ai_summary.recommended_tasks[i]` để biết task nào đã push/đã
   vào KPI rồi (chống push trùng, so khớp theo chuỗi `detail_task`).
4. **`recalculate_meeting_score()`** được gọi ngay trong cùng request
   push-tasks, không cần chờ bước nào khác.
5. **Đường dự phòng**: nếu tạo Task thật thất bại khi push, dòng
   `AITaskInbox` vẫn ở trạng thái nháp — PM có thể vào **Project Detail →
   AI Task Inbox**, review và bấm **Import** thủ công →
   `POST /api/projects/{pid}/ai-task-inbox/{task_id}/import`
   (`backend/app/routers/chat_ai.py`) → tạo Task thật, ghi `imported_task_id`
   ngược lại meeting, và cũng tự động gọi lại `recalculate_meeting_score()`
   cho meeting nguồn. Đây giờ là **fallback**, không phải luồng chính.

→ Vì push-tasks giờ tạo Task thật ngay, một task được đẩy thành công là đã
tính "đã đồng bộ KPI" trong công thức điểm ở mục 4 luôn — không cần thêm
thao tác Import riêng như trước.

**Lưu ý:** widget "Hướng dẫn sử dụng" ngay trên trang `/meetings`
(`MeetingPlaybook.tsx`) hiện vẫn mô tả luồng cũ (2 bước, qua AI Task Inbox)
— UI copy đó cần cập nhật lại cho khớp.

## 6. Bước 4 — Xem chi tiết 1 meeting (`MeetingDetailModal.tsx`)

6 tab, mở bằng nút "Chi tiết" ở bảng danh sách:

| Tab | Nội dung |
|---|---|
| Tổng quan | Thông tin cuộc họp, thành viên, nhật ký hoạt động, AI tóm tắt + quyết định chính |
| AI Summary | Bản tóm tắt chi tiết dạng Sheet: ngày/tuần/thời lượng/team/organizer, "Task cha đã chốt" với đủ trường |
| Task đề xuất | Danh sách task AI bóc tách, nút "📥 Đẩy task vào dự án" (→ mục 5) |
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

Số liệu ở đây đến từ **2 nguồn thật** (không có số liệu giả, nhưng không
phải 1 nguồn duy nhất):
- Chart xu hướng, cảnh báo, và 2/3 card insight ("Tải theo dự án", "Top
  nhân sự") lấy từ `GET /api/meetings/insights`.
- KPI grid (5 chỉ số) và card insight thứ 3 ("Chất lượng vận hành họp")
  tính client-side ngay trên frontend, từ dữ liệu `GET /api/meetings`
  (danh sách meeting thường) — không gọi `/insights`.

## 8. Danh sách endpoint liên quan

```
GET    /api/meetings                       Danh sách (lọc theo project/status/ngày)
GET    /api/meetings/insights               Số liệu tổng hợp cho dashboard (chart/alerts/2 insight card)
GET    /api/meetings/{id}                    Chi tiết 1 meeting
POST   /api/meetings                         Tạo meeting (tự chạy AI Summary + tính điểm)
PUT    /api/meetings/{id}                    Sửa meeting (tính điểm lại)
DELETE /api/meetings/{id}                    Xóa meeting
POST   /api/meetings/{id}/transcript         Cập nhật biên bản
POST   /api/meetings/{id}/sync                Đồng bộ Zoom/Google Meet (không tính lại điểm)
POST   /api/meetings/{id}/push-tasks          Đẩy task đề xuất → tạo Task thật ngay (tính lại điểm)
POST   /api/meetings/{id}/recalculate-score   Tính lại điểm thủ công
POST   /api/meetings/{id}/feedback            Gửi đánh giá nhanh (tính lại điểm)
POST   /api/meetings/generate-ai-content      AI Copilot soạn Mục tiêu/Agenda
POST   /api/meetings/generate-link            Tự sinh link Zoom/Google Meet
POST   /api/meetings/webhook/n8n-summary      Nhận AI Summary tự động từ n8n (tạo/cập nhật meeting
                                               theo id/url/title+ngày — luồng tạo meeting song song,
                                               không qua form thủ công; xem badge "🤖 Tự động tạo từ n8n")
POST   /api/projects/{pid}/ai-task-inbox/{task_id}/import   Import task nháp → Task thật
                                               (chat_ai.py, fallback khi push-tasks lỗi — xem mục 5)
```

## 9. Giới hạn đã biết (chưa xử lý)

- "Đúng giờ" / "đủ thành phần bắt buộc" chỉ chính xác khi có dữ liệu
  `joined_at` thật từ Zoom/Google sync — meeting nhập tay mặc định coi là
  đạt vì không có gì để đối chiếu.
- Endpoint `POST`/`DELETE /api/meetings/{id}/members` là nơi duy nhất tạo
  `MeetingMember.joined_at` thật (nguồn dữ liệu duy nhất cho điểm Đúng giờ/
  Đủ thành phần ở mục 4) — nhưng UI hiện tại **không gọi 2 endpoint này**;
  nút "thêm thành viên" đi qua `PUT /{id}` với `ai_summary.custom_members`,
  không tạo `MeetingMember` thật. Vì vậy trên thực tế 2 mục điểm này gần
  như luôn mặc định "đạt", trừ khi có sync Zoom/Google thật.
- Task hợp lệ hiện chỉ check đủ **Dự án + Owner + Hạn hoàn thành** (chưa có
  field KPI/Đầu ra mong đợi riêng — xem lý do trong lịch sử trao đổi, việc
  thêm 2 field này cần sửa vào màn hình review AI Task Inbox ở Project
  Detail, đang chủ động không đụng vào).
- Chống push trùng task dựa theo so khớp chuỗi `detail_task`, không phải ID
  — tương đối chứ chưa tuyệt đối.
- Không có cron tự tính lại điểm theo thời gian (ví dụ khi task vừa quá
  hạn) — chỉ tính lại khi có hành động cụ thể tác động tới meeting/task đó.
