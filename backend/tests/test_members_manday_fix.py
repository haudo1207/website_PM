"""GET /members leaderboard MANDAY column (chốt 2026-10-30): manday_total
must be sourced from manday_est x kpi_ratio, NOT the old manday_actual
calendar-span (end_date_actual - start_date + 1, still computed as-is by
calc_manday_actual() in kpi_engine.py and used everywhere else — this fix
only changes what list_members() surfaces as the leaderboard's MANDAY). The
old calendar-span sum must still be readable under manday_calendar_span_total
("Số ngày mở task" in the KPI Tuần tab)."""
from datetime import date

import pytest

from app.models.member import Member
from app.models.project import Project
from app.models.phase import Phase
from app.models.task_group import TaskGroup
from app.models.skill_master import Category, Group, Skill
from app.models.task import Task
from app.routers import members as mm


def mk_member(db, name):
    m = Member(display_name=name, full_name=name)
    db.add(m)
    db.commit()
    return m


@pytest.fixture
def world(db, admin):
    """One Project -> Phase -> TaskGroup, plus the Group/Skill FKs every
    Task row needs. Built directly via the ORM (not the create_project /
    create_task_group routers) — their template/validation logic is
    unrelated to this fix."""
    project = Project(name="W", business="All", data_scope="all")
    db.add(project)
    db.flush()
    phase = Phase(project_id=project.id, name="Master")
    db.add(phase)
    db.flush()
    tg = TaskGroup(phase_id=phase.id, name="Group 1")
    db.add(tg)
    cat = Category(name="IT")
    db.add(cat)
    db.flush()
    grp = Group(name="Network", category_id=cat.id)
    db.add(grp)
    db.flush()
    skill = Skill(name="Cisco", group_id=grp.id)
    db.add(skill)
    db.commit()
    return dict(tg=tg, grp=grp, skill=skill)


def mk_task(db, w, *, assigned, support, manday_est, kpi_ratio_assign=90,
            kpi_ratio_support=10, start_date=date(2026, 9, 1),
            end_date_actual=date(2026, 9, 30), status="Done",
            kpi_assigned=0, kpi_support=0):
    t = Task(
        task_group_id=w["tg"].id,
        detail="t",
        manday_est=manday_est,
        status=status,
        start_date=start_date,
        assigned_id=assigned.id,
        support_id=support.id,
        kpi_ratio_assign=kpi_ratio_assign,
        kpi_ratio_support=kpi_ratio_support,
        skill_solution_id=w["grp"].id,
        skill_vendor_id=w["skill"].id,
        end_date_actual=end_date_actual,
        kpi_assigned=kpi_assigned,
        kpi_support=kpi_support,
    )
    db.add(t)
    db.commit()
    # manday_actual is normally derived by calc_manday_actual() in
    # kpi_engine.py on save (status==Done -> end_date_actual - start_date + 1)
    # — set it the same way here so the test matches production behavior
    # without importing the full task-update code path.
    if status == "Done" and end_date_actual:
        t.manday_actual = max(1, (end_date_actual - start_date).days + 1)
        db.commit()
    return t


def by_id(rows, member_id):
    return next(r for r in rows if r["id"] == member_id)


def test_manday_uses_estimate_not_calendar_span(db, admin, world):
    """A task open for 30 calendar days but estimated at 5 manday must
    report MANDAY=5 (est-based), with the 30-day span still available
    separately as manday_calendar_span_total."""
    alice = mk_member(db, "Alice")
    bob = mk_member(db, "Bob")  # support, 0% ratio not allowed so give 0 explicitly below
    mk_task(
        db, world, assigned=alice, support=bob, manday_est=5,
        kpi_ratio_assign=100, kpi_ratio_support=0,
        start_date=date(2026, 9, 1), end_date_actual=date(2026, 9, 30),
    )

    rows = mm.list_members(start_date="2026-09-01", end_date="2026-09-30", db=db, current_user=admin)
    a = by_id(rows, alice.id)
    assert a["manday_total"] == 5.0
    assert a["manday_est_total"] == 5.0
    assert a["manday_calendar_span_total"] == 30.0


