# Markee Meeting Host Bot — Chrome Extension

Tự động Join + Admit Google Meet dưới tài khoản Gmail đang đăng nhập trong
Chrome profile này, dựa trên `GET /api/meeting-bot/queue`. Trước khi bấm
"Cho vào" cho người khác, bot tự tắt mic/cam của chính nó — vì tài khoản này
chỉ đóng vai trò host để mở cửa, không cần phát tiếng/hình.

Bản này hợp nhất 2 phiên bản từng được xây độc lập (bản backend/local session
và bản đã merge trước đó vào `dev` bởi CTO) thành một bản duy nhất, lấy điểm
mạnh của cả hai — xem lịch sử git nếu cần đối chiếu chi tiết khác biệt.

## Vì sao cần cái này (đã xác nhận, không phải giả định)

4 mail vận hành là Gmail cá nhân (`@gmail.com`, cùng 1 nhóm Google Family),
**không phải Google Workspace**. Gmail cá nhân không có API đổi quyền phòng
họp Meet (`accessType=OPEN`) và cũng không có nút "Ghi lại cuộc họp" — cả 2
đều là tính năng chỉ Workspace mới có. Cách duy nhất để "ai có link cũng vào
thẳng được" là phải có chính tài khoản organizer đang thực sự có mặt trong
phòng để bấm cho vào, và cách duy nhất để có bản ghi là tự quay màn hình VPS
(FFmpeg — xem mục Recording bên dưới, **chưa tự động hoá**).

## Cài đặt (mỗi Chrome profile / mỗi tài khoản Gmail)

1. `chrome://extensions` → bật **Developer mode** → **Load unpacked** → chọn thư mục này.
2. Click icon extension (hoặc `chrome://extensions` → **Details** → **Extension options**) để mở trang cấu hình.
3. Điền:
   - **API Base URL**: domain backend, vd `https://kpi.markeeai.com` hoặc `http://localhost:8000` (không có `/api` ở cuối).
   - **Google Email**: đúng bằng `Meeting.organizer_google_email` (hoặc mail workspace đã connect) mà backend gán cho meeting của tài khoản này.
   - **Bot Token**: giá trị `MEETING_BOT_TOKEN` đã cấu hình trên backend.
   - **Poll interval**: mặc định 20s (khuyến nghị 15-30s).
4. Bấm **Lưu cấu hình** → Chrome sẽ hỏi cấp quyền truy cập domain API Base URL, chọn **Allow**.
5. Bấm **Kiểm tra ngay** để test poll thủ công lần đầu.

## Setup VPS (production, 4 profile song song)

1 VPS Linux nhỏ (2 vCPU / 4GB RAM đủ cho 4 tab Meet chạy nền), Ubuntu 22.04+:

```bash
sudo apt update
sudo apt install -y xvfb google-chrome-stable ffmpeg pulseaudio
```

Với mỗi mail trong 4 mail, tạo 1 thư mục profile Chrome riêng + 1 màn hình ảo:

```bash
mkdir -p ~/meeting-bot/profile-ws1
Xvfb :101 -screen 0 1280x800x24 &
DISPLAY=:101 google-chrome \
  --user-data-dir=$HOME/meeting-bot/profile-ws1 \
  --load-extension=/duong-dan-toi/extensions/meeting-host-bot \
  --no-first-run --disable-notifications &
```

Lặp lại với `:102`/`profile-ws2`, `:103`/`profile-ws3`, `:104`/`profile-ws4`.

**Bước đầu tiên cho mỗi profile (làm tay, chỉ 1 lần):** kết nối vào màn hình
ảo `:10X` qua VNC/x11vnc (hoặc `--remote-debugging-port` + SSH tunnel), đăng
nhập đúng tài khoản Gmail đó, xác nhận nếu Google hỏi 2FA/"thiết bị lạ", rồi
mở Options của extension (xem mục Cài đặt ở trên).

Sau bước đó, profile giữ nguyên trạng thái đăng nhập vĩnh viễn (cookie lưu
trong `--user-data-dir`) — không cần làm tay lại mỗi ngày. Nên chạy mỗi cặp
`Xvfb` + `google-chrome` dưới dạng systemd service (`Restart=always`) để VPS
restart hay Chrome crash thì tự phục hồi.

