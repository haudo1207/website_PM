# Markee Meeting Host Bot

Chrome extension + hướng dẫn setup VPS để 1 trong 4 mail vận hành có thể tự
join Google Meet với vai trò **host**, tự "cho vào" người ở phòng chờ, và
(qua quay màn hình phía VPS, xem bên dưới — không phải tính năng của Meet)
được ghi hình lại — mà không cần ai phải đăng nhập tay vào mail đó để mở
cửa cho người khác.

## Vì sao cần cái này

4 mail vận hành này là Gmail cá nhân (đã xác nhận: toàn bộ đuôi `@gmail.com`,
nằm trong 1 nhóm Google Family), không phải Google Workspace. Gmail cá nhân
không có API để đổi quyền phòng họp Meet (`accessType=OPEN`) và cũng không
có nút "Ghi lại cuộc họp" — cả 2 đều là tính năng chỉ Workspace mới có. Cách
duy nhất để "ai có link cũng vào thẳng được" là phải có chính tài khoản
tổ chức (organizer) đang thực sự có mặt trong phòng họp để bấm cho vào, và
cách duy nhất để có bản ghi là tự quay lại màn hình. Vì vậy: một VPS giữ
sẵn 4 cửa sổ Chrome mở, mỗi cửa sổ đăng nhập 1 mail, đăng nhập 1 lần rồi để
nguyên đó, mỗi cửa sổ chạy extension này.

Phía backend (đã có sẵn trong repo): `backend/app/routers/meeting_bot.py`
mở endpoint `GET /api/meeting-bot/queue?google_email=...` (bảo vệ bằng biến
môi trường `MEETING_BOT_TOKEN` — cần set giống nhau ở cả backend và ở
extension). Endpoint này khớp từng meeting với đúng mail phụ trách qua
`Meeting.organizer_google_email` (đã lưu cố định lúc tạo meeting), hoặc nếu
chưa có thì lấy theo mail đã connect/mail dự kiến của workspace sở hữu
meeting đó.

## Setup VPS (làm 1 lần)

Hình dung: 1 VPS Linux nhỏ (2 vCPU / 4GB RAM là đủ cho 4 tab Meet chạy
nền), Ubuntu 22.04 trở lên.

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
  --load-extension=/duong-dan-toi/meeting-bot-extension \
  --no-first-run --disable-notifications &
```

Lặp lại với `:102`/`profile-ws2`, `:103`/`profile-ws3`, `:104`/`profile-ws4`.

**Bước đầu tiên cho mỗi profile (làm tay, chỉ 1 lần):** kết nối vào màn
hình ảo `:10X` đó qua VNC/x11vnc (hoặc dùng
`--remote-debugging-port` rồi mở DevTools từ máy mình qua SSH tunnel), đăng
nhập bình thường vào đúng tài khoản Gmail đó, xác nhận nếu Google hỏi
2FA/"thiết bị lạ", rồi vào `chrome://extensions` → bật extension đã load →
mở trang Options của nó → điền:
- **Backend API base URL**: `https://<domain-pm-cua-ban>/api/meeting-bot`
- **Bot token**: giống hệt giá trị `MEETING_BOT_TOKEN` trong `.env` của backend
- **Gmail của profile này**: đúng mail cửa sổ Chrome này đang đăng nhập
  (phải khớp chính xác với `organizer_google_email` / mail đã connect của
  workspace tương ứng).

Sau bước đó, profile giữ nguyên trạng thái đăng nhập vĩnh viễn (cookie lưu
trong `--user-data-dir`) — không cần làm tay lại mỗi ngày. Nên chạy mỗi cặp
`Xvfb` + `google-chrome` dưới dạng systemd service (`Restart=always`) để
VPS restart hay Chrome bị crash thì tự phục hồi (xem `systemd-example/`).

## Ghi hình (làm ở phía VPS, không phải tính năng của Meet)

Vì Gmail cá nhân không có nút "Ghi lại" của Meet, phải tự quay màn hình ảo
+ lấy nguồn âm thanh PulseAudio, ví dụ mỗi profile chạy 1 tiến trình ffmpeg
riêng, bật/tắt theo lúc vào/ra cuộc họp:

```bash
ffmpeg -f x11grab -video_size 1280x800 -i :101 \
       -f pulse -i <monitor-source-cho-:101> \
       -c:v libx264 -preset veryfast -c:a aac \
       ~/meeting-bot/recordings/ws1-$(date +%Y%m%d-%H%M%S).mp4
```

Phần này **hiện chưa được tự động hoá** — extension chưa tự bật/tắt ffmpeg
giúp bạn. Bước tiếp theo đơn giản nhất là viết 1 server nhỏ chạy local trên
VPS mà `background.js` gọi tới mỗi khi mở/đóng tab meeting, để đoạn ghi hình
khớp đúng thời gian cuộc họp thật — chưa làm sẵn vì còn phụ thuộc vài quyết
định cuối (ghi xong lưu ở đâu/đẩy lên đâu, giữ file bao lâu, dung lượng ổ
đĩa nếu 4 workspace họp cùng lúc).

## Giới hạn / rủi ro cần biết — đọc trước khi tin tưởng dùng thật

- **Google có thể coi đây là hành vi bất thường.** Việc điều khiển tự động
  liên tục 1 phiên Gmail cá nhân (tự bấm nút trong Meet) nằm ngoài cách
  dùng thông thường, có thể khiến Google yêu cầu xác minh lại "hoạt động
  bất thường" — lúc đó auto-admit sẽ âm thầm ngừng hoạt động cho tới khi có
  người vào xác minh lại tay. Giữ nguyên trạng thái đăng nhập của từng
  profile (đừng xoá `user-data-dir`) để giảm rủi ro này.
- **1 mail chỉ host được 1 cuộc cùng lúc.** Nếu 2 dự án cùng workspace họp
  trùng giờ, chỉ 1 cuộc được auto-admit; cuộc còn lại vẫn như hiện tại (cần
  người có quyền đăng nhập đúng mail đó).
- **Các selector trong `content.js` là phần dễ hỏng nhất** mỗi khi Google
  đổi giao diện Meet — xem comment ở đầu file đó để biết cách sửa (mở thử
  1 cuộc họp tay trong đúng profile đó rồi kiểm tra lại aria-label/chữ trên
  nút).
- Toàn bộ phần này **chưa từng chạy thử trên VPS thật** — đây là bản dựng
  đầu tiên để triển khai rồi chỉnh dần, chưa phải bản đã kiểm chứng ổn định.
