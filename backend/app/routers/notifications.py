from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import date, datetime, timedelta
from typing import Optional

from ..database import get_db
from ..utils.auth import get_current_user
from ..utils.access import (
    ROLE_SUPER_ADMIN,
    ROLE_LEADER,
    business_unit_for_project,
    can_access_project,
    _is_member_of_project,
    primary_workspace_code_for_user,
    resolve_workspace,
    user_allowed_scopes,
)
from ..models.notification import Notification
from ..models.task import Task
from ..models.task_group import TaskGroup
from ..models.phase import Phase
from ..models.project import Project, project_members
from ..models.user import User
from ..models.member import Member
from ..models.zalo import ZaloConversation

router = APIRouter()


def _find_project_leaders(db: Session, project: Project) -> list[User]:
    """Find the PM and Technical Leader Users for a project."""
    member_ids = []
    if project.pm_id:
        member_ids.append(project.pm_id)
    if project.technical_leader_id:
        member_ids.append(project.technical_leader_id)

    if not member_ids:
        return []

    # Remove duplicates
    member_ids = list(set(member_ids))

    users = db.query(User).filter(User.member_id.in_(member_ids)).all()
    return users


def _find_leader_user(db: Session, project: Project) -> Optional[User]:
    """
    DEPRECATED: Use _find_project_leaders.
    Find the leader/PM User for a project with multiple fallback strategies.
    """
    leaders = _find_project_leaders(db, project)
    if leaders:
        return leaders[0]

    # Fallback strategies from the old function, in case PM/Tech lead are not set.
    # 3. Check project_members table for members with role 'Leader' or 'PM'
    pm_row = db.execute(
        project_members.select().where(
            project_members.c.project_id == project.id,
            project_members.c.role.in_(["Leader", "PM", "Technical Leader", "pm", "leader"])
        )
    ).first()
    if pm_row:
        user = db.query(User).filter(User.member_id == pm_row.member_id).first()
        if user:
            return user

    # 4. Any member of the project who has user.role in ('super_admin', 'leader')
    all_pm_rows = db.execute(
        project_members.select().where(project_members.c.project_id == project.id)
    ).fetchall()
    member_ids = [r.member_id for r in all_pm_rows]
    if member_ids:
        user = db.query(User).filter(
            User.member_id.in_(member_ids),
            User.role.in_(["super_admin", "leader"])
        ).first()
        if user:
            return user

    # 5. Fallback: Any super_admin or leader user in system
    fallback_user = db.query(User).filter(User.role.in_(["super_admin", "leader"])).first()
    return fallback_user



