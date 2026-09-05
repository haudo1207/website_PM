"""Periodic AI digest of Zalo group messages.

Each tick (interval configurable via ZALO_SUMMARY_INTERVAL_SECONDS — a few
minutes while testing, 86400 for real use), every active group conversation
gets its messages since the last summary (or since `interval` ago if it has
none yet) rolled up into one ZaloConversationSummary row: what was discussed,
what tasks/action items came up. Empty windows are skipped — no empty-summary
spam.

Safe under multiple uvicorn workers: each conversation is claimed with a
non-blocking Postgres advisory lock before summarizing, so if two workers'
schedulers fire at the same moment, only one actually calls the AI and writes
the row for a given conversation; the other sees the lock is taken and skips.
"""
import datetime
import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

from .ai_client import chat_completion_json, AiClientError
from ..models.zalo import ZaloAccount, ZaloConversation, ZaloMessage, ZaloConversationSummary

logger = logging.getLogger("zalo_summary")

# Same 3-part shape as the Meeting Intelligence summary
# (services/meeting_sync.py's executive_summary/decisions/recommended_tasks)
# so the two features read consistently and a recommended_tasks entry here
# could later feed the same "push task" flow meetings already have.
SYSTEM_PROMPT = """Bạn là trợ lý tóm tắt hội thoại nhóm công việc trên Zalo.
Đọc đoạn tin nhắn thô (mỗi dòng là "Tên người gửi: nội dung") và trả về JSON THUẦN TÚY
(JSON Object), KHÔNG bọc trong markdown block, KHÔNG thêm câu dẫn:
{
  "executive_summary": "Tóm tắt điều hành 3-6 câu ngắn gọn, chính xác tuyệt đối từ nội dung — nhóm đã bàn luận về gì.",
  "decisions": [
    "Quyết định/thống nhất chính 1 được nhắc tới rõ ràng trong tin nhắn",
    "Quyết định chính 2 (nếu có)"
  ],
  "issues": [
    "Vấn đề/rủi ro/vướng mắc được nhắc tới rõ ràng trong tin nhắn (nếu có)"
  ],
  "next_steps": [
    "Bước tiếp theo/việc cần làm kế tiếp được thống nhất (nếu có)"
  ],
  "recommended_tasks": [
    {
      "detail_task": "Việc/nhiệm vụ cụ thể được nhắc tới",
      "priority": "Critical | High | Normal",
      "assigned_name": "Tên người chịu trách nhiệm nếu tin nhắn nói rõ, ngược lại để rỗng \\"\\"",
      "deadline": "YYYY-MM-DD nếu tin nhắn nói rõ, ngược lại để rỗng \\"\\""
    }
  ]
}
QUY TẮC BẮT BUỘC: KHÔNG bịa quyết định, vấn đề, bước tiếp theo, người phụ trách hay deadline không có
căn cứ trong tin nhắn — để rỗng/mảng rỗng nếu không có. "priority" mặc định "Normal" nếu không có từ
khóa gấp/critical/urgent."""


def _try_claim_conversation(db: Session, conversation_id: int) -> bool:
    """Non-blocking advisory lock scoped to this conversation. Returns True
    if this process claimed it (and must eventually unlock), False if
    another worker already holds it this tick."""
    row = db.execute(
        text("SELECT pg_try_advisory_lock(:key)"),
        {"key": conversation_id},
    ).scalar()
    return bool(row)


def _release_conversation(db: Session, conversation_id: int) -> None:
    db.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": conversation_id})


def summarize_conversation_window(
    db: Session, conversation: ZaloConversation, window_start: datetime.datetime, window_end: datetime.datetime
) -> ZaloConversationSummary | None:
    """Pure logic, no locking — summarizes exactly the given window for one
    conversation. Returns None (and writes nothing) if there are no messages
    in the window. Caller commits."""
    messages = (
        db.query(ZaloMessage)
        .filter(
            ZaloMessage.conversation_id == conversation.id,
            ZaloMessage.created_at > window_start,
            ZaloMessage.created_at <= window_end,
        )
        .order_by(ZaloMessage.created_at.asc())
        .all()
    )
    if not messages:
        return None

    transcript = "\n".join(
        f"{m.sender_name or ('Chúng ta' if m.is_outgoing else 'Không rõ')}: {(m.content or '').strip()}"
        for m in messages
        if (m.content or "").strip()
    )
    if not transcript.strip():
        return None

    try:
        result = chat_completion_json(SYSTEM_PROMPT, transcript, max_tokens=1000, temperature=0.3)
    except AiClientError as e:
        logger.error(f"Zalo summary AI call failed for conversation {conversation.id}: {e}")
        return None

    summary_text = (result.get("executive_summary") or "").strip()
    if not summary_text:
        return None

    decisions = [d for d in (result.get("decisions") or []) if isinstance(d, str) and d.strip()]
    issues = [i for i in (result.get("issues") or []) if isinstance(i, str) and i.strip()]
    next_steps = [n for n in (result.get("next_steps") or []) if isinstance(n, str) and n.strip()]
    tasks = [
        {
            "detail_task": str(t.get("detail_task", "")).strip(),
            "priority": (t.get("priority") or "Normal").strip() or "Normal",
            "assigned_name": (t.get("assigned_name") or "").strip(),
            "deadline": (t.get("deadline") or "").strip(),
        }
        for t in (result.get("recommended_tasks") or [])
        if isinstance(t, dict) and str(t.get("detail_task") or "").strip()
    ]

    row = ZaloConversationSummary(
        conversation_id=conversation.id,
        period_start=window_start,
        period_end=window_end,
        message_count=len(messages),
        content=summary_text,
        decisions=decisions or None,
        issues=issues or None,
        next_steps=next_steps or None,
        recommended_tasks=tasks or None,
    )
    db.add(row)
    db.flush()
    return row


def run_summary_tick(db: Session, interval_seconds: int) -> int:
    """Runs one tick across all group conversations. Returns how many
    summaries were actually created (for logging/testing feedback)."""
    now = datetime.datetime.now(datetime.timezone.utc)
    created = 0

    conversations = (
        db.query(ZaloConversation)
        .join(ZaloAccount, ZaloConversation.account_id == ZaloAccount.id)
        .filter(ZaloConversation.is_group.is_(True), ZaloAccount.is_active.is_(True))
        .all()
    )
    for convo in conversations:
        if not _try_claim_conversation(db, convo.id):
            continue
        try:
            last = (
                db.query(ZaloConversationSummary)
                .filter(ZaloConversationSummary.conversation_id == convo.id)
                .order_by(ZaloConversationSummary.period_end.desc())
                .first()
            )
            window_start = last.period_end if last else now - datetime.timedelta(seconds=interval_seconds)
            if window_start >= now:
                continue
            row = summarize_conversation_window(db, convo, window_start, now)
            if row:
                db.commit()
                created += 1
            else:
                db.rollback()
        except Exception as e:
            db.rollback()
            logger.error(f"Zalo summary tick failed for conversation {convo.id}: {e}")
        finally:
            _release_conversation(db, convo.id)

    return created
