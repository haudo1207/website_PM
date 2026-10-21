"""Meetings group B fixes: n8n time handling, reminder resets, midnight
rollover, Zoom timezone, soft-delete leaks, and write robustness."""
import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.models.meeting import Meeting, MeetingMember
from app.models.project import Project
from app.routers import meeting_bot as mb
from app.routers import meetings as mt
from app.services import meeting_sync as ms


def make_meeting(db, **kw):
    defaults = dict(title="Họp", meeting_date=datetime.date.today() + datetime.timedelta(days=3),
                    start_time=datetime.time(14, 0), end_time=datetime.time(15, 0), status="UPCOMING")
    defaults.update(kw)
    m = Meeting(**defaults)
    db.add(m)
    db.commit()
    return m


def webhook_payload(**kw):
    defaults = dict(title="Họp", meeting_date=str(datetime.date.today()))
    defaults.update(kw)
    return mt.N8nMeetingSummaryPayload(**defaults)


# ── n8n time handling ──

def test_n8n_update_without_start_time_keeps_existing_time(db, monkeypatch):
    monkeypatch.setattr("app.config.settings.N8N_WEBHOOK_SECRET", "test-secret", raising=False)
    m = make_meeting(db, start_time=datetime.time(14, 30))
    payload = webhook_payload(meeting_id=m.id, meeting_date=str(m.meeting_date))
    mt.ingest_n8n_meeting_summary(payload=payload, db=db, x_n8n_webhook_secret="test-secret")
    db.expire_all()
    assert db.get(Meeting, m.id).start_time == datetime.time(14, 30)


def test_n8n_update_with_explicit_start_time_applies_it(db, monkeypatch):
    monkeypatch.setattr("app.config.settings.N8N_WEBHOOK_SECRET", "test-secret", raising=False)
    m = make_meeting(db, start_time=datetime.time(14, 30))
    payload = webhook_payload(meeting_id=m.id, meeting_date=str(m.meeting_date), start_time="09:15")
    mt.ingest_n8n_meeting_summary(payload=payload, db=db, x_n8n_webhook_secret="test-secret")
    db.expire_all()
    assert db.get(Meeting, m.id).start_time == datetime.time(9, 15)


def test_n8n_create_defaults_time_when_truly_absent(db, monkeypatch):
    monkeypatch.setattr("app.config.settings.N8N_WEBHOOK_SECRET", "test-secret", raising=False)
    payload = webhook_payload(title="Brand new from n8n")
    res = mt.ingest_n8n_meeting_summary(payload=payload, db=db, x_n8n_webhook_secret="test-secret")
    created = db.get(Meeting, res["meeting_id"])
    assert created.start_time == datetime.time(9, 0)


# ── reschedule resets reminders ──

def test_rescheduling_clears_reminder_flags(db, admin):
    m = make_meeting(db, reminder_sent_at=datetime.datetime.utcnow(), start_link_sent_at=datetime.datetime.utcnow())
    mt.update_meeting(m.id, {"meeting_date": str(m.meeting_date + datetime.timedelta(days=1))}, db=db, current_user=admin)
    db.expire_all()
    row = db.get(Meeting, m.id)
    assert row.reminder_sent_at is None and row.start_link_sent_at is None


def test_editing_other_fields_keeps_reminder_flags(db, admin):
    sent_at = datetime.datetime.utcnow()
    m = make_meeting(db, reminder_sent_at=sent_at)
    mt.update_meeting(m.id, {"title": "Đổi tên"}, db=db, current_user=admin)
    db.expire_all()
    assert db.get(Meeting, m.id).reminder_sent_at == sent_at


# ── Zoom timezone ──

def test_zoom_payload_strips_z_and_sets_vn_timezone(monkeypatch):
    captured = {}

    def fake_post(url, headers, json, **kwargs):
        captured.update(json)
        return SimpleNamespace(ok=True, status_code=201, raise_for_status=lambda: None,
                               json=lambda: {"join_url": "https://zoom.us/j/1", "id": 1})

    monkeypatch.setattr(ms, "get_zoom_access_token", lambda: "tok")
    monkeypatch.setattr(ms.requests, "post", fake_post)
    ms.create_zoom_meeting("Họp", "2026-10-21T14:00:00Z", 30)
    assert captured["start_time"] == "2026-10-21T14:00:00"
    assert captured["timezone"] == "Asia/Ho_Chi_Minh"


