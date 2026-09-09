import re
from fastapi import Depends, HTTPException, Request
from sqlalchemy import or_, func as sql_func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.meeting import Meeting, MeetingMember
from ..models.meeting_project import MeetingProject
from ..models.member import Member
from ..models.phase import Phase
from ..models.project import Project, project_members
from ..models.system_category import Customer, Workspace
from ..models.workspace_access import UserWorkspaceAccess
from ..models.task import Task
from ..models.task_group import TaskGroup
from ..models.user import User
from ..models.audit_log import AuditLog
from .auth import get_current_user

ALL_SCOPE = "all"

# ── Role constants ──────────────────────────────────────────
ROLE_SUPER_ADMIN = "super_admin"
ROLE_LEADER = "leader"
ROLE_MEMBER = "member"
ROLE_VIEWER = "viewer"
VALID_ROLES = {ROLE_SUPER_ADMIN, ROLE_LEADER, ROLE_MEMBER, ROLE_VIEWER}
WRITE_ROLES = {ROLE_SUPER_ADMIN, ROLE_LEADER}
# Roles whose effective data scope is their assigned Workspace
# (same Workspace-based data-scope mechanism shared by Leader, Member and Viewer).
WORKSPACE_SCOPED_ROLES = {ROLE_LEADER, ROLE_MEMBER, ROLE_VIEWER}

# project_members_v2.role values that grant Leader-equivalent write access,
# scoped to that one project, to an otherwise-restricted `member`/`viewer`.
PROJECT_FULL_ACCESS_ROLES = {"PM", "Leader"}
# Global roles eligible for the project-role escalation in has_full_project_access.
PROJECT_ROLE_ESCALATABLE = {ROLE_MEMBER, ROLE_VIEWER}


# ── Workspace Master (Single Source of Truth) ───────────────
def get_workspaces(db: Session):
    """Every Workspace must come from the Workspace Master table."""
    return db.query(Workspace).order_by(Workspace.id.asc()).all()


def preload_workspace_maps(db: Session):
    """Workspace table is tiny and near-static (2-3 rows) — load it once for
    an entire project list instead of resolve_workspace() re-querying it per
    project inside business_label_for_project/business_unit_for_project."""
    all_ws = db.query(Workspace).all()
    by_code = {w.code.lower(): w for w in all_ws if w.code}
    by_name = {w.name.lower(): w for w in all_ws if w.name}
    return by_code, by_name


def resolve_workspace(db: Session, value, by_code=None, by_name=None):
    """Resolve a Workspace by its code or case-insensitive display name.
    Pass by_code/by_name (from preload_workspace_maps) to avoid a query."""
    v = str(value or "").strip().lower()
    if not v:
        return None
    if by_code is not None:
        return by_code.get(v) or by_name.get(v)
    ws = db.query(Workspace).filter(sql_func.lower(Workspace.code) == v).first()
    if not ws:
        ws = db.query(Workspace).filter(sql_func.lower(Workspace.name) == v).first()
    return ws


def is_valid_scope(db: Session, scope) -> bool:
    s = str(scope or "").strip().lower()
    if s == ALL_SCOPE:
        return True
    return resolve_workspace(db, s) is not None


def valid_data_scopes(db: Session):
    return {ALL_SCOPE} | {w.code for w in get_workspaces(db)}


def leader_allowed_scopes(db: Session):
    return {w.code for w in get_workspaces(db)}


def default_workspace(db: Session):
    workspaces = get_workspaces(db)
    return workspaces[0] if workspaces else None


def default_scope(db: Session) -> str:
    ws = default_workspace(db)
    return ws.code if ws else "infrastructure"


def scope_display_name(db: Session, scope) -> str:
    """Map a scope code to its Workspace display name ('all' → 'All')."""
    s = str(scope or "").strip().lower()
    if s == ALL_SCOPE:
        return "All"
    ws = resolve_workspace(db, s)
    return ws.name if ws else s


def business_label_for_project(db: Session, project, by_code=None, by_name=None) -> str:
    """Display name for a project: explicit business value or resolved from customer BU."""
    if project.business:
        return project.business
    bu_code = project.customer.business_unit if project.customer else None
    ws = resolve_workspace(db, bu_code or getattr(project, "data_scope", None), by_code, by_name)
    return ws.name if ws else "All"


