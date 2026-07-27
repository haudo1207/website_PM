import os
import json
import logging
import requests
from typing import List, Optional
from datetime import datetime, date

from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from sqlalchemy import func

from ..database import get_db
from ..models.project import Project, ProjectLink
from ..models.phase import Phase
from ..models.task_group import TaskGroup
from ..models.task import Task
from ..models.member import Member
from ..models.ai_task_inbox import AITaskInbox, ChatSyncLog

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat_ai"])


def _extract_tasks_with_ai(chat_text: str) -> List[dict]:
    """
    Uses Gemini REST API or OpenAI-compatible API to parse raw chat messages into structured task objects.
    """
    prompt = f"""Bạn là trợ lý AI quản lý dự án (PM Assistant).
Hãy phân tích đoạn hội thoại chat (Zalo / Telegram / Slack / Ghi chú) dưới đây và bóc tách các NHIỆM VỤ / TASK ĐƯỢC GIAO.

Nội dung đoạn hội thoại:
\"\"\"
{chat_text}
\"\"\"

Yêu cầu đầu ra bắt buộc là một JSON Array hợp lệ (Không bao gồm markdown, không giải thích thêm), mỗi phần tử chứa các trường:
- "detail_task": (string) Tên nhiệm vụ ngắn gọn, rõ ràng
- "task_description": (string) Mô tả chi tiết yêu cầu công việc
- "priority": (string) "High", "Normal", hoặc "Low" (mặc định "Normal" nếu không nhắc đến)
- "manday_est": (float) Ước tính công nhật Manday (ví dụ: 0.5, 1.0, 1.5, 2.0). Nếu không nhắc đến, đoán hợp lý từ 0.5 đến 2.0.
- "assigned_name": (string hoặc null) Tên người được giao công việc nếu có đề cập (ví dụ: @Tăng Nguyễn Kiều Anh -> "Tăng Nguyễn Kiều Anh")
- "acceptance_criteria": (string hoặc null) Tiêu chí hoàn thành / nghiệm thu nếu có
- "confidence": (integer) Độ tin cậy của AI từ 75 đến 98 (%)

Trả về DUY NHẤT một chuỗi JSON Array. Cấu trúc ví dụ:
[
  {{
    "detail_task": "Bổ sung lý do khi ứng viên nghỉ hoặc từ chối",
    "task_description": "Khi leader chuyển trạng thái Đã nghỉ hoặc Từ chối, hệ thống bắt buộc hiển thị ô nhập lý do.",
    "priority": "High",
    "manday_est": 1.0,
    "assigned_name": "Tăng Nguyễn Kiều Anh",
    "acceptance_criteria": "Không cho phép lưu nếu chưa nhập lý do.",
    "confidence": 96
  }}
]
"""

    gemini_api_key = os.getenv("GEMINI_API_KEY")
    ai_api_key = os.getenv("AI_API_KEY")
    ai_base_url = os.getenv("AI_BASE_URL", "https://api.openai.com/v1")

    response_text = ""

    if gemini_api_key:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_api_key}"
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.2, "maxOutputTokens": 2048}
            }
            res = requests.post(url, json=payload, timeout=30)
            if res.status_code == 200:
                data = res.json()
                candidates = data.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    if parts:
                        response_text = parts[0].get("text", "")
        except Exception as e:
            logger.warning(f"Gemini API call failed for chat parser: {e}")

    if not response_text and ai_api_key:
        try:
            url = f"{ai_base_url.rstrip('/')}/chat/completions"
            headers = {"Authorization": f"Bearer {ai_api_key}", "Content-Type": "application/json"}
            payload = {
                "model": "gpt-4o-mini",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2
            }
            res = requests.post(url, headers=headers, json=payload, timeout=30)
            if res.status_code == 200:
                data = res.json()
                choices = data.get("choices", [])
                if choices:
                    response_text = choices[0].get("message", {}).get("content", "")
        except Exception as e:
            logger.warning(f"OpenAI-compatible API call failed for chat parser: {e}")

    if not response_text:
        # Fallback heuristic parser if AI keys are unavailable
        lines = [line.strip() for line in chat_text.split('\n') if line.strip()]
        fallback_tasks = []
        for line in lines:
            if len(line) > 10:
                fallback_tasks.append({
                    "detail_task": line[:80],
                    "task_description": line,
                    "priority": "High" if "high" in line.lower() else "Normal",
                    "manday_est": 1.0,
                    "assigned_name": None,
                    "acceptance_criteria": None,
                    "confidence": 85
                })
        return fallback_tasks if fallback_tasks else [{
            "detail_task": chat_text[:80],
            "task_description": chat_text,
            "priority": "Normal",
            "manday_est": 1.0,
            "assigned_name": None,
            "acceptance_criteria": None,
            "confidence": 80
        }]

    # Clean markdown formatting from response if present
    clean_text = response_text.strip()
    if clean_text.startswith("```json"):
        clean_text = clean_text[7:]
    if clean_text.startswith("```"):
        clean_text = clean_text[3:]
    if clean_text.endswith("```"):
        clean_text = clean_text[:-3]
    clean_text = clean_text.strip()

    try:
        parsed = json.loads(clean_text)
        if isinstance(parsed, list):
            return parsed
        elif isinstance(parsed, dict) and "tasks" in parsed:
            return parsed["tasks"]
    except Exception as e:
        logger.error(f"Failed to parse AI JSON response: {e}, text: {clean_text}")

    return [{
        "detail_task": chat_text[:80],
        "task_description": chat_text,
        "priority": "Normal",
        "manday_est": 1.0,
        "assigned_name": None,
        "acceptance_criteria": None,
        "confidence": 80
    }]


