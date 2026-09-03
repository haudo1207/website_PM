"""
Seed a small, deterministic demo dataset for the Workspace Chinh/Phu
(primary/secondary) feature.

Structure:
  - 1 super_admin
  - Leader Dev: Chinh = Dev, Phu = Infra + Marketing (tests "1 Chinh + NHIEU Phu")
  - Leader Infra: Chinh = Infra, Phu = Dev (tests "1 Chinh + 1 Phu", contrast case)
  - 4 Members total, 2 reporting to each Leader (via Member.leader_member_id) —
    every Member's team is one of these two Leaders, no Phu of their own.
  - 2 Projects per Workspace (Dev/Infra/Marketing), each with a
    Phase/TaskGroup/4 Tasks.

Fully idempotent: every entity is keyed by a deterministic email/name, so
re-running this script updates/reuses existing rows instead of creating
duplicates.

Usage (from inside the backend container):
    docker compose exec backend python seed_workspace_demo.py
"""
import datetime
import random

from app.database import SessionLocal
from app.models.user import User
from app.models.member import Member
from app.models.system_category import Workspace, TaskPriority
from app.models.workspace_access import UserWorkspaceAccess
from app.models.project import Project, project_members
from app.models.phase import Phase
from app.models.task_group import TaskGroup
from app.models.task import Task
from app.models.skill_master import Group, Skill
from app.utils.auth import hash_password
from app.utils.kpi_engine import recalculate_task

TEST_PASSWORD = "Demo@12345"

TEAMS = ["Network Team", "System Team", "Security Team", "Backend Developer", "Frontend Developer", "DevOps Engineer"]
POSITIONS = [
    "Network Engineer", "System Administrator", "Cybersecurity Specialist",
    "Backend Developer", "Frontend Developer", "DevOps Engineer",
]

PROJECT_NAMES = {
    "infra": ["Trien khai SIEM noi bo", "Nang cap ha tang mang chi nhanh"],
    "dev": ["Website Villa moi", "App dat lich noi bo"],
    "marketing": ["Chien dich Quy 4", "Rebrand Website Cong ty"],
}


def get_or_create_member(db, display_name, full_name, leader: Member | None = None) -> Member:
    existing = db.query(Member).filter(Member.display_name == display_name).first()
    if existing:
        if leader is not None and existing.leader_member_id != leader.id:
            existing.leader_member_id = leader.id
            existing.leader_name = leader.full_name
            existing.leader_email = leader.email
        return existing
    m = Member(
        display_name=display_name,
        full_name=full_name,
        email=f"{display_name.lower()}@markeeai.demo",
        team=random.choice(TEAMS),
        position=random.choice(POSITIONS),
        department="Infrastructure",
        experience_year=random.randint(1, 8),
        leader_member_id=leader.id if leader else None,
        leader_name=leader.display_name if leader else None,
        leader_email=leader.email if leader else None,
    )
    db.add(m)
    db.flush()
    return m


def get_or_create_user(db, member, email, role, data_scope) -> User:
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        if existing.member_id != member.id:
            existing.member_id = member.id
        return existing
    u = User(
        email=email,
        full_name=member.full_name,
        hashed_pw=hash_password(TEST_PASSWORD),
        role=role,
        data_scope=data_scope,
        is_active=True,
        member_id=member.id,
    )
    db.add(u)
    db.flush()
    return u


def grant_workspace(db, user, workspace, is_primary):
    existing = (
        db.query(UserWorkspaceAccess)
        .filter(UserWorkspaceAccess.user_id == user.id, UserWorkspaceAccess.workspace_id == workspace.id)
        .first()
    )
    if existing:
        existing.is_primary = is_primary
        return
    db.add(UserWorkspaceAccess(user_id=user.id, workspace_id=workspace.id, is_primary=is_primary))