def business_unit_for_project(db: Session, project, by_code=None, by_name=None) -> str:
    """Workspace code for a project, resolved from the customer BU / data scope."""
    if project.customer and project.customer.business_unit:
        return project.customer.business_unit
    ws = resolve_workspace(db, getattr(project, "data_scope", None), by_code, by_name)
    return ws.code if ws else default_scope(db)


def workspace_id_for_project(db: Session, project):
    """Workspace row id a project belongs to, or None if missing/unresolvable/
    global ('All'). Resolved from Project.business/data_scope directly — NOT
    via business_unit_for_project/Customer.business_unit, which is legacy and
    can silently point to the wrong Workspace (see customer_query_for_user).
    Used to pick a per-workspace Google account override for meeting
    creation/sync (see services/meeting_sync.py)."""
    if not project:
        return None
    if project.business and project.business != "All":
        ws = resolve_workspace(db, project.business)
        if ws:
            return ws.id
    ws = resolve_workspace(db, getattr(project, "data_scope", None))
    return ws.id if ws else None


def user_scope(user) -> str:
    return (getattr(user, "data_scope", None) or default_scope_guard()).strip().lower()


def default_scope_guard() -> str:
    """Legacy fallback only used before the Workspace Master is seeded."""
    return "infrastructure"


def user_allowed_scopes(db: Session, user):
    """Return the set of Workspace scope-codes (lowercase) *user* may access,
    or ALL_SCOPE if they bypass Workspace restriction entirely.

    Backed by `user_workspace_access` — a user may hold more than one
    Workspace (e.g. a Leader overseeing several). Falls back to the single
    `data_scope` column when no rows exist yet (defensive: should not happen
    once the startup backfill has run, but keeps brand-new/test rows safe).
    """
    role = getattr(user, "role", ROLE_MEMBER)
    base_scope = user_scope(user)
    if role == ROLE_SUPER_ADMIN or base_scope == ALL_SCOPE:
        return ALL_SCOPE

    user_id = getattr(user, "id", None)
    rows = (
        db.query(Workspace.code)
        .join(UserWorkspaceAccess, UserWorkspaceAccess.workspace_id == Workspace.id)
        .filter(UserWorkspaceAccess.user_id == user_id)
        .all()
    )
    codes = {c.strip().lower() for (c,) in rows if c}
    return codes or {base_scope}


def primary_workspace_code_for_user(db: Session, user) -> str:
    """The user's actual Chính (primary) Workspace code, resolved from the
    canonical `user_workspace_access.is_primary` row — the same source the
    Chính/Phụ badges (GET /api/members/workspace-roles) already trust.

    `User.data_scope` is supposed to always mirror this row, but nothing
    enforces that at the DB level, so callers that need "the caller's real
    Chính Workspace" (e.g. filtering the Dashboard Leader roster by
    Workspace) should use this instead of reading `data_scope` directly.
    Falls back to `user_scope(user)` when no `is_primary` row exists yet.
    """
    user_id = getattr(user, "id", None)
    row = (
        db.query(Workspace.code)
        .join(UserWorkspaceAccess, UserWorkspaceAccess.workspace_id == Workspace.id)
        .filter(UserWorkspaceAccess.user_id == user_id, UserWorkspaceAccess.is_primary == True)  # noqa: E712
        .first()
    )
    if row and row[0]:
        return row[0].strip().lower()
    return user_scope(user)


def project_belongs_to_workspace(db: Session, scopes):
    """Return OR-conditions for projects belonging to any of the given
    Workspace scope(s). Accepts a single scope string or an iterable of scope
    codes — a caller (e.g. a Leader) may be granted more than one Workspace.

    Shared data-scope rule used by Leader, Member and Viewer: a project belongs
    to one of the caller's Workspaces when its scope/business matches it, or
    when it is global ('all' / 'All').
    """
    scope_set = {scopes} if isinstance(scopes, str) else set(scopes)
    filters = [
        Project.data_scope.in_(scope_set),
        Project.data_scope == ALL_SCOPE,
        Project.business == "All",
    ]
    for scope in scope_set:
        ws = resolve_workspace(db, scope)
        if ws:
            filters.append(Project.business == ws.name)
    return filters


