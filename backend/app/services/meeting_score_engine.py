"""Meeting effectiveness scoring engine.

Deterministic, rule-based — computed from real meeting/task data, never from an
AI judgment (mirrors the design intent stated in the source prototype: "Điểm
được lấy từ dữ liệu thực tế... không cho người dùng tự chấm"). Structurally
mirrors utils/kpi_engine.py::recalculate_task — a pure mutator called after any
relevant meeting/task-inbox mutation; the caller commits.

Score breakdown (100 total):
  Prep /25 · Execution /15 · Result & KPI Tasks /35 · Follow-through /20 · Feedback /5

Known simplifications (documented, not silently fudged):
  - on_time / required_attendance only use real MeetingMember.joined_at data
    when it exists (from Zoom/Google sync). Meetings with no join-timestamp
    data default to "assume met" since there's nothing to penalize against.
  - "no_reopen" (follow-through) defaults to true once at least one KPI task
    is linked — there's no "meeting reopened" concept yet in the data model.
"""
import datetime


def recalculate_meeting_score(meeting, db):
    from ..models.ai_task_inbox import AITaskInbox
    from ..models.task import Task
    from ..models.meeting_feedback import MeetingFeedback

    ai_summary = meeting.ai_summary if isinstance(meeting.ai_summary, dict) else {}
    decisions = ai_summary.get("decisions") or []
    recommended_tasks = ai_summary.get("recommended_tasks") or []

    # ── 1. Prep /25 ──────────────────────────────────────────────────────
    has_objective = bool(meeting.objective and meeting.objective.strip())
    has_agenda = bool(meeting.agenda and meeting.agenda.strip())
    prep = (
        (2 if meeting.title else 0)
        + (3 if meeting.project_id else 0)
        + (8 if has_objective else 0)
        + (10 if has_agenda else 0)
        + (2 if (meeting.meeting_date and meeting.start_time) else 0)
    )
    if not has_objective or not has_agenda:
        # Gate: missing objective or agenda caps prep at 5/25.
        prep = min(prep, 5)

    # ── 2. Execution /15 ─────────────────────────────────────────────────
    members = list(meeting.members or [])
    required_members = [mm for mm in members if (mm.role or "").upper() in ("HOST", "PM")]
    has_join_data = any(mm.joined_at for mm in members)

    if has_join_data and meeting.meeting_date and meeting.start_time:
        scheduled_dt = datetime.datetime.combine(meeting.meeting_date, meeting.start_time)
        joins = [mm.joined_at for mm in members if mm.joined_at]
        earliest = min(joins) if joins else None
        on_time = bool(earliest and earliest <= scheduled_dt + datetime.timedelta(minutes=5))
        attendance_ok = all(mm.joined_at for mm in required_members) if required_members else True
    else:
        # No real join-timestamp data to measure against — assume met.
        on_time = True
        attendance_ok = True

    has_transcript_or_minutes = bool(
        (meeting.transcript and meeting.transcript.strip()) or ai_summary.get("executive_summary")
    )
    execution = (5 if on_time else 0) + (5 if attendance_ok else 0) + (5 if has_transcript_or_minutes else 0)

    # ── 3. Result & KPI Tasks /35 ────────────────────────────────────────
    inbox_rows = db.query(AITaskInbox).filter(AITaskInbox.meeting_id == meeting.id).all()
    has_decisions = len(decisions) > 0
    has_actions = len(recommended_tasks) > 0
    no_action_ok = bool(meeting.no_action_reason and meeting.no_action_reason.strip()) and has_decisions

    result = (10 if has_decisions else 0) + (5 if (has_actions or no_action_ok) else 0)

    if inbox_rows:
        synced_rows = [r for r in inbox_rows if r.imported_task_id]
        kpi_sync_rate = len(synced_rows) / len(inbox_rows)
        valid_rows = [r for r in inbox_rows if r.project_id and r.assigned_id and r.acceptance_criteria]
        valid_action_rate = len(valid_rows) / len(inbox_rows)
        all_synced = len(synced_rows) == len(inbox_rows)
    elif has_actions:
        # AI extracted actions but none pushed into the inbox yet.
        kpi_sync_rate = 0.0
        valid_action_rate = 0.0
        all_synced = False
    else:
        kpi_sync_rate = 1.0 if no_action_ok else 0.0
        valid_action_rate = 1.0 if no_action_ok else 0.0
        all_synced = True

    result += round(kpi_sync_rate * 10) + round(valid_action_rate * 10)

    gated = has_actions and not all_synced
    if gated:
        # Gate: an action exists but isn't a real synced KPI Task yet.
        result = min(result, 15)

    # ── 4. Follow-through /20 ────────────────────────────────────────────
    synced_task_ids = [r.imported_task_id for r in inbox_rows if r.imported_task_id]
    tasks = db.query(Task).filter(Task.id.in_(synced_task_ids)).all() if synced_task_ids else []
    if tasks:
        rated_tasks = [t for t in tasks if t.days_late is not None]
        on_time_tasks = [t for t in rated_tasks if t.days_late <= 0]
        on_time_rate = (len(on_time_tasks) / len(rated_tasks)) if rated_tasks else 0.0
        followthrough = round(on_time_rate * 15) + 5  # no_reopen: MVP default once tasks are linked
        all_past_due = bool(rated_tasks) and all(
            t.end_date_est and t.end_date_est <= datetime.date.today() for t in tasks
        )
        meeting.score_status = "final" if all_past_due else "provisional"
    else:
        followthrough = 0
        meeting.score_status = "provisional"

    # ── 5. Feedback /5 ───────────────────────────────────────────────────
    feedback_rows = db.query(MeetingFeedback).filter(MeetingFeedback.meeting_id == meeting.id).all()
    if feedback_rows:
        helpful_count = sum(1 for f in feedback_rows if f.helpful)
        feedback = round((helpful_count / len(feedback_rows)) * 5)
    else:
        feedback = 0

    total = prep + execution + result + followthrough + feedback
    if gated:
        # Gate: overall score capped at 69 while any action is unsynced.
        total = min(total, 69)

    meeting.score_prep = prep
    meeting.score_execution = execution
    meeting.score_result = result
    meeting.score_followthrough = followthrough
    meeting.score_feedback = feedback
    meeting.score_total = total
    meeting.last_score_calculated_at = datetime.datetime.utcnow()
    return meeting
