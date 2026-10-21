"""MSC -> PM weekly KPI sync (routers/msc_sync.py): token, skills, idempotent create/update of the week's Task Group + child tasks,
and the per-task / per-request errors MSC relies on."""
from datetime import date

import pytest
from fastapi import HTTPException

from app.config import settings
from app.models.member import Member
from app.models.skill_master import Category, Group, Skill
from app.models.task import Task
from app.models.task_group import TaskGroup
from app.routers import msc_sync as ms
from app.routers import projects as pr

WEEK = {"key": "sess_w3", "label": "Tuần 3 · 19/10/2026 – 25/10/2026", "weekNum": 3, "startDate": "2026-10-19", "endDate": "2026-10-25"}
GKEY = "msc-kpi:Team Minh:sess_w3"


def mk_member(db, name, email):
    m = Member(display_name=name, full_name=name, email=email)
    db.add(m)
    db.commit()
    return m


@pytest.fixture
def world(db, admin, assign):
    project = pr.create_project({"name": "MSC", "business": "all"}, db=db, current_user=admin)
    han = mk_member(db, "Han", "han@x.vn")
    an = mk_member(db, "An", "an@x.vn")
    out = mk_member(db, "Ngoai", "out@x.vn")  # not in the project
    assign(project["id"], han.id)
    assign(project["id"], an.id)
    cat = Category(name="IT")
    db.add(cat)
    db.commit()
    net, sec = Group(name="Network", category_id=cat.id), Group(name="Security", category_id=cat.id)
    db.add_all([net, sec])
    db.commit()
    cisco, palo = Skill(name="Cisco", group_id=net.id), Skill(name="Palo Alto", group_id=sec.id)
    db.add_all([cisco, palo])
    db.commit()
    return dict(pid=project["id"], han=han, an=an, out=out, net=net, sec=sec, cisco=cisco, palo=palo)


def task_in(w, who="han", support="an", metric="canXemXet", priority="High", manday=1.5, **over):
    people = {"han": ("han@x.vn", "Han"), "an": ("an@x.vn", "An"), "out": ("out@x.vn", "Ngoai")}
    t = {
        "externalKey": f"{GKEY}:{who}:{metric}",
        "detail": f"{people[who][1]} · {metric}: 7 gói ({priority})",
        "priority": priority, "status": "Done", "manday": manday, "startDate": "2026-10-19",
        "assignee": {"email": people[who][0], "name": people[who][1]},
        "support": {"email": people[support][0], "name": people[support][1]},
        "skillSolutionId": w["net"].id, "skillVendorId": w["cisco"].id,
    }
    t.update(over)
    return t


def body(tasks, **group):
    return {"source": "msc", "team": "Team Minh", "week": WEEK,
            "group": {"externalKey": GKEY, "name": "Tuần 3 · 19/10/2026 – 25/10/2026 · KPI MSC · Team Minh", **group}, "tasks": tasks}


def push(db, w, tasks, **group):
    return ms.upsert_weekly_kpi(w["pid"], body(tasks, **group), db=db)


# ── auth ──

def test_token_fails_closed_and_checks(monkeypatch):
    monkeypatch.setattr(settings, "MSC_SYNC_TOKEN", "")
    with pytest.raises(HTTPException) as e:
        ms._check_token("anything")
    assert e.value.status_code == 503, "unset token must lock the endpoint, not disable auth"
    monkeypatch.setattr(settings, "MSC_SYNC_TOKEN", "s3cret")
    for bad in (None, "", "nope"):
        with pytest.raises(HTTPException) as e:
            ms._check_token(bad)
        assert e.value.status_code == 403
    assert ms._check_token("s3cret") is None


# ── skills ──

def test_skills_list(db, world):
    groups = {g["name"]: g for g in ms.list_skills(db=db)["groups"]}
    assert groups["Network"]["categoryName"] == "IT"
    assert [s["name"] for s in groups["Network"]["skills"]] == ["Cisco"]
    assert groups["Security"]["skills"][0]["id"] == world["palo"].id


# ── create / update ──

def test_creates_group_and_tasks(db, world):
    out = push(db, world, [task_in(world), task_in(world, who="an", support="han", metric="thamGia", priority="Normal", manday=0.5)])
    assert out["errors"] == []
    assert out["group"]["action"] == "created" and out["group"]["code"]
    assert [t["action"] for t in out["tasks"]] == ["created", "created"]
    tg = db.get(TaskGroup, out["group"]["id"])
    assert tg.description == GKEY and tg.name.startswith("Tuần 3")
    assert float(tg.manday_est) == 2, "group manday = ceil(1.5 + 0.5)"
    assert str(tg.start_date_est) == "2026-10-19"
    t1 = db.get(Task, out["tasks"][0]["id"])
    assert (t1.priority, t1.status, t1.ticket_id) == ("High", "Done", f"{GKEY}:han:canXemXet")
    assert (t1.assigned_id, t1.support_id) == (world["han"].id, world["an"].id)
    assert (t1.skill_solution_id, t1.skill_vendor_id) == (world["net"].id, world["cisco"].id)
    assert float(t1.manday_est) == 1.5 and t1.end_date_actual == date.today(), "Done task gets its completion date"
    assert t1.task_code and t1.task_code.endswith(".1")
    assert db.get(Task, out["tasks"][1]["id"]).priority == "Normal"


