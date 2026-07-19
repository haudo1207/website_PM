import requests
import json
import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.project import Project, project_members
from ..models.phase import Phase
from ..models.task_group import TaskGroup
from ..models.task import Task
from ..models.member import Member
from ..models.meeting import Meeting
from ..models.ai_review import AIPrompt, AIReviewLog
from ..models.user import User
from ..utils.auth import get_current_user
from ..config import settings

router = APIRouter(tags=["ai-review"])

# Default prompts helper
def get_or_create_default_prompts(db: Session, project_id: int):
    # Check if prompts exist for this project
    prompts = db.query(AIPrompt).filter(AIPrompt.project_id == project_id).all()
    if not prompts:
        defaults = [
            {
                "type": "PROJECT",
                "name": "Project Check Prompt",
                "prompt_content": (
                    "Hãy đánh giá sức khỏe tổng thể của dự án này.\n"
                    "Phân tích rủi ro, phân bổ nguồn lực và tiến độ thực hiện.\n"
                    "Hãy chỉ ra các điểm nghẽn, các thành viên bị quá tải hoặc thiếu việc, "
                    "và mức độ hoàn thành so với mục tiêu đề ra."
                )
            },
            {
                "type": "PHASE",
                "name": "Phase Check Prompt",
                "prompt_content": (
                    "Hãy đánh giá giai đoạn (Phase) này của dự án.\n"
                    "Tìm các task bị overdue (quá hạn), phân phối tài nguyên (resource), "
                    "và kiểm tra xem phase có bị thiếu các task cốt lõi nào không."
                )
            },
            {
                "type": "TASK",
                "name": "Task Check Prompt",
                "prompt_content": (
                    "Hãy đánh giá chi tiết công việc (Task) này.\n"
                    "Kiểm tra tính rõ ràng của mô tả chi tiết công việc (detail task), "
                    "ước lượng số ngày công (manday), kết quả đầu ra (output/deliverable), "
                    "rủi ro và chỉ số đánh giá hiệu quả công việc (KPI)."
                )
            }
        ]
        created_prompts = []
        for d in defaults:
            p = AIPrompt(
                project_id=project_id,
                type=d["type"],
                name=d["name"],
                prompt_content=d["prompt_content"],
                active=True
            )
            db.add(p)
            created_prompts.append(p)
        db.commit()
        for p in created_prompts:
            db.refresh(p)
        return created_prompts
    return prompts


# ═══════════════════════════════════════════════════════════
# PROMPTS SETTINGS CRUD
# ═══════════════════════════════════════════════════════════