def main():
    db = SessionLocal()
    try:
        workspaces = {w.code: w for w in db.query(Workspace).all()}
        for code in ("infra", "dev", "marketing"):
            if code not in workspaces:
                raise SystemExit(f"Expected Workspace '{code}' to already exist — aborting.")
        ws_infra, ws_dev, ws_mkt = workspaces["infra"], workspaces["dev"], workspaces["marketing"]

        fallback_group = db.query(Group).order_by(Group.id.asc()).first()
        fallback_skill = db.query(Skill).order_by(Skill.id.asc()).first()
        priorities = [p.name for p in db.query(TaskPriority).all()] or ["Normal"]

        # ── super_admin ──
        admin = db.query(User).filter(User.email == "admin.demo@markeeai.demo").first()
        if not admin:
            admin = User(
                email="admin.demo@markeeai.demo",
                full_name="Demo Super Admin",
                hashed_pw=hash_password(TEST_PASSWORD),
                role="super_admin",
                data_scope="all",
                is_active=True,
            )
            db.add(admin)
            db.flush()

        # ── Leader Dev: Chinh=Dev, Phu=Infra + Phu=Marketing (2 Phu) ──
        leader_dev_member = get_or_create_member(db, "LeaderDev", "Leader Dev")
        leader_dev = get_or_create_user(db, leader_dev_member, "leader.dev@markeeai.demo", "leader", ws_dev.code)
        grant_workspace(db, leader_dev, ws_dev, is_primary=True)
        grant_workspace(db, leader_dev, ws_infra, is_primary=False)
        grant_workspace(db, leader_dev, ws_mkt, is_primary=False)

        # ── Leader Infra: Chinh=Infra, Phu=Dev (1 Phu, contrast case) ──
        leader_infra_member = get_or_create_member(db, "LeaderInfra", "Leader Infra")
        leader_infra = get_or_create_user(db, leader_infra_member, "leader.infra@markeeai.demo", "leader", ws_infra.code)
        grant_workspace(db, leader_infra, ws_infra, is_primary=True)
        grant_workspace(db, leader_infra, ws_dev, is_primary=False)

        # ── 4 Members, 2 reporting to each Leader — every Member's team is
        # one of these two Leaders, no Phu of their own. ──
        member_pool: dict[str, list[tuple[User, Member]]] = {ws_infra.code: [], ws_dev.code: []}
        for ws, leader_member, prefix in ((ws_dev, leader_dev_member, "MemberDev"), (ws_infra, leader_infra_member, "MemberInfra")):
            for i in (1, 2):
                display = f"{prefix}{i}"
                m = get_or_create_member(db, display, f"{prefix} {i}", leader=leader_member)
                email = f"member.{ws.code}{i}@markeeai.demo"
                u = get_or_create_user(db, m, email, "member", ws.code)
                grant_workspace(db, u, ws, is_primary=True)
                member_pool[ws.code].append((u, m))

        db.flush()

        # ── Projects: 2 per Workspace (Dev/Infra/Marketing), each with a
        # Phase + TaskGroup + Tasks ──
        today = datetime.date.today()
        pm_members = {ws_dev.code: leader_dev_member, ws_infra.code: leader_infra_member, ws_mkt.code: leader_dev_member}
        assignee_pools = {ws_dev.code: member_pool[ws_dev.code], ws_infra.code: member_pool[ws_infra.code], ws_mkt.code: []}
        for ws in (ws_infra, ws_dev, ws_mkt):
            pm_member = pm_members[ws.code]
            assignee_pool = [m for (_, m) in assignee_pools[ws.code]] or [pm_member]

            for pname in PROJECT_NAMES[ws.code]:
                proj = db.query(Project).filter(Project.name == pname).first()
                if proj:
                    continue

                proj = Project(
                    name=pname,
                    customer_name="Noi bo",
                    year=today.year,
                    pm_id=pm_member.id,
                    business=ws.code,
                    status="Developing",
                )
                db.add(proj)
                db.flush()  # `business` -> `data_scope` via the before_insert event listener

                phase = Phase(project_id=proj.id, name="1. Trien khai", sort_order=1)
                db.add(phase)
                db.flush()

                tg = TaskGroup(phase_id=phase.id, name="Cong viec chinh", sort_order=1)
                db.add(tg)
                db.flush()

                db.execute(project_members.insert().values(project_id=proj.id, member_id=pm_member.id, role="PM"))
                for m in assignee_pool:
                    if m.id == pm_member.id:
                        continue
                    db.execute(project_members.insert().values(project_id=proj.id, member_id=m.id, role="Member"))

                for t_i in range(4):
                    assignee = random.choice(assignee_pool)
                    support = random.choice(assignee_pool)
                    status = random.choice(["Waiting", "Process", "Done"])
                    # Keep every task inside the last few days so it reliably
                    # falls within "Tuan nay" / "Thang nay" dashboard filters
                    # regardless of what day the seed script happens to run —
                    # the old random(0, 20 days) window could silently drift
                    # a task out of the current week/month and make it look
                    # like the workspace-allocation / cross-workspace numbers
                    # were wrong when it was actually just a stale date.
                    if status == "Done":
                        start_date = today - datetime.timedelta(days=random.randint(2, 5))
                        end_actual = today
                    else:
                        start_date = today - datetime.timedelta(days=random.randint(0, 2))
                        end_actual = None
                    task = Task(
                        task_group_id=tg.id,
                        detail=f"{pname} - Task {t_i + 1}",
                        priority=random.choice(priorities),
                        manday_est=random.choice([1, 2, 3, 5]),
                        status=status,
                        start_date=start_date,
                        end_date_actual=end_actual,
                        assigned_id=assignee.id,
                        support_id=support.id,
                        skill_solution_id=fallback_group.id if fallback_group else None,
                        skill_vendor_id=fallback_skill.id if fallback_skill else None,
                    )
                    db.add(task)
                    db.flush()
                    recalculate_task(task, db)

        # ── Cross-workspace "tham gia ngoai" test case ──────────────────
        # MemberDev1 (home = Dev) is additionally granted Phu access to
        # Infra AND assigned into ONE Infra project's project_members with
        # a real task there. This is the Member-side mirror of what Leader
        # Dev already gets for free (PM of the 2 Marketing projects, added
        # to project_members above) — it exercises the exact rule in
        # backend/app/utils/access.py::project_query_for_user(): for a
        # Member/Viewer, a project only shows up when BOTH (a) they have an
        # explicit project_members row AND (b) the project's Workspace is
        # one of their granted Workspaces (Chinh or Phu) — being a project
        # member alone is not enough without the matching Workspace grant.
        member_dev1_user = db.query(User).filter(User.email == "member.dev1@markeeai.demo").first()
        member_dev1 = db.query(Member).filter(Member.display_name == "MemberDev1").first()
        if member_dev1_user and member_dev1:
            grant_workspace(db, member_dev1_user, ws_infra, is_primary=False)
            ext_project = db.query(Project).filter(Project.name == PROJECT_NAMES["infra"][0]).first()
            if ext_project:
                already_member = db.execute(
                    project_members.select().where(
                        project_members.c.project_id == ext_project.id,
                        project_members.c.member_id == member_dev1.id,
                    )
                ).first()
                if not already_member:
                    db.execute(project_members.insert().values(
                        project_id=ext_project.id, member_id=member_dev1.id, role="Member",
                    ))
                ext_tg = (
                    db.query(TaskGroup)
                    .join(Phase, TaskGroup.phase_id == Phase.id)
                    .filter(Phase.project_id == ext_project.id)
                    .first()
                )
                ext_detail = f"{ext_project.name} - Cross-workspace contribution (MemberDev1)"
                if ext_tg and not db.query(Task).filter(Task.detail == ext_detail).first():
                    ext_task = Task(
                        task_group_id=ext_tg.id,
                        detail=ext_detail,
                        priority=priorities[0] if priorities else "Normal",
                        manday_est=3,
                        status="Process",
                        start_date=today,
                        assigned_id=member_dev1.id,
                        support_id=member_dev1.id,
                        skill_solution_id=fallback_group.id if fallback_group else None,
                        skill_vendor_id=fallback_skill.id if fallback_skill else None,
                    )
                    db.add(ext_task)
                    db.flush()
                    recalculate_task(ext_task, db)

        # ── Second cross-workspace test case: BOTH the Leader and one of
        # their own Members assigned into the same Phu-Workspace project.
        # This is the mirror case of the one above — there, only MemberDev1
        # was assigned (Leader Dev himself was not) so LeaderDev only sees
        # that Infra project's numbers via the aggregate Dashboard view, not
        # as its own project card. Here, LeaderInfra (Chinh=Infra, Phu=Dev)
        # AND MemberInfra1 (one of LeaderInfra's own reports) are BOTH
        # assigned into the same Dev project — so LeaderInfra should see it
        # as a real "Tham gia ngoai" project card (Limited access), not just
        # as background KPI/Manday noise from a teammate they can't open.
        leader_infra_user = db.query(User).filter(User.email == "leader.infra@markeeai.demo").first()
        member_infra1_user = db.query(User).filter(User.email == "member.infra1@markeeai.demo").first()
        member_infra1 = db.query(Member).filter(Member.display_name == "MemberInfra1").first()
        if leader_infra_user and member_infra1_user and member_infra1:
            grant_workspace(db, member_infra1_user, ws_dev, is_primary=False)
            ext_project2 = db.query(Project).filter(Project.name == PROJECT_NAMES["dev"][0]).first()
            if ext_project2:
                for m in (leader_infra_member, member_infra1):
                    already_member2 = db.execute(
                        project_members.select().where(
                            project_members.c.project_id == ext_project2.id,
                            project_members.c.member_id == m.id,
                        )
                    ).first()
                    if not already_member2:
                        db.execute(project_members.insert().values(
                            project_id=ext_project2.id, member_id=m.id, role="Member",
                        ))
                ext_tg2 = (
                    db.query(TaskGroup)
                    .join(Phase, TaskGroup.phase_id == Phase.id)
                    .filter(Phase.project_id == ext_project2.id)
                    .first()
                )
                if ext_tg2:
                    for who, label in ((leader_infra_member, "LeaderInfra"), (member_infra1, "MemberInfra1")):
                        ext_detail2 = f"{ext_project2.name} - Cross-workspace contribution ({label})"
                        if not db.query(Task).filter(Task.detail == ext_detail2).first():
                            ext_task2 = Task(
                                task_group_id=ext_tg2.id,
                                detail=ext_detail2,
                                priority=priorities[0] if priorities else "Normal",
                                manday_est=2,
                                status="Process",
                                start_date=today,
                                assigned_id=who.id,
                                support_id=who.id,
                                skill_solution_id=fallback_group.id if fallback_group else None,
                                skill_vendor_id=fallback_skill.id if fallback_skill else None,
                            )
                            db.add(ext_task2)
                            db.flush()
                            recalculate_task(ext_task2, db)

        db.commit()

        print("=" * 64)
        print("Seed OK")
        print("=" * 64)
        print(f"Test SUPER_ADMIN : admin.demo@markeeai.demo / {TEST_PASSWORD}")
        print(f"Test LEADER      : leader.dev@markeeai.demo / {TEST_PASSWORD}")
        print(f"                   Chinh = Dev, Phu = Infra + Marketing (2 Phu)")
        print(f"Test LEADER      : leader.infra@markeeai.demo / {TEST_PASSWORD}")
        print(f"                   Chinh = Infra, Phu = Dev (1 Phu)")
        print(f"Test MEMBER      : member.dev1@markeeai.demo / {TEST_PASSWORD}  (reports to leader.dev)")
        print(f"Test MEMBER      : member.dev2@markeeai.demo / {TEST_PASSWORD}  (reports to leader.dev)")
        print(f"Test MEMBER      : member.infra1@markeeai.demo / {TEST_PASSWORD}  (reports to leader.infra)")
        print(f"Test MEMBER      : member.infra2@markeeai.demo / {TEST_PASSWORD}  (reports to leader.infra)")
        print("2 projects per Workspace (Dev/Infra/Marketing) = 6 total.")
        print("MemberDev1 also 'tham gia ngoai': Phu access to Infra +")
        print("1 real task on an Infra project (member-only cross-ws case).")
        print("LeaderInfra + MemberInfra1 BOTH assigned into 1 Dev project")
        print("(leader+member cross-ws case).")
        print("=" * 64)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
