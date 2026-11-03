/**
 * Comprehensive Test Suite for ProjectTaskListPanel:
 * 
 * KỊCH BẢN 1: Màn hình hẹp/vừa — 2 panel tự co giãn hợp lý, sidebar không bị ép mất chữ, Dashboard giữa vẫn có không gian.
 * KỊCH BẢN 2: Mở panel Leader "B.Đ Anh Tú", chọn "Tuần này", bấm vào project — Task List chỉ hiện task đúng tuần này VÀ có Anh Tú là assigned/support.
 * KỊCH BẢN 3: Đổi "Tuần này" → "Tuần trước" — danh sách tự cập nhật ngay, không cần mở lại.
 * KỊCH BẢN 4: Đổi sang Leader khác khi Task panel đang mở — danh sách Task tự lọc lại theo người mới.
 * KỊCH BẢN 5: Mở panel từ bảng xếp hạng KPI (Member thường, ví dụ "N Hữu Dũng"), bấm vào project — lọc đúng theo N Hữu Dũng, dùng chung logic với Leader.
 * KỊCH BẢN 6: Chọn "Tất cả kỳ" — chỉ còn lọc theo người, bỏ lọc thời gian.
 */

import { isTaskAssignedOrSupportForMember } from '../components/dashboard/ProjectTaskListPanel';
import { checkTaskInPeriod, getMondayToSundayRange, getPrevWeekRange } from '../app/dashboard/constants';

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function runTests() {
  console.log("======================================================================");
  console.log("=== BẮT ĐẦU TEST KIỂM THỬ HOÀN THIỆN PROJECT TASK LIST PANEL ===");
  console.log("======================================================================\n");
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

  // =========================================================================
  // KỊCH BẢN 1: Responsive UI & Co giãn 2 panel
  // =========================================================================
  console.log("--- KỊCH BẢN 1: UI TỰ CO GIÃN THEO VIEWPORT & KHÔNG ÉP SIDEBAR ---");
  const SIDEBAR_EXPANDED_WIDTH = 230; // Sidebar luôn đủ rộng để hiện text ở mọi kích thước màn hình

  function calcPanelWidths(viewportW: number) {
    // Panel Trái (task list): max-w-[min(540px, 32vw-34vw)]
    const leftRatio = viewportW >= 1440 ? 0.34 : 0.32;
    const leftW = Math.min(540, Math.floor(viewportW * leftRatio));
    // Panel Phải (member detail - trọng tâm): max-w-[min(672px, 44vw-45vw)]
    const rightRatio = viewportW >= 1440 ? 0.45 : 0.44;
    const rightW = Math.min(672, Math.floor(viewportW * rightRatio));
    const totalPanels = leftW + rightW;
    const remainingDashboard = viewportW - (SIDEBAR_EXPANDED_WIDTH + totalPanels);
    return { leftW, rightW, totalPanels, remainingDashboard };
  }

  // 1.1 Kiểm tra ở 1024px (Màn hình hẹp / iPad Pro ngang)
  const at1024 = calcPanelWidths(1024);
  assert(at1024.leftW < at1024.rightW, `Tại 1024px: Panel Trái (${at1024.leftW}px) nhỏ hơn Panel Phải (${at1024.rightW}px) - dành ưu tiên cho trọng tâm`);
  assert(at1024.remainingDashboard >= 0, `Tại 1024px: 2 panel + sidebar (230px) vừa vặn trong màn hình (dư ${at1024.remainingDashboard}px)`);

  // 1.2 Kiểm tra ở 1280px (Laptop nhỏ / HD tiêu chuẩn)
  const at1280 = calcPanelWidths(1280);
  assert(at1280.leftW < at1280.rightW, `Tại 1280px: Panel Trái (${at1280.leftW}px) nhỏ hơn Panel Phải (${at1280.rightW}px)`);
  assert(at1280.remainingDashboard > 30, `Tại 1280px: Dashboard giữa còn ${at1280.remainingDashboard}px không gian hiển thị, sidebar 230px không mất chữ`);

  // 1.3 Kiểm tra ở 1366px (Laptop phổ biến)
  const at1366 = calcPanelWidths(1366);
  assert(at1366.leftW < at1366.rightW, `Tại 1366px: Panel Trái (${at1366.leftW}px) nhỏ hơn Panel Phải (${at1366.rightW}px)`);
  assert(at1366.remainingDashboard > 50, `Tại 1366px: Dashboard giữa còn ${at1366.remainingDashboard}px không gian`);

  // 1.4 Kiểm tra ở 1440px (MacBook / 2K scaled)
  const at1440 = calcPanelWidths(1440);
  assert(at1440.remainingDashboard > 70, `Tại 1440px: Dashboard giữa còn ${at1440.remainingDashboard}px không gian`);

  // 1.5 Kiểm tra ở 1920px (Full HD Desktop)
  const at1920 = calcPanelWidths(1920);
  assert(at1920.leftW === 540, `Tại 1920px: Panel Trái đạt max-w chuẩn ${at1920.leftW}px`);
  assert(at1920.rightW === 672, `Tại 1920px: Panel Phải đạt max-w chuẩn ${at1920.rightW}px`);
  assert(at1920.remainingDashboard > 400, `Tại 1920px: Dashboard giữa thênh thang với ${at1920.remainingDashboard}px`);

  // =========================================================================
  // DỮ LIỆU MOCK PHỤC VỤ TEST KỊCH BẢN 2 ĐẾN 6
  // =========================================================================
  const thisWeekRange = getMondayToSundayRange(new Date());
  const prevWeekRange = getPrevWeekRange(new Date());

  // Chọn ngày giữa tuần (Thứ 4) để đảm bảo nằm gọn trong tuần
  const thisMidWeek = new Date(thisWeekRange.monday);
  thisMidWeek.setDate(thisMidWeek.getDate() + 2);
  const thisWeekDateStr = toLocalDateStr(thisMidWeek);

  const prevMidWeek = new Date(prevWeekRange.monday);
  prevMidWeek.setDate(prevMidWeek.getDate() + 2);
  const prevWeekDateStr = toLocalDateStr(prevMidWeek);

  const twoMonthsAgoDateStr = "2026-08-10";

  // Mock danh sách task của Project Timetech
  const sampleTasks = [
    // Task 1: B.Đ Anh Tú (ID 13) Assigned - Trong "Tuần này"
    {
      id: 1,
      detail: "Khảo sát hạ tầng cloud AWS",
      status: "In Progress",
      priority: "Critical",
      assigned_id: 13,
      assigned_name: "B.Đ Anh Tú",
      support_id: null,
      support_name: null,
      start_date: thisWeekDateStr,
      end_date_est: thisWeekDateStr,
      manday_est: 2.0,
    },
    // Task 2: B.Đ Anh Tú (ID 13) Support - Trong "Tuần này"
    {
      id: 2,
      detail: "Cấu hình VPN gateway",
      status: "Done",
      priority: "Normal",
      assigned_id: 2, // Phil
      assigned_name: "Phil",
      support_id: 13, // Anh Tú Support
      support_name: "B.Đ Anh Tú",
      start_date: thisWeekDateStr,
      end_date_est: thisWeekDateStr,
      end_date_actual: thisWeekDateStr,
      manday_est: 1.5,
    },
    // Task 3: B.Đ Anh Tú (ID 13) Assigned - Trong "Tuần trước"
    {
      id: 3,
      detail: "Review bảo mật SSL và firewall",
      status: "Done",
      priority: "High",
      assigned_id: 13,
      assigned_name: "B.Đ Anh Tú",
      support_id: null,
      support_name: null,
      start_date: prevWeekDateStr,
      end_date_est: prevWeekDateStr,
      end_date_actual: prevWeekDateStr,
      manday_est: 3.0,
    },
    // Task 4: B.Đ Anh Tú (ID 13) Assigned - 2 tháng trước ("Tất cả kỳ")
    {
      id: 4,
      detail: "Thiết kế kiến trúc hệ thống ban đầu",
      status: "Done",
      priority: "Normal",
      assigned_id: 13,
      assigned_name: "B.Đ Anh Tú",
      support_id: null,
      support_name: null,
      start_date: twoMonthsAgoDateStr,
      end_date_est: twoMonthsAgoDateStr,
      end_date_actual: twoMonthsAgoDateStr,
      manday_est: 5.0,
    },
    // Task 5: Phil (ID 2) Assigned, Không có Anh Tú - "Tuần này"
    {
      id: 5,
      detail: "Triển khai microservice auth",
      status: "In Progress",
      priority: "High",
      assigned_id: 2,
      assigned_name: "Phil",
      support_id: 10, // Huyht
      support_name: "Huyht",
      start_date: thisWeekDateStr,
      end_date_est: thisWeekDateStr,
      manday_est: 2.5,
    },
    // Task 6: N Hữu Dũng (ID 99) Assigned, Member thường - "Tuần này"
    {
      id: 6,
      detail: "Viết unit test cho CRM module",
      status: "In Progress",
      priority: "Normal",
      assigned_id: 99,
      assigned_name: "N Hữu Dũng",
      support_id: null,
      support_name: null,
      start_date: thisWeekDateStr,
      end_date_est: thisWeekDateStr,
      manday_est: 1.0,
    },
    // Task 7: N Hữu Dũng (ID 99) Support - "Tuần trước"
    {
      id: 7,
      detail: "Fix bug giao diện bảng lương",
      status: "Done",
      priority: "Interrupt",
      assigned_id: 2,
      assigned_name: "Phil",
      support_id: 99, // Dũng Support
      support_name: "N Hữu Dũng",
      start_date: prevWeekDateStr,
      end_date_est: prevWeekDateStr,
      end_date_actual: prevWeekDateStr,
      manday_est: 0.5,
    },
  ];

  function filterScopedTasks(tasks: any[], member: any, year: any, month: any, week: any, quickFilter: string | null) {
    return tasks.filter(t => {
      // Điều kiện người (Assigned hoặc Support)
      if (member && !isTaskAssignedOrSupportForMember(t, member)) return false;
      // Điều kiện thời gian
      if (!checkTaskInPeriod(t, year, month, week, quickFilter)) return false;
      return true;
    });
  }

  function computeStats(scoped: any[]) {
    let done = 0, open = 0, critical = 0, totalManday = 0;
    for (const t of scoped) {
      if (t.status === 'Done') done++;
      else open++;
      if ((t.priority || '').toLowerCase() === 'critical') critical++;
      totalManday += Number(t.manday_est || 0);
    }
    return { total: scoped.length, done, open, critical, totalManday: Math.round(totalManday * 10) / 10 };
  }

  // =========================================================================
  // KỊCH BẢN 2: Leader "B.Đ Anh Tú" + "Tuần này"
  // =========================================================================
  console.log("\n--- KỊCH BẢN 2: LEADER B.Đ ANH TÚ + BỘ LỌC 'TUẦN NÀY' ---");
  const leaderAnhTu = { id: 13, name: "B.Đ Anh Tú", team: "Infras" };
  const scoped2 = filterScopedTasks(sampleTasks, leaderAnhTu, 'all', 'all', 'all', 'Tuần này');

  assert(scoped2.length === 2, `Có đúng 2 task hiển thị cho Anh Tú trong Tuần này (thực tế: ${scoped2.length})`);
  assert(scoped2.some(t => t.id === 1 && t.assigned_id === 13), "Task 1 (Anh Tú Assigned) có mặt");
  assert(scoped2.some(t => t.id === 2 && t.support_id === 13), "Task 2 (Anh Tú Support) có mặt");
  assert(!scoped2.some(t => t.id === 3), "Task 3 (Tuần trước) bị loại bỏ đúng");
  assert(!scoped2.some(t => t.id === 5), "Task 5 (Của Phil, không có Anh Tú) bị loại bỏ đúng");

  const stats2 = computeStats(scoped2);
  assert(stats2.total === 2 && stats2.open === 1 && stats2.done === 1 && stats2.critical === 1, "Thống kê đầu panel tính đúng theo tập task đã lọc: 2 task, 1 mở, 1 done, 1 critical");
  assert(stats2.totalManday === 3.5, `Tổng MD tính đúng theo tập task: 2.0 + 1.5 = 3.5 MD (thực tế: ${stats2.totalManday})`);

  // =========================================================================
  // KỊCH BẢN 3: Đổi "Tuần này" → "Tuần trước"
  // =========================================================================
  console.log("\n--- KỊCH BẢN 3: ĐỔI 'TUẦN NÀY' → 'TUẦN TRƯỚC' (TỰ CẬP NHẬT NGAY) ---");
  const scoped3 = filterScopedTasks(sampleTasks, leaderAnhTu, 'all', 'all', 'all', 'Tuần trước');

  assert(scoped3.length === 1, `Chỉ có 1 task của Anh Tú trong Tuần trước (thực tế: ${scoped3.length})`);
  assert(scoped3[0].id === 3 && scoped3[0].detail.includes("firewall"), "Đúng Task 3: Review bảo mật SSL và firewall");
  assert(scoped3[0].status === "Done", "Task đã hoàn thành đúng trạng thái");
  const stats3 = computeStats(scoped3);
  assert(stats3.total === 1 && stats3.done === 1 && stats3.totalManday === 3.0, "Thống kê cập nhật ngay: 1 task, 1 done, 3.0 MD");

  // =========================================================================
  // KỊCH BẢN 4: Đổi sang Leader khác khi panel đang mở
  // =========================================================================
  console.log("\n--- KỊCH BẢN 4: ĐỔI SANG LEADER KHÁC (PHIL) KHI TASK PANEL ĐANG MỞ ---");
  const leaderPhil = { id: 2, name: "Phil", team: "Infras" };
  // Vẫn giữ filter "Tuần này"
  const scoped4 = filterScopedTasks(sampleTasks, leaderPhil, 'all', 'all', 'all', 'Tuần này');

  assert(scoped4.length === 2, `Có 2 task của Phil trong Tuần này (thực tế: ${scoped4.length})`);
  assert(scoped4.some(t => t.id === 2 && t.assigned_id === 2), "Task 2 (Phil Assigned, Anh Tú Support) có mặt cho Phil");
  assert(scoped4.some(t => t.id === 5 && t.assigned_id === 2), "Task 5 (Phil Assigned) có mặt");
  assert(!scoped4.some(t => t.id === 1), "Task 1 (chỉ của Anh Tú) không hiển thị cho Phil");
  const stats4 = computeStats(scoped4);
  assert(stats4.total === 2 && stats4.totalManday === 4.0, `Thống kê tự đổi theo Phil: 2 task, tổng MD 1.5 + 2.5 = 4.0 MD (thực tế: ${stats4.totalManday})`);

  // =========================================================================
  // KỊCH BẢN 5: Member thường từ bảng xếp hạng KPI ("N Hữu Dũng")
  // =========================================================================
  console.log("\n--- KỊCH BẢN 5: MEMBER THƯỜNG TỪ BẢNG XẾP HẠNG KPI (N HỮU DŨNG) ---");
  // Object member lấy từ bảng xếp hạng KPI (rawMember pattern)
  const memberDungFromKpi = {
    id: 99,
    name: "N Hữu Dũng",
    team: "Software",
    kpi: 105,
    rawMember: { id: 99, display_name: "N Hữu Dũng" }
  };

  // Test Tuần này của N Hữu Dũng
  const scoped5ThisWeek = filterScopedTasks(sampleTasks, memberDungFromKpi, 'all', 'all', 'all', 'Tuần này');
  assert(scoped5ThisWeek.length === 1 && scoped5ThisWeek[0].id === 6, "Tuần này: hiển thị đúng Task 6 (N Hữu Dũng Assigned)");

  // Test Tuần trước của N Hữu Dũng (Support)
  const scoped5PrevWeek = filterScopedTasks(sampleTasks, memberDungFromKpi, 'all', 'all', 'all', 'Tuần trước');
  assert(scoped5PrevWeek.length === 1 && scoped5PrevWeek[0].id === 7, "Tuần trước: hiển thị đúng Task 7 (N Hữu Dũng Support)");
  assert(scoped5PrevWeek[0].support_id === 99, "Dùng chung 1 logic lấy member.id từ selectedMemberModal cho cả Leader lẫn Member");

  // =========================================================================
  // KỊCH BẢN 6: Chọn "Tất cả kỳ" (bỏ lọc thời gian, chỉ lọc theo người)
  // =========================================================================
  console.log("\n--- KỊCH BẢN 6: CHỌN 'TẤT CẢ KỲ' (BỎ LỌC THỜI GIAN, CHỈ LỌC THEO NGƯỜI) ---");
  const scoped6AllCycles = filterScopedTasks(sampleTasks, leaderAnhTu, 'all', 'all', 'all', null);

  assert(scoped6AllCycles.length === 4, `Chọn 'Tất cả kỳ': hiện đủ 4 task của Anh Tú ở mọi thời điểm (thực tế: ${scoped6AllCycles.length})`);
  assert(scoped6AllCycles.some(t => t.id === 1), "Task 1 (Tuần này) có mặt");
  assert(scoped6AllCycles.some(t => t.id === 2), "Task 2 (Tuần này Support) có mặt");
  assert(scoped6AllCycles.some(t => t.id === 3), "Task 3 (Tuần trước) có mặt");
  assert(scoped6AllCycles.some(t => t.id === 4), "Task 4 (2 tháng trước) có mặt");
  assert(!scoped6AllCycles.some(t => t.id === 5 || t.id === 6), "Task của người khác (Phil, Dũng) vẫn bị loại bỏ");

  const stats6 = computeStats(scoped6AllCycles);
  assert(stats6.total === 4 && stats6.done === 3 && stats6.open === 1, "Thống kê 'Tất cả kỳ': 4 task, 3 done, 1 open");
  assert(stats6.totalManday === 11.5, `Tổng MD toàn bộ của Anh Tú: 2.0 + 1.5 + 3.0 + 5.0 = 11.5 MD (thực tế: ${stats6.totalManday})`);

  console.log("\n======================================================================");
  console.log(`KẾT QUẢ TỔNG HỢP: ${passed} PASSED / ${failed} FAILED`);
  console.log("======================================================================\n");

  if (failed > 0) process.exit(1);
}

runTests();

export {};
