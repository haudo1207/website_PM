"""Parses the Zalo `/task` (or `task:`) command and creates a real Task row.

Message syntax (either prefix works, case-insensitive):
  /task Xây dựng landing page => critical 1 manday @Nguyễn Minh Hoàng
  task: Xây dựng landing page => critical 1 manday @Nguyễn Minh Hoàng @Ngọc Thảo

  <title> => <priority> <manday> manday [@mention ...]

@mentions are matched against Member.zalo_name (admin-set per member, see
/accounts) — case-insensitive, exact match. First mention becomes the
assignee, second becomes support (Task.assigned_id/support_id are both
required); if only one mention resolves, that member is used for both.
"""
import datetime
import logging
import re
from typing import Optional

from sqlalchemy.orm import Session

from ..models.member import Member
from ..models.phase import Phase
from ..models.task_group import TaskGroup
from ..models.task import Task
from ..models.project import Project, project_members
from ..models.skill_master import Group, Skill
from ..models.system_category import TaskPriority
from ..models.zalo import ZaloConversation
from ..models.notification import Notification
from ..models.user import User
from ..utils.kpi_engine import calc_end_date_est

logger = logging.getLogger("zalo_task")

TASK_COMMAND_RE = re.compile(
    r"^\s*(?:/task|task\s*:)\s*(?P<title>.+?)\s*=>\s*(?P<priority>\S+)\s+"
    r"(?P<manday>\d+(?:[.,]\d+)?)\s*manday(?:s)?\b\s*(?P<rest>.*)$",
    re.IGNORECASE | re.DOTALL,
)
MENTION_RE = re.compile(r"@([^@]+)")


def parse_task_command(text: str) -> Optional[dict]:
    """Returns {title, priority_raw, manday, mentions: [str]} or None if the
    text doesn't match the /task syntax at all."""
    if not text:
        return None
    m = TASK_COMMAND_RE.match(text.strip())
    if not m:
        return None
    title = m.group("title").strip()
    if not title:
        return None
    try:
        manday = float(m.group("manday").replace(",", "."))
    except ValueError:
        manday = 1.0
    mention_texts = [mt.strip() for mt in MENTION_RE.findall(m.group("rest") or "") if mt.strip()]
    return {
        "title": title,
        "priority_raw": m.group("priority").strip(),
        "manday": manday,
        "mentions": mention_texts,
    }


def resolve_priority(db: Session, priority_raw: str) -> str:
    row = db.query(TaskPriority).filter(TaskPriority.name.ilike(priority_raw)).first()
    return row.name if row else "Normal"


def resolve_mentioned_members(db: Session, mention_texts: list) -> list:
    """Matches each @mention text against a member — Member.zalo_name first
    (the deliberate, admin-set mapping), falling back to full_name/
    display_name so someone whose real name already matches their Zalo
    display name doesn't need manual re-entry in /accounts. Mentions that
    still don't match anyone are skipped (logged, not an error) — the
    caller decides whether the resulting member list is enough to proceed.
    """
    members = []
    for text in mention_texts:
        member = (
            db.query(Member)
            .filter(Member.zalo_name.isnot(None), Member.zalo_name.ilike(text))
            .first()
        )
        if not member:
            member = (
                db.query(Member)
                .filter((Member.full_name.ilike(text)) | (Member.display_name.ilike(text)))
                .first()
            )
        if member:
            members.append(member)
        else:
            logger.info("Zalo /task: no member matches '%s' (zalo_name/full_name/display_name)", text)
    return members


def _default_skill(db: Session):
    """Task.skill_solution_id/skill_vendor_id are required but the /task
    syntax has no way to specify them — fall back to the first Group/Skill
    that exists so the task can be created at all; admin can fix it up in
    the normal task edit UI afterward."""
    group = db.query(Group).order_by(Group.id).first()
    if not group:
        return None, None
    skill = db.query(Skill).filter(Skill.group_id == group.id).order_by(Skill.id).first()
    return group, skill


def _ensure_project_member(db: Session, project_id: int, member_id: int) -> None:
    """Task edits (e.g. marking Done) reject an assigned/support member who
    isn't in `project_members` — Zalo-assigned tasks bypass the normal
    "add member to project" UI step, so without this the very next manual
    edit in the app fails with "Assigned member must be a member of this
    project." Auto-adds membership at task-creation time to match the
    always-allow-assignment behavior already promised by
    get_or_create_member_from_zalo."""
    exists = db.execute(
        project_members.select().where(
            project_members.c.project_id == project_id,
            project_members.c.member_id == member_id,
        )
    ).first()
    if not exists:
        db.execute(project_members.insert().values(project_id=project_id, member_id=member_id, role="Member"))


