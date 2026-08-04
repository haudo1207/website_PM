from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import delete
from ..database import get_db
from ..models.phase import Phase
from ..models.task_group import TaskGroup
from ..models.task import Task
from ..models.member import Member
from ..models.project import Project
from ..models.project_template import (
    ProjectTemplate,
    ProjectTemplatePhase,
    ProjectTemplateTaskGroup,
    ProjectTemplateTask,
)
from ..models.skill_master import Group, Skill
from ..utils.auth import get_current_user, require_super_admin

router = APIRouter(tags=["project-templates"])


def serialize_template(template: ProjectTemplate):
    return {
        "id": template.id,
        "name": template.name,
        "description": template.description,
        "is_active": template.is_active,
        "phases": [serialize_phase(phase) for phase in sorted(template.phases, key=lambda item: item.sort_order or 0)],
    }


def serialize_phase(phase: ProjectTemplatePhase):
    return {
        "id": phase.id,
        "name": phase.name,
        "description": phase.description,
        "sort_order": phase.sort_order or 0,
        "is_active": phase.is_active,
        "task_groups": [serialize_task_group(group) for group in sorted(phase.task_groups, key=lambda item: item.sort_order or 0)],
    }


def serialize_task_group(group: ProjectTemplateTaskGroup):
    return {
        "id": group.id,
        "name": group.name,
        "description": group.description,
        "sort_order": group.sort_order or 0,
        "tasks": [serialize_task(task) for task in sorted(group.tasks, key=lambda item: item.sort_order or 0)],
    }


def serialize_task(task: ProjectTemplateTask):
    return {
        "id": task.id,
        "detail": task.detail,
        "priority": task.priority,
        "manday_est": task.manday_est,
        "status": task.status,
        "sort_order": task.sort_order or 0,
    }


@router.get("/project-templates")
def list_project_templates(db: Session = Depends(get_db), _=Depends(get_current_user)):
    templates = db.query(ProjectTemplate).filter(ProjectTemplate.is_active == True).order_by(ProjectTemplate.id.asc()).all()
    return [serialize_template(template) for template in templates]