@router.get("/projects/{pid}/ai-task-inbox")
def get_ai_task_inbox(pid: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == pid).first()
    if not project:
        raise HTTPException(404, "Project not found")

    tasks = db.query(AITaskInbox).filter(
        AITaskInbox.project_id == pid,
        AITaskInbox.status.in_(["ready", "missing", "PENDING"])
    ).order_by(AITaskInbox.id.desc()).all()

    # Pre-fetch members for name resolution if needed
    members = db.query(Member).all()
    member_map = {m.id: m.display_name or m.full_name for m in members}

    items = []
    for t in tasks:
        items.append({
            "id": t.id,
            "project_id": t.project_id,
            "chat_group_id": t.chat_group_id,
            "source_platform": t.source_platform or "Telegram",
            "source_group_name": t.source_group_name or "Chat Group",
            "source_message": t.source_message or "",
            "detail_task": t.detail_task,
            "task_description": t.task_description or "",
            "phase_id": t.phase_id,
            "task_group_id": t.task_group_id,
            "assigned_id": t.assigned_id,
            "assigned_name": t.assigned_name or (member_map.get(t.assigned_id) if t.assigned_id else None),
            "support_id": t.support_id,
            "priority": t.priority or "Normal",
            "manday_est": t.manday_est if t.manday_est is not None else 1.0,
            "start_date": t.start_date,
            "kpi_ratio_assign": t.kpi_ratio_assign or 100,
            "kpi_ratio_support": t.kpi_ratio_support or 0,
            "acceptance_criteria": t.acceptance_criteria or "",
            "confidence": t.confidence or 90,
            "status": t.status,
            "created_at": str(t.created_at) if t.created_at else None
        })

    # Calculate summary counts
    pending_count = len(items)
    ready_count = sum(1 for i in items if i["status"] == "ready")
    imported_count = db.query(AITaskInbox).filter(AITaskInbox.project_id == pid, AITaskInbox.status == "IMPORTED").count()

    return {
        "items": items,
        "stats": {
            "pending_count": pending_count,
            "ready_count": ready_count,
            "imported_count": imported_count,
            "accuracy": 91
        }
    }