def _default_support_id(db: Session, project_id: int, assigned_id: int) -> Optional[int]:
    """Task.support_id is a required, real, DISTINCT member (DB column is
    NOT NULL, and the task-edit endpoint separately rejects assigned_id ==
    support_id on every save) — but the "+ Task" quick form only collects
    one assignee. Picks a sensible stand-in: the project's PM, then
    technical leader, then any other existing project member. Whoever
    triggered task creation can swap it via the normal task edit UI if the
    support person actually matters for this task."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if project:
        for candidate_id in (project.pm_id, project.technical_leader_id):
            if candidate_id and candidate_id != assigned_id:
                return candidate_id
    row = db.execute(
        project_members.select().where(
            project_members.c.project_id == project_id,
            project_members.c.member_id != assigned_id,
        ).limit(1)
    ).first()
    return row.member_id if row else None


def _ensure_zalo_task_group(db: Session, project_id: int) -> TaskGroup:
    """A dedicated "Zalo" phase / "Từ Zalo" task group (auto-created if
    missing) so Zalo-originated tasks are visibly separate from
    manually-planned ones, whichever of the two creation paths below made
    them."""
    phase = db.query(Phase).filter(Phase.project_id == project_id, Phase.name == "Zalo").first()
    if not phase:
        sort_order = db.query(Phase).filter(Phase.project_id == project_id).count() + 1
        phase = Phase(project_id=project_id, name="Zalo", sort_order=sort_order)
        db.add(phase)
        db.flush()

    task_group = db.query(TaskGroup).filter(TaskGroup.phase_id == phase.id, TaskGroup.name == "Từ Zalo").first()
    if not task_group:
        task_group = TaskGroup(phase_id=phase.id, name="Từ Zalo", status="Waiting")
        db.add(task_group)
        db.flush()
    return task_group


def create_task_from_zalo(
    db: Session,
    project_id: int,
    parsed: dict,
    members: list,
    source_thread_id: str,
) -> Optional[Task]:
    """/task text-command path. Returns None (no exception) if a required
    field (assignee, skill) couldn't be resolved — caller reports that back
    to the Zalo thread instead of silently failing."""
    if not members:
        return None
    group, skill = _default_skill(db)
    if not group or not skill:
        return None

    task_group = _ensure_zalo_task_group(db, project_id)
    assigned = members[0]
    _ensure_project_member(db, project_id, assigned.id)

    support_is_placeholder = not (len(members) >= 2 and members[1].id != assigned.id)
    if support_is_placeholder:
        support_id = _default_support_id(db, project_id, assigned.id)
        if support_id is None:
            return None
    else:
        support_id = members[1].id
    _ensure_project_member(db, project_id, support_id)

    start_date = datetime.date.today()
    existing_count = db.query(Task).filter(Task.task_group_id == task_group.id).count()

    task = Task(
        task_group_id=task_group.id,
        task_code=f"ZL{task_group.id}.{existing_count + 1}",
        detail=parsed["title"][:500],
        priority=resolve_priority(db, parsed["priority_raw"]),
        manday_est=parsed["manday"],
        status="Waiting",
        start_date=start_date,
        end_date_est=calc_end_date_est(start_date, parsed["manday"]),
        assigned_id=assigned.id,
        support_id=support_id,
        kpi_ratio_assign=100 if support_is_placeholder else 90,
        kpi_ratio_support=0 if support_is_placeholder else 10,
        skill_solution_id=group.id,
        skill_vendor_id=skill.id,
        notes=f"Tạo tự động từ Zalo (thread {source_thread_id}).",
    )
    db.add(task)
    db.flush()
    return task


def create_task_direct(
    db: Session,
    project_id: int,
    title: str,
    assigned: Member,
    manday: float,
    deadline: Optional[datetime.date],
    source_thread_id: str,
    priority_raw: str = "Normal",
    support: Optional[Member] = None,
    skill_solution_id: Optional[int] = None,
    skill_vendor_id: Optional[int] = None,
    phase_id: Optional[int] = None,
    task_group_id: Optional[int] = None,
    start_date: Optional[datetime.date] = None,
    kpi_ratio_assign: int = 100,
    kpi_ratio_support: int = 0,
) -> Optional[Task]:
    """"+ Task" form path — title/assignee/priority/manday/deadline picked
    directly in the UI (no text-command parsing, no @mention matching
    needed). Returns None if the project has no skill data to default to
    yet.

    `support`/`skill_solution_id`/`skill_vendor_id`/`phase_id`+`task_group_id`/
    `start_date` are optional overrides — the Zalo summary's "Task đề xuất"
    push (a real Assigned/Support/Skill/Phase/Task-cha picker, see
    push_zalo_summary_tasks) passes these explicitly; the simpler "+ Task"
    quick-add form and the /task text command have no way to specify them
    and keep getting the auto-defaulted placeholders below unchanged.
    """
    if skill_solution_id and skill_vendor_id:
        group_id, skill_id = skill_solution_id, skill_vendor_id
    else:
        group, skill = _default_skill(db)
        if not group or not skill:
            return None
        group_id, skill_id = group.id, skill.id

    _ensure_project_member(db, project_id, assigned.id)

    if support is not None:
        support_id = support.id
    else:
        support_id = _default_support_id(db, project_id, assigned.id)
        if support_id is None:
            return None
    _ensure_project_member(db, project_id, support_id)

    # Explicit Phase/Task cha (validated by the caller against project_id)
    # lands the task in the real project plan with the normal "T{group}.{n}"
    # code, matching push_meeting_tasks — the dedicated "Zalo"/"Từ Zalo"
    # bucket (and its "ZL" tag) is only for callers that have no placement
    # picker at all.
    if phase_id and task_group_id:
        task_group = db.query(TaskGroup).filter(TaskGroup.id == task_group_id, TaskGroup.phase_id == phase_id).first()
        code_prefix = "T"
    else:
        task_group = None
        code_prefix = "ZL"
    if task_group is None:
        task_group = _ensure_zalo_task_group(db, project_id)
        code_prefix = "ZL"

    resolved_start_date = start_date or datetime.date.today()
    existing_count = db.query(Task).filter(Task.task_group_id == task_group.id).count()

    task = Task(
        task_group_id=task_group.id,
        task_code=f"{code_prefix}{task_group.id}.{existing_count + 1}",
        detail=title[:500],
        priority=resolve_priority(db, priority_raw),
        manday_est=manday,
        status="Waiting",
        start_date=resolved_start_date,
        end_date_est=deadline or calc_end_date_est(resolved_start_date, manday),
        assigned_id=assigned.id,
        support_id=support_id,
        kpi_ratio_assign=kpi_ratio_assign,
        kpi_ratio_support=kpi_ratio_support,
        skill_solution_id=group_id,
        skill_vendor_id=skill_id,
        notes=f"Tạo từ Zalo (form Task nhanh) — thread {source_thread_id}.",
    )
    db.add(task)
    db.flush()
    return task


def notify_task_done_if_zalo_linked(db: Session, task: Task, project_id: Optional[int]) -> None:
    """Call right after a task transitions INTO "Done" (old status != Done,
    new status == Done) — if the task's project has a linked Zalo
    conversation, alerts every admin/leader via the notification bell so
    they can fire "Yêu cầu xem demo" without hunting for the task inside
    /zalo-account. No-op if the project isn't Zalo-linked (most tasks).
    Recipients match the existing admin/leader gate already used for the
    Zalo feature itself (see require_manager, isAdmin())."""
    if not project_id:
        return
    # Best-effort: the task's own status transition has already been
    # committed by the caller by the time this runs — a failure here (bad
    # data on some legacy row, a transient DB hiccup, whatever) must never
    # surface as a 500 on what the user experiences as "mark task Done",
    # since that part already succeeded. Same defensive pattern as
    # _notify_assignee() in task_groups.py.
    try:
        conv = db.query(ZaloConversation).filter(ZaloConversation.project_id == project_id).first()
        if not conv:
            return

        recipients = db.query(User).filter(User.role.in_(["super_admin", "leader"])).all()
        if not recipients:
            return

        project = db.query(Project).filter(Project.id == project_id).first()
        assigned = db.query(Member).filter(Member.id == task.assigned_id).first()
        assignee_label = (assigned.full_name if assigned else None) or "?"
        message = (
            f"✅ Task [{task.task_code}] \"{(task.detail or '')[:80]}\" ({assignee_label}) đã Done — "
            f"dự án \"{project.name if project else project_id}\" đã gắn hội thoại Zalo, có thể yêu cầu xem demo."
        )
        for user in recipients:
            db.add(Notification(
                recipient_id=user.id,
                task_id=task.id,
                project_id=project_id,
                zalo_conversation_id=conv.id,
                message=message,
                notification_type="zalo_demo_ready",
                is_read=False,
            ))
        db.commit()
    except Exception:
        db.rollback()
        logger.exception(
            "notify_task_done_if_zalo_linked failed for task_id=%s project_id=%s — Done transition already committed, notification skipped.",
            getattr(task, "id", None), project_id,
        )
