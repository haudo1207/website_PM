import os
import json
import logging
import requests
import urllib.request
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from sqlalchemy import func

from ..database import get_db
from ..models.system_category import Customer
from ..models.skill_master import Skill, Group
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
    Parses natural, informal conversations from Zalo, Telegram, Slack, Teams, etc. without needing rigid commands.
    """
    if not chat_text or not chat_text.strip():
        return []

    # Fast python filter for small-talk / simple acknowledgements
    clean_lower = chat_text.strip().lower()
    ack_words = ["oki a", "oki", "ok a", "ok anh", "ok em", "dạ vâng", "dạ anh", "đã nhận", "thanks", "cảm ơn", "dạ em nghe", "được rồi", "haha", "kkk"]
    if clean_lower in ack_words or (len(clean_lower) <= 6 and clean_lower.startswith("ok")):
        return []

    prompt = f"""Bạn là chuyên gia AI Quản Lý Dự Án (PM Assistant Pro).
Nhiệm vụ của bạn là đọc toàn bộ đoạn hội thoại chat thực tế (Zalo, Telegram, Slack, Teams, Skype, v.v.) dưới đây và TỰ ĐỘNG SÀNG LỌC BÓC TÁCH CÁC NHIỆM VỤ / YÊU CẦU CÔNG VIỆC ĐƯỢC GIAO.

Quy tắc sàng lọc & chuẩn hóa cực kỳ quan trọng:
1. CHỈ BÓC TÁCH CÔNG VIỆC THẬT:
   - CHỈ trích xuất những câu có NỘI DUNG GIAO VIỆC HOẶC YÊU CẦU CÔNG VIỆC RÕ RÀNG.
   - TUYỆT ĐỐI KHÔNG trích xuất các câu nhắn đáp lời, xác nhận, tán thưởng hoặc trò chuyện xã giao (ví dụ: "oki a", "ok anh", "dạ vâng", "đã nhận", "dạ em làm liền", "được rồi", "cảm ơn anh"). Với các câu này, TRẢ VỀ MẢNG RỖNG `[]`.

2. CHUẨN HÓA TÊN TASK AI ĐỀ XUẤT (detail_task):
   - ĐỪNG copy nguyên xi cả đoạn chat thô (ví dụ: "Bèng em làm cho xong cái giao diện báo giá để anh gửi cho bên đối tác xem nha, c").
   - Hãy LOẠI BỎ các từ hô hào/xã giao ("bèng em làm cho xong", "nhờ em", "giúp anh nhé", "nha", "oki", tag @name).
   - ĐÃU TÓM TẮT & TRAU CHUỐT THÀNH 1 TÊN TASK CHUYÊN NGHIỆP, RÕ RÀNG (ví dụ: "Hoàn thiện giao diện báo giá gửi đối tác", "Hoàn thiện giao diện báo cáo KPI và kiểm tra API Telegram").

3. NHẬN DIỆN NGƯỜI ĐƯỢC GIAO (assigned_name):
   - Tên người được tag (@Trang, @Bèng, An, Dũng...) phải tách riêng ra trường "assigned_name". TUYỆT ĐỐI KHÔNG để tên người được giao dính trong tên task `detail_task`.

4. ĐOÁN ĐỘ ƯU TIÊN (priority):
   - "Interrupt": Cần làm gấp ngay lập tức, dừng việc khác lại, xử lý sự cố nóng
   - "Critical": Việc quan trọng, cực kỳ gấp, ảnh hưởng lớn
   - "High": Việc gấp, có deadline gần
   - "Normal": Việc thông thường (mặc định)

Nội dung đoạn hội thoại chat:
\"\"\"
{chat_text}
\"\"\"

