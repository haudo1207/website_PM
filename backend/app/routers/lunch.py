from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_, extract, func, or_
from datetime import date as date_type
from typing import Optional, List, Dict, Set
from pydantic import BaseModel
import calendar

from ..database import get_db
from ..models.lunch_record import LunchRecord
from ..models.member import Member
from ..models.user import User
from ..models.leave_request import LeaveRequest
from ..models.workspace_access import UserWorkspaceAccess
from ..models.working_lunch import WorkspaceWorkingLunchMember
from ..models.system_category import Workspace
from ..utils.auth import get_current_user
from ..utils.access import (
    ROLE_SUPER_ADMIN, ROLE_LEADER, ROLE_MEMBER, ROLE_VIEWER,
    ALL_SCOPE, user_allowed_scopes, member_query_for_user,
    workspaces_for_member, resolve_workspace,
)

router = APIRouter()

LUNCH_PRICE = 40000  # VND per lunch

# Real manager roles in this project (utils/access): super_admin + leader.
MANAGER_ROLES = {ROLE_SUPER_ADMIN, ROLE_LEADER}
MEMBER_SCOPED_ROLES = {ROLE_MEMBER, ROLE_VIEWER}

VALID_STATUSES = ['off', 'lunch', 'no_lunch', 'onsite', 'bonus']


class LunchUpsert(BaseModel):
    member_id: int
    date: str  # YYYY-MM-DD
    has_lunch: bool
    status: Optional[str] = None


class WorkingLunchToggle(BaseModel):
    enabled: bool


def _month_range(year, month):
    start = date_type(year, month, 1)
    end = date_type(year + 1, 1, 1) if month == 12 else date_type(year, month + 1, 1)
    return start, end


def _is_manager(user) -> bool:
    return (getattr(user, "role", ROLE_MEMBER) or "").strip().lower() in MANAGER_ROLES


def _is_super_admin(user) -> bool:
    return (getattr(user, "role", ROLE_MEMBER) or "").strip().lower() == ROLE_SUPER_ADMIN


def _is_member_scoped(user) -> bool:
    return (getattr(user, "role", ROLE_MEMBER) or "").strip().lower() in MEMBER_SCOPED_ROLES


def _scoped_member_ids(db: Session, user):
    return member_query_for_user(db, user).with_entities(Member.id).subquery()


def _enabled_member_ids(db: Session, work_date=None):
    filters = [WorkspaceWorkingLunchMember.enabled.is_(True)]
    if work_date:
        filters.append(WorkspaceWorkingLunchMember.work_date == work_date)
    return (
        db.query(WorkspaceWorkingLunchMember.member_id)
        .filter(*filters)
        .subquery()
    )


def _is_member_enabled(db: Session, member_id, work_date) -> bool:
    workspaces = workspaces_for_member(db, member_id)
    if not workspaces:
        return False
    ws_ids = [w.id for w in workspaces]
    return (
        db.query(WorkspaceWorkingLunchMember.id)
        .filter(
            WorkspaceWorkingLunchMember.member_id == member_id,
            WorkspaceWorkingLunchMember.workspace_id.in_(ws_ids),
            WorkspaceWorkingLunchMember.work_date == work_date,
            WorkspaceWorkingLunchMember.enabled.is_(True),
        )
        .first()
    ) is not None


def _assert_member_in_scope(db: Session, user, member_id: int):
    if not _is_manager(user):
        if member_id != getattr(user, "member_id", None):
            raise HTTPException(403, "You may only manage your own member")
        return
    scopes = user_allowed_scopes(db, user)
    if scopes == ALL_SCOPE:
        return
    if (
        db.query(Member.id)
        .filter(Member.id == member_id, Member.id.in_(_scoped_member_ids(db, user)))
        .count()
    ) == 0:
        raise HTTPException(403, "Member is outside your Workspace scope")


def _allowed_manager_scopes(db: Session, user) -> Optional[Set[str]]:
    scopes = user_allowed_scopes(db, user)
    if scopes == ALL_SCOPE:
        return None
    return {str(s).strip().lower() for s in scopes if str(s).strip()}