def project_query_for_user(db: Session, user):
    """Return a Project query filtered by the caller's role and Workspace(s).

    - super_admin (scope=all): every project.
    - leader: full access to every project in their Chính (home, `data_scope`)
      Workspace; in any Phụ (secondary) Workspace they only see projects
      they're explicitly assigned to via project_members — same restriction
      as Member. Holding a Phụ Workspace grants awareness of that team's
      Dashboard stats, not blanket access to every one of that Workspace's
      projects.
    - member / viewer: every project the user's linked member_id is
      explicitly assigned to via project_members, regardless of Workspace —
      membership alone is sufficient, same membership-overrides-Workspace
      rule as Leader's Phụ Workspace case above.
    """
    query = db.query(Project)
    scopes = user_allowed_scopes(db, user)
    role = getattr(user, "role", ROLE_MEMBER)

    if role == ROLE_SUPER_ADMIN or scopes == ALL_SCOPE:
        return query

    if role == ROLE_LEADER:
        member_id = getattr(user, "member_id", None)
        primary_code = (getattr(user, "data_scope", None) or "").strip().lower()
        filters = []
        if primary_code and primary_code != ALL_SCOPE:
            filters.extend(project_belongs_to_workspace(db, {primary_code}))
        if member_id:
            assigned_project_ids = (
                db.query(project_members.c.project_id)
                .filter(project_members.c.member_id == member_id)
                .subquery()
            )
            filters.append(Project.id.in_(assigned_project_ids))
        if not filters:
            return query.filter(Project.id == -1)
        return query.filter(or_(*filters))

    # member / viewer — every project they're explicitly assigned to,
    # regardless of Workspace (mirrors the Leader membership-override rule).
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


def project_query_for_user_broad(db: Session, user):
    """Same as project_query_for_user(), but for Leader every granted
    Workspace (Chính AND Phụ) gets blanket access — not just their Chính one.

    Use this ONLY for aggregate/awareness views (Dashboard team-wide KPI
    totals) where a Leader needs the FULL picture of their team's workload
    across every Workspace they're associated with, even projects they
    personally aren't a member of. Never use it to gate opening a specific
    project's page/detail — that must stay on the strict
    project_query_for_user()/can_access_project() (Phụ = assignment-only),
    so a Leader can see THAT a teammate has work on a project without being
    able to click into that project's internals themselves.
    """
    role = getattr(user, "role", ROLE_MEMBER)
    if role != ROLE_LEADER:
        return project_query_for_user(db, user)

    scopes = user_allowed_scopes(db, user)
    if scopes == ALL_SCOPE:
        return db.query(Project)

    member_id = getattr(user, "member_id", None)
    filters = list(project_belongs_to_workspace(db, scopes))
    if member_id:
        assigned_project_ids = (
            db.query(project_members.c.project_id)
            .filter(project_members.c.member_id == member_id)
            .subquery()
        )
        filters.append(Project.id.in_(assigned_project_ids))
    return db.query(Project).filter(or_(*filters))


