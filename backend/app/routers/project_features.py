"""
Project Features Router — per-project "Tính năng" tracking with a WIP-log
timeline. Ported from markee-dashboard's ProjectDetailContent.tsx concept
(skill_library rows tagged skill_type='wip' + feature_name), rebuilt here as
real normalized tables scoped to pm-new's own DB.
"""
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.project_feature import ProjectFeature, ProjectFeatureLog
from ..models.member import Member
from ..utils.access import require_route_project_access, require_project
from ..utils.auth import get_current_user

logger = logging.getLogger("project_features")

router = APIRouter(tags=["project-features"], dependencies=[Depends(require_route_project_access)])


def _auto_summarize_log_background(log_id: int) -> None:
    """Runs AFTER the create-log response is already sent (FastAPI
    BackgroundTasks) — an AI call can take 20-30s+, which used to make
    log-creation itself painfully slow and prone to "socket hang up" through
    the Next.js dev proxy's request timeout when done inline. Uses its own
    short-lived session since the request-scoped `db` is closed by then."""
    from ..database import BackgroundSessionLocal
    from ..services.project_feature_ai import summarize_feature_log
    from ..services.ai_client import AiClientError

    db = BackgroundSessionLocal()
    try:
        log = db.query(ProjectFeatureLog).filter(ProjectFeatureLog.id == log_id).first()
        if not log:
            return
        summarize_feature_log(db, log)
        db.commit()
    except AiClientError as e:
        logger.warning("Auto-summarize sau khi tạo log %s thất bại: %s", log_id, e)
        db.rollback()
    finally:
        db.close()


def _member_id_for(current_user, db: Session):
    if current_user and getattr(current_user, "email", None):
        member = db.query(Member).filter(Member.email.ilike(current_user.email)).first()
        if member:
            return member.id
    return None


def _display_name_for(current_user) -> str | None:
    """Fallback name for accounts with no linked Member profile (e.g. an
    admin/system login used only through the extension) — without this,
    logs created by such accounts would show "Ẩn danh" despite a known login."""
    if not current_user:
        return None
    return getattr(current_user, "full_name", None) or getattr(current_user, "email", None)


def _feature_to_dict(f: ProjectFeature) -> dict:
    return {
        "id": f.id,
        "project_id": f.project_id,
        "name": f.name,
        "created_by": f.created_by.display_name if f.created_by else None,
        "created_at": f.created_at.isoformat() if f.created_at else None,
        "log_count": len(f.logs or []),
    }


def _log_to_dict(l: ProjectFeatureLog) -> dict:
    return {
        "id": l.id,
        "feature_id": l.feature_id,
        "project_id": l.project_id,
        "content": l.content,
        "status": l.status,
        "author": (l.author.display_name if l.author else None) or l.author_display_name,
        "author_avatar_color": getattr(l.author, "avatar_color", None) if l.author else None,
        "created_at": l.created_at.isoformat() if l.created_at else None,
        "attached_files": l.attached_files or [],
        "ai_summary": l.ai_summary,
        "ai_tasks": l.ai_tasks or [],
    }


