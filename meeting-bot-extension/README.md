# Markee Meeting Host Bot

Chrome extension + VPS setup so any of the 4 operational Gmail mailboxes can
auto-join its own Google Meet meetings as **host**, auto-admit guests from
the waiting room, and (via VPS-side screen capture, see below — not a Meet
feature) get recorded — without anyone needing to manually log into that
mailbox to open the door.

## Why this exists

These 4 mailboxes are personal Gmail accounts (confirmed: all `@gmail.com`,
added to a Google Family group), not Google Workspace. Personal Gmail has
no API to change a Meet space's access policy (`accessType=OPEN`) and no
native "Record meeting" button — both are Workspace-only features. The only
way to get "anyone with the link walks straight in" behavior is to have the
actual organizer account physically present in the call to admit people,
and the only way to get a recording is to capture the screen ourselves.
Hence: a VPS keeps 4 Chrome windows open, one per mailbox, each signed in
once and left logged in, each running this extension.

Backend side (already in this repo): `backend/app/routers/meeting_bot.py`
exposes `GET /api/meeting-bot/queue?google_email=...` (protected by the
`MEETING_BOT_TOKEN` env var — set it in `.env` on both backend and here).
It matches meetings to mailboxes via `Meeting.organizer_google_email`
(frozen at creation time) or, as a fallback, the owning workspace's
connected/expected Google account.

## VPS setup (one-time)

Tested shape: any small Linux VPS (2 vCPU / 4GB RAM is enough for 4 idle
Meet tabs), Ubuntu 22.04+.

```bash
sudo apt update
sudo apt install -y xvfb google-chrome-stable ffmpeg pulseaudio
```

For each of the 4 mailboxes, create an isolated Chrome profile dir and a
virtual display:

```bash
mkdir -p ~/meeting-bot/profile-ws1
Xvfb :101 -screen 0 1280x800x24 &
DISPLAY=:101 google-chrome \
  --user-data-dir=$HOME/meeting-bot/profile-ws1 \
  --load-extension=/path/to/meeting-bot-extension \
  --no-first-run --disable-notifications &
```

Repeat with `:102`/`profile-ws2`, `:103`/`profile-ws3`, `:104`/`profile-ws4`.

**First run per profile (manual, one-time):** connect via VNC/x11vnc to that
`:10X` display (or `--remote-debugging-port` + a local Chrome DevTools
session tunneled over SSH), log into the corresponding Gmail account
normally, approve any 2FA/"new device" prompt, then open
`chrome://extensions` → enable the unpacked extension → open its Options
page → fill in:
- **Backend API base URL**: `https://<your-pm-domain>/api/meeting-bot`
- **Bot token**: same value as `MEETING_BOT_TOKEN` in the backend's `.env`
- **Gmail of this profile**: the exact mailbox this Chrome window is signed
  into (must match `organizer_google_email` / the workspace's connected
  Google account exactly).

After that, the profile stays logged in indefinitely (cookies persist in
`--user-data-dir`) — no more manual steps needed day-to-day. Run each
`Xvfb` + `google-chrome` pair under a systemd unit (`Restart=always`) so a
VPS reboot or a Chrome crash recovers on its own; see `systemd-example/`.

## Recording (VPS-side, not Meet's own feature)

Since personal Gmail has no native "Record" button, capture the virtual
display + a PulseAudio monitor source instead, e.g. one ffmpeg process per
profile, started/stopped alongside the meeting window:

```bash
ffmpeg -f x11grab -video_size 1280x800 -i :101 \
       -f pulse -i <monitor-source-for-:101> \
       -c:v libx264 -preset veryfast -c:a aac \
       ~/meeting-bot/recordings/ws1-$(date +%Y%m%d-%H%M%S).mp4
```

This is a separate, still-to-be-wired piece: nothing in this extension
starts/stops ffmpeg yet. The simplest next step is a small script the bot's
`background.js` could ping (e.g. via a tiny local HTTP server on the VPS)
when it opens/closes a meeting tab, so recording brackets line up with the
actual call — not built here because it depends on final choices (where
recordings get uploaded, retention, disk sizing for 4 concurrent calls).

## Known limitations / risks — read before relying on this

- **Google may flag the automation.** Persistent scripted control of a
  personal Gmail session (auto-clicking Meet's UI) is outside normal usage
  patterns and could trigger an "unusual activity" / re-verification
  prompt, which would silently break auto-admit until someone manually
  re-verifies. Keep each profile's login stable (don't reset
  `user-data-dir`) to minimize this.
- **One mailbox = one concurrent meeting.** If two projects under the same
  workspace are scheduled at the same time, only one gets auto-admit; the
  other behaves like today (needs a human with access to that Gmail).
- **`content.js` selectors are the most likely thing to break** when
  Google ships a Meet UI change — see the comment at the top of that file
  for how to fix it (re-check aria-labels/button text in a manual session).
- Nothing here has been run against a live VPS yet — this is a first
  implementation to deploy and iterate on, not a battle-tested one.
