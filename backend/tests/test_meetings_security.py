"""Meetings security fixes (group A): Google connect state, n8n webhook
secret per Workspace, push-tasks project checks and pushed markers,
participant rules, conflict-check and drive-token leaks."""
import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.config import settings
from app.models.google_token import GoogleOAuthState
from app.models.meeting import Meeting, MeetingMember
from app.models.project import Project
from app.models.system_category import WorkspaceIntegrationSecret
from app.models.user import User
from app.models.workspace_google_account import WorkspaceGoogleAccount
from app.routers import meeting_bot as mb
from app.routers import meetings as mt
from app.routers import system_categories as sc
from app.utils.auth import require_super_admin


def make_meeting(db, **kw):
    defaults = dict(title="Họp", meeting_date=datetime.date.today() + datetime.timedelta(days=3),
                    start_time=datetime.time(10), end_time=datetime.time(11), status="UPCOMING")
    defaults.update(kw)
    m = Meeting(**defaults)
    db.add(m)
    db.commit()
    return m


def make_project(db, name, business, scope):
    p = Project(name=name, business=business, data_scope=scope)
    db.add(p)
    db.commit()
    return p


def make_user(db, uid, role):
    u = User(id=uid, email=f"u{uid}@x.vn", hashed_pw="x", role=role, data_scope="all" if role == "super_admin" else "infras")
    db.add(u)
    db.commit()
    return u


# ── A1: Google connect ──

def test_google_auth_url_is_super_admin_only(leader):
    with pytest.raises(HTTPException) as e:
        require_super_admin(user=leader)
    assert e.value.status_code == 403


def test_google_auth_url_issues_a_one_time_state(db, admin, ws, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "cid", raising=False)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET", "csecret", raising=False)
    monkeypatch.setattr(settings, "GOOGLE_REDIRECT_URI", "http://localhost/cb", raising=False)
    make_user(db, admin.id, "super_admin")
    url = mt.google_auth_url(workspace="infras", db=db, current_user=admin)["auth_url"]
    row = db.query(GoogleOAuthState).one()
    assert f"state={row.state}" in url
    assert len(row.state) >= 32 and row.workspace_id == ws["infras"].id and row.user_id == admin.id


@pytest.mark.parametrize("case", ["missing", "unknown", "expired", "not_admin"])
def test_callback_rejects_bad_state_without_touching_tokens(db, ws, case, monkeypatch):
    import app.main as main
    monkeypatch.setattr(settings, "FRONTEND_URL", "http://fe", raising=False)
    make_user(db, 1, "super_admin")
    make_user(db, 2, "leader")
    state = None
    if case == "unknown":
        state = "not-issued"
    elif case == "expired":
        db.add(GoogleOAuthState(state="old", user_id=1, workspace_id=ws["infras"].id,
                                created_at=datetime.datetime.utcnow() - datetime.timedelta(minutes=30)))
        db.commit()
        state = "old"
    elif case == "not_admin":
        db.add(GoogleOAuthState(state="lead", user_id=2, workspace_id=ws["infras"].id))
        db.commit()
        state = "lead"

    resp = main.google_callback_public(code="attacker-code", state=state, db=db)
    assert "google_error=invalid_state" in resp.headers["location"]
    assert db.query(WorkspaceGoogleAccount).count() == 0
    assert db.query(GoogleOAuthState).count() == 0  # consumed / never stored


