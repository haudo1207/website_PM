"""Which Customers show up in which Workspace (project form dropdown,
Customers tab, Leader visibility) — derived from Projects, with a
business_unit fallback only for Customers that have no Projects yet."""
from fastapi import HTTPException
import pytest

from app.models.project import Project
from app.models.system_category import Customer
from app.routers import projects as pr
from app.routers import system_categories as sc


def names(rows):
    return {c.name for c in rows}


def new_customer(db, admin, name, bu):
    return sc.create_customer({"name": name, "business_unit": bu}, db=db, current_user=admin)


def add_project(db, name, customer, business, scope):
    p = Project(name=name, customer_id=customer.id, customer_name=customer.name, business=business, data_scope=scope)
    db.add(p)
    db.commit()
    return p


def test_new_customer_without_projects_is_pickable_in_its_workspace(db, admin, leader):
    new_customer(db, admin, "SAWACO", "infras")
    assert "SAWACO" in names(sc.list_customers_by_workspace("infras", db=db, current_user=admin))
    assert "SAWACO" not in names(sc.list_customers_by_workspace("markee", db=db, current_user=admin))
    assert "SAWACO" in names(sc.list_customers_by_workspace("infras", db=db, current_user=leader))
    assert "SAWACO" in names(sc.list_customers(business_unit=None, db=db, current_user=leader))


def test_leader_cannot_open_ungranted_workspace(db, leader_infras_only):
    with pytest.raises(HTTPException) as e:
        sc.list_customers_by_workspace("markee", db=db, current_user=leader_infras_only)
    assert e.value.status_code == 403


def test_all_scope_customer_shows_everywhere(db, admin):
    new_customer(db, admin, "Shared", "all")
    for code in ("infras", "markee"):
        assert "Shared" in names(sc.list_customers_by_workspace(code, db=db, current_user=admin))


def test_customer_follows_its_projects_once_it_has_some(db, admin):
    c = new_customer(db, admin, "Moved", "infras")
    add_project(db, "P", c, "Markee", "markee")
    assert "Moved" in names(sc.list_customers_by_workspace("markee", db=db, current_user=admin))
    assert "Moved" not in names(sc.list_customers_by_workspace("infras", db=db, current_user=admin))
    # D3: the Customers tab (list_customers?business_unit=) uses the same rule
    assert "Moved" in names(sc.list_customers(business_unit="markee", db=db, current_user=admin))
    assert "Moved" not in names(sc.list_customers(business_unit="infras", db=db, current_user=admin))


def test_project_matching_only_by_raw_code_still_counts(db, admin):
    """D2: business holding a raw code (or only data_scope matching) used to drop the Customer."""
    c = new_customer(db, admin, "Raw", "markee")
    add_project(db, "P", c, "infras", "infras")
    assert "Raw" in names(sc.list_customers_by_workspace("infras", db=db, current_user=admin))


def test_all_project_needs_no_customer_clone(db, admin):
    """C1: an "All" project puts its Customer in every Workspace without copying it."""
    c = new_customer(db, admin, "VNPT", "infras")
    created = pr.create_project({"name": "Global", "business": "all", "customer_id": c.id}, db=db, current_user=admin)
    pr.update_project(created["id"], {"name": "Global 2", "business": "all", "customer_id": c.id}, db=db, current_user=admin)
    assert db.query(Customer).filter(Customer.name == "VNPT").count() == 1
    for code in ("infras", "markee"):
        assert "VNPT" in names(sc.list_customers_by_workspace(code, db=db, current_user=admin))
        assert "VNPT" in names(sc.list_customers(business_unit=code, db=db, current_user=admin))


def test_leader_only_sees_customers_of_projects_they_can_see(db, admin, leader, assign):
    """D1: a Phụ-Workspace project the Leader isn't on must not leak its Customer."""
    secret = new_customer(db, admin, "Secret", "markee")
    shared = new_customer(db, admin, "Assigned", "markee")
    own = new_customer(db, admin, "Own", "markee")
    add_project(db, "secret", secret, "Markee", "markee")
    p = add_project(db, "assigned", shared, "Markee", "markee")
    add_project(db, "own", own, "Infras", "infras")
    assign(p.id, leader.member_id)

    visible = names(sc.list_customers(business_unit=None, db=db, current_user=leader))
    assert "Secret" not in visible
    assert {"Assigned", "Own"} <= visible
    assert "Secret" not in names(sc.list_customers_by_workspace("markee", db=db, current_user=leader))
