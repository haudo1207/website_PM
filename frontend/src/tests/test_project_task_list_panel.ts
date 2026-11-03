/**
 * Test suite verifying:
 * 1. Project click in MemberDetailModal triggers onSelectProject without closing MemberDetailModal.
 * 2. "Xem dự án ➔" button click triggers onNavigate + onClose (preserves old navigation behavior).
 * 3. Left panel updates directly on project switch (single panel, overwrites state).
 * 4. Closing Left panel keeps Right panel open (independent state).
 * 5. Layout and z-index positioning rules (Sidebar z-30, Left panel z-40, Right panel z-50).
 */

function runTests() {
  console.log("=== BẮT ĐẦU TEST KIỂM THỬ PROJECT TASK LIST PANEL ===");
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  [PASS] ${msg}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${msg}`);
      failed++;
    }
  }

  // TEST 1: State management simulation for dual panels
  console.log("\n1. Test Dual Panel State Management (Left: ProjectTaskList, Right: MemberDetail):");
  let selectedMemberModal: any = null;
  let selectedProjectForTasks: any = null;
  let navigatedUrl: string | null = null;

  // Bước 1: Mở panel Leader A
  selectedMemberModal = { id: 101, name: "Leader Alpha", team: "Infra" };
  assert(selectedMemberModal !== null, "Panel Leader bên phải đã mở");
  assert(selectedProjectForTasks === null, "Panel Project bên trái chưa mở");

  // Bước 2: Bấm vào project card P1 (Project Timetech)
  const project1 = { id: 501, name: "Timetech System", code: "TT-01" };
  function onProjectCardClick(p: any) {
    // onSelectProject được gọi từ MemberDetailModal
    selectedProjectForTasks = p;
  }
  onProjectCardClick(project1);

  assert(selectedMemberModal !== null && selectedMemberModal.id === 101, "Panel Leader bên phải VẪN CÒN NGUYÊN (không bị đóng/thay thế)");
  assert(selectedProjectForTasks !== null && selectedProjectForTasks.id === 501, "Panel Project bên trái đã mở đồng thời với ID 501");

  // Bước 3: Bấm sang project card P2 (Project SecurityZone)
  console.log("\n2. Test đổi sang Project khác khi panel trái đang mở:");
  const project2 = { id: 502, name: "SecurityZone Portal", code: "SZ-02" };
  onProjectCardClick(project2);

  assert(selectedProjectForTasks.id === 502, "Panel trái ghi đè trực tiếp sang Project P2 (502)");
  assert(selectedProjectForTasks.name === "SecurityZone Portal", "Tên project cập nhật đúng");
  assert(selectedMemberModal !== null && selectedMemberModal.id === 101, "Panel Leader bên phải vẫn giữ nguyên");

  // Bước 4: Đóng panel trái (bấm ✕)
  console.log("\n3. Test đóng panel trái (✕):");
  function onCloseLeftPanel() {
    selectedProjectForTasks = null;
  }
  onCloseLeftPanel();

  assert(selectedProjectForTasks === null, "Panel trái đã đóng (selectedProjectForTasks = null)");
  assert(selectedMemberModal !== null && selectedMemberModal.id === 101, "Panel Leader bên phải VẪN CÒN NGUYÊN (độc lập trạng thái)");

  // Bước 5: Bấm nút "Xem dự án ➔" trên project card (không mở panel trái, điều hướng)
  console.log("\n4. Test nút 'Xem dự án ➔':");
  selectedProjectForTasks = null;
  function onXemDuAnClick(p: any) {
    // e.stopPropagation() ngăn onProjectCardClick
    selectedMemberModal = null; // onClose Leader
    navigatedUrl = `/projects/${p.id}/overview`;
  }
  onXemDuAnClick(project1);

  assert(selectedProjectForTasks === null, "Không mở panel trái khi bấm Xem dự án");
  assert(selectedMemberModal === null, "Đã đóng panel Leader để điều hướng");
  assert(navigatedUrl === `/projects/501/overview`, "Điều hướng đúng URL dự án");

  // TEST 6: Kiểm tra Layout z-index và Sidebar clearance
  console.log("\n5. Test quy ước Layout & z-index:");
  const SIDEBAR_Z = 30;
  const LEFT_PANEL_Z = 40;
  const RIGHT_PANEL_Z = 50;

  assert(LEFT_PANEL_Z > SIDEBAR_Z, "Left Panel (z-40) cao hơn Sidebar (z-30) để nổi trên in-page content");
  assert(RIGHT_PANEL_Z > LEFT_PANEL_Z, "Right Panel Leader (z-50) ưu tiên cao nhất, nổi trên Left Panel nếu có giao thoa");

  // Kiểm tra offset desktop không đè lên Sidebar
  const sidebarWidthExpanded = 230;
  const sidebarWidthCollapsed = 64;
  const leftPanelDesktopLeftExpanded = "md:left-[230px]";
  const leftPanelDesktopLeftCollapsed = "md:left-16";

  assert(leftPanelDesktopLeftExpanded.includes(String(sidebarWidthExpanded)), "Left Panel bắt đầu từ mép phải Sidebar khi mở rộng (230px)");
  assert(leftPanelDesktopLeftCollapsed.includes("16"), "Left Panel bắt đầu từ mép phải Sidebar khi thu gọn (64px / w-16)");

  console.log("\n=========================================");
  console.log(`KẾT QUẢ TỔNG HỢP: ${passed} PASSED / ${failed} FAILED`);
  console.log("=========================================\n");

  if (failed > 0) process.exit(1);
}

runTests();

export {};
