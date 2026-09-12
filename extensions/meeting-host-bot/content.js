// Runs on meet.google.com. Detects Join/Ask-to-join (muting mic/cam first,
// since this account IS the host and shouldn't broadcast audio/video just to
// admit people), then watches for waiting-room participants and admits them
// (bulk "Admit all" first, falling back to one-at-a-time).
//
// IMPORTANT: this is best-effort DOM matching, not a stable Google Meet API —
// Meet's markup uses obfuscated/rotating class names, so matching is done on
// visible text / aria-label (Vietnamese + English UI). Expect to tune the
// regexes below against the real UI during the VPS test, using the console
// logs as a guide to exactly which step failed.
//
// These console.log lines print to the MEET TAB's own DevTools console
// (F12 on that tab) — NOT to the extension's service-worker "Inspect" view,
// which only shows background.js's queue-polling logs.
const LOG_PREFIX = "[MeetingBot]";
function log(...args) {
  console.log(LOG_PREFIX, ...args);
}

const MIC_OFF_RE = /(turn off microphone|tắt micrô|tắt microphone)/i;
const CAM_OFF_RE = /(turn off camera|tắt camera)/i;
// Confirmed live 2026-09-11: on a VPS with no real camera/mic hardware, Meet
// renames the button to "Join now without microphone & camera" — anchoring
// to the exact string "^join now$" (as this used to) never matches that
// variant, which every headless/VPS profile will always hit. Matching "join
// now" as a substring instead covers it without hard-coding one exact
// string, since Meet's exact wording can vary by environment/language.
const JOIN_TEXT_RE = /(join now|ask to join|tham gia ngay|xin tham gia|yêu cầu tham gia|tham gia mà không)/i;
const LEAVE_CALL_RE = /(leave call|rời khỏi cuộc gọi|rời cuộc gọi)/i;
// Confirmed live 2026-09-12: as the meeting's host, clicking "Leave call"
// doesn't leave directly — it opens a submenu with two real choices ("Just
// leave the call" / "End the call for everyone"), same two-step shape as
// the "Admit all?" confirmation dialog elsewhere in this file. Only the
// former should ever be clicked automatically.
const JUST_LEAVE_RE = /(just leave the call|chỉ rời khỏi cuộc gọi|chỉ rời cuộc gọi)/i;
// Confirmed live 2026-09-11: this account's real Meet UI shows "Admit N
// guest(s)" (not "Admit all") as the bulk button — it admits every guest
// currently waiting, whatever N is. Label can arrive as
// "Admit 1 guest\ncheck" (an icon's alt text tacked on by innerText), so
// this is intentionally NOT anchored to the full string.
const ADMIT_ALL_RE = /(admit all|cho tất cả vào|cho vào tất cả|admit\s+\d+\s+guests?)/i;
// Real per-person button's aria-label is "Admit {name}" (e.g. "Admit h"),
// not the bare word "Admit" — confirmed live via outerHTML dump 2026-09-11.
const ADMIT_ONE_RE = /(^admit\b|^chấp nhận|^cho vào)/i;
// Broad net for the debug scan below — deliberately looser than the real
// ADMIT_* regexes above, so it catches the real button even if its actual
// wording doesn't match what we guessed.
const DEBUG_CANDIDATE_RE = /(admit|cho vào|chấp nhận|tham gia|join|wants to|muốn tham gia|waiting|phòng chờ|yêu cầu|request to)/i;

let joinClicked = false;
let joinAttemptInFlight = false;
let joinDetectedLogged = false;
let hostDetected = false;
let callEndedNotified = false;
const _loggedCandidates = new Set();

function visibleText(el) {
  return (el.innerText || el.textContent || "").trim();
}

function allButtons() {
  return document.querySelectorAll('button, [role="button"]');
}

function findClickableByText(regex) {
  for (const el of allButtons()) {
    const label = el.getAttribute("aria-label") || visibleText(el);
    if (label && regex.test(label)) return el;
  }
  return null;
}

