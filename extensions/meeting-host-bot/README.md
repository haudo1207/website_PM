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

## Recording (chưa tự động hoá)

Vì Gmail cá nhân không có nút "Ghi lại" của Meet, phải tự quay màn hình ảo +
lấy nguồn âm thanh PulseAudio — mỗi profile 1 tiến trình ffmpeg riêng:

```bash
ffmpeg -f x11grab -video_size 1280x800 -i :101 \
       -f pulse -i <monitor-source-cho-:101> \
       -c:v libx264 -preset veryfast -c:a aac \
       ~/meeting-bot/recordings/ws1-$(date +%Y%m%d-%H%M%S).mp4
```

`background.js` **chưa tự gọi ffmpeg**. Bước tiếp theo hợp lý là 1 server nhỏ
chạy local trên VPS mà background.js gọi tới lúc mở/đóng tab meeting, để bản
ghi khớp đúng thời gian cuộc họp thật — chưa làm vì còn vài quyết định cuối
(ghi xong lưu/đẩy đi đâu, giữ file bao lâu, dung lượng ổ đĩa nếu 4 workspace
họp cùng lúc).

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
[MeetingBot] Host detected
[MeetingBot] Waiting room participant detected
[MeetingBot] Admit clicked
```

Nếu bot "im lặng không hoạt động", log sẽ cho biết dừng ở bước nào (queue rỗng?
không mở được tab? Join không detect được? vào phòng nhưng không phải host?
không detect được người chờ?).

## Giới hạn / rủi ro cần biết — đọc trước khi tin tưởng dùng thật

- **Selector Join/Admit trong `content.js` là dò theo text/aria-label** (tiếng Việt + tiếng Anh), vì Google Meet không có API DOM ổn định và hay đổi class/layout. **Chưa từng chạy thử với một cuộc Google Meet thật** — gần như chắc chắn cần tinh chỉnh regex khi test thật lần đầu (mở thử 1 cuộc họp tay trong đúng profile đó, kiểm tra lại aria-label/chữ trên nút nếu bot không phản ứng).
- **Google có thể coi đây là hành vi bất thường.** Điều khiển tự động liên tục 1 phiên Gmail cá nhân (tự bấm nút trong Meet) nằm ngoài cách dùng thông thường, có thể khiến Google yêu cầu xác minh lại — lúc đó auto-admit sẽ âm thầm ngừng hoạt động tới khi có người vào xác minh tay. Giữ nguyên `user-data-dir` của từng profile (đừng xoá) để giảm rủi ro này.
- **1 mail chỉ host được 1 cuộc cùng lúc** — đây là giới hạn của Google Meet, không phải bug của queue/extension. Nếu 2 meeting cùng workspace trùng giờ, chỉ 1 cuộc được auto-admit.
- `chrome.alarms` bị Chrome giới hạn tối thiểu 1 phút/lần — cadence 15-30s thực tế chạy qua vòng lặp `setTimeout` tự lặp lại trong `background.js`, alarm chỉ đóng vai trò "hồi phục" nếu service worker bị Chrome thu hồi giữa chừng.
- Dedupe theo `meeting_id` lưu trong `chrome.storage.local` — mỗi meeting chỉ tự mở tab Meet một lần trong vòng 6 giờ kể từ lúc mở, tránh mở lại tab liên tục mỗi lần poll.
- Chưa nhân bản ra WS2-WS4 — cấu hình hiện tại là 1 config cho 1 profile, làm WS1 ổn định trước rồi mới nhân ra.