@router.get("/settings/ai-prompts")
def list_project_prompts(project_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    # Auto-initialize defaults if none exist
    prompts = get_or_create_default_prompts(db, project_id)
    return {
        "success": True,
        "data": [
            {
                "id": p.id,
                "project_id": p.project_id,
                "type": p.type,
                "name": p.name,
                "prompt_content": p.prompt_content,
                "active": p.active,
                "created_at": p.created_at.isoformat() if p.created_at else None
            }
            for p in prompts
        ]
    }


@router.post("/settings/ai-prompts")
def create_or_update_prompt(body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    project_id = body.get("project_id")
    prompt_type = body.get("type")
    name = body.get("name")
    prompt_content = body.get("prompt_content")
    active = body.get("active", True)
    prompt_id = body.get("id")

    if not project_id or not prompt_type or not prompt_content or not name:
        raise HTTPException(400, "project_id, type, name and prompt_content are required")

    if prompt_type not in ["PROJECT", "PHASE", "TASK"]:
        raise HTTPException(400, "Invalid type. Must be PROJECT, PHASE, or TASK")

    # Find existing prompt by ID or by project_id + type
    prompt = None
    if prompt_id:
        prompt = db.query(AIPrompt).filter(AIPrompt.id == prompt_id).first()
    else:
        prompt = db.query(AIPrompt).filter(AIPrompt.project_id == project_id, AIPrompt.type == prompt_type).first()

    if prompt:
        prompt.name = name
        prompt.prompt_content = prompt_content
        prompt.active = active
        prompt.created_by = current_user.id
    else:
        prompt = AIPrompt(
            project_id=project_id,
            type=prompt_type,
            name=name,
            prompt_content=prompt_content,
            active=active,
            created_by=current_user.id
        )
        db.add(prompt)

    db.commit()
    db.refresh(prompt)

    return {
        "success": True,
        "data": {
            "id": prompt.id,
            "project_id": prompt.project_id,
            "type": prompt.type,
            "name": prompt.name,
            "prompt_content": prompt.prompt_content,
            "active": prompt.active,
            "created_at": prompt.created_at.isoformat() if prompt.created_at else None
        }
    }


# ═══════════════════════════════════════════════════════════
# AI REVIEW TRIGGER & PROCESS
# ═══════════════════════════════════════════════════════════

@router.post("/ai-review/check")
def trigger_ai_check(body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    entity_type = body.get("entity_type")  # PROJECT, PHASE, TASK
    entity_id = body.get("entity_id")

    if not entity_type or not entity_id:
        raise HTTPException(400, "entity_type and entity_id are required")

    entity_type = entity_type.upper()
    if entity_type not in ["PROJECT", "PHASE", "TASK"]:
        raise HTTPException(400, "Invalid entity_type. Must be PROJECT, PHASE, or TASK")

    # 1. Fetch Entity & Find Project ID
    project_id = None
    entity_obj = None

    if entity_type == "PROJECT":
        entity_obj = db.query(Project).filter(Project.id == entity_id).first()
        if not entity_obj:
            raise HTTPException(404, "Project not found")
        project_id = entity_obj.id

    elif entity_type == "PHASE":
        entity_obj = db.query(Phase).filter(Phase.id == entity_id).first()
        if not entity_obj:
            raise HTTPException(404, "Phase not found")
        project_id = entity_obj.project_id

    elif entity_type == "TASK":
        entity_obj = db.query(Task).filter(Task.id == entity_id).first()
        if not entity_obj:
            raise HTTPException(404, "Task not found")
        # Trace task group -> phase -> project
        tg = db.query(TaskGroup).filter(TaskGroup.id == entity_obj.task_group_id).first()
        if not tg:
            raise HTTPException(400, "Task group associated with task not found")
        phase = db.query(Phase).filter(Phase.id == tg.phase_id).first()
        if not phase:
            raise HTTPException(400, "Phase associated with task group not found")
        project_id = phase.project_id

    # 2. Get active prompt or fallback
    prompt_obj = db.query(AIPrompt).filter(
        AIPrompt.project_id == project_id,
        AIPrompt.type == entity_type,
        AIPrompt.active == True
    ).first()

    if not prompt_obj:
        # Create defaults
        get_or_create_default_prompts(db, project_id)
        prompt_obj = db.query(AIPrompt).filter(
            AIPrompt.project_id == project_id,
            AIPrompt.type == entity_type,
            AIPrompt.active == True
        ).first()

    prompt_snapshot = prompt_obj.prompt_content if prompt_obj else "Default Check"

    # Set status to CHECKING temporarily
    old_status = entity_obj.ai_status
    entity_obj.ai_status = "CHECKING"
    db.commit()

    # 3. Gather Payload Data
    review_data = {}
    if entity_type == "TASK":
        tg = db.query(TaskGroup).filter(TaskGroup.id == entity_obj.task_group_id).first()
        phase = db.query(Phase).filter(Phase.id == tg.phase_id).first()
        proj = db.query(Project).filter(Project.id == project_id).first()
        
        assigned_m = db.query(Member).filter(Member.id == entity_obj.assigned_id).first() if entity_obj.assigned_id else None
        support_m = db.query(Member).filter(Member.id == entity_obj.support_id).first() if entity_obj.support_id else None

        review_data = {
            "project": {
                "id": proj.id,
                "name": proj.name,
                "description": proj.description
            },
            "phase": {
                "id": phase.id,
                "name": phase.name,
                "description": phase.description
            },
            "task_group": {
                "id": tg.id,
                "name": tg.name,
                "description": tg.description
            },
            "task": {
                "id": entity_obj.id,
                "task_code": entity_obj.task_code,
                "detail": entity_obj.detail,
                "priority": entity_obj.priority,
                "manday_est": float(entity_obj.manday_est) if entity_obj.manday_est else None,
                "status": entity_obj.status,
                "start_date": str(entity_obj.start_date) if entity_obj.start_date else None,
                "assigned": assigned_m.display_name if assigned_m else None,
                "support": support_m.display_name if support_m else None,
                "remark": entity_obj.remark,
                "solution": entity_obj.solution
            }
        }

    elif entity_type == "PHASE":
        proj = db.query(Project).filter(Project.id == project_id).first()
        task_groups = db.query(TaskGroup).filter(TaskGroup.phase_id == entity_obj.id).all()
        tg_ids = [tg.id for tg in task_groups]
        tasks = db.query(Task).filter(Task.task_group_id.in_(tg_ids)).all() if tg_ids else []

        # Get assigned member names for tasks
        task_list = []
        for t in tasks:
            assignee = db.query(Member).filter(Member.id == t.assigned_id).first() if t.assigned_id else None
            task_list.append({
                "id": t.id,
                "task_group_id": t.task_group_id,
                "task_code": t.task_code,
                "detail": t.detail,
                "priority": t.priority,
                "manday_est": float(t.manday_est) if t.manday_est else None,
                "status": t.status,
                "assigned": assignee.display_name if assignee else None
            })

        review_data = {
            "project": {
                "id": proj.id,
                "name": proj.name
            },
            "phase": {
                "id": entity_obj.id,
                "name": entity_obj.name,
                "description": entity_obj.description,
                "status": entity_obj.status
            },
            "task_groups": [
                {
                    "id": tg.id,
                    "name": tg.name,
                    "status": tg.status,
                    "progress": float(tg.progress or 0)
                } for tg in task_groups
            ],
            "tasks": task_list
        }

    elif entity_type == "PROJECT":
        phases = db.query(Phase).filter(Phase.project_id == entity_obj.id).all()
        phase_ids = [ph.id for ph in phases]
        task_groups = db.query(TaskGroup).filter(TaskGroup.phase_id.in_(phase_ids)).all() if phase_ids else []
        tg_ids = [tg.id for tg in task_groups]
        tasks = db.query(Task).filter(Task.task_group_id.in_(tg_ids)).all() if tg_ids else []

        # Fetch project members
        m_rows = db.query(Member, project_members.c.role).join(
            project_members, Member.id == project_members.c.member_id
        ).filter(project_members.c.project_id == entity_obj.id).all()

        # Fetch meeting logs
        meetings = db.query(Meeting).filter(Meeting.project_id == entity_obj.id).all()

        task_list = []
        for t in tasks:
            assignee = db.query(Member).filter(Member.id == t.assigned_id).first() if t.assigned_id else None
            task_list.append({
                "id": t.id,
                "detail": t.detail,
                "priority": t.priority,
                "manday_est": float(t.manday_est) if t.manday_est else None,
                "status": t.status,
                "assigned": assignee.display_name if assignee else None
            })

        review_data = {
            "project": {
                "id": entity_obj.id,
                "name": entity_obj.name,
                "description": entity_obj.description,
                "status": entity_obj.status
            },
            "phases": [
                {
                    "id": ph.id,
                    "name": ph.name,
                    "status": ph.status
                } for ph in phases
            ],
            "tasks": task_list,
            "members": [
                {
                    "display_name": m.display_name,
                    "role": r
                } for m, r in m_rows
            ],
            "meeting_logs": [
                {
                    "id": mt.id,
                    "title": mt.title,
                    "meeting_date": str(mt.meeting_date),
                    "status": mt.status
                } for mt in meetings
            ]
        }

    # 4. Call AI Client
    api_key = settings.AI_API_KEY
    base_url = settings.AI_BASE_URL
    model = settings.AI_MODEL

    if not api_key:
        entity_obj.ai_status = old_status
        db.commit()
        raise HTTPException(400, "AI_API_KEY is not configured in .env file.")

    system_prompt = (
        "Bạn là chuyên gia thẩm định & quản lý dự án sử dụng mô hình ngôn ngữ lớn.\n"
        "Nhiệm vụ của bạn là phân tích dữ liệu dự án/giai đoạn/công việc được cung cấp và đưa ra nhận xét, cảnh báo và đề xuất cải thiện.\n"
        "AI của bạn chỉ đưa ra nhận xét và KHÔNG tự sửa dữ liệu.\n\n"
        "BẮT BUỘC: Bạn phải phản hồi ở định dạng JSON duy nhất, có cấu trúc chính xác như sau:\n"
        "{\n"
        '  "score": <số nguyên từ 0 đến 100 đại diện cho điểm số chất lượng/tuân thủ của thực thể này>,\n'
        '  "issues": [<danh sách các vấn đề/cảnh báo được tìm thấy, ví dụ: "Thiếu KPI", "Manday quá thấp">],\n'
        '  "suggestions": [<danh sách các đề xuất cải thiện cụ thể, bắt đầu bằng động từ hành động, ví dụ: "Bổ sung deliverable", "Chia nhỏ task">],\n'
        '  "summary_markdown": "<chuỗi markdown chứa chi tiết nhận xét đầy đủ và báo cáo tổng quan bằng tiếng Việt>"\n'
        "}\n"
        "Chú ý: Trả về JSON hợp lệ. Không bọc trong ```json hay ``` ở kết quả."
    )

    user_content = f"""Yêu cầu đánh giá:
Prompt của Leader:
{prompt_snapshot}

Dữ liệu thực thể gửi lên:
{json.dumps(review_data, ensure_ascii=False, indent=2)}"""

    try:
        resp = requests.post(
            f"{base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": 4000,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content}
                ],
                "temperature": 0.2
            },
            timeout=120,
        )

        if resp.status_code != 200:
            entity_obj.ai_status = old_status
            db.commit()
            raise HTTPException(400, f"AI API error: {resp.text}")

        resp_data = resp.json()
        ai_output = resp_data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()

        if not ai_output:
            entity_obj.ai_status = old_status
            db.commit()
            raise HTTPException(500, "AI returned an empty response")

        # Clean markdown code block wraps if LLM ignored the instructions
        if ai_output.startswith("```"):
            # Strip first line (e.g. ```json or ```) and last line (```)
            lines = ai_output.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines[-1].startswith("```"):
                lines = lines[:-1]
            ai_output = "\n".join(lines).strip()

        # Parse JSON
        try:
            result_json = json.loads(ai_output)
        except Exception as e:
            # Fallback parsing in case JSON is slightly invalid or has trailing commas
            # We can log this and create a structured error
            raise ValueError(f"Failed to parse AI output as JSON: {ai_output}. Details: {str(e)}")

        score = result_json.get("score", 70)
        issues = result_json.get("issues", [])
        suggestions = result_json.get("suggestions", [])
        summary_markdown = result_json.get("summary_markdown", "Không có chi tiết.")

        # Determine final status
        final_status = "CHECKED"
        if issues:
            final_status = "HAS_ISSUE"

        # 5. Save Review Log
        log = AIReviewLog(
            project_id=project_id,
            entity_type=entity_type,
            entity_id=entity_id,
            prompt_id=prompt_obj.id if prompt_obj else None,
            prompt_snapshot=prompt_snapshot,
            status=final_status,
            score=score,
            issues_json=issues,
            suggestions_json=suggestions,
            result_markdown=summary_markdown,
            checked_by=current_user.id,
            checked_at=datetime.datetime.now()
        )
        db.add(log)
        db.flush()

        # 6. Update Entity Status
        entity_obj.ai_status = final_status
        entity_obj.last_ai_check_at = datetime.datetime.now()
        entity_obj.last_ai_score = score
        entity_obj.last_review_id = log.id

        db.commit()
        db.refresh(entity_obj)
        db.refresh(log)

        return {
            "success": True,
            "data": {
                "log_id": log.id,
                "status": final_status,
                "score": score,
                "issues": issues,
                "suggestions": suggestions,
                "result_markdown": summary_markdown,
                "checked_at": log.checked_at.isoformat()
            }
        }

    except Exception as e:
        entity_obj.ai_status = "NOT_CHECKED" if old_status == "CHECKING" else old_status
        db.commit()
        raise HTTPException(500, f"Error calling AI review: {str(e)}")