// Confirmed live 2026-09-11 via a direct xdotool (real X11-level) click test
// on the VPS: el.click() alone worked fine on real desktop Chrome (WS1-3)
// but silently failed to trigger Meet's "Join now" button under Xvfb — no
// error, but the button never actually reacted. Meet's buttons are Material
// "ripple" buttons wired to pointerdown/pointerup (not just click), which
// el.click() never dispatches (it only synthesizes a bare "click" event).
// Firing the full pointerdown -> mousedown -> pointerup -> mouseup -> click
// sequence matches what a real click produces and is a strict superset of
// plain el.click(), so this doesn't regress the already-working desktop path.
function fireClick(el) {
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0 };
  el.dispatchEvent(new PointerEvent("pointerdown", { ...base, pointerId: 1, isPrimary: true }));
  el.dispatchEvent(new MouseEvent("mousedown", base));
  el.dispatchEvent(new PointerEvent("pointerup", { ...base, pointerId: 1, isPrimary: true }));
  el.dispatchEvent(new MouseEvent("mouseup", base));
  el.dispatchEvent(new MouseEvent("click", base));
}

function clickIfFound(regex) {
  const el = findClickableByText(regex);
  if (el) {
    fireClick(el);
    return true;
  }
  return false;
}

// Confirmed live 2026-09-11 via outerHTML dump: Meet's waiting-room area has
// TWO look-alike elements that also match "admit"-ish text but are NOT
// action buttons — a floating notification badge (`aria-haspopup="dialog"`,
// just opens the People panel) and the "Waiting to be admitted" section
// header (`aria-expanded`, just expands/collapses the list). Both are
// `<div role="button">`, not real `<button>` elements. Restricting to real
// <button> tags AND excluding aria-haspopup/aria-expanded is what actually
// tells these apart from the genuine "Admit all" / "Admit {name}" buttons —
// matching on text alone (as findClickableByText does) clicks the wrong one.
// Confirmed live 2026-09-11: clicking the panel's "Admit all" button doesn't
// admit anyone directly — it opens an "Admit all?" CONFIRMATION dialog
// (Cancel / Admit all) listing the waiting guest(s) by name. That dialog's
// own "Admit all" button is a SEPARATE element with the same label. Using
// el.click() bypasses the dialog's visual overlay (unlike a real click,
// which the overlay would block), so without this the panel's original
// button kept re-triggering the confirmation instead of ever confirming it.
// Searching inside an open dialog first ensures we click the confirm
// button, not the thing that opened it.
function findActionButton(regex) {
  const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]');
  const scope = dialog || document;
  for (const el of scope.querySelectorAll("button")) {
    if (el.hasAttribute("aria-haspopup") || el.hasAttribute("aria-expanded")) continue;
    const label = el.getAttribute("aria-label") || visibleText(el);
    if (label && regex.test(label)) return el;
  }
  return null;
}

function clickActionButton(regex) {
  const el = findActionButton(regex);
  if (el) {
    fireClick(el);
    return true;
  }
  return false;
}

// Confirmed live 2026-09-11 via a direct xdotool-vs-JS-click A/B test on the
// VPS: fireClick() (full pointerdown/mousedown/pointerup/mouseup/click,
// still JS-dispatched) does NOT trigger Meet's "Join now" button under
// Xvfb — only genuinely-trusted input does (xdotool at the OS level, and
// separately confirmed Chrome's own CDP Input.dispatchMouseEvent). content.js
// has no access to CDP itself — only the extension's privileged background
// page can use chrome.debugger — so Join specifically hands off the actual
// click to background.js instead of calling fireClick() here. Every other
// click in this file (mic/cam mute, Admit) stays on fireClick(): Admit was
// already confirmed working that way live, so there's no reason to route it
// through CDP too.
// No coordinates sent here on purpose — background.js re-locates the button
// itself, after it has attached the debugger, since attaching can shift the
// page (Chrome's own "being debugged" infobar) and stale coordinates
// computed here would miss. Confirmed live 2026-09-11: the button can also
// briefly exist mid-render with zero width/height before Meet finishes
// laying it out — background.js retries the lookup itself, but if it still
// comes back empty, joinClicked stays false here so the next 1.5s tick just
// tries again instead of giving up after one bad-timing attempt.
function requestCdpJoinClick() {
  chrome.runtime.sendMessage({ action: "CDP_CLICK_JOIN" }, (response) => {
    joinAttemptInFlight = false;
    if (chrome.runtime.lastError) {
      log("CDP click request failed:", chrome.runtime.lastError.message);
      return;
    }
    if (response && response.success === false) {
      log("CDP click failed, will retry:", response.error);
      return;
    }
    joinClicked = true;
  });
}

