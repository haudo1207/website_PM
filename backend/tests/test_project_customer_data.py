"""Data integrity: project codes, cascades, customer rename/delete."""
import datetime

from app.models.meeting import Meeting
from app.models.meeting_project import MeetingProject
from app.models.project import Project
from app.models.system_category import Customer
from app.routers import projects as pr
from app.routers import system_categories as sc


def meeting(db, title, project_id, hour=9):
    m = Meeting(title=title, meeting_date=datetime.date(2026, 10, 21), start_time=datetime.time(hour), project_id=project_id)
    db.add(m)
    db.commit()
    return m


# ── project code (B2) ──

def test_blank_codes_are_stored_as_null(db, admin):
    a = pr.create_project({"name": "A", "business": "markee", "code": "  "}, db=db, current_user=admin)
    b = pr.create_project({"name": "B", "business": "markee", "code": ""}, db=db, current_user=admin)
    assert db.get(Project, a["id"]).code is None
    assert db.get(Project, b["id"]).code is None


def test_duplicate_code_is_409_on_create_and_update(db, admin, status_of):
    a = pr.create_project({"name": "A", "business": "markee"}, db=db, current_user=admin)
    pr.create_project({"name": "C", "business": "markee", "code": "ABC-1"}, db=db, current_user=admin)
    assert status_of(lambda: pr.create_project({"name": "D", "business": "markee", "code": "ABC-1"}, db=db, current_user=admin)) == 409
    assert status_of(lambda: pr.update_project(a["id"], {"code": "ABC-1"}, db=db, current_user=admin)) == 409


# ── meetings on project delete (A7) ──

def test_shared_meeting_survives_project_delete(db, admin):
    p1 = pr.create_project({"name": "M1", "business": "markee"}, db=db, current_user=admin)
    p2 = pr.create_project({"name": "M2", "business": "markee"}, db=db, current_user=admin)
    shared = meeting(db, "Shared", p1["id"])
    solo = meeting(db, "Solo", p1["id"], 10)
    db.add(MeetingProject(meeting_id=shared.id, project_id=p2["id"]))
    db.commit()
    shared_id, solo_id = shared.id, solo.id

    pr.delete_project(p1["id"], db=db, current_user=admin)
    db.expire_all()
    assert db.get(Meeting, shared_id).project_id == p2["id"]
    assert db.get(Meeting, solo_id) is None


# ── customer delete (A2 + shared cascade) ──

def test_deleting_same_named_customer_spares_the_other_ones_projects(db, admin):
    keep = sc.create_customer({"name": "VNPT", "business_unit": "infras"}, db=db, current_user=admin)
    gone = sc.create_customer({"name": "VNPT", "business_unit": "markee"}, db=db, current_user=admin)
    kept_p = pr.create_project({"name": "Keep", "business": "infras", "customer_id": keep.id}, db=db, current_user=admin)
    pr.create_project({"name": "Own", "business": "markee", "customer_id": gone.id}, db=db, current_user=admin)
    db.add(Project(name="Legacy", customer_name="VNPT", customer_id=None, business="Markee", data_scope="markee"))
    db.commit()

    linked = sc.list_customer_linked_projects(gone.id, db=db, current_user=admin)
    assert {p["name"] for p in linked} == {"Own", "Legacy"}

    sc.delete_customer(gone.id, cascade_projects=True, db=db, current_user=admin)
    db.expire_all()
    survivor = db.get(Project, kept_p["id"])
    assert survivor is not None and survivor.customer_id == keep.id


def test_customer_cascade_uses_the_project_delete_rules(db, admin):
    """Point 1: deleting a Customer with its projects hands shared meetings over too."""
    c = sc.create_customer({"name": "KH", "business_unit": "markee"}, db=db, current_user=admin)
    p1 = pr.create_project({"name": "KH P", "business": "markee", "customer_id": c.id}, db=db, current_user=admin)
    other = pr.create_project({"name": "Other", "business": "markee"}, db=db, current_user=admin)
    shared = meeting(db, "Shared", p1["id"])
    solo = meeting(db, "Solo", p1["id"], 10)
    db.add(MeetingProject(meeting_id=shared.id, project_id=other["id"]))
    db.commit()
    shared_id, solo_id = shared.id, solo.id

    sc.delete_customer(c.id, cascade_projects=True, db=db, current_user=admin)
    db.expire_all()
    assert db.get(Project, p1["id"]) is None
    assert db.get(Customer, c.id) is None
    assert db.get(Meeting, shared_id).project_id == other["id"]
    assert db.get(Meeting, solo_id) is None


def test_customer_delete_without_cascade_unlinks(db, admin):
    c = sc.create_customer({"name": "KH", "business_unit": "markee"}, db=db, current_user=admin)
    p = pr.create_project({"name": "P", "business": "markee", "customer_id": c.id}, db=db, current_user=admin)
    sc.delete_customer(c.id, cascade_projects=False, db=db, current_user=admin)
    db.expire_all()
    row = db.get(Project, p["id"])
    assert row is not None and row.customer_id is None and row.customer_name is None


# ── customer rename (B8) ──

def test_rename_keeps_description_and_syncs_projects(db, admin):
    c = sc.create_customer({"name": "VNPT", "business_unit": "infras"}, db=db, current_user=admin)
    sc.update_customer(c.id, {"name": "VNPT", "description": "desc"}, db=db, current_user=admin)
    p = pr.create_project({"name": "P", "business": "infras", "customer_id": c.id}, db=db, current_user=admin)
    legacy = Project(name="Legacy", customer_name="VNPT", customer_id=None, business="Infras", data_scope="infras")
    db.add(legacy)
    db.commit()

    sc.update_customer(c.id, {"name": "VNPT Group"}, db=db, current_user=admin)
    db.expire_all()
    assert db.get(Customer, c.id).description == "desc"
    assert db.get(Project, p["id"]).customer_name == "VNPT Group"
    adopted = db.get(Project, legacy.id)
    assert (adopted.customer_id, adopted.customer_name) == (c.id, "VNPT Group")


def test_duplicate_name_check_is_exact_not_wildcard(db, admin, status_of):
    sc.create_customer({"name": "A_B", "business_unit": "infras"}, db=db, current_user=admin)
    assert status_of(lambda: sc.create_customer({"name": "AxB", "business_unit": "infras"}, db=db, current_user=admin)) == 200
    assert status_of(lambda: sc.create_customer({"name": "a_b", "business_unit": "infras"}, db=db, current_user=admin)) == 400