def _resolve_requested_workspace(db: Session, user, workspace_code) -> Optional[Workspace]:
    """Resolve a client-supplied Workspace code against the caller's scopes.

    The Workspace a caller may act in is DERIVED FROM THE DATABASE (their
    `user_workspace_access` grants + primary `data_scope`), never chosen by the
    client. A `workspace_code` coming from the query string/body therefore only
    acts as a *narrowing* selector for the Workspace(s) the caller already owns:

    - no code supplied -> None (meaning "all of the caller's Workspaces")
    - unknown code     -> 400
    - Workspace the caller has no DB grant for -> 403
    """
    if workspace_code is None or not str(workspace_code).strip():
        return None
    target = resolve_workspace(db, workspace_code)
    if not target:
        raise HTTPException(400, f"Invalid workspace: {workspace_code}")
    allowed = user_allowed_scopes(db, user)
    if allowed == ALL_SCOPE:
        return target
    if target.code and target.code.strip().lower() in allowed:
        return target
    raise HTTPException(403, "No access to that Workspace")


def _member_workspace_map(db: Session, member_ids) -> Dict[int, List[Workspace]]:
    """Map Member.id -> Workspace rows derived from the DB relationship."""
    if not member_ids:
        return {}
    users = db.query(User).filter(User.member_id.in_(member_ids)).all()
    user_by_member = {u.member_id: u for u in users}
    ws_by_user = {}
    if users:
        grants = (
            db.query(UserWorkspaceAccess.user_id, Workspace)
            .join(Workspace, Workspace.id == UserWorkspaceAccess.workspace_id)
            .filter(UserWorkspaceAccess.user_id.in_([u.id for u in users]))
            .all()
        )
        for uid, ws in grants:
            ws_by_user.setdefault(uid, []).append(ws)
    member_rows = dict(
        db.query(Member.id, Member.team)
        .filter(Member.id.in_(member_ids))
        .all()
    )
    ws_lookup = {}
    for w in db.query(Workspace).all():
        if w.code:
            ws_lookup[w.code.strip().lower()] = w
        if w.name:
            ws_lookup[w.name.strip().lower()] = w
    result = {}
    for mid in member_ids:
        workspaces = []
        seen = set()
        user = user_by_member.get(mid)
        if user is not None:
            for ws in ws_by_user.get(user.id, []):
                if ws.id not in seen:
                    workspaces.append(ws)
                    seen.add(ws.id)
            ds = (getattr(user, "data_scope", None) or "").strip()
            if ds and ds.lower() != ALL_SCOPE:
                ws = resolve_workspace(db, ds)
                if ws and ws.id not in seen:
                    workspaces.append(ws)
                    seen.add(ws.id)
            if workspaces:
                result[mid] = workspaces
                continue
        team = member_rows.get(mid)
        if team:
            ws = ws_lookup.get(str(team).strip().lower())
            if ws:
                result[mid] = [ws]
    return result


def _manager_candidate_members(db: Session, user, target_ws: Optional[Workspace] = None):
    """Load Check Lunch candidates with one direct Workspace-scoped query.

    This intentionally avoids member_query_for_user(), whose project visibility
    joins are correct for dashboards but unnecessarily expensive for this
    attendance roster.
    """
    query = db.query(Member)
    if target_ws is not None:
        workspace_codes = {target_ws.code.strip().lower()} if target_ws.code else set()
        workspace_names = {target_ws.name.strip().lower()} if target_ws.name else set()
    else:
        allowed = user_allowed_scopes(db, user)
        if allowed == ALL_SCOPE:
            return query.order_by(Member.display_name.asc()).all()
        workspaces = db.query(Workspace).filter(
            func.lower(Workspace.code).in_(allowed)
        ).all()
        workspace_codes = {w.code.strip().lower() for w in workspaces if w.code}
        workspace_names = {w.name.strip().lower() for w in workspaces if w.name}

    if not workspace_codes and not workspace_names:
        return []

    access_exists = db.query(UserWorkspaceAccess.id).join(
        Workspace, Workspace.id == UserWorkspaceAccess.workspace_id
    ).filter(
        UserWorkspaceAccess.user_id == User.id,
        or_(func.lower(Workspace.code).in_(workspace_codes),
            func.lower(Workspace.name).in_(workspace_names)),
    ).exists()
    return query.outerjoin(User, User.member_id == Member.id).filter(
        or_(
            func.lower(User.data_scope).in_(workspace_codes),
            access_exists,
            func.lower(Member.team).in_(workspace_codes | workspace_names),
            func.lower(Member.department).in_(workspace_names),
        )
    ).order_by(Member.display_name.asc()).all()