function tryClickJoin() {
  if (joinClicked || joinAttemptInFlight) return;
  const el = findClickableByText(JOIN_TEXT_RE);
  if (el) {
    if (!joinDetectedLogged) {
      log("Join detected");
      joinDetectedLogged = true;
    }
    joinAttemptInFlight = true;
    requestCdpJoinClick();
    return;
  }
  // Mute opportunistically every tick until Join itself is found — the
  // mic/cam toggles and the Join button don't always render in the same
  // frame, so this can't be a single one-shot check before clicking Join.
  clickIfFound(MIC_OFF_RE);
  clickIfFound(CAM_OFF_RE);
}

function checkHostState() {
  if (hostDetected) return;
  // Presence of the "leave call" control is the most reliable in-call signal —
  // it only exists once you're actually inside the meeting, not in the
  // pre-join lobby.
  if (findClickableByText(LEAVE_CALL_RE)) {
    hostDetected = true;
    log("Host detected");
    // Recording starts from here, not from Join — Join can fire multiple
    // failed CDP attempts before actually landing in the call (see
    // requestCdpJoinClick's retry comments above), and the lobby itself has
    // nothing worth recording.
    chrome.runtime.sendMessage({ action: "HOST_DETECTED" });
  }
}

// Native Google Meet recording (built 2026-09-12). Confirmed live that this
// account has a genuinely enabled (non-disabled) "Start recording" control —
// earlier project notes assumed personal Gmail accounts never get this, which
// turned out to be stale. NOT yet confirmed to reliably produce a finished
// recording end-to-end (one manual test's tab lost its CDP target right after
// confirming the dialog, before a "recording in progress" indicator could be
// verified) — kept running ALONGSIDE the existing FFmpeg/recorder_service.py
// capture as a safety net, not as a replacement, until several real runs
// confirm this path is trustworthy on its own.
const MEETING_TOOLS_RE = /^meeting tools$/i;
const START_RECORDING_RE = /^start recording$/i;
const STOP_RECORDING_RE = /^stop recording$/i;
const RECORD_ITEM_PRESENT_RE = /capture the meeting/i;
const NATIVE_RECORDING_PANEL_OPEN_ATTEMPTS_MAX = 15; // ~22s at the 1.5s tick rate

let nativeRecordingStarted = false;
let nativeRecordingUnavailableLogged = false;
let nativeRecordingPanelOpenAttempts = 0;

function tryStartNativeRecording() {
  if (!hostDetected || nativeRecordingStarted) return;

  // Step 3: the "Make sure everyone is ready" consent dialog is open —
  // confirm it. Scoped to dialogs whose text mentions "ready" so this never
  // matches an unrelated dialog's own generically-labeled "Start" button.
  const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]');
  if (dialog && /ready/i.test(dialog.innerText || "")) {
    const startBtn = Array.from(dialog.querySelectorAll("button")).find(
      (b) => (b.getAttribute("aria-label") || visibleText(b)).trim().toLowerCase() === "start"
    );
    if (startBtn) {
      fireClick(startBtn);
      nativeRecordingStarted = true;
      log("Native recording: Start confirmed");
      return;
    }
  }

  // Step 2c: "Start recording" is already visible (drilled into the Record
  // sub-panel) — click it, which opens the dialog handled in step 3 above
  // on a later tick.
  if (clickIfFound(START_RECORDING_RE)) {
    log("Native recording: clicked Start recording");
    return;
  }

  // Step 2b: the "Meeting tools" panel is open and showing the Tools list
  // (the "Record / Capture the meeting" row, with a chevron — it's a nav
  // item, not a leaf action, confirmed live 2026-09-13: the earlier version
  // of this function assumed "Start recording" appeared inline here and
  // just kept re-toggling the panel forever without this extra click).
  // Click the row itself to drill into the sub-panel where "Start
  // recording" actually lives.
  if (RECORD_ITEM_PRESENT_RE.test(document.body.innerText || "")) {
    if (clickIfFound(RECORD_ITEM_PRESENT_RE)) {
      log("Native recording: opened Record sub-panel");
    }
    return;
  }

  // Step 2a: open the "Meeting tools" panel, but only if it isn't already
  // open (the same button toggles it closed on a second click) — checked
  // via the same "Capture the meeting" text step 2b looks for.
  if (nativeRecordingPanelOpenAttempts >= NATIVE_RECORDING_PANEL_OPEN_ATTEMPTS_MAX) {
    if (!nativeRecordingUnavailableLogged) {
      log("Native recording: 'Start recording' never appeared after opening Meeting tools repeatedly — likely unavailable for this account, giving up (FFmpeg recording is unaffected).");
      nativeRecordingUnavailableLogged = true;
    }
    return;
  }
  if (clickIfFound(MEETING_TOOLS_RE)) {
    nativeRecordingPanelOpenAttempts += 1;
    log("Native recording: opened Meeting tools panel");
  }
}