def test_state_cannot_be_reused(db, ws, monkeypatch):
    import app.main as main
    monkeypatch.setattr(settings, "FRONTEND_URL", "http://fe", raising=False)
    make_user(db, 1, "super_admin")
    db.add(GoogleOAuthState(state="once", user_id=1, workspace_id=ws["infras"].id))
    db.commit()

    class FakeFlow:
        credentials = SimpleNamespace(token="at", refresh_token="rt")

        @classmethod
        def from_client_config(cls, *a, **k):
            return cls()

        def fetch_token(self, code):
            pass

    monkeypatch.setattr("google_auth_oauthlib.flow.Flow", FakeFlow)
    monkeypatch.setattr("requests.get", lambda *a, **k: SimpleNamespace(ok=True, json=lambda: {"email": "host@x.vn"}))

    first = main.google_callback_public(code="c", state="once", db=db)
    assert "google_connected=true" in first.headers["location"]
    assert db.query(WorkspaceGoogleAccount).filter_by(workspace_id=ws["infras"].id).one().google_email == "host@x.vn"
    second = main.google_callback_public(code="c", state="once", db=db)
    assert "google_error=invalid_state" in second.headers["location"]


def test_public_auth_direct_is_retired():
    import app.main as main
    with pytest.raises(HTTPException) as e:
        main.google_auth_direct_public()
    assert e.value.status_code == 410


# ── A2: n8n webhook secret ──

def test_webhook_fails_closed_when_no_secret_configured(db, monkeypatch):
    monkeypatch.setattr(settings, "N8N_WEBHOOK_SECRET", "", raising=False)
    with pytest.raises(HTTPException) as e:
        mt._authenticate_n8n_webhook(db, "anything")
    assert e.value.status_code == 503


def test_webhook_secret_identifies_workspace(db, ws, monkeypatch):
    monkeypatch.setattr(settings, "N8N_WEBHOOK_SECRET", "global-secret-value-123", raising=False)
    sc._apply_n8n_secret(db, ws["infras"].id, {"n8n_webhook_secret": "infras-secret-value-123"})
    db.commit()
    assert mt._authenticate_n8n_webhook(db, "infras-secret-value-123") == ws["infras"].id
    assert mt._authenticate_n8n_webhook(db, "global-secret-value-123") is None
    for bad in (None, "", "wrong"):
        with pytest.raises(HTTPException) as e:
            mt._authenticate_n8n_webhook(db, bad)
        assert e.value.status_code == 401


def test_workspace_secret_rules_and_never_exposed(db, ws, admin, status_of):
    assert status_of(lambda: sc._apply_n8n_secret(db, ws["infras"].id, {"n8n_webhook_secret": "short"})) == 400
    sc._apply_n8n_secret(db, ws["infras"].id, {"n8n_webhook_secret": "a" * 20})
    db.commit()
    assert status_of(lambda: sc._apply_n8n_secret(db, ws["markee"].id, {"n8n_webhook_secret": "a" * 20})) == 400

    listed = {w.code: w for w in sc.list_workspaces(db=db, current_user=admin)}
    assert listed["infras"].has_n8n_webhook_secret is True
    assert listed["markee"].has_n8n_webhook_secret is False
    assert all("a" * 20 not in str(vars(w)) for w in listed.values())

    sc._apply_n8n_secret(db, ws["infras"].id, {"clear_n8n_webhook_secret": True})
    db.commit()
    assert db.get(WorkspaceIntegrationSecret, ws["infras"].id).n8n_webhook_secret is None


def test_workspace_secret_cannot_touch_other_workspace_meeting(db, ws, monkeypatch):
    monkeypatch.setattr(settings, "N8N_WEBHOOK_SECRET", "", raising=False)
    sc._apply_n8n_secret(db, ws["infras"].id, {"n8n_webhook_secret": "infras-secret-value-123"})
    db.commit()
    mk_project = make_project(db, "Mk", "Markee", "markee")
    other = make_meeting(db, project_id=mk_project.id, title="Markee meeting")
    payload = mt.N8nMeetingSummaryPayload(meeting_id=other.id, title="x", meeting_date=str(other.meeting_date),
                                          start_time="10:00", meeting_url="https://evil.example")
    with pytest.raises(HTTPException) as e:
        mt.ingest_n8n_meeting_summary(payload=payload, db=db, x_n8n_webhook_secret="infras-secret-value-123")
    assert e.value.status_code == 403
    db.expire_all()
    assert db.get(Meeting, other.id).meeting_url is None


