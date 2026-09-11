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
const JOIN_TEXT_RE = /(^join now$|^ask to join$|tham gia ngay|xin tham gia|yêu cầu tham gia)/i;
const LEAVE_CALL_RE = /(leave call|rời khỏi cuộc gọi|rời cuộc gọi)/i;
const ADMIT_ALL_RE = /(admit all|cho tất cả vào|cho vào tất cả)/i;
const ADMIT_ONE_RE = /(^admit$|^chấp nhận$|^cho vào$)/i;

let joinClicked = false;
let hostDetected = false;

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

function clickIfFound(regex) {
  const el = findClickableByText(regex);
  if (el) {
    el.click();
    return true;
  }
  return false;
}

function tryClickJoin() {
  if (joinClicked) return;
  if (clickIfFound(JOIN_TEXT_RE)) {
    joinClicked = true;
    log("Join detected");
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
  }
}

function admitWaitingParticipants() {
  if (!hostDetected) return; // nothing to admit before actually being in the call

  if (findClickableByText(ADMIT_ALL_RE)) {
    log("Waiting room participant detected");
    clickIfFound(ADMIT_ALL_RE);
    log("Admit clicked");
    return;
  }

  // Fall back to admitting one at a time — there can be several individual
  // "Admit" buttons stacked in the notification list. Bounded loop guards
  // against an infinite spin if a click doesn't actually remove the button.
  let guard = 0;
  while (guard < 10) {
    const el = findClickableByText(ADMIT_ONE_RE);
    if (!el) break;
    log("Waiting room participant detected");
    el.click();
    log("Admit clicked");
    guard += 1;
  }
}

function tick() {
  tryClickJoin();
  checkHostState();
  admitWaitingParticipants();
}

// Meet is a heavy, dynamic SPA — a plain interval is simpler and more
// reliable here than MutationObserver, which tends to fire noisily against
// this specific DOM without reliably catching the moments that matter.
setInterval(tick, 1500);
tick();