// Mirrors tryStartNativeRecording()'s panel-then-click shape. Not yet
// live-verified (no test run has reached an active-recording state long
// enough to test stopping it) — logged defensively so a wrong selector shows
// up in the console instead of silently leaving a native recording running
// after the bot has left the call.
function tryStopNativeRecording() {
  if (!nativeRecordingStarted) return;
  if (clickIfFound(STOP_RECORDING_RE)) {
    log("Native recording: clicked Stop recording");
    return;
  }
  if (RECORD_ITEM_PRESENT_RE.test(document.body.innerText || "")) {
    clickIfFound(RECORD_ITEM_PRESENT_RE);
    return;
  }
  clickIfFound(MEETING_TOOLS_RE);
}

// Confirmed live 2026-09-11: a solo host (no other participants) gets
// dropped back to meet.google.com/home by Meet itself after roughly
// 20-25 minutes — not a bug in this bot, but it does mean "Host detected"
// firing once isn't a guarantee the call is still running later. The leave
// button disappearing again is the same in-call signal as above, just
// inverted, and is what tells background.js to stop the recording rather
// than let ffmpeg run indefinitely against a stale/blank tab.
function checkCallEnded() {
  if (!hostDetected || callEndedNotified) return;
  if (!findClickableByText(LEAVE_CALL_RE)) {
    callEndedNotified = true;
    log("Call ended");
    chrome.runtime.sendMessage({ action: "CALL_ENDED" });
  }
}

// Logs any on-screen button whose label smells related to joining/admitting
// but didn't match ADMIT_ALL_RE/ADMIT_ONE_RE — so if those regexes are wrong,
// the real wording shows up directly in the console instead of needing a
// manual Inspect Element. Each unique label logs once (not every 1.5s tick).
function debugLogCandidates() {
  for (const el of allButtons()) {
    const label = (el.getAttribute("aria-label") || visibleText(el)).trim();
    if (!label || !DEBUG_CANDIDATE_RE.test(label)) continue;
    if (_loggedCandidates.has(label)) continue;
    _loggedCandidates.add(label);
    log("DEBUG candidate button:", JSON.stringify(label));
  }
}

// Confirmed live 2026-09-11: without a cooldown, this fired dozens of times
// back-to-back (every 1.5s tick) for what was a single waiting guest —
// Meet's own UI doesn't always drop the "Admit N guest(s)" button the
// instant it's clicked, so re-scanning immediately re-finds and re-clicks
// the same button. A short cooldown gives Meet time to actually process the
// admit before we look again, without needing to know why the button lingers.
const ADMIT_ALL_COOLDOWN_MS = 4000;
let lastAdmitAllClickAt = 0;

function admitWaitingParticipants() {
  if (!hostDetected) return; // nothing to admit before actually being in the call
  debugLogCandidates();

  if (findActionButton(ADMIT_ALL_RE)) {
    if (Date.now() - lastAdmitAllClickAt < ADMIT_ALL_COOLDOWN_MS) return;
    log("Waiting room participant detected");
    clickActionButton(ADMIT_ALL_RE);
    lastAdmitAllClickAt = Date.now();
    log("Admit clicked");
    return;
  }

  // Fall back to admitting one at a time — there can be several individual
  // "Admit {name}" buttons stacked in the notification list. Bounded loop
  // guards against an infinite spin if a click doesn't actually remove the
  // button from the DOM.
  let guard = 0;
  while (guard < 10) {
    const el = findActionButton(ADMIT_ONE_RE);
    if (!el) break;
    log("Waiting room participant detected");
    fireClick(el);
    log("Admit clicked");
    guard += 1;
  }
  if (guard > 0) return;

  // Neither real Admit button exists yet — the floating notification badge
  // (aria-haspopup="dialog", the thing findActionButton correctly refuses to
  // click as an "admit" action) may still need a click to actually OPEN the
  // People panel, which is possibly where Meet renders the real "Admit
  // all"/"Admit {name}" buttons into the DOM in the first place. This is
  // just revealing the panel, not admitting anyone — only fires once per
  // appearance (guarded by aria-expanded="false", so it won't re-fire once
  // the panel is already open).
  for (const el of allButtons()) {
    if (el.getAttribute("aria-expanded") !== "false") continue;
    const label = el.getAttribute("aria-label") || visibleText(el);
    if (label && /admit/i.test(label)) {
      fireClick(el);
      break;
    }
  }
}