def _collect_working_lunch_members(db, user, workspace_code=None, enabled_only=True, work_date=None):
    """Members the caller may see for Check Working/Lunch, scoped by Workspace.

    `workspace_code` is only ever a *requested* Workspace — it is validated
    against the caller's DB-derived Workspace scopes first, so a client cannot
    use it to read another Workspace's members.
    """
    target_ws = _resolve_requested_workspace(db, user, workspace_code)
    if _is_member_scoped(user):
        mid = getattr(user, "member_id", None)
        if not mid or not work_date:
            return []
        m = db.query(Member).filter(Member.id == mid).first()
        if not m:
            return []
        ws_list = workspaces_for_member(db, mid)
        if target_ws is not None and target_ws.id not in {w.id for w in ws_list}:
            return []
        ws = ws_list[0] if ws_list else None
        enabled = _is_member_enabled(db, mid, work_date)
        return [{
            "id": m.id,
            "user_id": getattr(user, "id", None),
            "full_name": m.full_name,
            "display_name": m.display_name,
            "team": m.team,
            "department": m.department,
            "position": m.position,
            "workspace_id": ws.id if ws else None,
            "workspace_code": ws.code if ws else None,
            "workspace_name": ws.name if ws else None,
            "enabled": enabled,
        }]
    if not _is_manager(user):
        return []
    members = _manager_candidate_members(db, user, target_ws)
    member_ids = [m.id for m in members]
    if not member_ids:
        return []
    ws_map = _member_workspace_map(db, member_ids)
    user_by_member = {
        mid: uid
        for uid, mid in db.query(User.id, User.member_id)
        .filter(User.member_id.in_(member_ids))
        .all()
        if mid
    }
    enabled_rows = (
        db.query(WorkspaceWorkingLunchMember.member_id, WorkspaceWorkingLunchMember.workspace_id)
        .filter(
            WorkspaceWorkingLunchMember.member_id.in_(member_ids),
            WorkspaceWorkingLunchMember.work_date == work_date,
            WorkspaceWorkingLunchMember.enabled.is_(True),
        )
        .all()
    )
    enabled_set = {(rid, wid) for rid, wid in enabled_rows}
    out = []
    for m in members:
        ws_list = ws_map.get(m.id, [])
        if not ws_list:
            continue
        if target_ws is not None and target_ws.id not in {w.id for w in ws_list}:
            continue
        enabled = any((m.id, w.id) in enabled_set for w in ws_list)
        if enabled_only and not enabled:
            continue
        primary = ws_list[0]
        out.append({
            "id": m.id,
            "user_id": user_by_member.get(m.id),
            "full_name": m.full_name,
            "display_name": m.display_name,
            "team": m.team,
            "department": m.department,
            "position": m.position,
            "workspace_id": primary.id,
            "workspace_code": primary.code,
            "workspace_name": primary.name,
            "enabled": enabled,
        })
    return out