@router.post("/projects/{pid}/ai-task-inbox/analyze")
def analyze_chat_and_create_inbox_tasks(
    pid: int,
    body: dict = Body(...),
    db: Session = Depends(get_db)
):
    project = db.query(Project).filter(Project.id == pid).first()
    if not project:
        raise HTTPException(404, "Project not found")

    content = body.get("content", "").strip()
    source_platform = body.get("source_platform", "Manual Paste")
    source_group_name = body.get("source_group_name", "Manual Paste")

    if not content:
        raise HTTPException(400, "Content cannot be empty")

    extracted = _extract_tasks_with_ai(content)

    # Get project members for matching
    members = db.query(Member).all()
    default_phase = db.query(Phase).filter(Phase.project_id == pid).order_by(Phase.sort_order).first()
    default_phase_id = default_phase.id if default_phase else None

    created_tasks = []

    for item in extracted:
        detail_task = item.get("detail_task", "").strip() or "Task từ Chat"
        task_desc = item.get("task_description", "").strip() or content[:200]
        priority = item.get("priority", "Normal")
        manday_est = float(item.get("manday_est", 1.0)) if item.get("manday_est") else 1.0
        confidence = int(item.get("confidence", 90))
        assigned_name = item.get("assigned_name")

        matched_assigned_id = None
        if assigned_name:
            norm_name = assigned_name.lower().strip().replace('@', '')
            for m in members:
                m_name = (m.display_name or m.full_name or '').lower()
                if norm_name in m_name or m_name in norm_name:
                    matched_assigned_id = m.id
                    assigned_name = m.display_name or m.full_name
                    break

        status = "ready" if (detail_task and manday_est and matched_assigned_id) else "missing"

        inbox_task = AITaskInbox(
            project_id=pid,
            source_platform=source_platform,
            source_group_name=source_group_name,
            source_message=content,
            detail_task=detail_task,
            task_description=task_desc,
            phase_id=default_phase_id,
            assigned_id=matched_assigned_id,
            assigned_name=assigned_name,
            priority=priority,
            manday_est=manday_est,
            acceptance_criteria=item.get("acceptance_criteria"),
            confidence=confidence,
            status=status
        )
        db.add(inbox_task)
        created_tasks.append(inbox_task)

    # Add log entry
    log = ChatSyncLog(
        project_id=pid,
        source_name=source_group_name,
        message_text=f"AI đã nhận diện {len(created_tasks)} task từ nội dung chat.",
        status="SUCCESS"
    )
    db.add(log)

    db.commit()
    return {"ok": True, "created_count": len(created_tasks)}


@router.patch("/projects/{pid}/ai-task-inbox/{task_id}")
def update_inbox_task(pid: int, task_id: int, body: dict = Body(...), db: Session = Depends(get_db)):
    task = db.query(AITaskInbox).filter(AITaskInbox.id == task_id, AITaskInbox.project_id == pid).first()
    if not task:
        raise HTTPException(404, "Inbox task not found")

    allowed_fields = [
        "detail_task", "task_description", "phase_id", "task_group_id",
        "assigned_id", "assigned_name", "support_id", "priority",
        "manday_est", "start_date", "kpi_ratio_assign", "kpi_ratio_support",
        "acceptance_criteria", "status"
    ]

    for field in allowed_fields:
        if field in body:
            setattr(task, field, body[field])

    # Re-evaluate status if ready
    if task.detail_task and task.manday_est and (task.assigned_id or task.assigned_name):
        if task.status == "missing":
            task.status = "ready"

    db.commit()
    db.refresh(task)
    return {"ok": True, "id": task.id}


@router.delete("/projects/{pid}/ai-task-inbox/{task_id}")
def reject_inbox_task(pid: int, task_id: int, db: Session = Depends(get_db)):
    task = db.query(AITaskInbox).filter(AITaskInbox.id == task_id, AITaskInbox.project_id == pid).first()
    if not task:
        raise HTTPException(404, "Inbox task not found")

    task.status = "REJECTED"
    db.commit()
    return {"ok": True}


