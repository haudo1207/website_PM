"""
Vòng 5 (Tech_Support customer-sync, xem kpi-reference.md) — test cho
_resolve_task_group_assignee_for_support_key(): hàm xác định assigned_ids
thật cho 1 TaskGroup được tạo qua SUPPORT_INTEGRATION_API_KEY, theo đúng thứ
tự ưu tiên đã chốt với Tech_Support (a. leader_member_id -> b. leader_email/
leader_name -> c. fallback service-account).
"""
from app.models.member import Member
from app.routers.task_groups import _resolve_task_group_assignee_for_support_key


def _member(db, **kwargs):
    m = Member(display_name=kwargs.pop("display_name", "m"), full_name=kwargs.pop("full_name", "M"), **kwargs)
    db.add(m)
    db.commit()
    return m


def test_branch_a_uses_leader_member_id_when_present(db):
    leader = _member(db, display_name="leader1", full_name="Leader One")
    assignee = _member(db, display_name="dev1", full_name="Dev One", leader_member_id=leader.id)

    resolved_id, branch = _resolve_task_group_assignee_for_support_key(db, assignee.id, service_member_id=999)

    assert branch == "a"
    assert resolved_id == leader.id


def test_branch_b_matches_leader_email_to_existing_member(db):
    leader = _member(db, display_name="leader2", full_name="Leader Two", email="leader2@example.com")
    assignee = _member(db, display_name="dev2", full_name="Dev Two", leader_email="leader2@example.com")

    resolved_id, branch = _resolve_task_group_assignee_for_support_key(db, assignee.id, service_member_id=999)

    assert branch == "b"
    assert resolved_id == leader.id


def test_branch_b_falls_back_to_leader_name_when_email_empty(db):
    leader = _member(db, display_name="Leader Three", full_name="Leader Three")
    assignee = _member(db, display_name="dev3", full_name="Dev Three", leader_name="Leader Three")

    resolved_id, branch = _resolve_task_group_assignee_for_support_key(db, assignee.id, service_member_id=999)

    assert branch == "b"
    assert resolved_id == leader.id


def test_branch_c_fallback_when_no_leader_at_all(db):
    assignee = _member(db, display_name="dev4", full_name="Dev Four")

    resolved_id, branch = _resolve_task_group_assignee_for_support_key(db, assignee.id, service_member_id=42)

    assert branch == "c"
    assert resolved_id == 42


def test_branch_c_fallback_when_leader_email_matches_nobody(db):
    """Dữ liệu rác: leader_email có giá trị nhưng không khớp Member nào đang
    tồn tại -> vẫn rơi về fallback (c), không crash/raise."""
    assignee = _member(db, display_name="dev5", full_name="Dev Five", leader_email="khong-ton-tai@example.com")

    resolved_id, branch = _resolve_task_group_assignee_for_support_key(db, assignee.id, service_member_id=42)

    assert branch == "c"
    assert resolved_id == 42


def test_branch_c_fallback_when_assignee_id_itself_not_found(db):
    """assigned_member_id gửi lên trỏ tới 1 member_id không tồn tại -> fallback (c), không crash."""
    resolved_id, branch = _resolve_task_group_assignee_for_support_key(db, 999999, service_member_id=42)

    assert branch == "c"
    assert resolved_id == 42


def test_branch_a_takes_priority_over_text_leader_fields(db):
    """Có cả leader_member_id lẫn leader_email/leader_name -> ưu tiên (a), bỏ qua (b)."""
    fk_leader = _member(db, display_name="fk-leader", full_name="FK Leader")
    text_leader = _member(db, display_name="text-leader", full_name="Text Leader", email="text-leader@example.com")
    assignee = _member(
        db, display_name="dev6", full_name="Dev Six",
        leader_member_id=fk_leader.id, leader_email="text-leader@example.com",
    )

    resolved_id, branch = _resolve_task_group_assignee_for_support_key(db, assignee.id, service_member_id=999)

    assert branch == "a"
    assert resolved_id == fk_leader.id