def audit_log_query_for_user(db: Session, user, base_query=None):
    """Apply Workspace-scope filtering to an AuditLog query based on the
    caller's role + assigned Workspaces.

    Behaviour:
    - super_admin / scope='all': returns the query unchanged (sees every log).
    - leader with one or more assigned Workspaces: returns the query filtered
      to logs that are *about* one of those Workspaces. Specifically a log
      is kept when EITHER:
        (a) `audit_logs.business_unit` matches one of the caller's Workspaces
            (case-insensitive on code or name), OR
        (b) `audit_logs.project_id` points at a project within one of the
            caller's Workspaces (uses `project_query_for_user_broad()` so a
            Leader sees logs for every project in any granted Workspace,
            Chính or Phụ).
      Global / cross-Workspace events (business_unit = 'all' or NULL that
      aren't tied to a project in scope) are intentionally hidden from
      Leader — those are operational/security events that stay super-admin
      territory. This matches the "only data related to their Workspaces"
      rule from the System Audit Leader-access spec.
    - any other role: returns a query that resolves to the empty set
      (`audit_logs.id == -1`) as a defensive guard — `require_audit_user`
      already blocks these callers at the route-dep level, so this branch is
      only hit if some other router reuses this helper without that gate.
    """
    if base_query is None:
        base_query = db.query(AuditLog)

    role = getattr(user, "role", ROLE_MEMBER)
    scopes = user_allowed_scopes(db, user)

    if role == ROLE_SUPER_ADMIN or scopes == ALL_SCOPE:
        return base_query

    if role != ROLE_LEADER:
        return base_query.filter(AuditLog.id == -1)

    # Build the "business_unit matches one of my workspaces" OR-clause.
    bu_filters = []
    for scope in scopes:
        ws = resolve_workspace(db, scope)
        if ws:
            bu_filters.append(AuditLog.business_unit.ilike(ws.code))
            bu_filters.append(AuditLog.business_unit.ilike(ws.name))

    # Build the "project_id is in one of my workspaces" clause via the
    # shared project-scoping helper — same rule used everywhere else for
    # Leader multi-Workspace access so we never diverge.
    scoped_project_ids = (
        project_query_for_user_broad(db, user)
        .with_entities(Project.id)
        .subquery()
    )
    project_clause = AuditLog.project_id.in_(scoped_project_ids)

    clauses = bu_filters + [project_clause]
    if not clauses:
        return base_query.filter(AuditLog.id == -1)
    return base_query.filter(or_(*clauses))


def member_query_for_user(db: Session, user):
    """Return a Member query filtered by the caller's role and Workspace(s).

    - super_admin / scope=all: every member (unchanged).
    - leader / member / viewer: members belonging to one of the caller's
      Workspace(s) — i.e. members whose linked account data_scope matches one
      of them, OR whose linked account has a `user_workspace_access` row in
      one of them, OR members assigned to a project within the caller's
      scope(s). Reading the junction table is required so multi-Workspace
      Member accounts (granted via Requirement 2 of the permission extension)
      are seen across all their assigned Workspaces.
    """
    query = db.query(Member)
    scopes = user_allowed_scopes(db, user)
    role = getattr(user, "role", ROLE_MEMBER)

    if role == ROLE_SUPER_ADMIN or scopes == ALL_SCOPE:
        return query
    if role not in WORKSPACE_SCOPED_ROLES:
        return query

    # Match Members whose linked User has *any* Workspace grant in the
    # caller's scope, via either:
    #   (a) the legacy `User.data_scope` column (the historical source of
    #       truth, kept in sync with `user_workspace_access[0]` by
    #       `_apply_user_workspace_access`), OR
    #   (b) an explicit `user_workspace_access` row pointing at a Workspace
    #       whose code is in the caller's scopes.
    #
    # Previously this was expressed as a UNION of two subqueries; that
    # implementation called `Subquery.union(...)` which is not a method on
    # SQLAlchemy's `Subquery` object (it is on `Query`). The resulting
    # `AttributeError: 'Subquery' object has no attribute 'union'` broke
    # every non-super-admin caller of this helper, including Dashboard
    # Leader cards (`workspace_leader_names`) and the Create Account
    # Member-link dropdown (`accounts.available_members`).
    #
    # The fix is the logically equivalent `or_(...data_scope...,
    # ...data_scope == 'all', exists(junction_query))`, which avoids the
    # broken method entirely and matches the same set of Members in a
    # single SELECT — smaller SQL footprint and no behavioural change.
    junction_in_scope_exists = (
        db.query(UserWorkspaceAccess.user_id)
        .join(Workspace, Workspace.id == UserWorkspaceAccess.workspace_id)
        .filter(
            Workspace.code.in_(scopes),
            UserWorkspaceAccess.user_id == User.id,
        )
        .exists()
    )
    scoped_user_member_ids = (
        db.query(User.member_id)
        .filter(
            User.member_id.isnot(None),
            or_(
                User.data_scope.in_(scopes),
                User.data_scope == ALL_SCOPE,
                junction_in_scope_exists,
            ),
        )
        .subquery()
    )
    scoped_project_ids = (
        project_query_for_user(db, user).with_entities(Project.id).subquery()
    )
    scoped_project_member_ids = (
        db.query(project_members.c.member_id)
        .filter(project_members.c.project_id.in_(scoped_project_ids))
        .subquery()
    )
    conditions = [
        Member.id.in_(scoped_user_member_ids),
        Member.id.in_(scoped_project_member_ids),
    ]

    # Map workspace scope to department names
    scope_to_dept = {
        "infra": "Infrastructure",
        "dev": "Dev/DevOps",
        "soc": "Security",
        "marketing": "Marketing",
        "sales": "Sales"
    }
    target_depts = []
    for s in scopes:
        s_lower = str(s).strip().lower()
        dept = scope_to_dept.get(s_lower)
        if dept:
            target_depts.append(dept)
        else:
            ws = resolve_workspace(db, s_lower)
            if ws:
                target_depts.append(ws.name)
                target_depts.append(ws.code)

    if target_depts:
        conditions.append(sql_func.lower(Member.department).in_([d.lower() for d in target_depts]))

    return query.filter(or_(*conditions))