# ── A3: push-tasks ──

def recommended(*details):
    return {"recommended_tasks": [{"detail_task": d} for d in details]}


def test_push_skips_inaccessible_project_and_never_uses_first_project(db, leader_infras_only):
    first = make_project(db, "First in DB", "Markee", "markee")
    own = make_project(db, "Own", "Infras", "infras")
    m = make_meeting(db, project_id=None, ai_summary=recommended("A", "B"), created_by=leader_infras_only.member_id)
    res = mt.push_meeting_tasks(m.id, {"tasks": [
        {"detail_task": "A", "source_index": 0},                       # no project at all
        {"detail_task": "B", "source_index": 1, "project_id": first.id},  # other workspace
    ]}, db=db, current_user=leader_infras_only)
    assert res["pushed_count"] == 0
    assert {s["reason"] for s in res["skipped"]} == {"Chưa chọn dự án", "Không có quyền với dự án đã chọn"}

    res = mt.push_meeting_tasks(m.id, {"tasks": [{"detail_task": "A", "source_index": 0, "project_id": own.id}]},
                                db=db, current_user=leader_infras_only)
    assert res["pushed_count"] == 1
    assert res["recommended_tasks"][0]["ai_task_inbox_id"]


def test_push_is_deduped_by_index_even_after_text_edit(db, admin):
    p = make_project(db, "P", "Infras", "infras")
    m = make_meeting(db, project_id=p.id, ai_summary=recommended("Viết báo cáo"))
    mt.push_meeting_tasks(m.id, {"tasks": [{"detail_task": "Viết báo cáo", "source_index": 0}]}, db=db, current_user=admin)
    again = mt.push_meeting_tasks(m.id, {"tasks": [{"detail_task": "Viết báo cáo (sửa)", "source_index": 0}]},
                                  db=db, current_user=admin)
    assert again["pushed_count"] == 0
    assert again["skipped"][0]["reason"] == "Đã đẩy trước đó"


def test_push_tolerates_bad_manday(db, admin):
    p = make_project(db, "P", "Infras", "infras")
    m = make_meeting(db, project_id=p.id, ai_summary=recommended("A"))
    res = mt.push_meeting_tasks(m.id, {"tasks": [{"detail_task": "A", "source_index": 0, "manday_est": "abc"}]},
                                db=db, current_user=admin)
    assert res["pushed_count"] == 1


def test_reingest_keeps_pushed_markers():
    old = {"custom_members": ["Khách"], "recommended_tasks": [
        {"detail_task": "A", "ai_task_inbox_id": 7, "task_code": "T1.1"},
        {"detail_task": "Gone", "ai_task_inbox_id": 8},
    ]}
    merged = mt._merge_pushed_markers(old, {"executive_summary": "new", "recommended_tasks": [{"detail_task": "A"}, {"detail_task": "New"}]})
    by = {t["detail_task"]: t for t in merged["recommended_tasks"]}
    assert by["A"]["ai_task_inbox_id"] == 7 and by["A"]["task_code"] == "T1.1"
    assert by["Gone"]["ai_task_inbox_id"] == 8
    assert "ai_task_inbox_id" not in by["New"]
    assert merged["custom_members"] == ["Khách"]


# ── A4: participants ──

def test_non_manager_cannot_pick_role_or_remove_creator(db, member, leader, assign, monkeypatch):
    p = make_project(db, "P", "Infras", "infras")
    assign(p.id, member.member_id)
    m = make_meeting(db, project_id=p.id, created_by=leader.member_id)
    db.add(MeetingMember(meeting_id=m.id, member_id=leader.member_id, role="HOST"))
    db.commit()
    monkeypatch.setattr(mt, "_sync_meeting_calendar_attendees", lambda *a, **k: True)

    mt.add_meeting_member(m.id, {"member_id": member.member_id, "role": "HOST"}, db=db, current_user=member)
    row = db.query(MeetingMember).filter_by(meeting_id=m.id, member_id=member.member_id).one()
    assert row.role == "PARTICIPANT"

    with pytest.raises(HTTPException) as e:
        mt.remove_meeting_member(m.id, leader.member_id, db=db, current_user=member)
    assert e.value.status_code == 403


