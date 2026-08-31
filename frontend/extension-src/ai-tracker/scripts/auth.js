// ==========================================
// NHIỆM VỤ: Lấy định danh người dùng đang đăng nhập vào KPI Portal qua popup
// (không còn tự nhận diện qua Google — thay bằng phiên đăng nhập pm-new).
// ==========================================
var currentUser = "Unknown";

function autoLogin() {
  chrome.storage.local.get(["kpi_prototype_email"], function (result) {
    currentUser = result.kpi_prototype_email || "Unknown";
    if (currentUser === "Unknown") {
      console.log("🟡 [WARN]", "[KPI Prototype] Chưa đăng nhập — mở popup extension để đăng nhập.");
    } else {
      console.log(`[KPI Prototype] 🔐 Đang đăng nhập với: ${currentUser}`);
    }
  });
}
autoLogin();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.kpi_prototype_email) {
    currentUser = changes.kpi_prototype_email.newValue || "Unknown";
  }
});