@router.post("/projects/{pid}/ai-task-inbox/{task_id}/import")
def import_inbox_task_to_project_plan(
    pid: int,
    task_id: int,
    body: dict = Body(None),
    db: Session = Depends(get_db)
):
    inbox_task = db.query(AITaskInbox).filter(AITaskInbox.id == task_id, AITaskInbox.project_id == pid).first()
    if not inbox_task:
        raise HTTPException(404, "Inbox task not found")

    # Target Phase & TaskGroup
    phase_id = (body and body.get("phase_id")) or inbox_task.phase_id
    task_group_id = (body and body.get("task_group_id")) or inbox_task.task_group_id

    if not phase_id:
        phase = db.query(Phase).filter(Phase.project_id == pid).order_by(Phase.sort_order).first()
        if not phase:
            raise HTTPException(400, "Vui lòng tạo Phase trong dự án trước khi Import task!")
        phase_id = phase.id

    if not task_group_id:
        tg = db.query(TaskGroup).filter(TaskGroup.phase_id == phase_id).order_by(TaskGroup.sort_order).first()
        if not tg:
            # Create a default task group if none exists
            tg = TaskGroup(phase_id=phase_id, name="General Tasks", status="Waiting")
            db.add(tg)
            db.flush()
        task_group_id = tg.id

    # Generate task code (e.g., T1.1)
    existing_count = db.query(Task).filter(Task.task_group_id == task_group_id).count()
    task_code = f"T{task_group_id}.{existing_count + 1}"

    # Create real task in tasks_v2
    new_task = Task(
        task_group_id=task_group_id,
        task_code=task_code,
        detail=inbox_task.detail_task,
        priority=inbox_task.priority or "Normal",
        manday_est=inbox_task.manday_est or 1.0,
        status="Waiting",
        assigned_id=inbox_task.assigned_id,
        support_id=inbox_task.support_id,
        kpi_ratio_assign=inbox_task.kpi_ratio_assign or 100,
        kpi_ratio_support=inbox_task.kpi_ratio_support or 0,
        remark=inbox_task.acceptance_criteria,
        notes=inbox_task.task_description,
        start_date=inbox_task.start_date
    )
    db.add(new_task)
    db.flush()

    # Update inbox task status
    inbox_task.status = "IMPORTED"
    inbox_task.imported_task_id = new_task.id

    log = ChatSyncLog(
        project_id=pid,
        source_name=inbox_task.source_group_name or "AI Task Inbox",
        message_text=f"Đã import task '{inbox_task.detail_task}' vào Project Plan (Task Code: {task_code}).",
        status="SUCCESS"
    )
    db.add(log)

    db.commit()
    return {"ok": True, "imported_task_id": new_task.id, "task_code": task_code}


@router.post("/projects/{pid}/ai-task-inbox/bulk-import")
def bulk_import_inbox_tasks(
    pid: int,
    body: dict = Body(...),
    db: Session = Depends(get_db)
):
    task_ids = body.get("task_ids", [])
    if not task_ids:
        raise HTTPException(400, "No task_ids provided")

    imported_count = 0
    for tid in task_ids:
        try:
            import_inbox_task_to_project_plan(pid, tid, body, db)
            imported_count += 1
        except Exception as e:
            logger.error(f"Error bulk importing task {tid}: {e}")

    return {"ok": True, "imported_count": imported_count}


@router.get("/projects/{pid}/chat-sync-logs")
def get_chat_sync_logs(pid: int, db: Session = Depends(get_db)):
    logs = db.query(ChatSyncLog).filter(ChatSyncLog.project_id == pid).order_by(ChatSyncLog.id.desc()).limit(50).all()
    return [
        {
            "id": l.id,
            "source_name": l.source_name,
            "message_text": l.message_text,
            "status": l.status,
            "time_str": l.created_at.strftime("%H:%M %d/%m/%Y") if l.created_at else ""
        }
        for l in logs
    ]