## Recording (tự động, xác nhận hoạt động 2026-09-11 trên VPS)

Vì Gmail cá nhân không có nút "Ghi lại" của Meet, VPS tự quay màn hình ảo +
lấy nguồn âm thanh PulseAudio bằng ffmpeg, điều khiển qua `recorder_service.py`
— một HTTP service nhỏ (chỉ dùng thư viện chuẩn Python, không cần cài thêm
gói) chạy local trên **cùng VPS** với Chrome, bind `127.0.0.1` only:

```bash
python3 recorder_service.py
# hoặc chỉnh qua env: RECORDER_PORT, RECORDER_DISPLAY, RECORDER_AUDIO_SOURCE,
# RECORDER_OUTPUT_DIR, RECORDER_RESOLUTION, RECORDER_FRAMERATE
```

`background.js` gọi `POST http://127.0.0.1:8765/record/start` ngay khi
`content.js` báo `HOST_DETECTED` (đã thực sự vào cuộc gọi, không phải lúc
còn ở lobby), và `POST /record/stop` khi `content.js` báo `CALL_ENDED` (nút
"Leave call" biến mất trở lại — ví dụ khi Meet tự đá host ra sau khi ở một
mình quá lâu) hoặc khi tab bị đóng (`chrome.tabs.onRemoved`, phòng trường hợp
content.js không kịp báo). Cả hai request đều gửi `meeting_id` để service
đặt tên file `<meeting_id>_<timestamp>.mp4` trong `RECORDER_OUTPUT_DIR`
(mặc định `~/meeting-bot/recordings/`).

Recording không bao giờ chặn Join/Admit — nếu `recorder_service.py` chưa
chạy hoặc không gọi được, `background.js` chỉ log lỗi rồi tiếp tục bình
thường (xem `startRecording`/`stopRecording` trong `background.js`).

Kiểm tra thủ công 1 lần cùng ffmpeg 4.2.7 trên VPS thật, quay 15s trong lúc
có cuộc gọi thật đang chạy: ra file mp4 hợp lệ, có cả video (h264, đúng độ
phân giải Xvfb) lẫn audio (aac) — xem checkpoint trong memory
`meeting-host-bot-design` nếu cần đối chiếu chi tiết.

### Upload lên Drive cho pipeline AI Summary (tự động)

Ngay trước khi gọi `/record/stop`, `background.js` gọi thêm
`GET /api/meeting-bot/drive-token?meeting_id=...` (cùng `apiBaseUrl`/`botToken`
đã cấu hình) để lấy 1 access token Google ngắn hạn (~1h) + tên file đích, rồi
gửi kèm trong body `/record/stop` dưới key `upload`. `recorder_service.py`
tự upload thẳng file vừa quay lên Google Drive bằng chính token đó (resumable
upload qua `urllib` thư viện chuẩn, không cần cài `google-api-python-client`)
— **file không đi qua backend**, backend chỉ phát token, không đụng vào bytes
video. Đây cũng là lý do endpoint đó không nhận `refresh_token`/`client_secret`
gửi ra ngoài — chỉ 1 access token sống ngắn.

Tên file luôn có dạng `[MK-{meeting_id}] {title}.mp4` — đúng định dạng mà n8n
node "W3. Search Video By Tag" (`Meeting_AI_Summary_dev.json`) đang search
trên toàn bộ Drive (`name contains 'MK-{tag}' and mimeType contains 'video/'`),
tag giống hệt tag đã gắn vào tiêu đề Calendar event lúc tạo meeting
(`create_google_meet_shared`) — không cần thêm cột DB nào, vì tag luôn chính
là `meeting_id`.

Việc upload cũng additive như chính recording — nếu fetch token lỗi hoặc
Drive upload lỗi (`drive_upload_error` trong response), file mp4 vẫn nằm an
toàn trên đĩa VPS, không mất gì, chỉ là chưa lên được Drive.