def test_manager_keeps_role_choice(db, admin, member, monkeypatch):
    m = make_meeting(db)
    monkeypatch.setattr(mt, "_sync_meeting_calendar_attendees", lambda *a, **k: True)
    mt.add_meeting_member(m.id, {"member_id": member.member_id, "role": "PM"}, db=db, current_user=admin)
    assert db.query(MeetingMember).filter_by(meeting_id=m.id, member_id=member.member_id).one().role == "PM"


def fake_request(method, path, **params):
    return SimpleNamespace(method=method, url=SimpleNamespace(path=path), path_params=params)


def test_access_layer_participant_writes(db, member, leader, assign, status_of):
    """A4 at the router dependency: project members manage participants, a
    plain participant may only remove themselves."""
    from app.utils.access import require_route_project_access
    p = make_project(db, "P", "Infras", "infras")
    m = make_meeting(db, project_id=p.id, created_by=leader.member_id)
    db.add(MeetingMember(meeting_id=m.id, member_id=member.member_id, role="PARTICIPANT"))
    db.add(MeetingMember(meeting_id=m.id, member_id=leader.member_id, role="HOST"))
    db.commit()
    check = lambda req: status_of(lambda: require_route_project_access(req, db=db, user=member))

    # plain participant (not on the project)
    assert check(fake_request("POST", f"/api/meetings/{m.id}/members", id=str(m.id))) == 403
    assert check(fake_request("DELETE", f"/api/meetings/{m.id}/members/{leader.member_id}",
                              id=str(m.id), member_id=str(leader.member_id))) == 403
    assert check(fake_request("DELETE", f"/api/meetings/{m.id}/members/{member.member_id}",
                              id=str(m.id), member_id=str(member.member_id))) == 200

    # once assigned to the meeting's project
    assign(p.id, member.member_id)
    assert check(fake_request("POST", f"/api/meetings/{m.id}/members", id=str(m.id))) == 200


# ── A5: leaks ──

def test_conflict_check_hides_other_teams_title(db, member, admin):
    secret_p = make_project(db, "Secret", "Markee", "markee")
    other = make_meeting(db, project_id=secret_p.id, title="Sáp nhập bí mật", organizer_google_email="mkt.szone@gmail.com")
    body = {"meeting_date": str(other.meeting_date), "start_time": "10:30", "duration": 30}

    seen_by_member = mt.check_meeting_conflict(body, db=db, current_user=member)
    assert seen_by_member["conflict"] is True
    assert "title" not in seen_by_member and "Sáp nhập" not in seen_by_member["message"]

    seen_by_admin = mt.check_meeting_conflict(body, db=db, current_user=admin)
    assert seen_by_admin["title"] == "Sáp nhập bí mật"


def test_drive_token_requires_matching_mailbox(db, monkeypatch):
    m = make_meeting(db, organizer_google_email="host@x.vn")
    monkeypatch.setattr(mb, "get_workspace_google_access_token", lambda db, wid: "tok")
    monkeypatch.setattr(mb, "_get_or_create_recordings_folder", lambda tok: "folder")
    with pytest.raises(HTTPException) as e:
        mb.get_drive_upload_token(meeting_id=m.id, google_email="other@x.vn", db=db, _=None)
    assert e.value.status_code == 403
    ok = mb.get_drive_upload_token(meeting_id=m.id, google_email="HOST@x.vn", db=db, _=None)
    assert ok["access_token"] == "tok"
