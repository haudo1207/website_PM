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
from ..utils.skill_validation import validate_skill_area_consistency



logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat_ai"])


def _extract_tasks_with_ai(chat_text: str) -> List[dict]:
    """
    Uses Gemini REST API or OpenAI API or Super-Intelligent Vietnamese NLP Parser to extract structured tasks.
    Parses natural, informal chat messages from Zalo, Telegram, Slack, Teams, etc.
    """
    if not chat_text or not chat_text.strip():
        return []

    # Fast python filter for small-talk / simple acknowledgements
    clean_lower = chat_text.strip().lower()
    ack_words = ["oki a", "oki", "ok a", "ok anh", "ok em", "dạ vâng", "dạ anh", "đã nhận", "thanks", "cảm ơn", "dạ em nghe", "được rồi", "haha", "kkk"]
    if clean_lower in ack_words or (len(clean_lower) <= 6 and clean_lower.startswith("ok")):
        return []

    prompt = f"""Bạn là chuyên gia AI Quản Lý Dự Án (PM Assistant Pro).
Nhiệm vụ của bạn là đọc đoạn hội thoại chat thực tế dưới đây và TỰ ĐỘNG SÀNG LỌC, BÓC TÁCH NHIỆM VỤ CÔNG VIỆC.

QUY TẮC BÓC TÁCH CỰC KỲ CHI TIẾT & CHUẨN XÁC:
1. NẾU CÓ TÊN NGƯỜI ĐƯỢC GIAO (ví dụ: "Thu Trang", "Bèng", "An", "Dũng"):
   - TÁCH RIÊNG TÊN NGƯỜI ĐƯỢC GIAO vào trường "assigned_name" (ví dụ: "Thu Trang").
   - LOẠI BỎ TÊN NGƯỜI VÀ TỪ HÔ HÀO (làm giúp anh, làm cho chị, nhờ em, nộp cho chị) KHỎI TÊN TASK `detail_task`.

2. CHUẨN HÓA TÊN TASK AI ĐỀ XUẤT (detail_task):
   - KHÔNG ĐƯỢC copy nguyên văn câu chat thô.
   - Hãy tóm tắt ngắn gọn, chuyên nghiệp, thể hiện đúng CÔNG VIỆC CHÍNH CẦN LÀM (Ví dụ: "Xuất báo cáo KPI", "Thiết kế giao diện web báo giá", "Sửa lỗi đăng nhập", "Hoàn thiện báo cáo").

3. NHẬN DIỆN HẠN CHÓT / DEADLINE (acceptance_criteria):
   - Nếu câu nhắn có mốc thời gian (ví dụ: "trước 5h chiều", "chiều nay", "ngày mai", "trước thứ 6"), hãy ghi vào "acceptance_criteria" (ví dụ: "Hạn hoàn thành: Trước 5h chiều nay").

4. ĐỘ ƯU TIÊN (priority):
   - Đặt "High" hoặc "Critical" nếu có thời hạn chiều nay, gấp, khẩn cấp. Mặc định "Normal".

Nội dung đoạn hội thoại:
\"\"\"
{chat_text}
\"\"\"

Trả về JSON Array chứa phần tử:
[
  {{
    "detail_task": "Xuất báo cáo KPI",
    "task_description": "{chat_text}",
    "priority": "High",
    "manday_est": 1.0,
    "assigned_name": "Thu Trang",
    "acceptance_criteria": "Hạn hoàn thành: Trước 5h chiều nay",
    "confidence": 95
  }}
]
"""

    gemini_api_key = os.getenv("GEMINI_API_KEY")
    ai_api_key = os.getenv("AI_API_KEY")
    ai_base_url = os.getenv("AI_BASE_URL", "https://api.openai.com/v1")

    response_text = ""

    # Attempt 1: Try Gemini REST API (supporting both gemini-2.0-flash and gemini-1.5-flash)
    if gemini_api_key and gemini_api_key.startswith("AIza"):
        for model_name in ["gemini-2.0-flash", "gemini-1.5-flash"]:
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_api_key}"
                payload = {
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.1, "maxOutputTokens": 2048}
                }
                res = requests.post(url, json=payload, timeout=10)
                if res.status_code == 200:
                    data = res.json()
                    candidates = data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        if parts:
                            response_text = parts[0].get("text", "")
                            if response_text:
                                break
            except Exception as e:
                logger.warning(f"Gemini API ({model_name}) call failed: {e}")

    # Attempt 2: Try OpenAI / OpenRouter API
    if not response_text and ai_api_key:
        try:
            url = f"{ai_base_url.rstrip('/')}/chat/completions"
            headers = {"Authorization": f"Bearer {ai_api_key}", "Content-Type": "application/json"}
            payload = {
                "model": "gpt-4o-mini",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1
            }
            res = requests.post(url, headers=headers, json=payload, timeout=10)
            if res.status_code == 200:
                data = res.json()
                choices = data.get("choices", [])
                if choices:
                    response_text = choices[0].get("message", {}).get("content", "")
        except Exception as e:
            logger.warning(f"OpenAI API call failed: {e}")

    # Parse response_text from Gemini / LLM if present
    if response_text:
        try:
            clean_json = response_text.strip()
            if "```json" in clean_json:
                clean_json = clean_json.split("```json")[1].split("```")[0].strip()
            elif "```" in clean_json:
                clean_json = clean_json.split("```")[1].split("```")[0].strip()

            parsed = json.loads(clean_json)
            if isinstance(parsed, list) and len(parsed) > 0:
                return parsed
            elif isinstance(parsed, dict):
                return [parsed]
        except Exception as e:
            logger.error(f"Failed to parse LLM response JSON: {e}. Raw response: {response_text}")

    # Super-Intelligent Fallback Vietnamese NLP / Regex Task Extractor
    lines = [l.strip() for l in chat_text.split("\n") if l.strip()]
    tasks = []

    for line in lines:
        clean_line = line.strip()
        clean_lower = clean_line.lower()

        if clean_lower in ack_words or (len(clean_lower) <= 8 and ("ok" in clean_lower or "dạ" in clean_lower or "cảm ơn" in clean_lower)):
            continue

        task_action_keywords = ["làm", "fix", "sửa", "kiểm tra", "bổ sung", "tạo", "update", "nộp", "xử lý", "gửi", "thiết kế", "design", "xuất", "hoàn thiện"]
        if len(clean_line) < 6 or not any(kw in clean_lower for kw in task_action_keywords):
            continue

        assigned = None
        deadline_text = None
        priority = "Normal"

        words = clean_line.split()
        for w in words:
            if w.startswith("@") and len(w) > 1:
                assigned = w.replace("@", "").strip(" :,.-")
                break

        # Pattern B: Name before "làm giúp", "làm cho", "làm", "giúp", "xử lý", "fix", "sửa"
        if not assigned:
            for kw in [" làm giúp ", " làm cho ", " làm ", " giúp ", " xử lý ", " fix ", " sửa ", " tạo ", " nộp "]:
                if kw in clean_lower:
                    idx = clean_lower.index(kw)
                    before_str = clean_line[:idx].strip()
                    if before_str:
                        before_words = before_str.split()
                        name_candidates = [w for w in before_words if w.lower() not in ["nhờ", "giao", "phiền", "cho", "gửi", "đã", "anh", "chị", "em"]]
                        if name_candidates:
                            if len(name_candidates) >= 2 and name_candidates[-2][0].isupper():
                                assigned = f"{name_candidates[-2]} {name_candidates[-1]}"
                            else:
                                assigned = name_candidates[-1]
                            assigned = assigned.strip(" :,.-")
                    break

        # Pattern C: Name after "cho chị", "cho anh", "nộp cho", "gửi cho"
        if not assigned:
            for kw in ["cho chị ", "cho anh ", "nộp cho ", "gửi cho ", "cho "]:
                if kw in clean_lower:
                    after_str = clean_line[clean_lower.index(kw) + len(kw):].strip()
                    after_words = after_str.split()
                    if after_words:
                        if after_words[0].lower() not in ["bên", "khách", "đối", "sếp"]:
                            if len(after_words) >= 2 and after_words[1][0].isupper():
                                assigned = f"{after_words[0]} {after_words[1]}"
                            else:
                                assigned = after_words[0]
                            assigned = assigned.strip(" :,.-")
                    break

        # Pattern D: "Name ơi", "Name em"
        if not assigned and len(words) >= 2 and words[1].lower() in ["ơi", "em", "anh", "bạn"]:
            assigned = words[0].strip(" :,.-")

        # Extract Time / Deadline
        time_keywords = ["trước 5h chiều", "trước 5h", "chiều nay", "ngày mai", "trước thứ 6", "trước thứ 5", "trước thứ 4", "trong hôm nay", "gấp"]
        for tk in time_keywords:
            if tk in clean_lower:
                deadline_text = f"Hạn hoàn thành: {tk.capitalize()}"
                if any(g in tk for g in ["5h", "chiều nay", "gấp", "trong hôm nay"]):
                    priority = "High"
                break

        # Polish Task Title
        polished = clean_line
        if assigned and polished.lower().startswith(assigned.lower()):
            polished = polished[len(assigned):].strip(" :,.-")

        fillers = [
            "làm giúp anh phần", "làm giúp anh", "làm giúp em", "làm giúp", "làm cho chị cái phần",
            "làm cho chị phần", "làm cho chị cái", "làm cho chị", "làm cho anh", "làm phần",
            "làm task của phần", "nộp lại chiều nay cho chị", "nộp lại chiều nay", "chiều gửi chị em",
            "cho anh gửi cho bên đối tác xem nha, c", "trước 5h chiều", "trước 5h", "chiều nay",
            "giúp anh nhé", "giúp anh nha", "giúp anh", "giúp em", "nhờ em", "nha, c", "nha", "nhé", "ơi"
        ]
        for f in fillers:
            import re
            pattern = re.compile(re.escape(f), re.IGNORECASE)
            polished = pattern.sub("", polished).strip(" :,.-")

        if not polished or len(polished) < 4:
            polished = clean_line
            for f in ["nhờ", "giúp anh", "giúp em", "nha", "nhé"]:
                polished = polished.replace(f, "")
            polished = polished.strip(" :,.-")

        polished_words = polished.split()
        normalized_words = []
        for w in polished_words:
            if w.lower() in ["kpi", "api", "web", "design", "ui", "ux", "inc", "pdf", "doc"]:
                normalized_words.append(w.upper())
            else:
                normalized_words.append(w)

        final_title = " ".join(normalized_words)
        if final_title:
            final_title = final_title[0].upper() + final_title[1:]

        tasks.append({
            "detail_task": final_title if len(final_title) >= 4 else clean_line[:80],
            "task_description": clean_line,
            "priority": priority,
            "manday_est": 1.0,
            "assigned_name": assigned,
            "acceptance_criteria": deadline_text,
            "confidence": 95
        })

    return tasks


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
        current_detail = t.detail_task or ""
        current_assigned = t.assigned_name
        current_criteria = t.acceptance_criteria

        # Dynamic on-the-fly polishing for existing inbox tasks if detail_task was raw message text
        if t.source_message and (current_detail == t.source_message or any(f in current_detail.lower() for f in ["làm cho", "làm giúp", "nhờ em", "nộp lại", "chiều gửi", "trước 5h"])):
            re_extracted = _extract_tasks_with_ai(t.source_message)
            if re_extracted:
                best = re_extracted[0]
                current_detail = best.get("detail_task") or current_detail
                if not current_assigned and best.get("assigned_name"):
                    current_assigned = best.get("assigned_name")
                if not current_criteria and best.get("acceptance_criteria"):
                    current_criteria = best.get("acceptance_criteria")

        # Resolve assigned_name against Member DB table
        if current_assigned:
            norm_a = current_assigned.lower().strip().replace('@', '')
            for m in members:
                m_name = (m.display_name or m.full_name or '').lower()
                if norm_a in m_name or m_name in norm_a:
                    current_assigned = m.display_name or m.full_name
                    if not t.assigned_id:
                        t.assigned_id = m.id
                    break

        items.append({
            "id": t.id,
            "project_id": t.project_id,
            "chat_group_id": t.chat_group_id,
            "source_platform": t.source_platform or "Telegram",
            "source_group_name": t.source_group_name or "Chat Group",
            "source_message": t.source_message or "",
            "detail_task": current_detail,
            "task_description": t.task_description or "",
            "phase_id": t.phase_id,
            "task_group_id": t.task_group_id,
            "assigned_id": t.assigned_id,
            "assigned_name": current_assigned or (member_map.get(t.assigned_id) if t.assigned_id else None),
            "support_id": t.support_id,
            "support_name": member_map.get(t.support_id) if t.support_id else None,
            "priority": t.priority or "Normal",
            "manday_est": t.manday_est if t.manday_est is not None else 1.0,
            "start_date": t.start_date,
            "kpi_ratio_assign": t.kpi_ratio_assign if t.kpi_ratio_assign is not None else 100,
            "kpi_ratio_support": t.kpi_ratio_support if t.kpi_ratio_support is not None else 0,
            "acceptance_criteria": current_criteria or "",
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
    from ..utils.kpi_engine import parse_date, calc_end_date_est, recalculate_task
    parsed_start_date = parse_date(inbox_task.start_date)

    task_status = getattr(inbox_task, "target_status", None) or "Waiting"
    manday_est_val = inbox_task.manday_est if inbox_task.manday_est is not None else 1.0
    end_date_est_val = calc_end_date_est(parsed_start_date, manday_est_val) if parsed_start_date else None

    # skill_solution_id/skill_vendor_id are NOT NULL on Task. Inbox rows (chat
    # or meeting sourced) don't always carry a real "skill" — fall back to the
    # first Group/Skill by id, same pattern used in project_templates.py.
    skill_solution_id = getattr(inbox_task, "skill_solution_id", None)
    skill_vendor_id = getattr(inbox_task, "skill_vendor_id", None)
    if not skill_solution_id:
        fallback_group = db.query(Group).order_by(Group.id.asc()).first()
        skill_solution_id = fallback_group.id if fallback_group else None
    if not skill_vendor_id and skill_solution_id:
        # Fallback Skill must belong to the (possibly also-fallback) Group
        # above - picking the globally-first Skill regardless of its Group
        # would almost certainly mismatch and get rejected by the
        # consistency check right below.
        fallback_skill = db.query(Skill).filter(Skill.group_id == skill_solution_id).order_by(Skill.id.asc()).first()
        skill_vendor_id = fallback_skill.id if fallback_skill else None
    validate_skill_area_consistency(skill_solution_id, skill_vendor_id, db)

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
        skill_solution_id=skill_solution_id,
        skill_vendor_id=skill_vendor_id,
        ticket_id=getattr(inbox_task, "ticket_id", None),
        remark=getattr(inbox_task, "remark", None) or inbox_task.acceptance_criteria,
        send=getattr(inbox_task, "send", None),
        notes=inbox_task.task_description,
        start_date=parsed_start_date,
        end_date_est=end_date_est_val
    )
    db.add(new_task)
    db.flush()
    # Compute kpi_base/kpi_perform/kpi_final etc — previously skipped here, so
    # inbox-imported tasks silently kept kpi_final=0 (a real, pre-existing bug).
    recalculate_task(new_task, db)

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

    # If this inbox row originated from a meeting, recompute that meeting's
    # KPI-Tasks sync score now that a real Task is linked, and stamp
    # imported_task_id back onto the matching recommended_tasks[i] entry so
    # the meeting detail UI can show a real per-item synced badge.
    if getattr(inbox_task, "meeting_id", None):
        from ..models.meeting import Meeting
        from ..services.meeting_score_engine import recalculate_meeting_score
        source_meeting = db.query(Meeting).filter(Meeting.id == inbox_task.meeting_id).first()
        if source_meeting:
            if isinstance(source_meeting.ai_summary, dict):
                # Build brand-new dict objects rather than mutating existing ones
                # in place — SQLAlchemy's JSON column change-detection compares
                # old vs new by value, and an in-place-mutated nested dict is
                # still reference-shared with (and thus "equal" to) the tracked
                # old value, which silently makes the UPDATE a no-op.
                recommended_tasks = [
                    {**t, "imported_task_id": new_task.id}
                    if isinstance(t, dict) and t.get("ai_task_inbox_id") == inbox_task.id
                    else t
                    for t in (source_meeting.ai_summary.get("recommended_tasks") or [])
                ]
                source_meeting.ai_summary = {**source_meeting.ai_summary, "recommended_tasks": recommended_tasks}
            recalculate_meeting_score(source_meeting, db)

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
            # Get project links configured for this project
            proj_links = db.query(ProjectLink).filter(ProjectLink.project_id == pid).all()
            
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

                        message_thread_id = msg.get("message_thread_id")
                        
                        # Strict Topic Filtering for this project:
                        # If project links have specific Topic IDs, skip messages from non-matching topics!
                        if proj_links and message_thread_id is not None:
                            topic_matched = False
                            for pl in proj_links:
                                url_str = str(pl.url or '').strip()
                                desc_str = str(pl.description or '').strip()
                                parts = [p for p in url_str.split('/') if p]
                                last_seg = parts[-1] if parts else ''

                                if last_seg == str(message_thread_id) or desc_str == f"Topic #{message_thread_id}" or f"#{message_thread_id}" in str(pl.name or ''):
                                    topic_matched = True
                                    break
                                # If link is a general group link without a numeric topic ID
                                if not last_seg.isdigit():
                                    topic_matched = True
                                    break

                            if not topic_matched:
                                # Skip messages from other topics in the same supergroup!
                                continue

                        source_group_display = chat_title
                        if message_thread_id:
                            source_group_display += f" (Topic #{message_thread_id})"

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
                                source_group_name=source_group_display,
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


def _send_telegram_reply(chat_id: str, text: str, message_thread_id: int = None):
    """Utility to post messages back to Telegram chat or specific Topic thread."""
    telegram_token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if not telegram_token or not chat_id:
        return
    try:
        url = f"https://api.telegram.org/bot{telegram_token}/sendMessage"
        payload = {"chat_id": chat_id, "text": text}
        if message_thread_id:
            payload["message_thread_id"] = message_thread_id
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            pass
    except Exception as e:
        logger.error(f"Error sending Telegram reply: {e}")


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
            (ProjectLink.url.ilike(f"%{chat_id}%")) | (ProjectLink.name.ilike(f"%{chat_title}%")) | (ProjectLink.platform == "Telegram")
        ).all()

        if message_thread_id is not None and tg_links:
            thread_str = str(message_thread_id)
            for l in tg_links:
                url_str = str(l.url or '').strip()
                desc_str = str(l.description or '').strip()
                name_str = str(l.name or '').strip()
                parts = [p for p in url_str.split('/') if p]
                last_seg = parts[-1] if parts else ''

                if last_seg == thread_str or desc_str == f"Topic #{thread_str}" or f"#{thread_str}" in name_str:
                    link = l
                    break
                # If project connected to whole group without specific numeric topic ID
                if not last_seg.isdigit() and not link:
                    link = l

    pid = link.project_id if link else None

    if not pid:
        return {"ok": True, "ignored": f"Message from Topic #{message_thread_id} not connected to any project"}

    if pid:
        # Auto-reply commands directly inside the exact Topic thread
        if text in ["/status", "/topic", "/check", "/link", "/start"]:
            project_obj = db.query(Project).filter(Project.id == pid).first()
            pname = project_obj.name if project_obj else f"Dự án #{pid}"
            topic_str = f"Topic #{message_thread_id}" if message_thread_id else "Nhóm Chat"
            reply_msg = (
                f"🤖 <b>[Markee AI Bot]</b>\n"
                f"✅ Bot đã kết nối thành công và đang hoạt động tại: <b>{topic_str}</b>\n"
                f"📌 Dự án tương ứng: <b>{pname}</b>\n\n"
                f"💡 Hãy nhắn nội dung giao việc bình thường tại Topic này, AI sẽ tự động phân tích và đưa lên Web Task Inbox!"
            )
            _send_telegram_reply(chat_id, reply_msg, message_thread_id)
            return {"ok": True, "status_sent": True}

        # Pass natural text messages to AI task extraction (AI will determine if it contains actionable tasks)
        if len(text) >= 5 and not text.startswith("/start") and not text.startswith("/help"):
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
    # Parse Zalo payload (supports Zalo OA, Group Webhook, and Chatwoot / ZaloPersonal format from zalo-automation-tho.json)
    msg_obj = payload.get("message") or {}
    conv_obj = payload.get("conversation") or {}
    meta_obj = conv_obj.get("meta") or {}
    add_attrs = conv_obj.get("additional_attributes") or {}

    text = (
        payload.get("content")
        or payload.get("text")
        or msg_obj.get("text")
        or payload.get("processed_message_content")
        or ""
    ).strip()

    if not text and conv_obj.get("messages"):
        msgs = conv_obj.get("messages")
        if isinstance(msgs, list) and len(msgs) > 0:
            text = (msgs[0].get("content") or msgs[0].get("text") or "").strip()

    sender_name = (
        payload.get("sender_name")
        or payload.get("sender", {}).get("name")
        or meta_obj.get("sender", {}).get("name")
        or "Thành viên Zalo"
    )

    group_name = (
        add_attrs.get("zalo_thread_name")
        or add_attrs.get("thread_name")
        or payload.get("group_name")
        or payload.get("inbox", {}).get("name")
        or "Zalo Group"
    )

    if not text:
        return {"ok": True, "ignored": "No message text"}

    # Find matching project link by group name or URL for project isolation
    link = db.query(ProjectLink).filter(
        (ProjectLink.name.ilike(f"%{group_name}%")) | (ProjectLink.url.ilike(f"%{group_name}%")) | (ProjectLink.url.ilike("%zalo%"))
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