**Chưa làm (việc kế tiếp, không phải bug):** test với 1 `meeting_id` thật (có
dòng `Meeting` thật trong DB) để xác nhận n8n thực sự nhặt được file — lúc
build tính năng này chưa có sẵn 1 meeting thật đang chạy trên VPS để test hết
chain. Cũng chưa test 4 workspace ghi hình đồng thời (RAM/disk headroom, xem
mục Setup VPS).

## Đọc log ở đâu (dễ nhầm — đọc kỹ)

Có **hai nơi log riêng biệt**:

- **Log polling queue** (`Queue checked`, `Found meeting #...`, `Opening Meet`) nằm trong **Service Worker console** của extension: `chrome://extensions` → tìm extension này → bấm **Service worker** (hoặc "Inspect views: service worker") → tab Console.
- **Log Join/Admit** (`Join detected`, `Host detected`, `Waiting room participant detected`, `Admit clicked`) nằm trong **DevTools của chính tab Meet** (F12 ngay trên tab đang mở cuộc họp) — vì content.js chạy trong ngữ cảnh trang web, không phải service worker.

Chuỗi log đầy đủ khi mọi thứ chạy đúng:

```
[MeetingBot] Queue checked (1 meeting)      ← service worker console
[MeetingBot] Found meeting #12
[MeetingBot] Opening Meet
[MeetingBot] Join detected                  ← Meet tab console
[MeetingBot] Host detected                  ← cũng kích hoạt recording start
[MeetingBot] Waiting room participant detected
[MeetingBot] Admit clicked
[MeetingBot] Call ended                     ← khi rời cuộc gọi, kích hoạt recording stop
```

Log `Recording start:`/`Recording stop:` (kết quả gọi `recorder_service.py`)
nằm ở **Service Worker console** (background.js gọi, không phải content.js).

Nếu bot "im lặng không hoạt động", log sẽ cho biết dừng ở bước nào (queue rỗng?
không mở được tab? Join không detect được? vào phòng nhưng không phải host?
không detect được người chờ?).

## Giới hạn / rủi ro cần biết — đọc trước khi tin tưởng dùng thật

- **Selector Join/Admit trong `content.js` là dò theo text/aria-label** (tiếng Việt + tiếng Anh), vì Google Meet không có API DOM ổn định và hay đổi class/layout. Đã xác nhận chạy PASS end-to-end (Join → Host → Waiting room → Admit) trên cả Chrome desktop thật (WS1-3, 2026-09-11) lẫn VPS/Xvfb (WS1, 2026-09-11, dùng CDP `chrome.debugger` cho riêng bước Join — xem comment trong `content.js`/`background.js`). Meet có thể đổi wording/DOM bất kỳ lúc nào — nếu bot đột nhiên "im lặng", tra lại theo mục log bên dưới trước khi nghi ngờ selector.
- **Google có thể coi đây là hành vi bất thường.** Điều khiển tự động liên tục 1 phiên Gmail cá nhân (tự bấm nút trong Meet) nằm ngoài cách dùng thông thường, có thể khiến Google yêu cầu xác minh lại — lúc đó auto-admit sẽ âm thầm ngừng hoạt động tới khi có người vào xác minh tay. Giữ nguyên `user-data-dir` của từng profile (đừng xoá) để giảm rủi ro này.
- **1 mail chỉ host được 1 cuộc cùng lúc** — đây là giới hạn của Google Meet, không phải bug của queue/extension. Nếu 2 meeting cùng workspace trùng giờ, chỉ 1 cuộc được auto-admit.
- `chrome.alarms` bị Chrome giới hạn tối thiểu 1 phút/lần — cadence 15-30s thực tế chạy qua vòng lặp `setTimeout` tự lặp lại trong `background.js`, alarm chỉ đóng vai trò "hồi phục" nếu service worker bị Chrome thu hồi giữa chừng.
- Dedupe theo `meeting_id` lưu trong `chrome.storage.local` — mỗi meeting chỉ tự mở tab Meet một lần trong vòng 6 giờ kể từ lúc mở, tránh mở lại tab liên tục mỗi lần poll.
- Chưa nhân bản ra WS2-WS4 — cấu hình hiện tại là 1 config cho 1 profile, làm WS1 ổn định trước rồi mới nhân ra.