# ── Workspace → department mapping for Member/Leader attribution ─────────
# Mirrors the department-matching rule used inside member_query_for_user() so
# the Dashboard Leader visibility stays consistent with the Member dataset.
SCOPE_TO_DEPARTMENT = {
    "infra": "Infrastructure",
    "dev": "Dev/DevOps",
    "soc": "Security",
    "marketing": "Marketing",
    "sales": "Sales",
}


def workspace_leader_names(db: Session, user):
    """Canonical Leader names the caller may see on the Dashboard.

    Uses the authoritative portal account model (User.role='leader' + is_active)
    rather than arbitrary Member.leader_name strings. A Leader identity is
    attributed to a Workspace when the Leader's linked Member is within the
    caller's authorized member set (via member_query_for_user) or the caller
    has ALL_SCOPE.

    super_admin / scope=all keep the previous unrestricted behavior (all
    canonical leaders).
    """
    scopes = user_allowed_scopes(db, user)
    role = getattr(user, "role", ROLE_MEMBER)

    # Base canonical set: active portal leaders
    base_q = db.query(User).filter(User.role == ROLE_LEADER, User.is_active == True)  # noqa: E712
    all_leaders = base_q.all()
    # Helper to get display name for a leader user
    def _leader_display(u):
        m = getattr(u, "member", None)
        if m and getattr(m, "display_name", None):
            n = m.display_name
        elif m and getattr(m, "full_name", None):
            n = m.full_name
        else:
            n = u.full_name or (u.email.split("@")[0] if u.email else "")
        n = (n or "").strip()
        # keep consistent formatting
        if n:
            # local import to avoid cycle
            import re as _re
            clean = _re.sub(r"\s*\([^)]*\)\s*$", "", str(n)).strip()
            words = [w for w in clean.split() if w]
            if len(words) > 2:
                abbr = ".".join([w[0].upper() for w in words[:-2]])
                last_two = " ".join(words[-2:])
                n = f"{abbr} {last_two}"[:50]
            else:
                n = " ".join(words)[:50]
        return n

    if role == ROLE_SUPER_ADMIN or scopes == ALL_SCOPE:
        names = { _leader_display(u) for u in all_leaders if _leader_display(u) }
        return sorted(names)

    if role not in WORKSPACE_SCOPED_ROLES:
        return []

    # Scoped: only leaders whose member is within the caller's authorized set
    allowed_ids = {m.id for m in member_query_for_user(db, user).all()}
    names = set()
    for u in all_leaders:
        mid = getattr(u, "member_id", None)
        if mid is not None and mid in allowed_ids:
            disp = _leader_display(u)
            if disp:
                names.add(disp)
        elif mid is None:
            # Leader without member link - treat as not attributable to a specific workspace;
            # only include if caller has no workspace restriction (already handled above).
            continue
    return sorted(names)


