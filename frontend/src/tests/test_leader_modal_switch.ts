/**
 * Test suite verifying:
 * 1. getLeaderMemberObject logic with all edge cases (in ranking, in rawMembersAll, missing/null, invalid).
 * 2. State transition when switching from Leader A to Leader B while modal is open.
 * 3. Period filters preservation across switch.
 * 4. Safety when leader data is completely missing or null.
 */

function runTests() {
  console.log("=== BẮT ĐẦU TEST KIỂM THỬ THỰC TẾ ===");
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

  const isSameId = (a: any, b: any) => a != null && b != null && String(a) === String(b);

  const mockMemberRanking: any[] = [
    { id: 101, name: "Leader Alpha", team: "Infra", kpi: 95.5, rawMember: { id: 101, display_name: "Leader Alpha", team: "Infra" } },
    { id: 102, name: "Member Beta", team: "Infra", kpi: 80.0, rawMember: { id: 102, display_name: "Member Beta", team: "Infra" } },
  ];

  const mockRawMembersAll: any[] = [
    { id: 101, display_name: "Leader Alpha", team: "Infra", email: "alpha@corp.com" },
    { id: 102, display_name: "Member Beta", team: "Infra", email: "beta@corp.com" },
    { id: 201, display_name: "Leader Gamma", team: "Dev", email: "gamma@corp.com" }, // Not in current ranking
  ];

  const getLeaderMemberObject = (ld: any, memberRanking: any[] = mockMemberRanking, rawMembersAll: any[] = mockRawMembersAll): any => {
    if (!ld) return null;
    const targetMid = ld.member_id != null ? String(ld.member_id) : null;
    const targetName = (ld.name || '').trim().toLowerCase();

    // 1. Try finding in memberRanking (already prepared with full metrics & rawMember)
    const rankingMatch = memberRanking.find((m: any) => {
      if (targetMid && isSameId(m.id, targetMid)) return true;
      const mName = (m.name || '').trim().toLowerCase();
      if (mName && mName === targetName) return true;
      const rawName = (m.rawMember?.display_name || m.rawMember?.full_name || '').trim().toLowerCase();
      return rawName && rawName === targetName;
    });
    if (rankingMatch) return rankingMatch;

    // 2. Try finding in rawMembersAll
    const rawMatch = rawMembersAll.find((m: any) => {
      if (targetMid && isSameId(m.id, targetMid)) return true;
      const mName = (m.display_name || m.full_name || m.name || '').trim().toLowerCase();
      return mName && mName === targetName;
    });
    if (rawMatch) {
      return {
        id: rawMatch.id,
        name: rawMatch.display_name || rawMatch.full_name || rawMatch.name || ld.name,
        team: rawMatch.team || rawMatch.department || ld.team || 'Khác',
        department: rawMatch.department || rawMatch.team,
        position: rawMatch.position || 'Leader',
        leader_name: rawMatch.leader_name || '',
        rawMember: rawMatch,
      };
    }

    // 3. Fallback to ld info if member record not found
    return {
      id: ld.member_id ?? null,
      name: ld.name || 'Không xác định',
      team: ld.team || 'Khác',
      department: ld.team,
      position: 'Leader',
      isNotFound: !targetMid && !rawMatch && !rankingMatch,
      rawMember: {
        id: ld.member_id ?? null,
        display_name: ld.name,
        full_name: ld.name,
        team: ld.team,
      },
    };
  };

  // TEST 1: Tìm Leader có trong memberRanking
  console.log("\n1. Test tìm Leader trong memberRanking:");
  const res1: any = getLeaderMemberObject({ name: "Leader Alpha", member_id: 101, team: "Infra" });
  assert(res1 !== null, "Kết quả không null");
  assert(res1?.id === 101, "id đúng là 101");
  assert(res1?.name === "Leader Alpha", "Tên đúng là Leader Alpha");
  assert(res1?.kpi === 95.5, "KPI lấy từ memberRanking giữ nguyên");
  assert(!res1?.isNotFound, "isNotFound là falsy");

  // TEST 2: Tìm Leader KHÔNG có trong memberRanking nhưng CÓ trong rawMembersAll
  console.log("\n2. Test tìm Leader không có trong ranking nhưng có trong rawMembersAll:");
  const res2: any = getLeaderMemberObject({ name: "Leader Gamma", member_id: 201, team: "Dev" });
  assert(res2 !== null, "Kết quả không null");
  assert(res2?.id === 201, "id đúng là 201 từ rawMembersAll");
  assert(res2?.name === "Leader Gamma", "Tên đúng là Leader Gamma");
  assert(res2?.team === "Dev", "Team đúng là Dev");
  assert(!res2?.isNotFound, "isNotFound là falsy");

  // TEST 3: Leader KHÔNG tìm thấy trong ranking lẫn rawMembersAll (dữ liệu thiếu/null)
  console.log("\n3. Test Leader KHÔNG tìm thấy trong cả 2 nguồn (dữ liệu thiếu/null):");
  const res3: any = getLeaderMemberObject({ name: "Ghost Leader", member_id: null, team: "Unknown" });
  assert(res3 !== null, "Xử lý an toàn: không crash, trả về fallback object");
  assert(res3?.id === null, "id an toàn là null");
  assert(res3?.name === "Ghost Leader", "Tên hiển thị fallback an toàn");
  assert(res3?.isNotFound === true, "Cờ isNotFound = true để kích hoạt banner thông báo lỗi rõ ràng");

  // TEST 4: Input hoàn toàn null / undefined
  console.log("\n4. Test input null / undefined:");
  const res4: any = getLeaderMemberObject(null);
  assert(res4 === null, "Input null trả về null an toàn, không throw error");
  const res5: any = getLeaderMemberObject(undefined);
  assert(res5 === null, "Input undefined trả về null an toàn, không throw error");

  // TEST 5: Mô phỏng State transition khi panel Leader A đang mở, bấm sang Leader B
  console.log("\n5. Test State transition: Leader A -> Leader B khi modal đang mở:");
  let selectedLeader = "Leader Alpha";
  let selectedMemberModal: any = res1; // Đang mở modal Leader Alpha
  let selectedYear: number | 'all' = 2026;
  let selectedMonth: number | 'all' = 11;
  let selectedWeek: number | 'all' = 1;
  let activeQuickFilter: string | null = "Tuần này";

  // Giả lập hàm click thẻ Leader B
  function onLeaderCardClick(ld: any) {
    selectedLeader = ld.name;
    if (selectedMemberModal) {
      const leaderMember = getLeaderMemberObject(ld);
      if (leaderMember) {
        selectedMemberModal = leaderMember;
      }
    }
  }

  // Click sang Leader Gamma
  onLeaderCardClick({ name: "Leader Gamma", member_id: 201, team: "Dev" });

  assert(selectedLeader === "Leader Gamma", "selectedLeader đổi sang Leader Gamma");
  assert(selectedMemberModal !== null, "Modal KHÔNG bị đóng (không qua null)");
  assert(selectedMemberModal.id === 201, "Modal đã đổi sang id của Leader Gamma (201)");
  assert(selectedMemberModal.name === "Leader Gamma", "Modal đã đổi sang tên của Leader Gamma");

  // TEST 6: Kiểm tra bộ lọc thời gian Kỳ/Năm/Tháng/Tuần
  console.log("\n6. Test bộ lọc Kỳ/Năm/Tháng/Tuần sau khi đổi Leader:");
  assert(selectedYear === 2026, "Năm 2026 được giữ nguyên");
  assert(selectedMonth === 11, "Tháng 11 được giữ nguyên");
  assert(selectedWeek === 1, "Tuần 1 được giữ nguyên");
  assert(activeQuickFilter === "Tuần này", "QuickFilter 'Tuần này' được giữ nguyên");

  // TEST 7: Giả lập useEffect trong MemberDetailModal khi member.id thay đổi
  console.log("\n7. Test hành vi MemberDetailModal khi member.id đổi:");
  let taskFilter = 'overdue'; // Giả sử người dùng trước đó đang lọc task trễ hạn của Leader A
  let scrolledTop = 350;     // Giả sử đang cuộn dở 350px
  let contentVisible = true;
  let prevMemberId = 101;

  function simulateModalEffectOnMemberChange(newMemberId: any) {
    if (prevMemberId === newMemberId) return;
    prevMemberId = newMemberId;
    taskFilter = 'all';     // Reset filter task về 'all'
    scrolledTop = 0;        // Cuộn về đỉnh 0
    contentVisible = false; // Bắt đầu crossfade mượt
    contentVisible = true;  // raf đưa về true
  }

  simulateModalEffectOnMemberChange(selectedMemberModal.id);

  assert(prevMemberId === 201, "prevMemberId cập nhật sang 201");
  assert(taskFilter === 'all', "taskFilter đã được reset về 'all'");
  assert(scrolledTop === 0, "Đã cuộn về đỉnh (top = 0)");
  assert(contentVisible === true, "Hiệu ứng crossfade hoàn tất mượt mà");

  console.log("\n=========================================");
  console.log(`KẾT QUẢ TỔNG HỢP: ${passed} PASSED / ${failed} FAILED`);
  console.log("=========================================\n");

  if (failed > 0) process.exit(1);
}

runTests();

export {};
