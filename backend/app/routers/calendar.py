"""
Calendar Router — Personal "My Task Calendar" view (008-task-calendar-overview).

A read-only scheduling layer on top of the existing Task Management system,
NOT a second Task CRUD system. Creating/updating a task (including its
`scheduled_at`) still goes entirely through the existing
POST/PATCH /task-groups/{gid}/tasks endpoints in task_groups.py — see
specs/008-task-calendar-overview/plan.md section 0.
"""
import re
from datetime import datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.member import Member
from ..models.meeting import Meeting, MeetingMember
from ..models.phase import Phase
from ..models.project import CalendarProjectPreference, Project
from ..models.skill_master import Group, Skill
from ..models.task import Task
from ..models.task_group import TaskGroup
from ..models.user import User
from ..utils.auth import get_current_user
from ..utils.kpi_engine import parse_date
from .meetings import meeting_to_dict
from .task_groups import serialize_task

router = APIRouter()


@router.get("/tasks")
def list_calendar_tasks(
    from_: str = Query(..., alias="from", description="YYYY-MM-DD, inclusive"),
    to: str = Query(..., description="YYYY-MM-DD, inclusive"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Personal Calendar — returns ONLY tasks where current_user is
    assigned_id or support_id, across every project they belong to.

    This is a hard data-scope boundary, not a UX filter: Project role
    (Leader / PM / Super Admin) does NOT expand it — a Leader with full
    access to a project still only sees their own Assigned/Support tasks
    here (spec.md section 2.2/2.3). Never widen this filter to "everyone
    on the project"; that would be a Team Calendar, explicitly out of
    scope for this feature (spec.md section 6).

    Includes BOTH: tasks scheduled inside [from, to] (rendered on the grid)
    AND every unscheduled task in scope (scheduled_at IS NULL — rendered in
    the "chưa xếp lịch" tray). An unscheduled task has no date of its own,
    so it can't be excluded by the date filter — it always accompanies
    whatever range is being viewed, same as spec.md FR-CAL-06. Frontend
    splits the two by checking `scheduled_at`.
    """
    member_id = getattr(current_user, "member_id", None)
    if not member_id:
        return []

    from_date = parse_date(from_)
    to_date = parse_date(to)
    if not from_date or not to_date:
        raise HTTPException(400, "Invalid 'from'/'to' — expected YYYY-MM-DD.")

    from_dt = datetime.combine(from_date, time.min)
    to_dt = datetime.combine(to_date, time.min) + timedelta(days=1)  # 'to' is inclusive

    results = (
        db.query(Task, TaskGroup, Phase, Project)
        .join(TaskGroup, Task.task_group_id == TaskGroup.id)
        .join(Phase, TaskGroup.phase_id == Phase.id)
        .join(Project, Phase.project_id == Project.id)
        .filter(or_(Task.assigned_id == member_id, Task.support_id == member_id))
        .filter(or_(
            Task.scheduled_at.is_(None),
            and_(Task.scheduled_at >= from_dt, Task.scheduled_at < to_dt),
        ))
        .all()
    )

    members_map = {m.id: (m.display_name or m.full_name) for m in db.query(Member).all()}
    groups_map = {g.id: g.name for g in db.query(Group).all()}
    skills_map = {s.id: s.name for s in db.query(Skill).all()}
    # Personal Calendar Preference — per-Member project color, NOT a Project
    # attribute (two members can pick different colors for the same
    # project). Missing row = frontend's own fallback color, same as today.
    color_map = {
        pref.project_id: pref.color
        for pref in db.query(CalendarProjectPreference).filter(CalendarProjectPreference.member_id == member_id).all()
    }

    output = []
    for task, tg, phase, project in results:
        t_dict = serialize_task(task, db, members_map, groups_map, skills_map)
        t_dict["project_id"] = project.id
        t_dict["project_name"] = project.name
        t_dict["project_color"] = color_map.get(project.id)
        t_dict["calendar_role"] = "assigned" if task.assigned_id == member_id else "support"
        output.append(t_dict)

    return output


@router.get("/meetings")
def list_calendar_meetings(
    from_: str = Query(..., alias="from", description="YYYY-MM-DD, inclusive"),
    to: str = Query(..., description="YYYY-MM-DD, inclusive"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Personal Calendar — Meeting is a SEPARATE event type from Task, on
    its own endpoint (not merged into GET /tasks), with its own data model
    and its own permission scoping. Frontend fetches both and merges by
    time client-side — see "Chốt thêm requirement: Personal Calendar hiển
    thị cả Task + Meeting, nhưng hai loại dữ liệu và quyền xử lý độc lập."

    Scope is deliberately narrower than the main Meetings-tab list
    (`GET /meetings`, which also grants visibility via Project ACL/role):
    here it's ONLY meetings this member created or was added to as a
    participant — never expanded just because the user is a Leader/Super
    Admin on the meeting's project. Reuses meeting_to_dict() as-is so the
    shape matches the Meetings tab exactly; no separate Calendar-only
    Meeting serialization.
    """
    member_id = getattr(current_user, "member_id", None)
    if not member_id:
        return []

    from_date = parse_date(from_)
    to_date = parse_date(to)
    if not from_date or not to_date:
        raise HTTPException(400, "Invalid 'from'/'to' — expected YYYY-MM-DD.")

    meetings = (
        db.query(Meeting)
        .filter(Meeting.meeting_date >= from_date, Meeting.meeting_date <= to_date)
        .filter(or_(
            Meeting.created_by == member_id,
            Meeting.id.in_(db.query(MeetingMember.meeting_id).filter(MeetingMember.member_id == member_id)),
        ))
        .order_by(Meeting.meeting_date, Meeting.start_time)
        .all()
    )
    return [meeting_to_dict(m, db, current_user) for m in meetings]


@router.get("/project-colors")
def list_calendar_project_colors(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """This member's saved Personal Calendar color per project — a bulk map
    so Quick Create can show "already has a color" for any project the
    moment it's selected, without a round-trip per project. Projects with
    no saved preference are simply absent (frontend falls back to a default
    color), matching the same "no record = default" rule as the tasks list.
    """
    member_id = getattr(current_user, "member_id", None)
    if not member_id:
        return {}
    return {
        pref.project_id: pref.color
        for pref in db.query(CalendarProjectPreference).filter(CalendarProjectPreference.member_id == member_id).all()
    }


@router.put("/project-colors/{project_id}")
def set_calendar_project_color(
    project_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upsert THIS member's Personal Calendar color for one project. Never
    touches `projects` or `tasks_v2` — purely a per-Member preference (see
    008-task-calendar-overview "Màu Project trong Personal Calendar" §5/§10).
    """
    member_id = getattr(current_user, "member_id", None)
    if not member_id:
        raise HTTPException(403, "Tài khoản này chưa liên kết Member — không có Personal Calendar.")

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found.")

    color = str(body.get("color") or "").strip()
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}", color):
        raise HTTPException(400, "Color must be a hex value like #EF4444.")

    pref = (
        db.query(CalendarProjectPreference)
        .filter(CalendarProjectPreference.member_id == member_id, CalendarProjectPreference.project_id == project_id)
        .first()
    )
    if pref:
        pref.color = color
    else:
        pref = CalendarProjectPreference(member_id=member_id, project_id=project_id, color=color)
        db.add(pref)
    db.commit()
    db.refresh(pref)
    return {"project_id": project_id, "color": pref.color}