@router.get("")
def list_lunch_records(
    date: Optional[str] = None,
    member_id: Optional[int] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get Working/Lunch records scoped by role + Workspace(s)."""
    q = db.query(LunchRecord)
    parsed_date = date_type.fromisoformat(date) if date else None
    if _is_manager(current_user):
        q = q.filter(
            LunchRecord.member_id.in_(_scoped_member_ids(db, current_user)),
            LunchRecord.member_id.in_(_enabled_member_ids(db, parsed_date)) if parsed_date else True,
        )
    else:
        q = q.filter(LunchRecord.member_id == current_user.member_id)
    if date:
        q = q.filter(LunchRecord.date == date)
    if year and month:
        start_date, end_date = _month_range(year, month)
        q = q.filter(LunchRecord.date >= start_date, LunchRecord.date < end_date)
    elif year:
        q = q.filter(extract('year', LunchRecord.date) == year)
    elif month:
        q = q.filter(extract('month', LunchRecord.date) == month)
    if member_id:
        q = q.filter(LunchRecord.member_id == member_id)
    records = q.all()
    return [
        {
            "id": r.id,
            "member_id": r.member_id,
            "date": str(r.date),
            "has_lunch": r.has_lunch,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in records
    ]


@router.get("/members")
def list_working_lunch_members(
    enabled_only: Optional[bool] = True,
    workspace: Optional[str] = Query(
        None,
        description=(
            "Optional Workspace code to scope the list to. It is validated "
            "against the caller's own Workspace scopes derived from the DB, so "
            "requesting another Workspace is rejected (403)."
        ),
    ),
    work_date: str = Query(..., alias="date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Members the caller may act on for Check Working/Lunch, Workspace-scoped."""
    return _collect_working_lunch_members(
        db, current_user, workspace_code=workspace, enabled_only=enabled_only,
        work_date=date_type.fromisoformat(work_date),
    )


@router.get("/working-members")
def list_working_members_config(
    workspace: Optional[str] = Query(None, description="Workspace code to scope the config to"),
    work_date: str = Query(..., alias="date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """SUPER ADMIN / Leader config list of Members with their enabled flag."""
    if not _is_manager(current_user):
        raise HTTPException(403, "Requires manager role")
    return _collect_working_lunch_members(
        db, current_user, workspace_code=workspace, enabled_only=False,
        work_date=date_type.fromisoformat(work_date),
    )


@router.get("/monthly-summary")
def monthly_summary(
    year: int,
    month: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Monthly Working/Lunch summary, workspace-scoped. Manager only."""
    if not _is_manager(current_user):
        raise HTTPException(403, "Requires manager role")
    scoped = _scoped_member_ids(db, current_user)
    enabled = _enabled_member_ids(db)
    start_date, end_date = _month_range(year, month)
    records = (
        db.query(LunchRecord)
        .filter(
            LunchRecord.date >= start_date,
            LunchRecord.date < end_date,
            LunchRecord.member_id.in_(scoped),
            LunchRecord.member_id.in_(enabled),
        )
        .all()
    )
    leave_requests = (
        db.query(LeaveRequest, User)
        .join(User, User.id == LeaveRequest.user_id)
        .filter(
            LeaveRequest.status == 'Approved',
            LeaveRequest.user_id.in_(
                db.query(User.id).filter(User.member_id.in_(scoped), User.member_id.in_(enabled))
            ),
            LeaveRequest.start_date <= end_date.isoformat(),
            LeaveRequest.end_date >= start_date.isoformat(),
        )
        .all()
    )
    members = (
        db.query(Member)
        .filter(Member.id.in_(scoped), Member.id.in_(enabled))
        .order_by(Member.display_name)
        .all()
    )
    off_dates = set()
    from datetime import date, timedelta
    for lr, user in leave_requests:
        if not user or not user.member_id:
            continue
        start = lr.start_date if isinstance(lr.start_date, date) else date.fromisoformat(str(lr.start_date))
        end = lr.end_date if isinstance(lr.end_date, date) else date.fromisoformat(str(lr.end_date))
        current = max(start, start_date)
        last = min(end, end_date - timedelta(days=1))
        while current <= last:
            off_dates.add((user.member_id, current))
            current += timedelta(days=1)
    records_by_member = {}
    for r in records:
        records_by_member.setdefault(r.member_id, []).append(r)
    member_summaries = []
    for m in members:
        member_records = records_by_member.get(m.id, [])
        lunch_count = bonus_count = no_lunch_count = off_count = 0
        for r in member_records:
            r_date = r.date if isinstance(r.date, date_type) else date_type.fromisoformat(str(r.date))
            is_off = (m.id, r_date) in off_dates
            if is_off:
                off_count += 1
            elif r.status == 'lunch':
                lunch_count += 1
            elif r.status == 'bonus':
                bonus_count += 1
            elif r.status == 'no_lunch':
                no_lunch_count += 1
            elif r.status == 'onsite':
                pass
            elif r.status == 'off':
                off_count += 1
            elif r.has_lunch and not r.status:
                lunch_count += 1
            elif not r.has_lunch and not r.status:
                no_lunch_count += 1
        total_days = len(member_records)
        payable_days = no_lunch_count + bonus_count
        member_summaries.append({
            "member_id": m.id,
            "display_name": m.display_name,
            "full_name": m.full_name,
            "team": m.team,
            "lunch_count": lunch_count,
            "bonus_count": bonus_count,
            "no_lunch_count": no_lunch_count,
            "off_count": off_count,
            "total_registered_days": total_days,
            "total_cost": payable_days * LUNCH_PRICE,
        })
    total_lunch = sum(m["lunch_count"] for m in member_summaries)
    total_bonus = sum(m["bonus_count"] for m in member_summaries)
    total_no_lunch = sum(m["no_lunch_count"] for m in member_summaries)
    total_off = sum(m["off_count"] for m in member_summaries)
    total_cost = sum(m["total_cost"] for m in member_summaries)
    _, num_days = calendar.monthrange(year, month)
    working_days = sum(1 for d in range(1, num_days + 1) if calendar.weekday(year, month, d) < 5)
    return {
        "year": year, "month": month, "working_days": working_days,
        "total_lunch": total_lunch, "total_bonus": total_bonus,
        "total_no_lunch": total_no_lunch, "total_off": total_off,
        "total_cost": total_cost, "lunch_price": LUNCH_PRICE,
        "members": member_summaries,
    }


@router.put("/working-members/{member_id}")
def toggle_working_member(
    member_id: int,
    body: WorkingLunchToggle,
    work_date: str = Query(..., alias="date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Enable/disable a Member for Check Working/Lunch."""
    if not _is_manager(current_user):
        raise HTTPException(403, "Requires manager role")
    member = db.query(Member).filter(Member.id == member_id).first()
    if not member:
        raise HTTPException(404, "Member not found")
    _assert_member_in_scope(db, current_user, member_id)
    member_workspaces = workspaces_for_member(db, member_id)
    if not member_workspaces:
        raise HTTPException(400, "Cannot resolve Member Workspace (no linked account)")
    scopes = _allowed_manager_scopes(db, current_user)
    parsed_date = date_type.fromisoformat(work_date)
    changed = []
    for ws in member_workspaces:
        if scopes is not None and ws.code.strip().lower() not in scopes:
            continue
        row = (
            db.query(WorkspaceWorkingLunchMember)
            .filter(
                WorkspaceWorkingLunchMember.workspace_id == ws.id,
                WorkspaceWorkingLunchMember.member_id == member_id,
                WorkspaceWorkingLunchMember.work_date == parsed_date,
            )
            .first()
        )
        if row:
            row.enabled = bool(body.enabled)
        else:
            row = WorkspaceWorkingLunchMember(
                workspace_id=ws.id, member_id=member_id, work_date=parsed_date,
                enabled=bool(body.enabled),
            )
            db.add(row)
        db.commit()
        changed.append({
            "workspace_id": ws.id, "workspace_code": ws.code, "enabled": bool(body.enabled),
        })
    if not changed:
        raise HTTPException(403, "Member is not in a Workspace you manage")
    return {"member_id": member_id, "enabled": bool(body.enabled), "workspaces": changed}


@router.post("")
def upsert_lunch_record(
    body: LunchUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create/update a Working/Lunch record. Identity derived from current_user."""
    parsed_date = body.date
    if isinstance(parsed_date, str):
        from datetime import date
        parts = parsed_date.split("-")
        parsed_date = date(int(parts[0]), int(parts[1]), int(parts[2]))

    if _is_manager(current_user):
        _assert_member_in_scope(db, current_user, body.member_id)
        if not _is_super_admin(current_user) and not _is_member_enabled(db, body.member_id, parsed_date):
            raise HTTPException(403, "Member is not selected for Check Working/Lunch on this date")
    else:
        if body.member_id != getattr(current_user, "member_id", None):
            raise HTTPException(403, "You may only register for yourself")
        if not current_user.member_id:
            raise HTTPException(403, "Account is not linked to a member")

    weekday = parsed_date.weekday()
    if weekday in (5, 6):
        raise HTTPException(400, "Weekend - cannot update Check Lunch")

    status = body.status or ('lunch' if body.has_lunch else 'no_lunch')
    if status not in VALID_STATUSES:
        raise HTTPException(400, f"Status must be one of: {', '.join(VALID_STATUSES)}")

    existing = db.query(LunchRecord).filter(
        and_(LunchRecord.member_id == body.member_id, LunchRecord.date == parsed_date)
    ).first()
    if existing:
        existing.has_lunch = body.has_lunch
        existing.status = status
        db.commit()
        db.refresh(existing)
        record = existing
    else:
        record = LunchRecord(member_id=body.member_id, date=parsed_date, has_lunch=body.has_lunch, status=status)
        db.add(record)
        db.commit()
        db.refresh(record)
    return {
        "id": record.id, "member_id": record.member_id, "date": str(record.date),
        "has_lunch": record.has_lunch, "status": record.status,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "updated_at": record.updated_at.isoformat() if record.updated_at else None,
    }


@router.delete("/{record_id}")
def delete_lunch_record(
    record_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    record = db.query(LunchRecord).filter(LunchRecord.id == record_id).first()
    if not record:
        raise HTTPException(404, "Record not found")
    if _is_manager(current_user):
        _assert_member_in_scope(db, current_user, record.member_id)
    else:
        if record.member_id != getattr(current_user, "member_id", None):
            raise HTTPException(403, "No permission to delete")
        if not current_user.member_id or not _is_member_enabled(db, current_user.member_id, record.date):
            raise HTTPException(403, "You are not enabled for Check Working/Lunch")
    db.delete(record)
    db.commit()
    return {"message": "Deleted"}
