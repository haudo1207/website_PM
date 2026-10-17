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
from ..models.skill_master import Category, Group, Skill
from ..models.user import User
from ..utils.auth import get_current_user, require_admin_write
from ..utils.audit_service import AuditService
from ..services.ai_client import chat_completion_json, AiClientError
from ..config import settings

router = APIRouter(tags=["ai-review"], dependencies=[Depends(require_admin_write)])

# Default prompts helper
def get_or_create_default_prompts(db: Session, project_id: int):
    # Check per-type (not "any exist") so a project created before the
    # MEMBER level was added still gets that one default seeded in,
    # instead of being stuck forever with just its original 3.
    existing_types = {
        t for (t,) in db.query(AIPrompt.type).filter(AIPrompt.project_id == project_id).all()
    }
    if True:
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
            },
            {
                "type": "MEMBER",
                "name": "Member Check Prompt",
                "prompt_content": (
                    "Hãy đánh giá đóng góp của thành viên này trong dự án theo hướng tích cực, khích lệ.\n"
                    "Chỉ dựa trên các task mà thành viên này là người thực hiện (assigned) "
                    "hoặc hỗ trợ (support) — không đánh giá phần việc của người khác.\n"
                    "Ưu tiên nêu bật các điểm tốt trước: mức độ hoàn thành, tinh thần trách nhiệm, "
                    "sự chủ động khi có task được ghi nhận đầy đủ, tiến độ nhìn chung ổn định.\n"
                    "Việc thành viên đã khai báo/cập nhật task xem như một tín hiệu tích cực cho tiến độ "
                    "— không xem đây là vấn đề cần nêu ra, không đề cập đến việc khai báo hay số lượng "
                    "task như một điểm trừ.\n"
                    "Nếu có điểm chưa tốt, hãy diễn đạt nhẹ nhàng và có phần khéo léo, xem đó như một gợi ý "
                    "để thành viên hoàn thiện hơn chứ không phải một lỗi lớn — ví dụ có thể nói rằng nhịp độ "
                    "xử lý một vài task có thể cần thêm chút thời gian để ổn định hơn, hoặc một số việc đang "
                    "trong quá trình hoàn thiện và sẽ tốt hơn nếu được theo sát thêm một chút. Tránh dùng từ "
                    "ngữ mang tính phê bình, quy kết hay tạo cảm giác tiêu cực; luôn giữ giọng văn xây dựng, "
                    "động viên là chính."
                )
            }
        ]
        missing = [d for d in defaults if d["type"] not in existing_types]
        for d in missing:
            db.add(AIPrompt(
                project_id=project_id,
                type=d["type"],
                name=d["name"],
                prompt_content=d["prompt_content"],
                active=True
            ))
        if missing:
            db.commit()
    return db.query(AIPrompt).filter(AIPrompt.project_id == project_id).all()


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

    if prompt_type not in ["PROJECT", "PHASE", "TASK", "MEMBER"]:
        raise HTTPException(400, "Invalid type. Must be PROJECT, PHASE, TASK, or MEMBER")

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
    entity_type = body.get("entity_type")  # PROJECT, PHASE, TASK, MEMBER
    entity_id = body.get("entity_id")  # for MEMBER: the member_id being reviewed
    # MEMBER has no project of its own (a member can sit on several) — the
    # caller must say which project's tasks to scope the review to.
    member_review_project_id = body.get("project_id")

    if not entity_type or not entity_id:
        raise HTTPException(400, "entity_type and entity_id are required")

    entity_type = entity_type.upper()
    if entity_type not in ["PROJECT", "PHASE", "TASK", "MEMBER"]:
        raise HTTPException(400, "Invalid entity_type. Must be PROJECT, PHASE, TASK, or MEMBER")

    # 1. Fetch Entity & Find Project ID
    project_id = None
    entity_obj = None
    # Member has no ai_status/last_ai_check_at/last_ai_score/last_review_id
    # columns (those are Project/Phase/Task-only fields) — every place below
    # that stamps status onto entity_obj is skipped for MEMBER.
    is_member_review = entity_type == "MEMBER"

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

    elif entity_type == "MEMBER":
        entity_obj = db.query(Member).filter(Member.id == entity_id).first()
        if not entity_obj:
            raise HTTPException(404, "Member not found")
        if not member_review_project_id:
            raise HTTPException(400, "project_id is required for a MEMBER review")
        project_id = member_review_project_id

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

    # Set status to CHECKING temporarily (Member has no ai_status column)
    old_status = None if is_member_review else entity_obj.ai_status
    if not is_member_review:
        entity_obj.ai_status = "CHECKING"
        db.commit()

    # 3. Gather Payload Data
    review_data = {}
    if entity_type == "MEMBER":
        proj = db.query(Project).filter(Project.id == project_id).first()
        if not proj:
            raise HTTPException(404, "Project not found")

        # Same phase -> task_group -> task walk as PROJECT, but filtered down
        # to only the tasks this member is assigned to or supporting — never
        # another person's work in the same project.
        phases = db.query(Phase).filter(Phase.project_id == proj.id).all()
        phase_ids = [ph.id for ph in phases]
        task_groups = db.query(TaskGroup).filter(TaskGroup.phase_id.in_(phase_ids)).all() if phase_ids else []
        tg_ids = [tg.id for tg in task_groups]
        member_tasks = (
            db.query(Task).filter(
                Task.task_group_id.in_(tg_ids),
                (Task.assigned_id == entity_obj.id) | (Task.support_id == entity_obj.id),
            ).all()
            if tg_ids else []
        )

        task_list = []
        for t in member_tasks:
            role = []
            if t.assigned_id == entity_obj.id:
                role.append("assigned")
            if t.support_id == entity_obj.id:
                role.append("support")
            task_list.append({
                "id": t.id,
                "detail": t.detail,
                "priority": t.priority,
                "manday_est": float(t.manday_est) if t.manday_est else None,
                "status": t.status,
                "role": role,
            })

        review_data = {
            "project": {
                "id": proj.id,
                "name": proj.name,
            },
            "member": {
                "id": entity_obj.id,
                "display_name": entity_obj.display_name,
                "position": entity_obj.position,
            },
            "tasks": task_list,
        }

    elif entity_type == "TASK":
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
        if not is_member_review:
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
            if not is_member_review:
                entity_obj.ai_status = old_status
                db.commit()
            raise HTTPException(400, f"AI API error: {resp.text}")

        resp_data = resp.json()
        ai_output = resp_data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()

        if not ai_output:
            if not is_member_review:
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

        # 6. Update Entity Status (Member has no such columns to stamp)
        if not is_member_review:
            entity_obj.ai_status = final_status
            entity_obj.last_ai_check_at = datetime.datetime.now()
            entity_obj.last_ai_score = score
            entity_obj.last_review_id = log.id

        db.commit()
        db.refresh(entity_obj)
        db.refresh(log)

        AuditService.record(
            db=db,
            user_id=current_user.id,
            module="AI Check",
            entity_type=entity_type,
            entity_id=entity_id,
            action="CHECK",
            project_id=project_id,
            old_value=f"Ai Status: {old_status}",
            new_value=f"Score: {score}/100, Status: {final_status}",
            description=f"Chạy AI Check cho {entity_type} #{entity_id} - Điểm: {score}/100 ({len(issues)} rủi ro, {len(suggestions)} đề xuất)"
        )
        db.commit()

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
        if not is_member_review:
            entity_obj.ai_status = "NOT_CHECKED" if old_status == "CHECKING" else old_status
            db.commit()
        raise HTTPException(500, f"Error calling AI review: {str(e)}")