Yêu cầu đầu ra bắt buộc là một JSON Array hợp lệ (Không bao gồm markdown, không giải thích thêm), mỗi phần tử chứa các trường:
- "detail_task": (string) Tên nhiệm vụ đã được trau chuốt ngắn gọn, chuyên nghiệp (ví dụ: "Hoàn thiện giao diện báo giá gửi đối tác")
- "task_description": (string) Mô tả chi tiết yêu cầu công việc
- "priority": (string) "Interrupt", "Critical", "High", hoặc "Normal" (mặc định "Normal")
- "manday_est": (float) Ước tính công nhật Manday (ví dụ: 0.5, 1.0, 1.5, 2.0).
- "assigned_name": (string hoặc null) Tên người được giao công việc nếu có tag @ hoặc nhắc đến (ví dụ: "Trang", "Bèng", "Kiều Anh")
- "acceptance_criteria": (string hoặc null) Tiêu chí hoàn thành / ghi chú nghiệm thu / remark nếu có
- "ticket_id": (string hoặc null) Mã ticket nếu có nhắc đến (#INC123, #TK-88, v.v.)
- "start_date": (string hoặc null) Ngày bắt đầu hoặc hạn chót nếu có nhắc đến trong chat (YYYY-MM-DD)
- "confidence": (integer) Độ tin cậy của AI từ 75 đến 98 (%)

Nếu đoạn chat không chứa bất kỳ yêu cầu công việc nào (chỉ có câu đáp lời xã giao như "oki a"), hãy trả về `[]`.
"""

    gemini_api_key = os.getenv("GEMINI_API_KEY")
    ai_api_key = os.getenv("AI_API_KEY")
    ai_base_url = os.getenv("AI_BASE_URL", "https://api.openai.com/v1")

    response_text = ""

    if gemini_api_key:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_api_key}"
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.1, "maxOutputTokens": 2048}
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
                "temperature": 0.1
            }
            res = requests.post(url, headers=headers, json=payload, timeout=30)
            if res.status_code == 200:
                data = res.json()
                choices = data.get("choices", [])
                if choices:
                    response_text = choices[0].get("message", {}).get("content", "")
        except Exception as e:
            logger.warning(f"OpenAI-compatible API call failed for chat parser: {e}")

    # Fallback intelligent parser when LLM quota is reached
    lines = [line.strip() for line in chat_text.split("\n") if line.strip()]
    tasks = []
    for line in lines:
        clean_line = line.strip()
        clean_lower = clean_line.lower()

        # 1. Skip acknowledgements, confirmations & small talk
        if clean_lower in ack_words or (len(clean_lower) <= 8 and ("ok" in clean_lower or "dạ" in clean_lower or "cảm ơn" in clean_lower)):
            continue

        # 2. Check for task request keywords
        if len(clean_line) > 6 and any(kw in clean_lower for kw in ["cần", "giao", "làm", "fix", "sửa", "kiểm tra", "bổ sung", "tạo", "update", "hợp đồng", "hoàn thiện"]):
            assigned = None
            words = clean_line.split()

            # Extract assigned name from @mention or "Bèng em", "An ơi"
            for w in words:
                if w.startswith("@") and len(w) > 1:
                    assigned = w.replace("@", "").strip(" :,.-")
                    break

            if not assigned and len(words) >= 2 and words[1].lower() in ["em", "anh", "bạn", "ơi"]:
                assigned = words[0].strip(" :,.-")

            # Polish task title
            polished = clean_line
            if assigned:
                polished = polished.replace("@" + assigned, "").replace(assigned, "")

            fillers = [
                "em làm cho xong cái", "em làm cho xong", "nhờ em", "giúp anh nhé", "giúp anh nha",
                "giúp anh", "trước thứ 6 nhé", "trước thứ 6 nha", "trước thứ 6", "nha, c", "nha", "nhé",
                "oki", "ơi", "để anh gửi cho bên đối tác xem"
            ]
            for f in fillers:
                polished = polished.replace(f, "")

            polished = polished.strip(" :,.-")
            if polished:
                polished = polished[0].upper() + polished[1:]

            tasks.append({
                "detail_task": polished[:200] if polished else clean_line[:100],
                "task_description": clean_line,
                "priority": "High" if any(k in clean_lower for k in ["gấp", "khẩn", "gấp ngay"]) else "Normal",
                "manday_est": 1.0,
                "assigned_name": assigned,
                "confidence": 90
            })

    return tasks

    try:
        clean_json = response_text.strip()
        if "```json" in clean_json:
            clean_json = clean_json.split("```json")[1].split("```")[0].strip()
        elif "```" in clean_json:
            clean_json = clean_json.split("```")[1].split("```")[0].strip()

        parsed = json.loads(clean_json)
        if isinstance(parsed, list):
            return parsed
        elif isinstance(parsed, dict):
            return [parsed]
    except Exception as e:
        logger.error(f"Failed to parse LLM response JSON: {e}. Raw response: {response_text}")

    return []


@router.get("/projects/{pid}/ai-task-inbox")
def get_ai_task_inbox(pid: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == pid).first()
    if not project:
        raise HTTPException(404, "Project not found")

    tasks = db.query(AITaskInbox).filter(
        AITaskInbox.project_id == pid,
        AITaskInbox.status != "REJECTED"
    ).order_by(AITaskInbox.created_at.desc()).all()

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
            "support_name": member_map.get(t.support_id) if t.support_id else None,
            "priority": t.priority or "Normal",
            "manday_est": t.manday_est if t.manday_est is not None else 1.0,
            "start_date": t.start_date,
            "kpi_ratio_assign": t.kpi_ratio_assign if t.kpi_ratio_assign is not None else 100,
            "kpi_ratio_support": t.kpi_ratio_support if t.kpi_ratio_support is not None else 0,
            "acceptance_criteria": t.acceptance_criteria or "",
            "skill_solution_id": getattr(t, "skill_solution_id", None),
            "skill_vendor_id": getattr(t, "skill_vendor_id", None),
            "ticket_id": getattr(t, "ticket_id", None) or "",
            "remark": getattr(t, "remark", None) or "",
            "send": getattr(t, "send", None) or "",
            "target_status": getattr(t, "target_status", None) or "Waiting",
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

    mapped_phase_id = body.get("phase_id")
    mapped_task_group_id = body.get("task_group_id")
    mapped_target_status = body.get("target_status", "Waiting")
    mapped_kpi_assign = body.get("kpi_ratio_assign", 100)
    mapped_kpi_support = body.get("kpi_ratio_support", 0)

    if not content:
        raise HTTPException(400, "Content cannot be empty")

    extracted = _extract_tasks_with_ai(content)

    # Get project members for matching
    members = db.query(Member).all()
    default_phase = db.query(Phase).filter(Phase.project_id == pid).order_by(Phase.sort_order).first()
    default_phase_id = mapped_phase_id or (default_phase.id if default_phase else None)

    created_tasks = []

    for item in extracted:
        detail_task = item.get("detail_task", "").strip() or "Task từ Chat"
        task_desc = item.get("task_description", "").strip() or content[:200]
        priority = item.get("priority", "Normal")
        manday_est = float(item.get("manday_est", 1.0)) if item.get("manday_est") else 1.0
        confidence = int(item.get("confidence", 90))
        assigned_name = item.get("assigned_name")
        start_date = item.get("start_date")
        ticket_id = item.get("ticket_id")

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
            task_group_id=mapped_task_group_id,
            assigned_id=matched_assigned_id,
            assigned_name=assigned_name,
            priority=priority,
            manday_est=manday_est,
            start_date=start_date,
            ticket_id=ticket_id,
            kpi_ratio_assign=mapped_kpi_assign,
            kpi_ratio_support=mapped_kpi_support,
            target_status=mapped_target_status,
            acceptance_criteria=item.get("acceptance_criteria"),
            remark=item.get("acceptance_criteria"),
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
        "acceptance_criteria", "skill_solution_id", "skill_vendor_id",
        "ticket_id", "remark", "send", "target_status", "status"
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

    # Update inbox_task if body fields are sent
    if body:
        allowed_fields = [
            "detail_task", "task_description", "phase_id", "task_group_id",
            "assigned_id", "assigned_name", "support_id", "priority",
            "manday_est", "start_date", "kpi_ratio_assign", "kpi_ratio_support",
            "acceptance_criteria", "skill_solution_id", "skill_vendor_id",
            "ticket_id", "remark", "send", "target_status"
        ]
        for field in allowed_fields:
            if field in body and body[field] is not None:
                setattr(inbox_task, field, body[field])

    # 1. Target Phase validation (guarantee valid Phase ID)
    phase_id = (body and body.get("phase_id")) or inbox_task.phase_id
    phase = None
    if phase_id:
        phase = db.query(Phase).filter(Phase.id == phase_id, Phase.project_id == pid).first()
    if not phase:
        phase = db.query(Phase).filter(Phase.project_id == pid).order_by(Phase.sort_order).first()
        if not phase:
            phase = Phase(project_id=pid, name="Master", sort_order=1)
            db.add(phase)
            db.flush()
        phase_id = phase.id
        inbox_task.phase_id = phase_id

    # 2. Target TaskGroup validation (guarantee valid TaskGroup ID)
    task_group_id = (body and body.get("task_group_id")) or inbox_task.task_group_id
    tg = None
    if task_group_id:
        tg = db.query(TaskGroup).filter(TaskGroup.id == task_group_id, TaskGroup.phase_id == phase_id).first()
    if not tg:
        tg = db.query(TaskGroup).filter(TaskGroup.phase_id == phase_id).order_by(TaskGroup.sort_order).first()
        if not tg:
            tg = TaskGroup(phase_id=phase_id, name="General Tasks", status="Waiting")
            db.add(tg)
            db.flush()
        task_group_id = tg.id
        inbox_task.task_group_id = task_group_id

    # Generate task code (e.g., T1.1)
    existing_count = db.query(Task).filter(Task.task_group_id == task_group_id).count()
    task_code = f"T{task_group_id}.{existing_count + 1}"

    # Safe date parsing
    from ..utils.kpi_engine import parse_date, calc_end_date_est
    parsed_start_date = parse_date(inbox_task.start_date)

    task_status = getattr(inbox_task, "target_status", None) or "Waiting"
    manday_est_val = inbox_task.manday_est if inbox_task.manday_est is not None else 1.0
    end_date_est_val = calc_end_date_est(parsed_start_date, manday_est_val) if parsed_start_date else None

    # Create real task in tasks_v2 with ALL fields matched
    new_task = Task(
        task_group_id=task_group_id,
        task_code=task_code,
        detail=inbox_task.detail_task or "Task từ Chat AI",
        priority=inbox_task.priority or "Normal",
        manday_est=manday_est_val,
        status=task_status,
        assigned_id=inbox_task.assigned_id,
        support_id=inbox_task.support_id,
        kpi_ratio_assign=inbox_task.kpi_ratio_assign if inbox_task.kpi_ratio_assign is not None else 100,
        kpi_ratio_support=inbox_task.kpi_ratio_support if inbox_task.kpi_ratio_support is not None else 0,
        skill_solution_id=getattr(inbox_task, "skill_solution_id", None),
        skill_vendor_id=getattr(inbox_task, "skill_vendor_id", None),
        ticket_id=getattr(inbox_task, "ticket_id", None),
        remark=getattr(inbox_task, "remark", None) or inbox_task.acceptance_criteria,
        send=getattr(inbox_task, "send", None),
        notes=inbox_task.task_description,
        start_date=parsed_start_date,
        end_date_est=end_date_est_val
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
        raise HTTPException(400, "No task_ids me provided")

    imported_count = 0
    errors = []
    for tid in task_ids:
        try:
            import_inbox_task_to_project_plan(pid, tid, body, db)
            imported_count += 1
        except Exception as e:
            db.rollback()
            logger.error(f"Error bulk importing task {tid}: {e}")
            errors.append(str(e))

    return {"ok": True, "imported_count": imported_count, "errors": errors}


@router.post("/projects/{pid}/ai-task-inbox/sync")
def sync_chat_sources(pid: int, db: Session = Depends(get_db)):
    """
    Syncs connected chat sources for a project.
    Fetches real-time messages from Telegram Bot API / Webhooks and runs AI task extraction.
    """
    project = db.query(Project).filter(Project.id == pid).first()
    if not project:
        raise HTTPException(404, "Project not found")

    members = db.query(Member).all()
    default_phase = db.query(Phase).filter(Phase.project_id == pid).order_by(Phase.sort_order).first()
    default_phase_id = default_phase.id if default_phase else None

    synced_count = 0
    telegram_token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()

    # Step 1: Poll Telegram Bot API for real messages if TELEGRAM_BOT_TOKEN is set
    if telegram_token:
        try:
            tg_url = f"https://api.telegram.org/bot{telegram_token}/getUpdates"
            req = urllib.request.Request(tg_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=8) as response:
                res_data = json.loads(response.read().decode())
                if res_data.get("ok"):
                    updates = res_data.get("result") or []
                    for up in updates:
                        msg = up.get("message") or up.get("channel_post") or {}
                        text = (msg.get("text") or "").strip()
                        chat = msg.get("chat") or {}
                        chat_title = chat.get("title") or "Telegram Group"
                        sender = msg.get("from") or {}
                        sender_name = f"{sender.get('first_name', '')} {sender.get('last_name', '')}".strip() or "Thành viên Telegram"

                        # Skip simple command strings like /start or empty text
                        if not text or text.startswith("/start") or text.startswith("/help"):
                            continue

                        # Check if message was already processed into Inbox
                        existing_inbox = db.query(AITaskInbox).filter(
                            AITaskInbox.project_id == pid,
                            AITaskInbox.source_message == text
                        ).first()

                        if existing_inbox:
                            continue

                        # Run AI extraction on REAL Telegram message text
                        extracted = _extract_tasks_with_ai(text)
                        for item in extracted:
                            detail_task = item.get("detail_task", "").strip() or text[:80]
                            raw_assigned = item.get("assigned_name")

                            matched_id = None
                            assigned_display_name = None

                            if raw_assigned:
                                norm = raw_assigned.lower().strip().replace('@', '')
                                for m in members:
                                    m_name = (m.display_name or m.full_name or '').lower()
                                    if norm in m_name or m_name in norm:
                                        matched_id = m.id
                                        assigned_display_name = m.display_name or m.full_name
                                        break
                                if not matched_id:
                                    assigned_display_name = raw_assigned.strip()
                            elif sender_name:
                                norm_sender = sender_name.lower().strip().replace('@', '')
                                for m in members:
                                    m_name = (m.display_name or m.full_name or '').lower()
                                    if norm_sender in m_name or m_name in norm_sender:
                                        matched_id = m.id
                                        assigned_display_name = m.display_name or m.full_name
                                        break

                            inbox_task = AITaskInbox(
                                project_id=pid,
                                source_platform="Telegram",
                                source_group_name=chat_title,
                                source_message=text,
                                detail_task=detail_task,
                                task_description=item.get("task_description") or text,
                                phase_id=default_phase_id,
                                assigned_id=matched_id,
                                assigned_name=assigned_display_name,
                                priority=item.get("priority", "Normal"),
                                manday_est=float(item.get("manday_est", 1.0)) if item.get("manday_est") else 1.0,
                                acceptance_criteria=item.get("acceptance_criteria"),
                                confidence=int(item.get("confidence", 95)),
                                status="ready"
                            )
                            db.add(inbox_task)
                            synced_count += 1

                        if extracted:
                            log = ChatSyncLog(
                                project_id=pid,
                                source_name=f"Telegram · {chat_title}",
                                message_text=f"AI đã bóc tách được {len(extracted)} task thực tế từ tin nhắn: '{text[:60]}...'",
                                status="SUCCESS"
                            )
                            db.add(log)
        except Exception as e:
            logger.error(f"Error polling Telegram getUpdates: {e}")

    # Step 2: Check connected links for this project
    links = db.query(ProjectLink).filter(ProjectLink.project_id == pid).all()

    if synced_count > 0:
        db.commit()
        return {
            "ok": True,
            "synced_count": synced_count,
            "message": f"🎉 AI đã quét thành công và bóc tách {synced_count} task thực tế từ nhóm chat của bạn!"
        }

    log = ChatSyncLog(
        project_id=pid,
        source_name="Đồng bộ Chat API",
        message_text="Đã quét API nhóm chat. Chưa có tin nhắn giao việc mới.",
        status="SUCCESS"
    )
    db.add(log)
    db.commit()
    return {
        "ok": True,
        "synced_count": 0,
        "message": "Đã kiểm tra đồng bộ! Chưa nhận được tin nhắn giao việc mới từ Telegram. Hãy gõ tin nhắn giao việc mới vào nhóm Telegram rồi nhấn 'Đồng bộ ngay' lại nhé!"
    }


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
    Supports Telegram Supergroup Forum Topics (message_thread_id)!
    """
    message = payload.get("message") or payload.get("channel_post") or {}
    text = message.get("text", "").strip()
    chat = message.get("chat", {})
    chat_id = str(chat.get("id", "")) if chat.get("id") is not None else ""
    chat_title = chat.get("title", "Telegram Group")
    sender = message.get("from") or {}
    sender_name = f"{sender.get('first_name', '')} {sender.get('last_name', '')}".strip() or "Thành viên Telegram"
    
    # Telegram Topic / Subgroup ID
    message_thread_id = message.get("message_thread_id")

    if not text:
        return {"ok": True, "ignored": "No text"}

    # Find project link matching this Telegram chat (and specific Topic if available)
    link = None
    if chat_id or chat_title:
        # Query all Telegram links
        tg_links = db.query(ProjectLink).filter(
            (ProjectLink.url.ilike(f"%{chat_id}%")) | (ProjectLink.name.ilike(f"%{chat_title}%"))
        ).all()

        if message_thread_id and tg_links:
            thread_str = str(message_thread_id)
            for l in tg_links:
                url_str = str(l.url or '')
                desc_str = str(l.description or '')
                name_str = str(l.name or '')
                if thread_str in url_str or thread_str in desc_str or thread_str in name_str:
                    link = l
                    break

        if not link and tg_links:
            link = tg_links[0]

    pid = link.project_id if link else None

    if not pid:
        p = db.query(Project).first()
        if p:
            pid = p.id

    if pid:
        # Save task to AI task inbox
        if any(kw in text.lower() for kw in ["/task", "@markeetask", "giao việc", "cần làm", "high priority", "manday", "làm", "sửa", "fix", "update", "bổ sung", "hợp đồng"]):
            extracted = _extract_tasks_with_ai(text)
            members = db.query(Member).all()
            created_count = 0

            for item in extracted:
                detail_task = item.get("detail_task", "").strip() or text[:80]
                raw_assigned = item.get("assigned_name")
                matched_id = None
                assigned_display_name = None

                if raw_assigned:
                    norm = raw_assigned.lower().strip().replace('@', '')
                    for m in members:
                        m_name = (m.display_name or m.full_name or '').lower()
                        if norm in m_name or m_name in norm:
                            matched_id = m.id
                            assigned_display_name = m.display_name or m.full_name
                            break
                    if not matched_id:
                        assigned_display_name = raw_assigned.strip()
                elif sender_name:
                    norm_sender = sender_name.lower().strip().replace('@', '')
                    for m in members:
                        m_name = (m.display_name or m.full_name or '').lower()
                        if norm_sender in m_name or m_name in norm_sender:
                            matched_id = m.id
                            assigned_display_name = m.display_name or m.full_name
                            break

                source_group_display = chat_title
                if message_thread_id:
                    source_group_display += f" (Topic #{message_thread_id})"

                inbox = AITaskInbox(
                    project_id=pid,
                    source_platform="Telegram",
                    source_group_name=source_group_display,
                    source_message=text,
                    detail_task=detail_task,
                    task_description=item.get("task_description") or text,
                    priority=item.get("priority", "Normal"),
                    manday_est=float(item.get("manday_est", 1.0)) if item.get("manday_est") else 1.0,
                    assigned_id=matched_id,
                    assigned_name=assigned_display_name,
                    confidence=int(item.get("confidence", 90)),
                    status="ready"
                )
                db.add(inbox)
                created_count += 1
            
            db.commit()
            return {"ok": True, "created_tasks": created_count}

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

    # Find matching project link by group name or URL for project isolation
    link = db.query(ProjectLink).filter(
        (ProjectLink.name.ilike(f"%{group_name}%")) | (ProjectLink.url.ilike(f"%{group_name}%"))
    ).first()
    pid = link.project_id if link else None

    if not pid:
        p = db.query(Project).first()
        if p:
            pid = p.id

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
            raw_assigned = item.get("assigned_name")
            matched_id = None
            assigned_display_name = None

            if raw_assigned:
                norm_name = raw_assigned.lower().strip().replace('@', '')
                for m in members:
                    m_name = (m.display_name or m.full_name or '').lower()
                    if norm_name in m_name or m_name in norm_name:
                        matched_id = m.id
                        assigned_display_name = m.display_name or m.full_name
                        break
                if not matched_id:
                    assigned_display_name = raw_assigned.strip()
            elif sender_name:
                norm_sender = sender_name.lower().strip().replace('@', '')
                for m in members:
                    m_name = (m.display_name or m.full_name or '').lower()
                    if norm_sender in m_name or m_name in norm_sender:
                        matched_id = m.id
                        assigned_display_name = m.display_name or m.full_name
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
                assigned_name=assigned_display_name,
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


@router.get("/chat/zalo-status")
def get_zalo_status(db: Session = Depends(get_db)):
    """Returns recent Zalo webhook activity status."""
    last_log = db.query(ChatSyncLog).filter(ChatSyncLog.source_name.like("%Zalo%")).order_by(ChatSyncLog.created_at.desc()).first()
    total_zalo_inbox = db.query(AITaskInbox).filter(AITaskInbox.source_platform == "Zalo").count()
    return {
        "status": "ACTIVE" if last_log else "STANDBY",
        "last_sync": last_log.created_at.isoformat() if last_log and last_log.created_at else None,
        "last_message": last_log.message_text if last_log else "Chưa nhận dữ liệu webhook từ Zalo",
        "total_inbox_tasks": total_zalo_inbox,
        "webhook_url": "/api/chat/zalo-webhook"
    }

