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
let hostDetected = false;
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
// computed here would miss.
function requestCdpJoinClick() {
  chrome.runtime.sendMessage({ action: "CDP_CLICK_JOIN" }, (response) => {
    if (chrome.runtime.lastError) {
      log("CDP click request failed:", chrome.runtime.lastError.message);
      return;
    }
    if (response && response.success === false) {
      log("CDP click failed:", response.error);
    }
  });
}

function tryClickJoin() {
  if (joinClicked) return;
  const el = findClickableByText(JOIN_TEXT_RE);
  if (el) {
    joinClicked = true;
    log("Join detected");
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