// Google Meet's own "solo call" idle-leave (see checkCallEnded's comment
// above) doesn't kick in for ~20-25 minutes — real production impact:
// once every guest leaves, recording keeps running (and the Drive
// upload/summary stays delayed) for that whole stretch. This proactively
// leaves much sooner once the bot detects it's alone, by reusing the
// existing stop path: clicking Leave here just makes checkCallEnded's
// normal "leave button gone" check fire on the next tick, no separate
// stop logic needed.
//
// NOT yet live-tested against a real multi-participant Meet call — the
// participant-count heuristics below are a best guess (matching common
// Meet DOM patterns), same as every other selector in this file when
// first written. If the count reads wrong, the log lines below should
// make that visible in the tab's own console instead of failing silently.
const SOLO_LEAVE_TIMEOUT_MS = 3 * 60 * 1000; // tune once verified live
let aloneSinceTs = null;
let aloneLoggedForThisStretch = false;

function getParticipantCount() {
  // Meet's "People" bottom-bar toggle usually carries the head-count in
  // its aria-label (e.g. "People, 2 participants" / "Mọi người, 2 người").
  for (const el of allButtons()) {
    const label = el.getAttribute("aria-label") || "";
    if (!/people|participants|người tham gia|mọi người/i.test(label)) continue;
    const m = label.match(/(\d+)/);
    if (m) return parseInt(m[1], 10);
  }
  // Fallback: count distinct participant tiles — Meet tags each tile
  // (self included) with data-participant-id in the main call grid.
  const tiles = document.querySelectorAll("[data-participant-id]");
  if (tiles.length > 0) return tiles.length;
  return null; // couldn't determine — don't risk acting on a guess
}

function checkSoloTimeout() {
  if (!hostDetected || callEndedNotified) return;
  const count = getParticipantCount();
  if (count === null) return;
  if (count <= 1) {
    if (aloneSinceTs === null) {
      aloneSinceTs = Date.now();
      aloneLoggedForThisStretch = false;
    }
    if (!aloneLoggedForThisStretch) {
      log(`Alone in call (participant count ${count}) — will auto-leave in ${Math.round(SOLO_LEAVE_TIMEOUT_MS / 1000)}s if still alone`);
      aloneLoggedForThisStretch = true;
    }
    if (Date.now() - aloneSinceTs >= SOLO_LEAVE_TIMEOUT_MS) {
      log("Still alone after timeout — leaving call proactively");
      tryStopNativeRecording();
      const leaveBtn = findClickableByText(LEAVE_CALL_RE);
      if (leaveBtn) fireClick(leaveBtn);
    }
  } else {
    aloneSinceTs = null;
    aloneLoggedForThisStretch = false;
  }
}

// Confirms the "Leave call" submenu opened by checkSoloTimeout() above.
// Runs every tick unconditionally (not just while "alone") since the
// submenu only ever appears after that click fires, and confirming it is
// harmless/idempotent otherwise — same reasoning as the opportunistic
// mic/cam mute clicks in tryClickJoin().
function confirmLeaveSubmenu() {
  clickIfFound(JUST_LEAVE_RE);
}

function tick() {
  tryClickJoin();
  checkHostState();
  checkCallEnded();
  admitWaitingParticipants();
  tryStartNativeRecording();
  checkSoloTimeout();
  confirmLeaveSubmenu();
}

// Meet is a heavy, dynamic SPA — a plain interval is simpler and more
// reliable here than MutationObserver, which tends to fire noisily against
// this specific DOM without reliably catching the moments that matter.
setInterval(tick, 1500);
tick();