def test_90_10_assigned_support_split(db, admin, world):
    """kpi_ratio 90/10 splits BOTH the KPI and the (now est-based) MANDAY
    the same way — assigned gets 90% of manday_est, support gets 10%."""
    alice = mk_member(db, "Alice")
    bob = mk_member(db, "Bob")
    mk_task(
        db, world, assigned=alice, support=bob, manday_est=10,
        kpi_ratio_assign=90, kpi_ratio_support=10,
        start_date=date(2026, 9, 1), end_date_actual=date(2026, 9, 5),
    )

    rows = mm.list_members(start_date="2026-09-01", end_date="2026-09-30", db=db, current_user=admin)
    a, b = by_id(rows, alice.id), by_id(rows, bob.id)
    assert a["manday_total"] == pytest.approx(9.0)
    assert b["manday_total"] == pytest.approx(1.0)


def test_50_50_split_three_manday_task(db, admin, world):
    """The example from the bug report: a 3-manday task split 50/50 must
    give each person 1.5, not the old calendar-span number."""
    alice = mk_member(db, "Alice")
    bob = mk_member(db, "Bob")
    mk_task(
        db, world, assigned=alice, support=bob, manday_est=3,
        kpi_ratio_assign=50, kpi_ratio_support=50,
        start_date=date(2026, 9, 1), end_date_actual=date(2026, 9, 20),  # 20-day span, would have been 10/10 under the old formula
    )

    rows = mm.list_members(start_date="2026-09-01", end_date="2026-09-30", db=db, current_user=admin)
    a, b = by_id(rows, alice.id), by_id(rows, bob.id)
    assert a["manday_total"] == pytest.approx(1.5)
    assert b["manday_total"] == pytest.approx(1.5)
    # The old calendar-span number (10.0 each) must still be readable, just
    # under its new, separate field — never silently dropped.
    assert a["manday_calendar_span_total"] == pytest.approx(10.0)
    assert b["manday_calendar_span_total"] == pytest.approx(10.0)


def test_zero_manday_est_contributes_zero_not_a_crash(db, admin, world):
    """manday_est is NOT NULL on Task (schema-enforced) — the realistic
    'missing estimate' case on production is a row saved with 0, not NULL.
    It must contribute 0 and must not crash the aggregation."""
    alice = mk_member(db, "Alice")
    bob = mk_member(db, "Bob")
    mk_task(
        db, world, assigned=alice, support=bob, manday_est=0,
        kpi_ratio_assign=90, kpi_ratio_support=10,
        start_date=date(2026, 9, 1), end_date_actual=date(2026, 9, 25),
    )

    rows = mm.list_members(start_date="2026-09-01", end_date="2026-09-30", db=db, current_user=admin)
    a = by_id(rows, alice.id)
    assert a["manday_total"] == 0.0
    assert a["manday_calendar_span_total"] == pytest.approx(22.5)  # 25-day span x 90%


def test_kpi_total_unaffected_by_manday_source_change(db, admin, world):
    """This fix only touches manday_total's source — kpi_total (and
    therefore kpi_avg / kpi_bonus / days-late, which are computed from
    kpi_assigned/kpi_support and manday_actual on the Task row directly,
    never through list_members()'s manday_total) must be byte-for-byte the
    same regardless of how wide the task's calendar span is."""
    alice = mk_member(db, "Alice")
    bob = mk_member(db, "Bob")
    mk_task(
        db, world, assigned=alice, support=bob, manday_est=5,
        kpi_ratio_assign=90, kpi_ratio_support=10,
        kpi_assigned=42, kpi_support=7,
        start_date=date(2026, 9, 1), end_date_actual=date(2026, 9, 30),
    )

    rows = mm.list_members(start_date="2026-09-01", end_date="2026-09-30", db=db, current_user=admin)
    a, b = by_id(rows, alice.id), by_id(rows, bob.id)
    assert a["kpi_total"] == pytest.approx(42.0)
    assert b["kpi_total"] == pytest.approx(7.0)
