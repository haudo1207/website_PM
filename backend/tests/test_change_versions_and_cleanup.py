"""Change stamps the frontend polls for auto-refresh, and the clone-cleanup
detector (cleanup_customer_clones.py)."""
import datetime
import time

import cleanup_customer_clones as cc
from app.models.meeting import Meeting
from app.models.project import Project
from app.models.system_category import Customer
from app.routers import meetings as mt
from app.routers import system_categories as sc


def cp_version(db, admin):
    return sc.customer_project_version(db=db, _=admin)["version"]


def test_customer_project_version_tracks_changes(db, admin):
    v0 = cp_version(db, admin)
    c = sc.create_customer({"name": "KH", "business_unit": "infras"}, db=db, current_user=admin)
    v1 = cp_version(db, admin)
    assert v1 != v0
    db.add(Project(name="P", customer_id=c.id, business="Infras", data_scope="infras"))
    db.commit()
    v2 = cp_version(db, admin)
    assert v2 != v1
    sc.update_customer(c.id, {"name": "KH 2"}, db=db, current_user=admin)
    v3 = cp_version(db, admin)
    assert v3 != v2
    assert cp_version(db, admin) == v3  # stable when nothing changed


def test_meetings_version_tracks_create_edit_soft_delete(db, admin):
    v0 = mt.meetings_version(db=db, _=admin)["version"]
    m = Meeting(title="Kickoff", meeting_date=datetime.date(2026, 10, 21), start_time=datetime.time(9))
    db.add(m)
    db.commit()
    v1 = mt.meetings_version(db=db, _=admin)["version"]
    assert v1 != v0
    time.sleep(1.1)  # SQLite func.now() has 1-second resolution
    m.title = "Kickoff 2"
    db.commit()
    v2 = mt.meetings_version(db=db, _=admin)["version"]
    assert v2 != v1
    time.sleep(1.1)
    m.deleted_at = datetime.datetime.now()
    db.commit()
    assert mt.meetings_version(db=db, _=admin)["version"] != v2


def test_cleanup_flags_only_projectless_same_name_copies(db):
    keeper = Customer(name="VNPT", business_unit="infras")
    clone = Customer(name="vnpt", business_unit="markee")
    lonely = Customer(name="Lonely", business_unit="markee")
    twin_a = Customer(name="Twin", business_unit="infras")
    twin_b = Customer(name="Twin", business_unit="markee")
    db.add_all([keeper, clone, lonely, twin_a, twin_b])
    db.commit()
    db.add_all([
        Project(name="k", customer_id=keeper.id, business="Infras", data_scope="infras"),
        Project(name="t", customer_id=twin_a.id, business="Infras", data_scope="infras"),
        # a legacy name-only row still points at "Twin", so twin_b is not a safe delete
        Project(name="legacy", customer_id=None, customer_name="Twin", business="Markee", data_scope="markee"),
    ])
    db.commit()

    flagged = {c.id for c, _, _ in cc.find_candidates(db)}
    assert flagged == {clone.id}