def test_resync_updates_same_tasks_not_duplicates(db, world):
    first = push(db, world, [task_in(world), task_in(world, who="an", support="han", metric="thamGia", priority="Normal", manday=0.5)])
    ids = {t["externalKey"]: t["id"] for t in first["tasks"]}
    # priority goes up, manday changes; group sent back by id and by key
    second = push(db, world, [task_in(world, priority="Critical", manday=2, pmTaskId=first["tasks"][0]["id"]),
                              task_in(world, who="an", support="han", metric="thamGia", priority="Normal", manday=0.5)],
                  pmGroupId=first["group"]["id"])
    assert second["errors"] == [] and second["group"]["action"] == "updated" and second["group"]["id"] == first["group"]["id"]
    assert {t["externalKey"]: t["id"] for t in second["tasks"]} == ids, "same ids: updated in place"
    assert [t["action"] for t in second["tasks"]] == ["updated", "updated"]
    assert db.query(Task).filter(Task.task_group_id == first["group"]["id"]).count() == 2, "no duplicates"
    t1 = db.get(Task, ids[f"{GKEY}:han:canXemXet"])
    assert (t1.priority, float(t1.manday_est)) == ("Critical", 2.0)
    assert float(db.get(TaskGroup, first["group"]["id"]).manday_est) == 3, "group re-sized to ceil(2 + 0.5)"
    assert db.query(TaskGroup).count() == 1


def test_group_found_by_key_without_id(db, world):
    a = push(db, world, [task_in(world)])
    b = push(db, world, [task_in(world, manday=1)])
    assert a["group"]["id"] == b["group"]["id"] and db.query(TaskGroup).count() == 1


def test_phase_is_created_once_and_reused(db, world):
    from app.models.phase import Phase
    push(db, world, [task_in(world)])
    push(db, world, [task_in(world, manday=1)])
    phases = db.query(Phase).filter(Phase.project_id == world["pid"], Phase.name == ms.DEFAULT_PHASE_NAME).all()
    assert len(phases) == 1


def test_untouched_existing_tasks_keep_consuming_group_budget(db, world):
    push(db, world, [task_in(world, manday=3), task_in(world, who="an", support="han", metric="thamGia", manday=3)])
    # re-send only one task: the other (3 manday) still lives in the group => group stays >= 6
    out = push(db, world, [task_in(world, manday=3)])
    assert out["errors"] == []
    assert float(db.get(TaskGroup, out["group"]["id"]).manday_est) == 6


# ── errors ──

def test_per_task_errors_do_not_block_other_tasks(db, world):
    tasks = [
        task_in(world),                                              # ok
        task_in(world, who="out", support="an", metric="thamGia"),  # assignee not in the project
        task_in(world, who="an", support="an", metric="presaleCheck"),  # support == assignee
        task_in(world, who="an", support="han", metric="x1", skillVendorId=world["palo"].id),  # vendor not in that solution
        task_in(world, who="an", support="han", metric="x2", priority="Interrupt"),
        task_in(world, who="an", support="han", metric="x3", assignee={"email": "nobody@x.vn", "name": "?"}),
    ]
    out = push(db, world, tasks)
    assert [t["externalKey"] for t in out["tasks"]] == [tasks[0]["externalKey"]]
    errs = {e["externalKey"].split(":")[-1]: e["message"] for e in out["errors"]}
    assert "chưa là thành viên của project" in errs["thamGia"]
    assert "khác người được giao" in errs["presaleCheck"]
    assert "Skill" in errs["x1"]
    assert "không hợp lệ" in errs["x2"]
    assert "Không tìm thấy thành viên PM" in errs["x3"]
    assert db.query(Task).filter(Task.task_group_id == out["group"]["id"]).count() == 1, "failed tasks leave nothing behind"


def test_total_manday_over_group_cap_is_rejected_clearly(db, world, status_of):
    tasks = [task_in(world, manday=4), task_in(world, who="an", support="han", metric="thamGia", manday=4), task_in(world, who="an", support="han", metric="presaleCheck", manday=4)]
    with pytest.raises(HTTPException) as e:
        push(db, world, tasks)
    assert e.value.status_code == 400 and "vượt giới hạn" in e.value.detail
    assert db.query(TaskGroup).count() == 0, "nothing created when the week can't fit one Task Group"


def test_request_validation(db, world):
    for bad in (
        {"group": {}, "tasks": [task_in(world)]},
        {"group": {"name": "x", "externalKey": "other:key"}, "tasks": [task_in(world)]},
        {"group": {"name": "x", "externalKey": GKEY}, "tasks": []},
        {"group": {"name": "x", "externalKey": GKEY}, "tasks": [{"externalKey": "bad"}]},
    ):
        with pytest.raises(HTTPException) as e:
            ms.upsert_weekly_kpi(world["pid"], {"week": WEEK, **bad}, db=db)
        assert e.value.status_code == 400
    with pytest.raises(HTTPException) as e:
        ms.upsert_weekly_kpi(99999, body([task_in(world)]), db=db)
    assert e.value.status_code == 404


def test_member_matched_by_email_case_insensitively(db, world):
    t = task_in(world, assignee={"email": "HAN@X.VN", "name": "Han"})
    out = push(db, world, [t])
    assert out["errors"] == [] and db.get(Task, out["tasks"][0]["id"]).assigned_id == world["han"].id