@router.get("/projects/{pid:int}/features")
def list_features(pid: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    require_project(db, current_user, pid)
    features = (
        db.query(ProjectFeature)
        .filter(ProjectFeature.project_id == pid)
        .order_by(ProjectFeature.created_at.asc())
        .all()
    )
    return [_feature_to_dict(f) for f in features]


@router.post("/projects/{pid:int}/features")
def create_feature(pid: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    require_project(db, current_user, pid)
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Thiếu tên tính năng")

    existing = (
        db.query(ProjectFeature)
        .filter(ProjectFeature.project_id == pid, ProjectFeature.name.ilike(name))
        .first()
    )
    if existing:
        raise HTTPException(400, "Tính năng này đã tồn tại trong dự án")

    feature = ProjectFeature(project_id=pid, name=name, created_by_id=_member_id_for(current_user, db))
    db.add(feature)
    db.commit()
    db.refresh(feature)
    return _feature_to_dict(feature)


@router.patch("/projects/{pid:int}/features/{fid:int}")
def rename_feature(pid: int, fid: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    require_project(db, current_user, pid)
    feature = db.query(ProjectFeature).filter(ProjectFeature.id == fid, ProjectFeature.project_id == pid).first()
    if not feature:
        raise HTTPException(404, "Không tìm thấy tính năng")

    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Thiếu tên tính năng")

    feature.name = name
    db.commit()
    db.refresh(feature)
    return _feature_to_dict(feature)


@router.delete("/projects/{pid:int}/features/{fid:int}")
def delete_feature(pid: int, fid: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    require_project(db, current_user, pid)
    feature = db.query(ProjectFeature).filter(ProjectFeature.id == fid, ProjectFeature.project_id == pid).first()
    if not feature:
        raise HTTPException(404, "Không tìm thấy tính năng")

    if feature.logs:
        raise HTTPException(400, "Tính năng này đang chứa lịch sử làm việc. Hãy xóa các log trước.")

    db.delete(feature)
    db.commit()
    return {"success": True}


@router.get("/projects/{pid:int}/feature-logs")
def list_all_logs(pid: int, feature_id: int = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    require_project(db, current_user, pid)
    query = db.query(ProjectFeatureLog).filter(ProjectFeatureLog.project_id == pid)
    if feature_id:
        query = query.filter(ProjectFeatureLog.feature_id == feature_id)
    logs = query.order_by(ProjectFeatureLog.created_at.desc()).all()
    return [_log_to_dict(l) for l in logs]


@router.post("/projects/{pid:int}/features/{fid:int}/logs")
def create_log(pid: int, fid: int, body: dict, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    require_project(db, current_user, pid)
    feature = db.query(ProjectFeature).filter(ProjectFeature.id == fid, ProjectFeature.project_id == pid).first()
    if not feature:
        raise HTTPException(404, "Không tìm thấy tính năng")

    content = (body.get("content") or "").strip()
    if not content:
        raise HTTPException(400, "Thiếu nội dung log")

    author_id = _member_id_for(current_user, db)
    log = ProjectFeatureLog(
        feature_id=fid,
        project_id=pid,
        author_id=author_id,
        author_display_name=None if author_id else _display_name_for(current_user),
        content=content,
        status=body.get("status") or "pending",
    )
    db.add(log)
    db.flush()

    attached_files = body.get("attached_files") or []
    if attached_files:
        from ..services.document_storage import save_base64_upload
        metas = []
        for f in attached_files:
            file_name = f.get("file_name") or f.get("fileName") or "file"
            b64 = f.get("base64")
            if not b64:
                continue
            try:
                relative_path, size = save_base64_upload(pid, file_name, b64)
            except ValueError as e:
                raise HTTPException(400, str(e))
            metas.append({
                "file_name": file_name, "file_path": relative_path,
                "mime_type": f.get("mime_type") or f.get("mimeType"), "size_bytes": size,
            })
        log.attached_files = metas or None

    db.commit()
    db.refresh(log)

    # Auto-summarize every new WIP log — no manual "Tạo tóm tắt" click
    # needed. Runs as a BackgroundTask (after this response is already sent)
    # rather than inline: an AI call can take 20-30s+, which made log
    # creation itself slow and prone to "socket hang up" through the
    # Next.js dev proxy's request timeout when awaited synchronously here.
    background_tasks.add_task(_auto_summarize_log_background, log.id)

    return _log_to_dict(log)


@router.get("/projects/{pid:int}/feature-logs/{lid:int}/attachments/{idx:int}")
def download_log_attachment(pid: int, lid: int, idx: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    from fastapi.responses import FileResponse
    from ..services.document_storage import resolve_path

    require_project(db, current_user, pid)
    log = db.query(ProjectFeatureLog).filter(ProjectFeatureLog.id == lid, ProjectFeatureLog.project_id == pid).first()
    files = (log.attached_files or []) if log else []
    if not log or idx < 0 or idx >= len(files):
        raise HTTPException(404, "Không tìm thấy file đính kèm")
    meta = files[idx]
    path = resolve_path(meta["file_path"])
    if not path.is_file():
        raise HTTPException(404, "File không tồn tại trên server")
    return FileResponse(path, filename=meta["file_name"], media_type=meta.get("mime_type") or "application/octet-stream")


@router.post("/projects/{pid:int}/share-link")
def create_share_link(pid: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    import secrets
    from ..config import settings
    from ..models.project import Project

    require_project(db, current_user, pid)
    project = db.query(Project).filter(Project.id == pid).first()
    if not project:
        raise HTTPException(404, "Không tìm thấy dự án")

    if not project.share_token:
        project.share_token = secrets.token_urlsafe(24)
        db.commit()

    # Not request.base_url — behind the Next.js proxy that reflects the
    # internal Docker hostname (http://backend:8000), not a browser-reachable
    # URL. The public route is proxied through the frontend's /api/* rewrite,
    # so the frontend's own public origin is what users need.
    base_url = (settings.APP_BASE_URL or settings.FRONTEND_URL or "").rstrip("/")
    return {"share_token": project.share_token, "share_url": f"{base_url}/share/project/{project.share_token}"}


@router.delete("/projects/{pid:int}/feature-logs/{lid:int}")
def delete_log(pid: int, lid: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    require_project(db, current_user, pid)
    log = db.query(ProjectFeatureLog).filter(ProjectFeatureLog.id == lid, ProjectFeatureLog.project_id == pid).first()
    if not log:
        raise HTTPException(404, "Không tìm thấy log")

    db.delete(log)
    db.commit()
    return {"success": True}


@router.post("/projects/{pid:int}/feature-logs/{lid:int}/ai-tasks")
def generate_log_ai_tasks(pid: int, lid: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    from ..services.project_feature_ai import summarize_feature_log
    from ..services.ai_client import AiClientError

    require_project(db, current_user, pid)
    log = db.query(ProjectFeatureLog).filter(ProjectFeatureLog.id == lid, ProjectFeatureLog.project_id == pid).first()
    if not log:
        raise HTTPException(404, "Không tìm thấy log")

    try:
        summarize_feature_log(db, log)
    except AiClientError as e:
        raise HTTPException(502, f"Tạo tóm tắt AI thất bại: {e}")

    db.commit()
    db.refresh(log)
    return _log_to_dict(log)


@router.post("/projects/{pid:int}/feature-logs/{lid:int}/push-tasks")
def push_log_tasks(pid: int, lid: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Push selected AI-proposed tasks from a WIP log into the real Project
    Plan. Mirrors meetings.py::push_meeting_tasks's Phase/TaskGroup/skill
    fallback + immediate Task creation — project_id is always known here
    (log.project_id), unlike meetings which sometimes must infer it."""
    import datetime
    from ..models.ai_task_inbox import AITaskInbox
    from ..models.phase import Phase
    from ..models.task_group import TaskGroup
    from ..models.task import Task
    from ..models.skill_master import Skill, Group
    from ..models.project import Project
    from ..utils.kpi_engine import parse_date, calc_end_date_est, recalculate_task

    require_project(db, current_user, pid)
    log = db.query(ProjectFeatureLog).filter(ProjectFeatureLog.id == lid, ProjectFeatureLog.project_id == pid).first()
    if not log:
        raise HTTPException(404, "Không tìm thấy log")
    feature = db.query(ProjectFeature).filter(ProjectFeature.id == log.feature_id).first()

    tasks_data = body.get("tasks") or []
    if not isinstance(tasks_data, list) or not tasks_data:
        raise HTTPException(400, "Vui lòng cung cấp danh sách task cần push")

    existing_tasks = list(log.ai_tasks or [])
    index_by_detail = {
        str(t.get("detail_task") or "").strip(): idx
        for idx, t in enumerate(existing_tasks)
        if isinstance(t, dict)
    }

    def _find_member_by_name(name: str):
        mb = db.query(Member).filter(Member.display_name.ilike(name)).first()
        if not mb:
            mb = db.query(Member).filter(Member.full_name.ilike(name)).first()
        return mb

    def _fallback_assigned_id():
        """Task.assigned_id is NOT NULL — AI-proposed tasks frequently name
        no resolvable assignee, so fall back to: the person pushing (most
        natural "no one named, I'll take it" default) → the project's PM →
        the first Member in the DB."""
        self_id = _member_id_for(current_user, db)
        if self_id:
            return self_id
        project_obj = db.query(Project).filter(Project.id == pid).first()
        if project_obj and project_obj.pm_id:
            return project_obj.pm_id
        first_member = db.query(Member).order_by(Member.id.asc()).first()
        return first_member.id if first_member else None

    pushed_count = 0
    for item in tasks_data:
        detail_task = str(item.get("detail_task") or "").strip()
        if not detail_task:
            continue

        existing_idx = index_by_detail.get(detail_task)
        if existing_idx is not None and existing_tasks[existing_idx].get("imported_task_id"):
            continue  # already pushed once — skip to avoid duplicates

        assigned_id = None
        assigned_name = item.get("assigned_name")
        support_id = None
        if assigned_name:
            names = [n.strip() for n in str(assigned_name).split(",") if n.strip()]
            if names:
                mb = _find_member_by_name(names[0])
                if mb:
                    assigned_id = mb.id
            if len(names) > 1:
                mb2 = _find_member_by_name(names[1])
                if mb2:
                    support_id = mb2.id

        inbox_task = AITaskInbox(
            project_id=pid,
            source_platform="WIP Log",
            source_group_name=feature.name if feature else "WIP Log",
            source_message=f"[WIP: {feature.name if feature else ''}] {detail_task}",
            detail_task=detail_task,
            priority=item.get("priority", "Normal"),
            assigned_id=assigned_id,
            assigned_name=assigned_name,
            support_id=support_id,
            acceptance_criteria=f"Hạn hoàn thành: {item.get('deadline') or 'Chưa xác định'}",
            status="PENDING",
            manday_est=1.0,
        )
        db.add(inbox_task)
        db.flush()
        pushed_count += 1

        imported_task_id = None
        task_code = None
        try:
            # Nested transaction (SAVEPOINT) — if Task creation fails partway
            # (e.g. a NOT NULL column this code doesn't anticipate), only this
            # item's work rolls back; the outer transaction (inbox_task + any
            # already-succeeded items this request) stays intact for the
            # final commit below.
            with db.begin_nested():
                import_phase = db.query(Phase).filter(Phase.project_id == pid).order_by(Phase.sort_order).first()
                if not import_phase:
                    import_phase = Phase(project_id=pid, name="Master", sort_order=1)
                    db.add(import_phase)
                    db.flush()
                inbox_task.phase_id = import_phase.id

                import_tg = db.query(TaskGroup).filter(TaskGroup.phase_id == import_phase.id).order_by(TaskGroup.sort_order).first()
                if not import_tg:
                    import_tg = TaskGroup(phase_id=import_phase.id, name="General Tasks", status="Waiting")
                    db.add(import_tg)
                    db.flush()
                inbox_task.task_group_id = import_tg.id

                existing_count = db.query(Task).filter(Task.task_group_id == inbox_task.task_group_id).count()
                task_code = f"T{inbox_task.task_group_id}.{existing_count + 1}"

                fallback_group = db.query(Group).order_by(Group.id.asc()).first()
                fallback_skill = db.query(Skill).order_by(Skill.id.asc()).first()

                # AI-proposed tasks rarely include a start_date (the prompt
                # doesn't ask for one) — Task.start_date is NOT NULL, so
                # default to today rather than leaving it null.
                parsed_start_date = parse_date(item.get("start_date")) or datetime.date.today()
                end_date_est_val = calc_end_date_est(parsed_start_date, inbox_task.manday_est)

                # Task.assigned_id AND support_id are both NOT NULL — AI often
                # can't resolve either name. assigned_id falls back to the
                # pusher/PM/first-Member; support_id (no natural fallback
                # person) defaults to the same person as assigned_id, with
                # kpi_ratio_support=0 so it doesn't affect KPI split — the
                # same "solo task" representation as manually creating a task
                # with no second person in the existing UI.
                final_assigned_id = inbox_task.assigned_id or _fallback_assigned_id()
                final_support_id = inbox_task.support_id or final_assigned_id

                new_task = Task(
                    task_group_id=inbox_task.task_group_id,
                    task_code=task_code,
                    detail=inbox_task.detail_task,
                    priority=inbox_task.priority or "Normal",
                    manday_est=inbox_task.manday_est,
                    status="Waiting",
                    assigned_id=final_assigned_id,
                    support_id=final_support_id,
                    kpi_ratio_assign=100,
                    kpi_ratio_support=0,
                    skill_solution_id=fallback_group.id if fallback_group else None,
                    skill_vendor_id=fallback_skill.id if fallback_skill else None,
                    remark=inbox_task.acceptance_criteria,
                    start_date=parsed_start_date,
                    end_date_est=end_date_est_val,
                )
                db.add(new_task)
                db.flush()
                recalculate_task(new_task, db)

                inbox_task.status = "IMPORTED"
                inbox_task.imported_task_id = new_task.id
            imported_task_id = new_task.id
        except Exception:
            logger.exception("Auto-import sau push thất bại cho WIP task '%s'", detail_task)

        record = {
            **item,
            "detail_task": detail_task,
            "ai_task_inbox_id": inbox_task.id,
            "imported_task_id": imported_task_id,
            "task_code": task_code,
            "pushed_at": datetime.datetime.utcnow().isoformat(),
        }
        if existing_idx is not None:
            existing_tasks[existing_idx] = record
        else:
            existing_tasks.append(record)
            index_by_detail[detail_task] = len(existing_tasks) - 1

    log.ai_tasks = existing_tasks
    db.commit()
    db.refresh(log)
    return {"success": True, "pushed_count": pushed_count, "log": _log_to_dict(log)}
