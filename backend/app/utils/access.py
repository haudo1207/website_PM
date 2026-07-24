import re
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.meeting import Meeting
from ..models.phase import Phase
from ..models.project import Project, project_members
from ..models.task import Task
from ..models.task_group import TaskGroup
from .auth import get_current_user

ALL_SCOPE = "all"
DEFAULT_SCOPE = "infrastructure"
VALID_DATA_SCOPES = {ALL_SCOPE, DEFAULT_SCOPE, "markee"}

# ── Role constants ──────────────────────────────────────────
ROLE_SUPER_ADMIN = "super_admin"
ROLE_LEADER = "leader"
ROLE_MEMBER = "member"
ROLE_VIEWER = "viewer"
VALID_ROLES = {ROLE_SUPER_ADMIN, ROLE_LEADER, ROLE_MEMBER, ROLE_VIEWER, "admin"}
WRITE_ROLES = {ROLE_SUPER_ADMIN, ROLE_LEADER, "admin"}
# Teams a Leader may be assigned to (Leader cannot use "all").
LEADER_ALLOWED_SCOPES = {DEFAULT_SCOPE, "markee"}


def user_scope(user) -> str:
    return (getattr(user, "data_scope", None) or DEFAULT_SCOPE).strip().lower()


def project_query_for_user(db: Session, user):
    """Return a Project query filtered by the caller's role and scope.

    - super_admin (scope=all): every project.
    - leader: projects whose data_scope matches the leader's team.
    - member / viewer: only projects the user is explicitly assigned to
      via the project_members_v2 junction table.
    """
    query = db.query(Project)
    scope = user_scope(user)
    role = getattr(user, "role", ROLE_MEMBER)

    if role == ROLE_SUPER_ADMIN or scope == ALL_SCOPE:
        return query

    if role == ROLE_LEADER:
        return query.filter(Project.data_scope == scope)

    # member / viewer — restrict to assigned projects only.
    member_id = getattr(user, "member_id", None)
    if not member_id:
        # User has no linked member → they can see nothing.
        return query.filter(Project.id == -1)

    assigned_project_ids = (
        db.query(project_members.c.project_id)
        .filter(project_members.c.member_id == member_id)
        .subquery()
    )
    return query.filter(Project.id.in_(assigned_project_ids))


def can_access_project(db: Session, user, project: Project) -> bool:
    """Check whether *user* is allowed to view *project*."""
    scope = user_scope(user)
    role = getattr(user, "role", ROLE_MEMBER)

    if role == ROLE_SUPER_ADMIN or scope == ALL_SCOPE:
        return True

    if role == ROLE_LEADER:
        return project.data_scope == scope

    # member / viewer — must be an explicit project member.
    member_id = getattr(user, "member_id", None)
    if not member_id:
        return False
    return _is_member_of_project(db, user, project.id)


def require_project(db: Session, user, project_id: int) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    # Return 404 for both missing and out-of-scope records to avoid leaking IDs.
    if not project or not can_access_project(db, user, project):
        raise HTTPException(404, "Project not found.")
    return project


def _is_task_write(request: Request) -> bool:
    """Check if the request is a Task-related write operation (Create/Update/Delete)."""
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return False
    return re.search(r"/task-groups/\d+/tasks", request.url.path) is not None


def _is_member_of_project(db: Session, user, project_id: int) -> bool:
    """Check if the user's linked member is assigned to the project."""
    if not user.member_id:
        return False
    return db.execute(
        project_members.select().where(
            project_members.c.project_id == project_id,
            project_members.c.member_id == user.member_id,
        )
    ).first() is not None


def require_route_project_access(
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Authorize project, phase, group, task, or meeting path parameters."""
    params = request.path_params
    project_id = params.get("pid")

    # Resolve project_id from path parameters if not directly provided.
    if project_id is None and params.get("phid") is not None:
        project_id = db.query(Phase.project_id).filter(Phase.id == int(params["phid"])).scalar()
    if project_id is None and params.get("gid") is not None:
        project_id = (
            db.query(Phase.project_id)
            .join(TaskGroup, TaskGroup.phase_id == Phase.id)
            .filter(TaskGroup.id == int(params["gid"]))
            .scalar()
        )
    if project_id is None and params.get("tid") is not None:
        project_id = (
            db.query(Phase.project_id)
            .join(TaskGroup, TaskGroup.phase_id == Phase.id)
            .join(Task, Task.task_group_id == TaskGroup.id)
            .filter(Task.id == int(params["tid"]))
            .scalar()
        )
    if project_id is None and request.url.path.startswith("/api/meetings/") and params.get("id") is not None:
        meeting = db.query(Meeting).filter(Meeting.id == int(params["id"])).first()
        if meeting and meeting.project_id is None and user_scope(user) != ALL_SCOPE:
            raise HTTPException(404, "Meeting not found.")
        project_id = meeting.project_id if meeting else None

    # Check data scope access if project_id is resolved.
    if project_id is not None:
        require_project(db, user, int(project_id))

    role = getattr(user, "role", ROLE_MEMBER)

    # ── Viewer: read-only — block every non-GET request unconditionally. ──
    if role == ROLE_VIEWER and request.method not in {"GET", "HEAD", "OPTIONS"}:
        raise HTTPException(403, "Viewer không có quyền thực hiện thao tác này!")

    # ── Role-based write authorization. ──
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        if role in WRITE_ROLES:
            # super_admin and leader may write freely within their scope.
            return user

        # member: may perform Task CRUD if assigned to the current project.
        if role == ROLE_MEMBER:
            if _is_task_write(request) and project_id is not None and _is_member_of_project(db, user, int(project_id)):
                return user
            raise HTTPException(403, "Yêu cầu quyền quản lý, bạn không có quyền thực hiện thao tác này!")

        # Catch-all for any unexpected role.
        raise HTTPException(403, "Yêu cầu quyền quản lý, bạn không có quyền thực hiện thao tác này!")

    return user