def can_access_project(db: Session, user, project: Project) -> bool:
    """Check whether *user* is allowed to view *project*."""
    role = getattr(user, "role", ROLE_MEMBER)
    scopes = user_allowed_scopes(db, user)

    if role == ROLE_SUPER_ADMIN or scopes == ALL_SCOPE:
        return True

    if role == ROLE_LEADER:
        # Full access only within their Chính (home) Workspace — a Phụ
        # (secondary) Workspace only grants access to projects they're
        # explicitly assigned to, matching project_query_for_user() above.
        primary_code = (getattr(user, "data_scope", None) or "").strip().lower()
        return (
            (project.data_scope == primary_code)
            or (project.data_scope == ALL_SCOPE)
            or (project.business == "All")
            or _is_member_of_project(db, user, project.id)
        )

    # member / viewer — explicit project membership overrides Workspace,
    # same as Leader: an assigned member/viewer sees the project regardless
    # of which Workspace it belongs to.
    member_id = getattr(user, "member_id", None)
    if not member_id:
        return False
    return (
        (project.data_scope in scopes)
        or (project.data_scope == ALL_SCOPE)
        or (project.business == "All")
        or _is_member_of_project(db, user, project.id)
    )


def customer_query_for_user(db: Session, user):
    """Return a Customer query filtered by the caller's role and Workspace access.

    `Customer.business_unit` is legacy/unmaintained (confirmed by a production
    data audit — it does not reliably reflect a Customer's real Workspace), so
    a Customer's effective Workspace(s) are derived from its linked Projects:

    - super_admin / scope=all: every customer.
    - leader with Workspace access: customers with at least one Project whose
      business matches one of the allowed Workspaces (or the 'All' escape hatch).
    - member / viewer: no Customer access — Project access does not imply
      Customer access.
    """
    role = getattr(user, "role", ROLE_MEMBER)
    scopes = user_allowed_scopes(db, user)

    if role == ROLE_SUPER_ADMIN or scopes == ALL_SCOPE:
        return db.query(Customer)

    if role != ROLE_LEADER:
        return db.query(Customer).filter(Customer.id == -1)

    ws_names = {w.name for w in db.query(Workspace).filter(Workspace.code.in_(scopes)).all()}
    filters = [Project.business == "All"]
    if ws_names:
        filters.append(Project.business.in_(ws_names))
    customer_ids = (
        db.query(Project.customer_id)
        .filter(Project.customer_id.isnot(None), or_(*filters))
        .subquery()
    )
    return db.query(Customer).filter(Customer.id.in_(customer_ids))


def require_project(db: Session, user, project_id: int) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    # Return 404 for both missing and out-of-scope records to avoid leaking IDs.
    if not project or not can_access_project(db, user, project):
        raise HTTPException(404, "Project not found.")
    return project


def _is_task_write(request: Request) -> bool:
    """Check if the request is a Task write operation (Create/Update/Delete)."""
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return False
    path = request.url.path
    # Allow task CRUD (create, update, delete, copy tasks)
    if re.search(r"/task-groups/\d+/tasks(/.*)?", path) is not None:
        return True
    return False


MEETING_CREATE_HELPER_PATHS = {
    "/api/meetings",
    "/api/meetings/generate-link",
    "/api/meetings/generate-ai-content",
}


def _is_meeting_create(request: Request) -> bool:
    """Check if the request is meeting creation (POST /api/meetings, no id)
    or one of the two helper calls the create-meeting form fires before that
    (AI-suggested objective/agenda, on-demand Zoom/Google Meet link).

    None of these three have a project id in their URL — the project is
    chosen in the JSON body — so this router-level check can't apply the
    usual "member assigned to this project" gate the way task/document
    writes do. It lets the request through instead; create_meeting() then
    calls require_project() itself for whichever project(s) were actually
    chosen, which 404s if the member doesn't belong to them. The two helper
    endpoints don't touch project data at all (one calls an AI service, the
    other calls the shared Google/Zoom account), so there's nothing further
    to gate.
    """
    return request.method == "POST" and request.url.path.rstrip("/") in MEETING_CREATE_HELPER_PATHS


def _is_document_write(request: Request) -> bool:
    """Check if the request is a Resources/Documents write (upload, update, delete, star).

    Approve/reject are also matched here (they live under the same
    `/documents/{id}/...` path) — that's fine, since `is_project_leader()` is
    checked explicitly inside those two route handlers regardless of whether
    the generic member-write gate here lets the request through.
    """
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return False
    return re.search(r"/projects/\d+/documents(/.*)?", request.url.path) is not None