@router.post("/remind")
def remind_leader(
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """
    Member gửi nhắc nhở tới Leader của task.
    Body: { task_id: int, message?: str }
    """
    task_id = body.get("task_id")
    if not task_id:
        raise HTTPException(400, "task_id là bắt buộc.")

    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(404, "Không tìm thấy task.")

    # Walk up: Task → TaskGroup → Phase → Project
    task_group = db.query(TaskGroup).filter(TaskGroup.id == task.task_group_id).first()
    if not task_group:
        raise HTTPException(404, "Không tìm thấy task group.")

    phase = db.query(Phase).filter(Phase.id == task_group.phase_id).first()
    if not phase:
        raise HTTPException(404, "Không tìm thấy phase.")

    project = db.query(Project).filter(Project.id == phase.project_id).first()
    if not project:
        raise HTTPException(404, "Không tìm thấy dự án.")

    leader_user = _find_leader_user(db, project)
    if not leader_user:
        raise HTTPException(400, "Dự án chưa có Leader được chỉ định.")

    sender_name = current_user.full_name or current_user.email
    custom_message = str(body.get("message", "")).strip()
    message = custom_message or (
        f"🔔 {sender_name} nhắc bạn kiểm tra task [{task.task_code or task.id}]: "
        f"'{task.detail[:80]}' trong dự án '{project.name}'."
    )

    notification = Notification(
        recipient_id=leader_user.id,
        sender_id=current_user.id,
        task_id=task.id,
        message=message,
        notification_type="task_reminder",
        is_read=False,
    )
    db.add(notification)
    db.commit()

    return {"success": True, "message": "Đã gửi nhắc nhở tới Leader thành công!"}


@router.post("/remind-bulk")
def remind_leader_bulk(
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """
    Member gửi nhắc nhở hàng loạt tới Leader của tất cả task trễ/done chưa duyệt.
    Body: { project_id?: int } - nếu không có thì lấy tất cả task của member
    """
    member_id = current_user.member_id
    if not member_id:
        raise HTTPException(400, "Tài khoản chưa liên kết với Member.")

    today = date.today()

    # Find tasks that are overdue (not Done/Cancel, past end_date_est) or Done with no kpi_final
    from sqlalchemy import or_
    query = db.query(Task).filter(
        or_(Task.assigned_id == member_id, Task.support_id == member_id),
        or_(
            # Overdue: not done/cancel, end_date_est passed
            (Task.end_date_est < today) & (Task.status.notin_(["Done", "Cancel"])),
            # Done but kpi_final is null/0 — waiting Leader approval
            (Task.status == "Done") & ((Task.kpi_final == None) | (Task.kpi_final == 0))
        )
    )

    project_id = body.get("project_id")
    if project_id:
        # Filter to only tasks in the specified project
        group_ids = db.query(TaskGroup.id).join(Phase).filter(Phase.project_id == project_id).subquery()
        query = query.filter(Task.task_group_id.in_(group_ids))

    tasks = query.all()
    if not tasks:
        return {"success": True, "sent": 0, "message": "Không có task nào cần nhắc nhở."}

    sender_name = current_user.full_name or current_user.email
    sent_count = 0
    notified_leaders: set = set()

    for task in tasks:
        task_group = db.query(TaskGroup).filter(TaskGroup.id == task.task_group_id).first()
        if not task_group:
            continue
        phase = db.query(Phase).filter(Phase.id == task_group.phase_id).first()
        if not phase:
            continue
        project = db.query(Project).filter(Project.id == phase.project_id).first()
        if not project:
            continue

        leader_user = _find_leader_user(db, project)
        if not leader_user:
            continue

        # Avoid sending duplicate notifications to same leader per project
        key = (leader_user.id, phase.project_id)
        if key in notified_leaders:
            sent_count += 1
            continue

        notified_leaders.add(key)

        status_text = "trễ hạn" if task.status not in ["Done", "Cancel"] else "đã Done chờ xác nhận"
        notification = Notification(
            recipient_id=leader_user.id,
            sender_id=current_user.id,
            task_id=task.id,
            message=(
                f"⚠️ {sender_name} cần bạn xem xét các task {status_text} "
                f"trong dự án '{project.name}'."
            ),
            notification_type="bulk_reminder",
            is_read=False,
        )
        db.add(notification)
        sent_count += 1

    db.commit()
    return {
        "success": True,
        "sent": sent_count,
        "message": f"Đã gửi nhắc nhở tới Leader cho {sent_count} task."
    }


@router.get("/my-alerts")
def get_my_alerts(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """
    Lấy thống kê cảnh báo cho member hiện tại:
    - Số task trễ hạn
    - Số task Done chờ xác nhận (kpi_final = 0/null)
    """
    member_id = current_user.member_id
    if not member_id:
        return {"overdue_count": 0, "pending_approval_count": 0, "total": 0}

    today = date.today()
    from sqlalchemy import or_

    overdue_count = db.query(Task).filter(
        or_(Task.assigned_id == member_id, Task.support_id == member_id),
        Task.end_date_est < today,
        Task.status.notin_(["Done", "Cancel"])
    ).count()

    pending_approval_count = db.query(Task).filter(
        or_(Task.assigned_id == member_id, Task.support_id == member_id),
        Task.status == "Done",
        or_(Task.kpi_final == None, Task.kpi_final == 0)
    ).count()

    return {
        "overdue_count": overdue_count,
        "pending_approval_count": pending_approval_count,
        "total": overdue_count + pending_approval_count
    }


@router.post("/remind-group")
def remind_group_leader(
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """
    Member gửi nhắc nhở duyệt Task Cha (Task Group) tới Leader.
    Chỉ cho phép khi tất cả các Task con thuộc TaskGroup đó đều có status = 'Done'.
    """
    task_group_id = body.get("task_group_id")
    if not task_group_id:
        raise HTTPException(400, "task_group_id là bắt buộc.")

    task_group = db.query(TaskGroup).filter(TaskGroup.id == task_group_id).first()
    if not task_group:
        raise HTTPException(404, "Không tìm thấy Task Cha (Task Group).")

    # Fetch all child tasks
    child_tasks = db.query(Task).filter(Task.task_group_id == task_group_id).all()
    if not child_tasks:
        raise HTTPException(400, "Task Cha này không có task con nào.")

    unfinished = [t for t in child_tasks if not (t.status and t.status.strip().lower() == "done")]
    if unfinished:
        raise HTTPException(400, "Tất cả task con phải ở trạng thái Done mới được phép gửi thông báo!")

    # Cooldown check: only 1 reminder per 24 hours per task group
    now = datetime.utcnow()
    twenty_four_hours_ago = now - timedelta(hours=24)
    
    last_reminder = db.query(Notification).filter(
        Notification.task_group_id == task_group_id,
        Notification.notification_type == "group_approval_request",
        Notification.created_at > twenty_four_hours_ago
    ).first()
    
    if last_reminder:
        raise HTTPException(status_code=429, detail="Bạn chỉ có thể gửi lại nhắc nhở cho Task Cha này sau 24 giờ.")

    phase = db.query(Phase).filter(Phase.id == task_group.phase_id).first()
    if not phase:
        raise HTTPException(404, "Không tìm thấy Phase.")

    project = db.query(Project).filter(Project.id == phase.project_id).first()
    if not project:
        raise HTTPException(404, "Không tìm thấy Dự án.")

    recipients = _find_project_leaders(db, project)

    # Add the Member's responsible Leader from "Quản lý thành viên"
    if current_user.member_id:
        sender_member = db.query(Member).filter(Member.id == current_user.member_id).first()
        if sender_member and sender_member.leader_member_id:
            leader_user = db.query(User).filter(User.member_id == sender_member.leader_member_id).first()
            if leader_user and leader_user.id not in [u.id for u in recipients]:
                recipients.append(leader_user)

    if not recipients:
        raise HTTPException(400, "Dự án chưa có Project Manager hoặc Technical Leader được chỉ định.")

    sender_name = current_user.full_name or current_user.email
    message = (
        f"🔔 {sender_name} nhắc bạn duyệt Task Cha: "
        f"'{task_group.name}' trong dự án '{project.name}' (Tất cả task con đã Done)."
    )

    for user in recipients:
        notification = Notification(
            recipient_id=user.id,
            sender_id=current_user.id,
            task_group_id=task_group.id,
            project_id=project.id,
            message=message,
            notification_type="group_approval_request",
            is_read=False,
        )
        db.add(notification)

    db.commit()

    return {"success": True, "message": "Đã gửi thông báo nhắc Leader duyệt Task Cha thành công!"}


@router.get("/inbox")
def get_inbox_notifications(
    workspace: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """
    Lấy danh sách thông báo hộp thư và số lượng chưa đọc.
    Lọc theo quyền hạn của user và workspace đang chọn, không trả về thông báo chéo workspace
    hoặc thông báo của các dự án mà user không tham gia.
    """
    target_ws_code = None
    if workspace and workspace.strip().lower() not in ("all", ""):
        ws_obj = resolve_workspace(db, workspace)
        target_ws_code = ws_obj.code.lower() if ws_obj else workspace.strip().lower()
    elif getattr(current_user, "role", None) != ROLE_SUPER_ADMIN:
        target_ws_code = primary_workspace_code_for_user(db, current_user)

    all_notifs = (
        db.query(Notification)
        .filter(Notification.recipient_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .limit(100)
        .all()
    )

    filtered = []
    for n in all_notifs:
        if not n.project_id:
            filtered.append(n)
            continue

        project = n.project
        if not project:
            continue

        if not can_access_project(db, current_user, project):
            continue

        p_bu = business_unit_for_project(db, project).lower()
        p_scope = (project.data_scope or "").strip().lower()
        is_global = p_scope == "all" or (project.business and project.business.lower() == "all")

        if target_ws_code and not is_global:
            matched = (
                p_bu == target_ws_code
                or p_scope == target_ws_code
                or (project.business and resolve_workspace(db, project.business) and resolve_workspace(db, project.business).code.lower() == target_ws_code)
            )
            if not matched:
                continue

        if n.notification_type == "zalo_demo_ready":
            if getattr(current_user, "role", None) == ROLE_SUPER_ADMIN:
                pass
            else:
                is_pm = (project.pm_id == current_user.member_id) or (project.technical_leader_id == current_user.member_id)
                is_member = _is_member_of_project(db, current_user, project.id)
                is_assignee_lead = False
                is_task_assignee_or_support = False
                if n.task:
                    if n.task.assigned_id == current_user.member_id or n.task.support_id == current_user.member_id:
                        is_task_assignee_or_support = True
                    if n.task.assigned_id:
                        ass = db.query(Member).filter(Member.id == n.task.assigned_id).first()
                        if ass and ass.leader_member_id == current_user.member_id:
                            is_assignee_lead = True
                u_scopes = user_allowed_scopes(db, current_user)
                is_own_ws_leader = (
                    getattr(current_user, "role", None) == ROLE_LEADER
                    and (p_bu in u_scopes or "all" in u_scopes)
                )
                if not (is_pm or is_member or is_assignee_lead or is_task_assignee_or_support or is_own_ws_leader):
                    continue

        filtered.append(n)
        if len(filtered) >= 30:
            break

    unread_count = sum(1 for n in filtered if not n.is_read)

    conv_ids = [n.zalo_conversation_id for n in filtered if n.zalo_conversation_id]
    convs_by_id = {}
    if conv_ids:
        convs_by_id = {
            c.id: c for c in db.query(ZaloConversation).filter(ZaloConversation.id.in_(conv_ids)).all()
        }

    items = []
    for n in filtered:
        sender_name = n.sender.full_name if n.sender else "Hệ thống"
        project_name = n.project.name if n.project else None
        group_name = n.task_group.name if n.task_group else None
        conv = convs_by_id.get(n.zalo_conversation_id) if n.zalo_conversation_id else None
        items.append({
            "id": n.id,
            "sender_id": n.sender_id,
            "sender_name": sender_name,
            "project_id": n.project_id,
            "project_name": project_name,
            "task_group_id": n.task_group_id,
            "group_name": group_name,
            "task_id": n.task_id,
            "message": n.message,
            "notification_type": n.notification_type,
            "is_read": n.is_read,
            "created_at": n.created_at.isoformat() if n.created_at else None,
            "zalo_conversation_id": n.zalo_conversation_id,
            "zalo_conversation_name": conv.name if conv else None,
        })

    return {
        "unread_count": unread_count,
        "items": items
    }


@router.patch("/{id}/read")
def mark_notification_read(
    id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    notification = db.query(Notification).filter(Notification.id == id).first()
    if not notification:
        raise HTTPException(404, "Không tìm thấy thông báo.")
    notification.is_read = True
    db.commit()
    return {"success": True}