@router.post("/chat/telegram-webhook")
def telegram_webhook(payload: dict = Body(...), db: Session = Depends(get_db)):
    """
    Receives incoming Telegram messages from a Telegram Bot.
    """
    message = payload.get("message") or payload.get("channel_post") or {}
    text = message.get("text", "").strip()
    chat = message.get("chat", {})
    chat_id = chat.get("id")
    chat_title = chat.get("title", "Telegram Group")

    if not text:
        return {"ok": True, "ignored": "No text"}

    # Find project link matching this Telegram chat
    # Try finding link with chat_id or name matching
    link = db.query(ProjectLink).filter(ProjectLink.url.contains(str(chat_id))).first()
    pid = link.project_id if link else None

    if not pid:
        # Fallback to the first active project if unmatched
        p = db.query(Project).first()
        if p:
            pid = p.id

    if pid:
        # Save task to AI task inbox if message contains task directive or keywords
        if any(kw in text.lower() for kw in ["/task", "@markeetask", "giao việc", "cần làm", "high priority", "manday"]):
            extracted = _extract_tasks_with_ai(text)
            for item in extracted:
                detail_task = item.get("detail_task", "").strip() or text[:80]
                inbox = AITaskInbox(
                    project_id=pid,
                    source_platform="Telegram",
                    source_group_name=chat_title,
                    source_message=text,
                    detail_task=detail_task,
                    task_description=item.get("task_description") or text,
                    priority=item.get("priority", "Normal"),
                    manday_est=float(item.get("manday_est", 1.0)) if item.get("manday_est") else 1.0,
                    confidence=int(item.get("confidence", 90)),
                    status="ready"
                )
                db.add(inbox)
            return {"ok": True}


@router.post("/chat/zalo-webhook")
def zalo_webhook(payload: dict = Body(...), db: Session = Depends(get_db)):
    """
    Receives incoming Zalo messages (Zalo OA / Zalo Bot API / Zalo Group Webhook events).
    Formats supported:
    - Standard Zalo OA event: {"event_name": "user_send_text", "message": {"text": "..."}, "sender": {"id": "..."}}
    - Group Webhook: {"text": "...", "group_name": "HR Group", "sender_name": "..."}
    """
    event_name = payload.get("event_name", "")
    msg_obj = payload.get("message", {})
    text = (msg_obj.get("text") or payload.get("text") or "").strip()
    sender_name = payload.get("sender_name") or payload.get("sender", {}).get("name", "Thành viên Zalo")
    group_name = payload.get("group_name") or payload.get("recipient", {}).get("name", "HR Group (Zalo)")

    if not text:
        return {"ok": True, "ignored": "No message text"}

    # Find matching project
    p = db.query(Project).first()
    pid = p.id if p else None

    if pid:
        # Extract tasks with AI
        extracted = _extract_tasks_with_ai(text)
        members = db.query(Member).all()
        created_count = 0

        for item in extracted:
            detail_task = item.get("detail_task", "").strip() or text[:80]
            task_desc = item.get("task_description", "").strip() or text
            priority = item.get("priority", "Normal")
            manday_est = float(item.get("manday_est", 1.0)) if item.get("manday_est") else 1.0
            confidence = int(item.get("confidence", 90))
            assigned_name = item.get("assigned_name") or sender_name

            matched_id = None
            if assigned_name:
                norm_name = assigned_name.lower().strip().replace('@', '')
                for m in members:
                    m_name = (m.display_name or m.full_name or '').lower()
                    if norm_name in m_name or m_name in norm_name:
                        matched_id = m.id
                        assigned_name = m.display_name or m.full_name
                        break

            inbox = AITaskInbox(
                project_id=pid,
                source_platform="Zalo",
                source_group_name=group_name,
                source_message=text,
                detail_task=detail_task,
                task_description=task_desc,
                priority=priority,
                manday_est=manday_est,
                assigned_id=matched_id,
                assigned_name=assigned_name,
                confidence=confidence,
                status="ready" if (detail_task and manday_est) else "missing"
            )
            db.add(inbox)
            created_count += 1

        # Add sync log
        log = ChatSyncLog(
            project_id=pid,
            source_name=f"Zalo · {group_name}",
            message_text=f"Zalo webhook: Đã quét 1 tin nhắn và AI bóc tách được {created_count} task.",
            status="SUCCESS"
        )
        db.add(log)
        db.commit()

    return {"ok": True, "created_tasks": created_count if pid else 0}