def _is_meeting_member_write(request: Request) -> bool:
    """Check if the request adds/removes a meeting participant:
    POST /api/meetings/{id}/members or DELETE /api/meetings/{id}/members/{member_id}.

    A plain member assigned to the meeting's project may manage who's
    attending — same "assigned member can write" precedent as Task/Document
    writes (project_id is already resolved from the meeting's own
    project_id by require_route_project_access before this runs).
    """
    if request.method not in {"POST", "DELETE"}:
        return False
    return re.search(r"/meetings/\d+/members(/\d+)?$", request.url.path) is not None


def has_full_project_access(db: Session, user, project_id) -> bool:
    """True if *user* has Leader-equivalent write access to *project_id*:
    a super_admin, a global Leader, or a `member`/`viewer` whose
    project_members_v2.role for this specific project is 'PM' or 'Leader'
    (PROJECT_FULL_ACCESS_ROLES).

    Scoped to the one project — it does not elevate the user's global role or
    grant access to any other project.

    Callers that also need a Workspace-scope check for the global-Leader case
    (e.g. can_access_project) should keep doing that separately — this helper
    only covers the project-role escalation path.
    """
    role = getattr(user, "role", None) or ROLE_MEMBER
    if role in WRITE_ROLES:
        return True
    if role not in PROJECT_ROLE_ESCALATABLE or project_id is None:
        return False
    member_id = getattr(user, "member_id", None)
    if not member_id:
        return False
    return db.execute(
        project_members.select().where(
            project_members.c.project_id == project_id,
            project_members.c.member_id == member_id,
            project_members.c.role.in_(PROJECT_FULL_ACCESS_ROLES),
        )
    ).first() is not None


def is_project_leader(db: Session, user, project_id: int) -> bool:
    """True if *user* may approve/reject Resources for *project_id*:
    a super_admin, or the project's own PM/Technical Leader
    (project_members_v2.role in {'PM', 'Leader'} for this project) — not to be
    confused with the global/workspace `User.role == 'leader'`.
    """
    if getattr(user, "role", None) == ROLE_SUPER_ADMIN:
        return True
    member_id = getattr(user, "member_id", None)
    if not member_id:
        return False
    return db.execute(
        project_members.select().where(
            project_members.c.project_id == project_id,
            project_members.c.member_id == member_id,
            project_members.c.role.in_(PROJECT_FULL_ACCESS_ROLES),
        )
    ).first() is not None


def can_apply_project_template(db: Session, user, project: Project) -> bool:
    """Apply Template access — narrower than has_full_project_access(): a
    global Leader must ALSO actually have access to this project's Workspace
    (checked via user_allowed_scopes(), which is multi-workspace aware —
    unlike can_access_project()'s Leader branch, which only compares against
    the user's single primary data_scope column and would wrongly deny a
    Leader whose access to this Workspace comes from a secondary one).
    has_full_project_access()'s WRITE_ROLES shortcut is deliberately NOT
    reused here — it treats "role == leader" as an instant pass with no
    Workspace check at all, which is exactly the gap this function exists to
    close for Apply Template specifically.

    Allowed: super_admin; a Leader whose Workspace access covers this
    project; a Member/Viewer/anyone whose project_members_v2 role for this
    exact project is 'PM' or 'Leader' (PROJECT_FULL_ACCESS_ROLES). Everyone
    else (plain Member, Viewer, unrelated user) — denied.
    """
    role = getattr(user, "role", None) or ROLE_MEMBER
    if role == ROLE_SUPER_ADMIN:
        return True

    if role == ROLE_LEADER:
        scopes = user_allowed_scopes(db, user)
        if scopes == ALL_SCOPE or project.data_scope in scopes or project.business == "All":
            return True

    member_id = getattr(user, "member_id", None)
    if member_id:
        row = db.execute(
            project_members.select().where(
                project_members.c.project_id == project.id,
                project_members.c.member_id == member_id,
                project_members.c.role.in_(PROJECT_FULL_ACCESS_ROLES),
            )
        ).first()
        if row is not None:
            return True

    return False