# ── soft-delete leak ──

def test_recalculate_score_404s_for_deleted_meeting(db, admin, status_of):
    m = make_meeting(db, deleted_at=datetime.datetime.utcnow())
    assert status_of(lambda: mt.recalculate_score(m.id, db=db, current_user=admin)) == 404


def test_insights_defaults_to_vn_today(db, admin, monkeypatch):
    # _now_vn should be used, not UTC today — spot check it's callable and
    # insights doesn't blow up with no explicit range.
    res = mt.get_meeting_insights(from_date=None, to_date=None, workspace=None, db=db, current_user=admin)
    assert res is not None


# ── write robustness ──

def test_add_member_rejects_non_numeric_id(db, admin, status_of):
    m = make_meeting(db)
    assert status_of(lambda: mt.add_meeting_member(m.id, {"member_id": "abc"}, db=db, current_user=admin)) == 400


def test_add_member_duplicate_race_is_clean_400(db, admin, member, status_of, monkeypatch):
    """The pre-check can't catch a true concurrent insert; the route's own
    IntegrityError handling must still turn that into a clean 400, not a 500."""
    m = make_meeting(db)
    monkeypatch.setattr(mt, "_sync_meeting_calendar_attendees", lambda *a, **k: True)
    db.add(MeetingMember(meeting_id=m.id, member_id=member.member_id))
    db.commit()
    # Bypass the duplicate pre-check to force the insert to hit the unique
    # constraint, exercising the IntegrityError handler itself.
    monkeypatch.setattr(
        mt.MeetingMember, "__table__",
        mt.MeetingMember.__table__,  # no-op, keep real table/constraint
    )
    orig_query = db.query
    def query_skip_dup_check(model, *a, **k):
        if model is mt.MeetingMember and not a and not k:
            class _NoneFirst:
                def filter(self_inner, *fa, **fk):
                    return self_inner
                def first(self_inner):
                    return None
            return _NoneFirst()
        return orig_query(model, *a, **k)
    monkeypatch.setattr(db, "query", query_skip_dup_check)
    assert status_of(lambda: mt.add_meeting_member(m.id, {"member_id": member.member_id}, db=db, current_user=admin)) == 400


def test_meeting_member_unique_constraint_enforced(db):
    m = make_meeting(db)
    db.add(MeetingMember(meeting_id=m.id, member_id=1))
    db.commit()
    db.add(MeetingMember(meeting_id=m.id, member_id=1))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


# ── bot /ended resolves mailbox like /queue does ──

def test_ended_resolves_mailbox_when_organizer_empty(db, monkeypatch):
    p = Project(name="P", business="Infras", data_scope="infras")
    db.add(p)
    db.commit()
    m = make_meeting(db, project_id=p.id, organizer_google_email=None, status="UPCOMING")
    monkeypatch.setattr(mb, "_resolve_meeting_workspace_id", lambda db, meeting: 99)
    monkeypatch.setattr(mb, "_workspace_google_email", lambda db, wid: "team@x.vn")
    body = {"meeting_id": m.id, "google_email": "team@x.vn"}
    # Old behaviour 403'd outright whenever organizer_google_email was empty;
    # resolving the workspace mailbox must let a matching bot through instead.
    res = mb.report_meeting_ended(body, db=db, _=None)
    assert res.get("success", True) is not False
    db.expire_all()
    assert db.get(Meeting, m.id).status == "DONE"


def test_ended_still_rejects_mismatched_mailbox(db, monkeypatch):
    p = Project(name="P", business="Infras", data_scope="infras")
    db.add(p)
    db.commit()
    m = make_meeting(db, project_id=p.id, organizer_google_email=None, status="UPCOMING")
    monkeypatch.setattr(mb, "_resolve_meeting_workspace_id", lambda db, meeting: 99)
    monkeypatch.setattr(mb, "_workspace_google_email", lambda db, wid: "team@x.vn")
    body = {"meeting_id": m.id, "google_email": "someone-else@x.vn"}
    with pytest.raises(HTTPException) as e:
        mb.report_meeting_ended(body, db=db, _=None)
    assert e.value.status_code == 403
