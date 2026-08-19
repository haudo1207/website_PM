from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import delete
from ..database import get_db
from ..models.phase import Phase
from ..models.task_group import TaskGroup
from ..models.task import Task
from ..models.member import Member
from ..models.project import Project, project_members
from ..models.project_template import (
    ProjectTemplate,
    ProjectTemplatePhase,
    ProjectTemplateTaskGroup,
    ProjectTemplateTask,
)
from ..models.skill_master import Group, Skill
from ..utils.auth import get_current_user, require_super_admin
from ..utils.audit_service import AuditService

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
        "manday_est": float(group.manday_est) if group.manday_est is not None else None,
        "sort_order": group.sort_order or 0,
        "tasks": [serialize_task(task) for task in sorted(group.tasks, key=lambda item: item.sort_order or 0)],
    }


def serialize_task(task: ProjectTemplateTask):
    return {
        "id": task.id,
        "detail": task.detail,
        "priority": task.priority,
        "manday_est": float(task.manday_est) if task.manday_est is not None else None,
        "status": task.status,
        "skill_solution_id": task.skill_solution_id,
        "skill_solution_name": task.skill_solution.name if task.skill_solution else None,
        "skill_vendor_id": task.skill_vendor_id,
        "skill_vendor_name": task.skill_vendor.name if task.skill_vendor else None,
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
def create_project_template(body: dict, db: Session = Depends(get_db), current_user=Depends(require_super_admin)):
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
                manday_est=group_payload.get("manday_est"),
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
                    skill_solution_id=task_payload.get("skill_solution_id"),
                    skill_vendor_id=task_payload.get("skill_vendor_id"),
                    sort_order=task_payload.get("sort_order", 0),
                )
                db.add(task)
    db.commit()
    db.refresh(template)
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Project Template", entity_type="ProjectTemplate",
        entity_id=template.id, action="CREATE", resource_name=template.name,
        description=f"Tạo project template '{template.name}'"
    )
    db.commit()
    return serialize_template(template)


@router.put("/project-templates/{template_id}")
def update_project_template(template_id: int, body: dict, db: Session = Depends(get_db), current_user=Depends(require_super_admin)):
    template = db.query(ProjectTemplate).filter(ProjectTemplate.id == template_id).first()
    if not template:
        raise HTTPException(404, "Template not found")
    old_dict = {"name": template.name, "description": template.description, "is_active": template.is_active}
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
                    manday_est=group_payload.get("manday_est"),
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
                        skill_solution_id=task_payload.get("skill_solution_id"),
                        skill_vendor_id=task_payload.get("skill_vendor_id"),
                        sort_order=task_payload.get("sort_order", 0),
                    )
                    db.add(task)

    db.commit()
    db.refresh(template)
    AuditService.record_diff(
        db=db, user_id=getattr(current_user, "id", None), module="Project Template", entity_type="ProjectTemplate",
        entity_id=template.id, old_dict=old_dict,
        new_dict={"name": template.name, "description": template.description, "is_active": template.is_active},
        field_labels={"name": "Tên", "description": "Mô tả", "is_active": "Đang áp dụng"},
    )
    if "phases" in body:
        AuditService.record(
            db=db, user_id=getattr(current_user, "id", None), module="Project Template", entity_type="ProjectTemplate",
            entity_id=template.id, action="UPDATE", resource_name=template.name,
            description=f"Cập nhật cấu trúc phase/task-group/task của template '{template.name}'"
        )
    db.commit()
    return serialize_template(template)


@router.delete("/project-templates/{template_id}")
def delete_project_template(template_id: int, db: Session = Depends(get_db), current_user=Depends(require_super_admin)):
    template = db.query(ProjectTemplate).filter(ProjectTemplate.id == template_id).first()
    if not template:
        raise HTTPException(404, "Template not found")
    tpl_name = template.name
    db.delete(template)
    db.commit()
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Project Template", entity_type="ProjectTemplate",
        entity_id=template_id, action="DELETE", resource_name=tpl_name,
        description=f"Xóa project template '{tpl_name}'"
    )
    db.commit()
    return {"ok": True}


@router.post("/project-templates/{template_id}/apply/{project_id}")
def apply_project_template(template_id: int, project_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
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

    # Task defaults come from the target project's own team, not the whole
    # system: Assigned = first Member of the project, Support = the project's PM.
    member_role_row = db.execute(
        project_members.select()
        .where(project_members.c.project_id == project.id, project_members.c.role == "Member")
        .order_by(project_members.c.id.asc())
    ).first()
    any_member_row = member_role_row or db.execute(
        project_members.select()
        .where(project_members.c.project_id == project.id)
        .order_by(project_members.c.id.asc())
    ).first()
    first_project_member_id = (member_role_row or any_member_row).member_id if (member_role_row or any_member_row) else None
    default_assigned_id = first_project_member_id or project.pm_id or (fallback_member.id if fallback_member else None)
    default_support_id = project.pm_id or first_project_member_id or default_assigned_id

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

        for group_idx, group in enumerate(sorted(phase.task_groups, key=lambda item: item.sort_order or 0), start=1):
            created_group = TaskGroup(
                phase_id=created_phase.id,
                name=group.name,
                description=group.description,
                manday_est=float(group.manday_est) if group.manday_est is not None else None,
                sort_order=created_phase_count,
            )
            db.add(created_group)
            db.flush()

            for task_idx, task in enumerate(sorted(group.tasks, key=lambda item: item.sort_order or 0), start=1):
                skill_solution_id = task.skill_solution_id or (fallback_group.id if fallback_group else None)
                skill_vendor_id = task.skill_vendor_id or (fallback_skill.id if fallback_skill else None)
                if not default_assigned_id or not default_support_id or not skill_solution_id or not skill_vendor_id:
                    continue
                created_task = Task(
                    task_group_id=created_group.id,
                    task_code=f"{group_idx}.{task_idx}",
                    detail=task.detail,
                    priority=task.priority,
                    manday_est=float(task.manday_est or 1),
                    status=task.status,
                    start_date=date.today(),
                    assigned_id=default_assigned_id,
                    support_id=default_support_id,
                    kpi_ratio_assign=90,
                    kpi_ratio_support=10,
                    skill_solution_id=skill_solution_id,
                    skill_vendor_id=skill_vendor_id,
                    sort_order=task_idx,
                )
                db.add(created_task)

    db.commit()
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Project", entity_type="Project",
        entity_id=project.id, action="UPDATE", project_id=project.id, resource_name=project.name,
        severity="CRITICAL",
        description=f"Áp dụng template '{template.name}' — xóa và ghi đè toàn bộ Phase/Task Group/Task hiện có của dự án '{project.name}' ({created_phase_count} phase mới)"
    )
    db.commit()
    return {"ok": True, "applied": True, "overwritten": True}