@router.get("/project-templates/{template_id}")
def get_project_template(template_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    template = db.query(ProjectTemplate).filter(ProjectTemplate.id == template_id).first()
    if not template:
        raise HTTPException(404, "Template not found")
    return serialize_template(template)


@router.post("/project-templates")
def create_project_template(body: dict, db: Session = Depends(get_db), _=Depends(require_super_admin)):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Template name is required")
    template = ProjectTemplate(name=name, description=body.get("description"), is_active=body.get("is_active", True))
    db.add(template)
    db.flush()

    for phase_payload in body.get("phases", []) or []:
        phase = ProjectTemplatePhase(
            template_id=template.id,
            name=(phase_payload.get("name") or "").strip(),
            description=phase_payload.get("description"),
            sort_order=phase_payload.get("sort_order", 0),
            is_active=phase_payload.get("is_active", True),
        )
        db.add(phase)
        db.flush()
        for group_payload in phase_payload.get("task_groups", []) or []:
            group = ProjectTemplateTaskGroup(
                phase_id=phase.id,
                name=(group_payload.get("name") or "").strip(),
                description=group_payload.get("description"),
                sort_order=group_payload.get("sort_order", 0),
            )
            db.add(group)
            db.flush()
            for task_payload in group_payload.get("tasks", []) or []:
                task = ProjectTemplateTask(
                    task_group_id=group.id,
                    detail=(task_payload.get("detail") or "").strip(),
                    priority=task_payload.get("priority", "Normal"),
                    manday_est=task_payload.get("manday_est", 1),
                    status=task_payload.get("status", "Waiting"),
                    sort_order=task_payload.get("sort_order", 0),
                )
                db.add(task)
    db.commit()
    db.refresh(template)
    return serialize_template(template)


@router.put("/project-templates/{template_id}")
def update_project_template(template_id: int, body: dict, db: Session = Depends(get_db), _=Depends(require_super_admin)):
    template = db.query(ProjectTemplate).filter(ProjectTemplate.id == template_id).first()
    if not template:
        raise HTTPException(404, "Template not found")
    if "name" in body:
        name = (body.get("name") or "").strip()
        if not name:
            raise HTTPException(400, "Template name is required")
        template.name = name
    if "description" in body:
        template.description = body.get("description")
    if "is_active" in body:
        template.is_active = bool(body.get("is_active"))

    if "phases" in body:
        for existing in list(template.phases):
            db.delete(existing)
        db.flush()
        for phase_payload in body.get("phases", []) or []:
            phase = ProjectTemplatePhase(
                template_id=template.id,
                name=(phase_payload.get("name") or "").strip(),
                description=phase_payload.get("description"),
                sort_order=phase_payload.get("sort_order", 0),
                is_active=phase_payload.get("is_active", True),
            )
            db.add(phase)
            db.flush()
            for group_payload in phase_payload.get("task_groups", []) or []:
                group = ProjectTemplateTaskGroup(
                    phase_id=phase.id,
                    name=(group_payload.get("name") or "").strip(),
                    description=group_payload.get("description"),
                    sort_order=group_payload.get("sort_order", 0),
                )
                db.add(group)
                db.flush()
                for task_payload in group_payload.get("tasks", []) or []:
                    task = ProjectTemplateTask(
                        task_group_id=group.id,
                        detail=(task_payload.get("detail") or "").strip(),
                        priority=task_payload.get("priority", "Normal"),
                        manday_est=task_payload.get("manday_est", 1),
                        status=task_payload.get("status", "Waiting"),
                        sort_order=task_payload.get("sort_order", 0),
                    )
                    db.add(task)

    db.commit()
    db.refresh(template)
    return serialize_template(template)


@router.delete("/project-templates/{template_id}")
def delete_project_template(template_id: int, db: Session = Depends(get_db), _=Depends(require_super_admin)):
    template = db.query(ProjectTemplate).filter(ProjectTemplate.id == template_id).first()
    if not template:
        raise HTTPException(404, "Template not found")
    db.delete(template)
    db.commit()
    return {"ok": True}


@router.post("/project-templates/{template_id}/apply/{project_id}")
def apply_project_template(template_id: int, project_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    template = db.query(ProjectTemplate).filter(ProjectTemplate.id == template_id).first()
    if not template:
        raise HTTPException(404, "Template not found")
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    phase_names = {phase.name for phase in template.phases}
    if len(phase_names) != len(template.phases):
        raise HTTPException(400, "Template contains duplicated phase names")

    # ── GHI ĐÈ: Xóa toàn bộ Phase/Task hiện tại của dự án trước khi tạo mới ──
    existing_phases = db.query(Phase).filter(Phase.project_id == project.id).all()
    for phase in existing_phases:
        # Xóa tất cả Task thuộc các TaskGroup của Phase này
        group_ids = [g.id for g in phase.task_groups]
        if group_ids:
            db.execute(delete(Task).where(Task.task_group_id.in_(group_ids)))
        # Xóa tất cả TaskGroup của Phase
        db.execute(delete(TaskGroup).where(TaskGroup.phase_id == phase.id))
        # Xóa Phase
        db.delete(phase)
    db.flush()

    fallback_member = db.query(Member).order_by(Member.id.asc()).first()
    fallback_group = db.query(Group).order_by(Group.id.asc()).first()
    fallback_skill = db.query(Skill).order_by(Skill.id.asc()).first()

    created_phase_count = 0
    for phase in sorted(template.phases, key=lambda item: item.sort_order or 0):
        if not phase.is_active:
            continue
        created_phase = Phase(
            project_id=project.id,
            name=phase.name,
            description=phase.description,
            sort_order=created_phase_count + 1,
            status="Waiting",
        )
        db.add(created_phase)
        db.flush()
        created_phase_count += 1

        for group in sorted(phase.task_groups, key=lambda item: item.sort_order or 0):
            created_group = TaskGroup(
                phase_id=created_phase.id,
                name=group.name,
                description=group.description,
                sort_order=created_phase_count,
            )
            db.add(created_group)
            db.flush()

            for task in sorted(group.tasks, key=lambda item: item.sort_order or 0):
                if not fallback_member or not fallback_group or not fallback_skill:
                    continue
                created_task = Task(
                    task_group_id=created_group.id,
                    detail=task.detail,
                    priority=task.priority,
                    manday_est=float(task.manday_est or 1),
                    status=task.status,
                    start_date=date.today(),
                    assigned_id=fallback_member.id,
                    support_id=fallback_member.id,
                    kpi_ratio_assign=100,
                    kpi_ratio_support=0,
                    skill_solution_id=fallback_group.id,
                    skill_vendor_id=fallback_skill.id,
                    sort_order=0,
                )
                db.add(created_task)

    db.commit()
    return {"ok": True, "applied": True, "overwritten": True}