# ═══════════════════════════════════════════════════════════
# AI REVIEW HISTORY & SINGLE LOG
# ═══════════════════════════════════════════════════════════

@router.get("/ai-review/history")
def get_review_history(entity_type: str, entity_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    entity_type = entity_type.upper()
    if entity_type not in ["PROJECT", "PHASE", "TASK"]:
        raise HTTPException(400, "Invalid entity_type. Must be PROJECT, PHASE, or TASK")

    logs = db.query(AIReviewLog).filter(
        AIReviewLog.entity_type == entity_type,
        AIReviewLog.entity_id == entity_id
    ).order_by(AIReviewLog.checked_at.desc()).all()

    return {
        "success": True,
        "data": [
            {
                "id": log.id,
                "project_id": log.project_id,
                "entity_type": log.entity_type,
                "entity_id": log.entity_id,
                "prompt_id": log.prompt_id,
                "prompt_snapshot": log.prompt_snapshot,
                "status": log.status,
                "score": log.score,
                "issues": log.issues_json,
                "suggestions": log.suggestions_json,
                "result_markdown": log.result_markdown,
                "checked_at": log.checked_at.isoformat() if log.checked_at else None,
                "checker_name": log.checker.full_name if log.checker else "System"
            }
            for log in logs
        ]
    }


@router.get("/ai-review/logs/{log_id}")
def get_review_log_details(log_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    log = db.query(AIReviewLog).filter(AIReviewLog.id == log_id).first()
    if not log:
        raise HTTPException(404, "Review log not found")

    return {
        "success": True,
        "data": {
            "id": log.id,
            "project_id": log.project_id,
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "prompt_id": log.prompt_id,
            "prompt_snapshot": log.prompt_snapshot,
            "status": log.status,
            "score": log.score,
            "issues": log.issues_json,
            "suggestions": log.suggestions_json,
            "result_markdown": log.result_markdown,
            "checked_at": log.checked_at.isoformat() if log.checked_at else None,
            "checker_name": log.checker.full_name if log.checker else "System"
        }
    }
