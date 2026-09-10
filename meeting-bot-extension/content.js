// Runs on meet.google.com/*. Two jobs, in order:
//   1. Pre-join: mute mic/cam, click "Join now" so the bot enters silently
//      as the meeting's organizer (that's what makes it auto-enter instead
//      of waiting in the lobby — this account IS the host).
//   2. Once in the call: watch for "X wants to join" waiting-room prompts
//      and admit them automatically.
//
// CAUTION — this is the single most fragile part of the whole setup:
// Google Meet's DOM has no stable ids/classes for these controls and its
// wording/layout changes over time without notice. Matching is done on
// aria-label/text substrings (EN + VI, since the account's Meet UI language
// depends on its Google account locale) rather than CSS selectors, but if
// this stops working after a Meet UI change, open the meeting manually in
// this same profile and re-check the current aria-labels/button text here.

const MIC_OFF_HINTS = [/turn off microphone/i, /tắt micrô/i, /tắt microphone/i];
const CAM_OFF_HINTS = [/turn off camera/i, /tắt camera/i];
const JOIN_HINTS = [/^join now$/i, /^ask to join$/i, /tham gia ngay/i, /xin tham gia/i];
const ADMIT_ALL_HINTS = [/admit all/i, /cho tất cả vào/i, /cho vào tất cả/i];
const ADMIT_ONE_HINTS = [/^admit$/i, /^cho vào$/i, /^chấp nhận$/i];

function allButtons() {
  return Array.from(document.querySelectorAll('button, div[role="button"]'));
}

function findByHints(hints) {
  return allButtons().find((el) => {
    const label = (el.getAttribute("aria-label") || el.textContent || "").trim();
    return hints.some((re) => re.test(label));
  });
}

function clickIfFound(hints) {
  const el = findByHints(hints);
  if (el) {
    el.click();
    return true;
  }
  return false;
}

// ── Step 1: pre-join screen ────────────────────────────────────────────
let preJoinDone = false;
function tryPreJoin() {
  if (preJoinDone) return;
  const joined = clickIfFound(JOIN_HINTS);
  if (joined) {
    preJoinDone = true;
    return;
  }
  // Mute mic/cam opportunistically every tick until the Join button itself
  // is found (toggles may render slightly before/after each other).
  clickIfFound(MIC_OFF_HINTS);
  clickIfFound(CAM_OFF_HINTS);
}

// ── Step 2: auto-admit waiting room ────────────────────────────────────
function tryAdmit() {
  // Bulk button covers most cases (multiple people knocking at once).
  if (clickIfFound(ADMIT_ALL_HINTS)) return;
  // Fall back to admitting one at a time — there can be several individual
  // "Admit" buttons stacked in the notification list.
  let clicked = true;
  let guard = 0;
  while (clicked && guard < 10) {
    clicked = clickIfFound(ADMIT_ONE_HINTS);
    guard += 1;
  }
}

function tick() {
  tryPreJoin();
  if (preJoinDone) tryAdmit();
}

// Meet is a heavy SPA — poll on an interval instead of relying solely on
// MutationObserver, which is noisy here and easy to get wrong against a DOM
// this dynamic. 1.5s is frequent enough that guests aren't stuck waiting
// long, without hammering the page.
setInterval(tick, 1500);
tick();
