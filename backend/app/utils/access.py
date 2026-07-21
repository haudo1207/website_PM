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
VALID_DATA_SCOPES = {ALL_SCOPE, DEFAULT_SCOPE}


def user_scope(user) -> str:
    return (getattr(user, "data_scope", None) or DEFAULT_SCOPE).strip().lower()


def project_query_for_user(db: Session, user):
    query = db.query(Project)
    scope = user_scope(user)
    return query if scope == ALL_SCOPE else query.filter(Project.data_scope == scope)


def can_access_project(user, project: Project) -> bool:
    scope = user_scope(user)
    return scope == ALL_SCOPE or project.data_scope == scope


def require_project(db: Session, user, project_id: int) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    # Return 404 for both missing and out-of-scope records to avoid leaking IDs.
    if not project or not can_access_project(user, project):
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

    # Role-based write authorization.
    if request.method not in {"GET", "HEAD", "OPTIONS"} and user.role != "admin":
        # Members may perform Task CRUD if assigned to the current project.
        if _is_task_write(request) and project_id is not None and _is_member_of_project(db, user, int(project_id)):
            return user
        raise HTTPException(403, "Yêu cầu quyền admin, bạn không có quyền thực hiện thao tác này!")

    return user