# ═══════════════════════════════════════════════════════════
# AI REVIEW HISTORY & SINGLE LOG
# ═══════════════════════════════════════════════════════════

@router.get("/ai-review/history")
def get_review_history(
    entity_type: str, entity_id: int, project_id: Optional[int] = None,
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    entity_type = entity_type.upper()
    if entity_type not in ["PROJECT", "PHASE", "TASK", "MEMBER"]:
        raise HTTPException(400, "Invalid entity_type. Must be PROJECT, PHASE, TASK, or MEMBER")

    query = db.query(AIReviewLog).filter(
        AIReviewLog.entity_type == entity_type,
        AIReviewLog.entity_id == entity_id
    )
    # A MEMBER's entity_id (their member_id) alone doesn't say which project
    # this history is for — the same person can be reviewed under several
    # different projects, each with its own independent history.
    if entity_type == "MEMBER" and project_id:
        query = query.filter(AIReviewLog.project_id == project_id)
    logs = query.order_by(AIReviewLog.checked_at.desc()).all()

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


# ═══════════════════════════════════════════════════════════
# CRITERIA CHECKS (Skill / Manday) — task-by-task verdicts
# ═══════════════════════════════════════════════════════════
#
# Two focused checks shown as their own tabs under "Báo Cáo Hiện Tại":
#   - SKILL:  is each task filed under the right Skill Area (Group) + Skill?
#             Prompt is editable from the FE (stored per project as an
#             AIPrompt of type SKILL_CHECK; the FE also sends the text it
#             currently shows with each scan — that text is what's used).
#   - MANDAY: is each task's Manday EST reasonable? Prompt is hard-coded
#             here; the FE only displays it.
#
# Logs reuse ai_review_logs with a namespaced entity_type
# "<ENTITY>:<CRITERION>:<period>" (e.g. "MEMBER:SKILL:2026-10") so they never
# mix into the regular PROJECT/PHASE/TASK/MEMBER history, and each KPI month
# keeps its own latest result. issues_json holds the per-task verdict list.

CRITERIA = ("SKILL", "MANDAY")

DEFAULT_SKILL_CHECK_PROMPT = (
    "Hãy kiểm tra từng task xem đã được fill đúng Skill Area và Skill hay chưa.\n"
    "- Đọc nội dung Detail Task (và Task Group / Phase nếu cần) để hiểu bản chất công việc.\n"
    "- Skill Area (nhóm kỹ năng) phải phù hợp với lĩnh vực của công việc.\n"
    "- Skill phải mô tả đúng kỹ năng chính cần để làm task đó và phải thuộc đúng Skill Area đã chọn "
    "(trường skill_belongs_to_area = false nghĩa là Skill không thuộc Skill Area — luôn coi là WRONG).\n"
    "- Nếu chọn sai, hãy đề xuất Skill Area và Skill đúng, ưu tiên lấy từ danh mục Skill được cung cấp.\n"
    "- Nếu Detail Task quá mơ hồ để kết luận, đánh giá WARNING và gợi ý ghi rõ hơn."
)

MANDAY_CHECK_PROMPT = (
    "Hãy kiểm tra từng task xem số Manday EST đã fill có hợp lý hay không.\n"
    "- Ước lượng khối lượng công việc thực tế dựa trên Detail Task, Priority và Skill của task.\n"
    "- Manday EST quá thấp so với khối lượng (ví dụ việc phức tạp nhưng chỉ 0.1–0.25 ngày) → WRONG hoặc WARNING.\n"
    "- Manday EST quá cao so với khối lượng (việc đơn giản nhưng nhiều ngày) → WRONG hoặc WARNING.\n"
    "- Task có Manday EST lớn hơn 5 ngày nên được chia nhỏ → WARNING.\n"
    "- Nếu task đã Done, so sánh Manday Actual với Manday EST: lệch nhiều (gấp đôi trở lên hoặc chưa tới một nửa) "
    "→ WARNING và nêu rõ độ lệch; days_late > 0 cũng là tín hiệu ước lượng chưa sát.\n"
    "- Với mỗi task chưa hợp lý, đề xuất một con số Manday EST cụ thể (suggested_manday)."
)

MAX_CRITERIA_TASKS = 150
MAX_SKILL_CATALOG_CHARS = 12000


def _period_key(month: Optional[int], year: Optional[int]) -> str:
    if month and year:
        return f"{year}-{int(month):02d}"
    if year:
        return str(year)
    if month:
        return f"M{int(month):02d}"
    return "ALL"


def _period_label(month: Optional[int], year: Optional[int]) -> str:
    if month and year:
        return f"Tháng {month}/{year}"
    if year:
        return f"Năm {year}"
    if month:
        return f"Tháng {month} (mọi năm)"
    return "Toàn bộ thời gian"


def _get_skill_prompt(db: Session, project_id: int) -> Optional[AIPrompt]:
    return db.query(AIPrompt).filter(
        AIPrompt.project_id == project_id,
        AIPrompt.type == "SKILL_CHECK",
    ).first()


def _resolve_project_id(db: Session, entity_type: str, entity_id: int, project_id: Optional[int]) -> int:
    if entity_type == "PROJECT":
        if not db.query(Project.id).filter(Project.id == entity_id).first():
            raise HTTPException(404, "Project not found")
        return entity_id
    if entity_type == "PHASE":
        ph = db.query(Phase).filter(Phase.id == entity_id).first()
        if not ph:
            raise HTTPException(404, "Phase not found")
        return ph.project_id
    if entity_type == "TASK":
        t = db.query(Task).filter(Task.id == entity_id).first()
        if not t:
            raise HTTPException(404, "Task not found")
        tg = db.query(TaskGroup).filter(TaskGroup.id == t.task_group_id).first()
        ph = db.query(Phase).filter(Phase.id == tg.phase_id).first() if tg else None
        if not ph:
            raise HTTPException(400, "Phase associated with task not found")
        return ph.project_id
    # MEMBER — has no project of its own; the caller must name one.
    if not db.query(Member.id).filter(Member.id == entity_id).first():
        raise HTTPException(404, "Member not found")
    if not project_id:
        raise HTTPException(400, "project_id is required for a MEMBER review")
    return int(project_id)


def _collect_scope_tasks(db: Session, entity_type: str, entity_id: int, project_id: int,
                         month: Optional[int], year: Optional[int]) -> list:
    if entity_type == "TASK":
        tasks = db.query(Task).filter(Task.id == entity_id).all()
    else:
        if entity_type == "PHASE":
            phase_ids = [entity_id]
        else:
            phase_ids = [pid for (pid,) in db.query(Phase.id).filter(Phase.project_id == project_id).all()]
        tg_ids = [tid for (tid,) in db.query(TaskGroup.id).filter(TaskGroup.phase_id.in_(phase_ids)).all()] if phase_ids else []
        if not tg_ids:
            return []
        q = db.query(Task).filter(Task.task_group_id.in_(tg_ids))
        if entity_type == "MEMBER":
            q = q.filter((Task.assigned_id == entity_id) | (Task.support_id == entity_id))
        tasks = q.order_by(Task.start_date.asc(), Task.id.asc()).all()

    # Same semantics as the FE's taskMatchesKpiMonthYear (the /kpi drill-in
    # filter): plain calendar month/year of start_date; a missing side means
    # "any".
    def in_period(t: Task) -> bool:
        if not month and not year:
            return True
        if not t.start_date:
            return False
        if month and t.start_date.month != int(month):
            return False
        if year and t.start_date.year != int(year):
            return False
        return True

    return [t for t in tasks if in_period(t)]


def _serialize_task_for_criteria(t: Task) -> dict:
    area = t.skill_solution_rel
    skill = t.skill_vendor_rel
    tg = t.task_group
    phase = tg.phase if tg is not None else None
    return {
        "task_id": t.id,
        "task_code": t.task_code,
        "detail": t.detail,
        "phase": phase.name if phase is not None else None,
        "task_group": tg.name if tg is not None else None,
        "priority": t.priority,
        "status": t.status,
        "skill_area": area.name if area else None,
        "skill_area_category": area.category.name if area and area.category else None,
        "skill": skill.name if skill else None,
        "skill_solution_id": t.skill_solution_id,
        "skill_vendor_id": t.skill_vendor_id,
        "skill_belongs_to_area": bool(skill and area and skill.group_id == area.id),
        "manday_est": float(t.manday_est) if t.manday_est is not None else None,
        "manday_actual": float(t.manday_actual) if t.manday_actual is not None else None,
        "start_date": str(t.start_date) if t.start_date else None,
        "end_date_est": str(t.end_date_est) if t.end_date_est else None,
        "end_date_actual": str(t.end_date_actual) if t.end_date_actual else None,
        "days_late": t.days_late,
        "assigned": t.assigned_member.display_name if t.assigned_member else None,
        "support": t.support_member.display_name if t.support_member else None,
    }


def _skill_catalog_text(db: Session) -> str:
    rows = (
        db.query(Category.name, Group.name, Skill.name)
        .join(Group, Group.category_id == Category.id)
        .join(Skill, Skill.group_id == Group.id)
        .filter(Skill.is_active == True)
        .order_by(Category.name, Group.name, Skill.name)
        .all()
    )
    grouped: dict = {}
    for cat, grp, sk in rows:
        grouped.setdefault((cat, grp), []).append(sk)
    text = "\n".join(f"- {cat} > {grp}: {', '.join(sks)}" for (cat, grp), sks in grouped.items())
    if len(text) > MAX_SKILL_CATALOG_CHARS:
        text = text[:MAX_SKILL_CATALOG_CHARS] + "\n... (danh mục đã được rút gọn)"
    return text


def _norm_name(s: Optional[str]) -> str:
    return " ".join((s or "").replace("&", " & ").split()).lower()


def _resolve_skill_ids(db: Session, area_name: Optional[str], skill_name: Optional[str],
                       fallback_area_id: Optional[int]) -> Optional[tuple]:
    """Map the AI's suggested Skill Area/Skill *names* to a real
    (group_id, skill_id) pair from the catalog, or None if no exact pair
    exists. The skill must belong to the area (same rule the task form
    enforces); when the AI only names a skill, the task's current area is
    tried first, then any area that has a skill by that name."""
    if not skill_name:
        return None
    want_skill = _norm_name(skill_name)
    want_area = _norm_name(area_name)
    rows = (
        db.query(Group.id, Group.name, Skill.id, Skill.name)
        .join(Skill, Skill.group_id == Group.id)
        .filter(Skill.is_active == True)
        .all()
    )
    matches = [(gid, sid, _norm_name(gname)) for gid, gname, sid, sname in rows if _norm_name(sname) == want_skill]
    if want_area:
        for gid, sid, gname in matches:
            if gname == want_area:
                return gid, sid
        return None
    for gid, sid, _ in matches:
        if gid == fallback_area_id:
            return gid, sid
    return (matches[0][0], matches[0][1]) if len(matches) == 1 else None


def _normalize_manday(value) -> Optional[float]:
    """Round to the 0.25-day grid the task form uses, within its 0.25–365 range."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    v = round(v * 4) / 4
    return min(max(v, 0.25), 365.0)


def _attach_current_state(db: Session, criterion: Optional[str], items: list) -> list:
    """Flag each verdict whose task was edited (on the criterion's own
    fields) or deleted since the scan — a log is a snapshot, so after the
    member fixes a task the FE should say "đã sửa, cần quét lại" instead of
    still showing the stale verdict as if nothing changed."""
    ids = [i.get("task_id") for i in items if i.get("task_id")]
    current = {t.id: t for t in db.query(Task).filter(Task.id.in_(ids)).all()} if ids else {}
    out = []
    for item in items:
        item = dict(item)
        t = current.get(item.get("task_id"))
        if t is None:
            item["changed"] = True
            item["deleted"] = True
            out.append(item)
            continue
        cur_area = t.skill_solution_rel.name if t.skill_solution_rel else None
        cur_skill = t.skill_vendor_rel.name if t.skill_vendor_rel else None
        cur_md = float(t.manday_est) if t.manday_est is not None else None
        item["current_skill_area"] = cur_area
        item["current_skill"] = cur_skill
        item["current_manday_est"] = cur_md
        if criterion == "SKILL":
            # Older logs predate the stored ids — fall back to names.
            if "skill_solution_id" in item:
                item["changed"] = (item["skill_solution_id"], item["skill_vendor_id"]) != (t.skill_solution_id, t.skill_vendor_id)
            else:
                item["changed"] = (item.get("skill_area"), item.get("skill")) != (cur_area, cur_skill)
            if "suggested_skill_vendor_id" not in item and item.get("verdict") != "OK" and item.get("suggested_skill"):
                ids = _resolve_skill_ids(db, item.get("suggested_skill_area"), item.get("suggested_skill"),
                                         item.get("skill_solution_id", t.skill_solution_id))
                item["suggested_skill_solution_id"], item["suggested_skill_vendor_id"] = ids or (None, None)
            target = (item.get("suggested_skill_solution_id"), item.get("suggested_skill_vendor_id"))
            has_suggestion = target[1] is not None
            item["applied"] = has_suggestion and target == (t.skill_solution_id, t.skill_vendor_id)
        else:
            item["changed"] = item.get("manday_est") != cur_md
            if item.get("suggested_manday") is not None:
                item["suggested_manday"] = _normalize_manday(item["suggested_manday"])
            has_suggestion = item.get("suggested_manday") is not None
            item["applied"] = has_suggestion and item.get("suggested_manday") == cur_md
        item["task_group_id"] = t.task_group_id
        # One-click fix is offered only for a still-untouched, non-OK verdict
        # that carries a concrete, catalog-valid suggestion.
        item["applicable"] = item.get("verdict") != "OK" and has_suggestion and not item["changed"]
        out.append(item)
    return out


def _criteria_log_to_dict(log: AIReviewLog, db: Optional[Session] = None) -> dict:
    parts = (log.entity_type or "").split(":")
    criterion = parts[1] if len(parts) > 1 else None
    items = log.issues_json or []
    if db is not None:
        items = _attach_current_state(db, criterion, items)
    return {
        "id": log.id,
        "project_id": log.project_id,
        "entity_type": parts[0],
        "criterion": criterion,
        "period": parts[2] if len(parts) > 2 else None,
        "entity_id": log.entity_id,
        "prompt_snapshot": log.prompt_snapshot,
        "status": log.status,
        "score": log.score,
        "items": items,
        # Applied suggestions are edits too, but already resolved — don't nag
        # for a rescan because of them.
        "changed_count": sum(1 for i in items if i.get("changed") and not i.get("applied")),
        "applicable_count": sum(1 for i in items if i.get("applicable")),
        "suggestions": log.suggestions_json or [],
        "result_markdown": log.result_markdown,
        "checked_at": log.checked_at.isoformat() if log.checked_at else None,
        "checker_name": log.checker.full_name if log.checker else "System",
    }


@router.get("/ai-review/criteria-prompts")
def get_criteria_prompts(project_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    skill_prompt = _get_skill_prompt(db, project_id)
    return {
        "success": True,
        "data": {
            "skill": {
                "prompt_content": skill_prompt.prompt_content if skill_prompt else DEFAULT_SKILL_CHECK_PROMPT,
                "default_content": DEFAULT_SKILL_CHECK_PROMPT,
                "is_default": skill_prompt is None,
                "editable": True,
            },
            "manday": {
                "prompt_content": MANDAY_CHECK_PROMPT,
                "editable": False,
            },
        },
    }


@router.post("/ai-review/criteria-prompts")
def save_criteria_prompt(body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    project_id = body.get("project_id")
    criterion = (body.get("criterion") or "").upper()
    content = (body.get("prompt_content") or "").strip()
    if not project_id:
        raise HTTPException(400, "project_id is required")
    if criterion == "MANDAY":
        raise HTTPException(400, "Prompt đánh giá Manday được cấu hình cố định ở backend, không thể sửa.")
    if criterion != "SKILL":
        raise HTTPException(400, "criterion must be SKILL")
    if not content:
        raise HTTPException(400, "prompt_content is required")

    prompt = _get_skill_prompt(db, project_id)
    if prompt:
        prompt.prompt_content = content
        prompt.created_by = current_user.id
    else:
        prompt = AIPrompt(
            project_id=project_id,
            type="SKILL_CHECK",
            name="Skill Area / Skill Check Prompt",
            prompt_content=content,
            active=True,
            created_by=current_user.id,
        )
        db.add(prompt)
    db.commit()
    return {"success": True, "data": {"prompt_content": prompt.prompt_content}}


@router.get("/ai-review/criteria-latest")
def get_criteria_latest(
    criterion: str, entity_type: str, entity_id: int,
    project_id: Optional[int] = None, month: Optional[int] = None, year: Optional[int] = None,
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    criterion = criterion.upper()
    entity_type = entity_type.upper()
    if criterion not in CRITERIA:
        raise HTTPException(400, "criterion must be SKILL or MANDAY")
    q = db.query(AIReviewLog).filter(
        AIReviewLog.entity_type == f"{entity_type}:{criterion}:{_period_key(month, year)}",
        AIReviewLog.entity_id == entity_id,
    )
    if entity_type == "MEMBER" and project_id:
        q = q.filter(AIReviewLog.project_id == project_id)
    log = q.order_by(AIReviewLog.checked_at.desc()).first()
    return {"success": True, "data": _criteria_log_to_dict(log, db) if log else None}


@router.post("/ai-review/criteria-check")
def run_criteria_check(body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    criterion = (body.get("criterion") or "").upper()
    entity_type = (body.get("entity_type") or "").upper()
    entity_id = body.get("entity_id")
    month = body.get("month") or None
    year = body.get("year") or None

    if criterion not in CRITERIA:
        raise HTTPException(400, "criterion must be SKILL or MANDAY")
    if entity_type not in ["PROJECT", "PHASE", "TASK", "MEMBER"] or not entity_id:
        raise HTTPException(400, "Valid entity_type and entity_id are required")

    project_id = _resolve_project_id(db, entity_type, int(entity_id), body.get("project_id"))

    if criterion == "SKILL":
        # The FE's current text wins — it's what the leader just looked at
        # and possibly tweaked; fall back to the saved/default prompt.
        prompt_text = (body.get("prompt_content") or "").strip()
        if not prompt_text:
            saved = _get_skill_prompt(db, project_id)
            prompt_text = saved.prompt_content if saved else DEFAULT_SKILL_CHECK_PROMPT
    else:
        # Manday is backend-owned: ignore anything the client sends.
        prompt_text = MANDAY_CHECK_PROMPT

    tasks = _collect_scope_tasks(db, entity_type, int(entity_id), project_id, month, year)
    if not tasks:
        raise HTTPException(400, f"Không có task nào trong phạm vi đánh giá ({_period_label(month, year)}).")
    truncated = len(tasks) > MAX_CRITERIA_TASKS
    task_rows = [_serialize_task_for_criteria(t) for t in tasks[:MAX_CRITERIA_TASKS]]
    task_by_id = {r["task_id"]: r for r in task_rows}

    if criterion == "SKILL":
        criterion_title = "đúng Skill Area và Skill"
        extra_fields = (
            '      "suggested_skill_area": "<Skill Area đề xuất nếu sai, ngược lại null>",\n'
            '      "suggested_skill": "<Skill đề xuất nếu sai, ngược lại null>"\n'
        )
        catalog = _skill_catalog_text(db)
        extra_context = f"\n\nDanh mục Skill hợp lệ (Category > Skill Area: các Skill):\n{catalog}" if catalog else ""
    else:
        criterion_title = "Manday EST hợp lý"
        extra_fields = '      "suggested_manday": <số ngày công đề xuất nếu chưa hợp lý, ngược lại null>\n'
        extra_context = ""

    system_prompt = (
        "Bạn là chuyên gia thẩm định chất lượng khai báo task trong quản lý dự án.\n"
        f"Nhiệm vụ: đánh giá TỪNG task có được fill {criterion_title} hay không. Chỉ nhận xét, KHÔNG sửa dữ liệu.\n\n"
        "BẮT BUỘC trả về DUY NHẤT một JSON hợp lệ (không bọc ```), đúng cấu trúc:\n"
        "{\n"
        '  "score": <số nguyên 0-100, chất lượng chung của nhóm task theo tiêu chí này>,\n'
        '  "summary_markdown": "<nhận xét tổng quan bằng tiếng Việt>",\n'
        '  "suggestions": [<các đề xuất chung, bắt đầu bằng động từ>],\n'
        '  "items": [\n'
        "    {\n"
        '      "task_id": <id task>,\n'
        '      "verdict": "OK" | "WARNING" | "WRONG",\n'
        '      "reason": "<lý do ngắn gọn bằng tiếng Việt>",\n'
        f"{extra_fields}"
        "    }\n"
        "  ]\n"
        "}\n"
        "Mỗi task trong dữ liệu phải có đúng một phần tử trong items."
    )

    # Only the fields each criterion actually needs, compact JSON — the Skill
    # request also carries the whole skill catalog, and an oversized prompt
    # is what the shared AI gateway most often rejects as "overloaded".
    if criterion == "SKILL":
        ai_fields = ("task_id", "detail", "phase", "task_group", "skill_area_category", "skill_area", "skill", "skill_belongs_to_area")
    else:
        ai_fields = ("task_id", "detail", "phase", "task_group", "priority", "status", "skill_area", "skill",
                     "manday_est", "manday_actual", "start_date", "end_date_est", "end_date_actual", "days_late")
    ai_rows = [{k: r[k] for k in ai_fields} for r in task_rows]

    truncated_note = f" — chỉ gửi {MAX_CRITERIA_TASKS} task đầu tiên" if truncated else ""
    user_content = (
        f"Tiêu chí đánh giá (prompt của Leader):\n{prompt_text}\n\n"
        f"Phạm vi: {_period_label(month, year)}{truncated_note}\n\n"
        f"Danh sách task:\n{json.dumps(ai_rows, ensure_ascii=False, separators=(',', ':'))}"
        f"{extra_context}"
    )

    try:
        result = chat_completion_json(
            system_prompt, user_content,
            max_tokens=min(8000, 800 + 150 * len(ai_rows)),
            temperature=0.2, timeout=120, retries=5,
        )
    except AiClientError as e:
        msg = str(e).lower()
        if "overloaded" in msg or "quá tải" in msg or "no available channel" in msg or "service_unavailable" in msg:
            raise HTTPException(503, "Dịch vụ AI đang quá tải (đã tự thử lại nhiều lần). Vui lòng bấm quét lại sau ít phút.")
        raise HTTPException(500, f"Error calling AI review: {e}")

    # Re-attach the real task fields from the DB — never trust the model to
    # echo names/numbers back correctly.
    items = []
    seen = set()
    for raw in result.get("items") or []:
        try:
            tid = int(raw.get("task_id"))
        except (TypeError, ValueError, AttributeError):
            continue
        row = task_by_id.get(tid)
        if not row or tid in seen:
            continue
        seen.add(tid)
        verdict = str(raw.get("verdict") or "WARNING").upper()
        if verdict not in ("OK", "WARNING", "WRONG"):
            verdict = "WARNING"
        item = {
            "task_id": tid,
            "task_code": row["task_code"],
            "detail": row["detail"],
            "assigned": row["assigned"],
            "skill_area": row["skill_area"],
            "skill": row["skill"],
            "skill_solution_id": row["skill_solution_id"],
            "skill_vendor_id": row["skill_vendor_id"],
            "manday_est": row["manday_est"],
            "manday_actual": row["manday_actual"],
            "status": row["status"],
            "verdict": verdict,
            "reason": raw.get("reason") or "",
        }
        if criterion == "SKILL":
            item["suggested_skill_area"] = raw.get("suggested_skill_area")
            item["suggested_skill"] = raw.get("suggested_skill")
            resolved = None
            if verdict != "OK" and item["suggested_skill"]:
                resolved = _resolve_skill_ids(db, item["suggested_skill_area"], item["suggested_skill"], row["skill_solution_id"])
            # Only a pair that really exists in the catalog can be applied.
            item["suggested_skill_solution_id"], item["suggested_skill_vendor_id"] = resolved or (None, None)
            if resolved:
                grp = db.query(Group).filter(Group.id == resolved[0]).first()
                sk = db.query(Skill).filter(Skill.id == resolved[1]).first()
                item["suggested_skill_area"], item["suggested_skill"] = grp.name, sk.name
        else:
            item["suggested_manday"] = _normalize_manday(raw.get("suggested_manday")) if verdict != "OK" else None
        items.append(item)

    try:
        score = int(result.get("score", 70))
    except (TypeError, ValueError):
        score = 70
    suggestions = result.get("suggestions") or []
    summary = result.get("summary_markdown") or "Không có chi tiết."
    final_status = "HAS_ISSUE" if any(i["verdict"] != "OK" for i in items) else "CHECKED"

    prompt_obj = _get_skill_prompt(db, project_id) if criterion == "SKILL" else None
    log = AIReviewLog(
        project_id=project_id,
        entity_type=f"{entity_type}:{criterion}:{_period_key(month, year)}",
        entity_id=int(entity_id),
        prompt_id=prompt_obj.id if prompt_obj else None,
        prompt_snapshot=f"[{_period_label(month, year)}]\n{prompt_text}",
        status=final_status,
        score=score,
        issues_json=items,
        suggestions_json=suggestions,
        result_markdown=summary,
        checked_by=current_user.id,
        checked_at=datetime.datetime.now(),
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    AuditService.record(
        db=db,
        user_id=current_user.id,
        module="AI Check",
        entity_type=entity_type,
        entity_id=int(entity_id),
        action="CHECK",
        project_id=project_id,
        new_value=f"{criterion} Score: {score}/100, Status: {final_status}",
        description=(
            f"Chạy AI Check {criterion} cho {entity_type} #{entity_id} ({_period_label(month, year)}) - "
            f"{sum(1 for i in items if i['verdict'] != 'OK')}/{len(items)} task chưa đạt"
        ),
    )
    db.commit()

    return {"success": True, "data": _criteria_log_to_dict(log, db)}


@router.post("/ai-review/criteria-apply")
def apply_criteria_suggestions(body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Write the AI's suggested Skill Area/Skill or Manday EST onto the task(s)
    of one criteria scan. `task_ids` limits it to those tasks; omitted =
    every applicable verdict ("Áp dụng tất cả").

    Goes through the regular task PATCH handler (update_task) so the exact
    same validation (skill-in-area, manday range, task-group manday/date
    caps), KPI recalculation and audit logging apply as a manual edit."""
    from .task_groups import update_task
    from ..utils.access import require_project

    log_id = body.get("log_id")
    only_ids = {int(i) for i in (body.get("task_ids") or [])}
    log = db.query(AIReviewLog).filter(AIReviewLog.id == log_id).first() if log_id else None
    if not log or ":" not in (log.entity_type or ""):
        raise HTTPException(404, "Không tìm thấy kết quả đánh giá.")
    # Calling update_task directly skips task_groups' router-level
    # project-access dependency — enforce the same scope check here.
    require_project(db, current_user, log.project_id)

    criterion = log.entity_type.split(":")[1]
    items = _attach_current_state(db, criterion, log.issues_json or [])
    targets = [i for i in items if i.get("applicable") and (not only_ids or i["task_id"] in only_ids)]
    if not targets:
        raise HTTPException(400, "Không có đề xuất nào có thể áp dụng (task có thể đã được sửa — hãy quét lại).")

    results = []
    for item in targets:
        if criterion == "SKILL":
            patch = {
                "skill_solution_id": item["suggested_skill_solution_id"],
                "skill_vendor_id": item["suggested_skill_vendor_id"],
            }
        else:
            patch = {"manday_est": item["suggested_manday"]}
        try:
            update_task(item["task_group_id"], item["task_id"], patch, db, current_user)
            results.append({"task_id": item["task_id"], "ok": True})
        except HTTPException as e:
            db.rollback()
            results.append({"task_id": item["task_id"], "ok": False, "error": str(e.detail)})
        except Exception as e:  # keep going for the remaining tasks
            db.rollback()
            results.append({"task_id": item["task_id"], "ok": False, "error": str(e)})

    db.expire_all()
    log = db.query(AIReviewLog).filter(AIReviewLog.id == log.id).first()
    return {"success": True, "data": {"results": results, "log": _criteria_log_to_dict(log, db)}}
