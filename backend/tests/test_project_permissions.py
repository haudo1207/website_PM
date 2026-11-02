"""Who may create / move / delete / open a Project."""
from app.models.project import Project, project_members
from app.routers import projects as pr
from app.routers import system_categories as sc
from app.utils.access import can_access_project


def roles_of(db, pid, mid):
    return {r for (r,) in db.query(project_members.c.role).filter(
        project_members.c.project_id == pid, project_members.c.member_id == mid).all()}


# ── create (A3, A5, D4) ──

def test_leader_cannot_create_outside_granted_workspaces(db, leader_infras_only, status_of):
    assert status_of(lambda: pr.create_project({"name": "x", "business": "markee"}, db=db, current_user=leader_infras_only)) == 403
    assert status_of(lambda: pr.create_project({"name": "x", "business": "all"}, db=db, current_user=leader_infras_only)) == 403


def test_leader_creates_in_own_workspace_and_defaults_to_it(db, leader_infras_only):
    p = pr.create_project({"name": "Own", "business": "infras"}, db=db, current_user=leader_infras_only)
    assert p["business"] == "Infras"
    p = pr.create_project({"name": "No biz"}, db=db, current_user=leader_infras_only)
    assert p["business"] == "Infras"


def test_super_admin_can_still_create_all(db, admin):
    assert pr.create_project({"name": "All", "business": "all"}, db=db, current_user=admin)["business"] == "All"


def test_customer_is_validated_on_create(db, admin, leader_infras_only, status_of):
    other = sc.create_customer({"name": "Markee KH", "business_unit": "markee"}, db=db, current_user=admin)
    assert status_of(lambda: pr.create_project({"name": "y", "business": "infras", "customer_id": 9999}, db=db, current_user=leader_infras_only)) == 400
    assert status_of(lambda: pr.create_project({"name": "y", "business": "infras", "customer_id": other["id"]}, db=db, current_user=leader_infras_only)) == 400


def test_phu_project_scope_follows_workspace_and_adds_leader(db, leader):
    """D4: data_scope = chosen Workspace; the creating Leader is added so they keep access."""
    created = pr.create_project({"name": "Phu", "business": "markee"}, db=db, current_user=leader)
    p = db.get(Project, created["id"])
    assert (p.business, p.data_scope) == ("Markee", "markee")
    assert "Leader" in roles_of(db, p.id, leader.member_id)
    assert can_access_project(db, leader, p)


def test_no_duplicate_auto_add_and_none_in_chinh(db, leader):
    as_pm = pr.create_project({"name": "Phu PM", "business": "markee", "pm_ids": [leader.member_id]}, db=db, current_user=leader)
    assert roles_of(db, as_pm["id"], leader.member_id) == {"PM"}
    chinh = pr.create_project({"name": "Chinh", "business": "infras"}, db=db, current_user=leader)
    assert db.get(Project, chinh["id"]).data_scope == "infras"
    assert not roles_of(db, chinh["id"], leader.member_id)


# ── update (A4, D4) ──

def test_leader_cannot_widen_or_move_out_of_grants(db, leader_infras_only, status_of):
    p = pr.create_project({"name": "P", "business": "infras"}, db=db, current_user=leader_infras_only)
    assert status_of(lambda: pr.update_project(p["id"], {"data_scope": "all"}, db=db, current_user=leader_infras_only)) == 403
    assert status_of(lambda: pr.update_project(p["id"], {"business": "markee"}, db=db, current_user=leader_infras_only)) == 403
    db.expire_all()
    row = db.get(Project, p["id"])
    assert (row.business, row.data_scope) == ("Infras", "infras")
    assert status_of(lambda: pr.update_project(p["id"], {"name": "P2", "business": "infras"}, db=db, current_user=leader_infras_only)) == 200


def test_moving_workspace_keeps_data_scope_in_step(db, leader):
    p = pr.create_project({"name": "P", "business": "infras"}, db=db, current_user=leader)
    pr.update_project(p["id"], {"name": "P", "business": "markee"}, db=db, current_user=leader)
    db.expire_all()
    row = db.get(Project, p["id"])
    assert (row.business, row.data_scope) == ("Markee", "markee")


# ── delete (A1) ──

def test_leader_cannot_bulk_delete_other_workspace(db, admin, leader_infras_only):
    other = pr.create_project({"name": "Mk", "business": "markee"}, db=db, current_user=admin)
    res = pr.bulk_delete_projects({"ids": [other["id"]]}, db=db, current_user=leader_infras_only)
    assert res["deleted_ids"] == [] and len(res["failed"]) == 1
    assert db.get(Project, other["id"]) is not None


def test_bulk_delete_own_project_and_report_bad_ids(db, leader_infras_only):
    own = pr.create_project({"name": "Own", "business": "infras"}, db=db, current_user=leader_infras_only)
    res = pr.bulk_delete_projects({"ids": [own["id"], "abc"]}, db=db, current_user=leader_infras_only)
    assert res["deleted_ids"] == [own["id"]]
    assert len(res["failed"]) == 1


# ── open (C2) ──

def test_member_opens_only_assigned_projects(db, admin, leader, member, assign):
    unassigned = Project(name="U", business="Infras", data_scope="infras")
    assigned = Project(name="A", business="Infras", data_scope="infras")
    global_p = Project(name="G", business="All", data_scope="all")
    db.add_all([unassigned, assigned, global_p])
    db.commit()
    assign(assigned.id, member.member_id)

    assert not can_access_project(db, member, unassigned)
    assert not can_access_project(db, member, global_p)
    assert can_access_project(db, member, assigned)
    assert can_access_project(db, leader, unassigned)
    assert can_access_project(db, admin, unassigned)