def require_project_template_access(db: Session, user, project: Project) -> None:
    if not can_apply_project_template(db, user, project):
        raise HTTPException(403, "Bạn không có quyền áp dụng template cho dự án này.")


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
    print(f"--- ACCESS CHECK ---")
    print(f"Path: {request.url.path}")
    if request.url.path.endswith("/google/callback") or "/health/google" in request.url.path or "/webhook/n8n-summary" in request.url.path:
        return None

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
    # A meeting can be linked to more than one project (Meeting.project_id is
    # the "primary", extras live in meeting_projects) — the generic
    # project_id-only check below can't express "accessible via ANY of them",
    # so meetings are authorized here instead and the generic check is
    # skipped for this request.
    skip_generic_project_check = False
    if project_id is None and request.url.path.startswith("/api/meetings/") and params.get("id") is not None:
        meeting = db.query(Meeting).filter(Meeting.id == int(params["id"])).first()
        if meeting:
            extra_ids = [
                pid for (pid,) in db.query(MeetingProject.project_id)
                .filter(MeetingProject.meeting_id == meeting.id).all()
            ]
            linked_project_ids = ([meeting.project_id] if meeting.project_id else []) + extra_ids
            if linked_project_ids and user_scope(user) != ALL_SCOPE:
                linked_projects = db.query(Project).filter(Project.id.in_(linked_project_ids)).all()
                has_project_access = any(can_access_project(db, user, p) for p in linked_projects)
                # Membership overrides Workspace here too: a Workspace-scoped
                # member added as a participant (or who created the meeting)
                # must still be able to open it even if its project(s) sit
                # outside their Workspace — mirrors list_meetings/insights.
                member_id = getattr(user, "member_id", None)
                is_participant = bool(member_id) and (
                    meeting.created_by == member_id
                    or db.query(MeetingMember.id).filter(
                        MeetingMember.meeting_id == meeting.id,
                        MeetingMember.member_id == member_id,
                    ).first() is not None
                )
                if not has_project_access and not is_participant:
                    raise HTTPException(404, "Meeting not found.")
            project_id = meeting.project_id
        else:
            project_id = None
        skip_generic_project_check = True

    print(f"Project ID: {project_id}")

    # Check data scope access if project_id is resolved.
    if project_id is not None and not skip_generic_project_check:
        require_project(db, user, int(project_id))

    role = getattr(user, "role", ROLE_MEMBER)
    print(f"Role: {role}")

    # ── Viewer: read-only, UNLESS their project-role for this project is
    #    PM/Leader — that grants full write access scoped to this project. ──
    if role == ROLE_VIEWER and request.method not in {"GET", "HEAD", "OPTIONS"}:
        if project_id is not None and has_full_project_access(db, user, int(project_id)):
            print("--- ACCESS GRANTED FOR VIEWER (project PM/Leader) ---")
            return user
        raise HTTPException(403, "Viewer không có quyền thực hiện thao tác này!")

    # ── Role-based write authorization. ──
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        is_task_write_result = _is_task_write(request)
        print(f"Is Task Write: {is_task_write_result}")
        if role in WRITE_ROLES:
            # super_admin and leader may write freely within their scope.
            return user

        # member: full write access if their project-role for this project is
        # PM/Leader (has_full_project_access); otherwise only Task CRUD or
        # Resources/Documents CRUD, if assigned to the current project.
        # (Approve/reject are additionally gated by is_project_leader() inside
        # the route handler itself.)
        if role == ROLE_MEMBER:
            if project_id is not None and has_full_project_access(db, user, int(project_id)):
                print("--- ACCESS GRANTED FOR MEMBER (project PM/Leader) ---")
                return user
            if (is_task_write_result or _is_document_write(request) or _is_meeting_member_write(request)) and project_id is not None:
                print("--- ACCESS GRANTED FOR MEMBER ---")
                return user
            if _is_meeting_create(request):
                print("--- ACCESS GRANTED FOR MEMBER (meeting create) ---")
                return user
            print("--- ACCESS DENIED FOR MEMBER ---")
            raise HTTPException(403, "Yêu cầu quyền quản lý, bạn không có quyền thực hiện thao tác này!")

        # Catch-all for any unexpected role.
        raise HTTPException(403, "Yêu cầu quyền quản lý, bạn không có quyền thực hiện thao tác này!")

    return user
