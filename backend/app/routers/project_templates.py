from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import delete, func
from ..database import get_db
from ..models.phase import Phase
from ..models.task_group import TaskGroup
from ..models.task import Task
from ..models.project import Project, project_members
from ..models.project_template import (
    ProjectTemplate,
    ProjectTemplatePhase,
    ProjectTemplateTaskGroup,
    ProjectTemplateTask,
)
from ..utils.auth import get_current_user, require_super_admin
from ..utils.access import require_project_template_access
from ..utils.audit_service import AuditService
from ..utils.skill_validation import validate_skill_area_consistency

router = APIRouter(tags=["project-templates"])


def _validate_template_phases_payload(phases_payload, db: Session):
    phase_names = [(p.get("name") or "").strip() for p in phases_payload]
    if len(phase_names) != len(set(phase_names)):
        raise HTTPException(400, "Template contains duplicated phase names")

    for phase_payload in phases_payload:
        phase_name = (phase_payload.get("name") or "").strip()
        for group_payload in phase_payload.get("task_groups", []) or []:
            group_name = (group_payload.get("name") or "").strip()
            for task_payload in group_payload.get("tasks", []) or []:
                skill_solution_id = task_payload.get("skill_solution_id")
                skill_vendor_id = task_payload.get("skill_vendor_id")
                task_detail = (task_payload.get("detail") or "").strip() or "(chưa đặt tên)"
                if not skill_solution_id or not skill_vendor_id:
                    raise HTTPException(
                        400,
                        f"Task '{task_detail}' in group '{group_name}' (phase '{phase_name}') is missing "
                        "Skill Area/Skill — both are required."
                    )
                try:
                    validate_skill_area_consistency(skill_solution_id, skill_vendor_id, db)
                except HTTPException as exc:
                    raise HTTPException(
                        400,
                        f"Task '{task_detail}' in group '{group_name}' (phase '{phase_name}'): {exc.detail}"
                    )


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
    _validate_template_phases_payload(body.get("phases", []) or [], db)
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
        _validate_template_phases_payload(body.get("phases", []) or [], db)
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


@router.post("/project-templates/{template_id}/apply/{pid}")
def apply_project_template(
    template_id: int,
    pid: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    # `pid` kept as the parameter name for consistency with the rest of the
    # codebase's path-param convention (pid/phid/gid/tid) — aliased here so
    # the rest of this function (already tested) keeps reading `project_id`.
    project_id = pid
    template = db.query(ProjectTemplate).filter(ProjectTemplate.id == template_id).first()
    if not template:
        raise HTTPException(404, "Template not found")
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    # Apply Template access model — Admin / Workspace Leader / Project PM /
    # Project Leader only. Deliberately its own check (not the generic
    # require_route_project_access) because that generic dependency treats
    # ANY Leader as an instant pass with no Workspace check at all — see
    # can_apply_project_template()'s docstring for the full reasoning.
    require_project_template_access(db, current_user, project)

    # ── 1. Validate Template — defensive re-check, don't trust what Settings already
    # validated (the template may predate that validation, or have been written directly). ──
    if not (template.name or "").strip():
        raise HTTPException(400, "Template name is invalid")

    active_phases = sorted((p for p in template.phases if p.is_active), key=lambda item: item.sort_order or 0)
    if not active_phases:
        raise HTTPException(400, "Template has no active phases to apply")

    phase_names = [phase.name for phase in active_phases]
    if len(phase_names) != len(set(phase_names)):
        raise HTTPException(400, "Template contains duplicated phase names")

    for phase in active_phases:
        if not (phase.name or "").strip():
            raise HTTPException(400, "Template has a phase with an empty name")
        # TaskGroup is optional — a phase with 0 groups (e.g. Lab/PoC) is valid, no check needed.
        # Manday EST on a Task Group is NOT required to apply a template (deliberately reverted
        # 2026-09-12 — templates commonly lack it and blocking apply on it was more disruptive
        # than useful); a group applies with manday_est left as whatever the template has, incl. None.
        for group in phase.task_groups:
            # Task is optional too, but if one exists it must be fully specified. Any single
            # task missing a skill rejects the WHOLE apply — no silent skip, no fallback.
            for task in group.tasks:
                if not task.skill_solution_id or not task.skill_vendor_id:
                    raise HTTPException(
                        400,
                        f"Cannot apply template: task '{task.detail}' in group '{group.name}' "
                        f"(phase '{phase.name}') is missing Skill Area / Skill."
                    )
                try:
                    validate_skill_area_consistency(task.skill_solution_id, task.skill_vendor_id, db)
                except HTTPException as exc:
                    raise HTTPException(
                        400,
                        f"Cannot apply template: task '{task.detail}' in group '{group.name}' "
                        f"(phase '{phase.name}'): {exc.detail}"
                    )

    # ── 2. Validate Project readiness — not a Template concern, a precondition of the
    # target project. assigned_id/support_id are NOT NULL on Task, so at least one
    # assignable member/PM must exist. No system-wide fallback member. ──
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
    default_assigned_id = first_project_member_id or project.pm_id
    default_support_id = project.pm_id or first_project_member_id

    if not default_assigned_id or not default_support_id:
        raise HTTPException(
            400,
            "Cannot apply template: the project has no members and no PM to assign tasks to. "
            "Add at least one member to the project before applying a template."
        )

    # ── 3. Everything validated — now it's safe to overwrite the project's structure. ──
    existing_phases = db.query(Phase).filter(Phase.project_id == project.id).all()
    for phase in existing_phases:
        group_ids = [g.id for g in phase.task_groups]
        if group_ids:
            db.execute(delete(Task).where(Task.task_group_id.in_(group_ids)))
        db.execute(delete(TaskGroup).where(TaskGroup.phase_id == phase.id))
        db.delete(phase)
    db.flush()

    created_phase_count = 0
    created_group_count = 0
    created_task_count = 0
    for phase in active_phases:
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
                sort_order=group_idx,
            )
            db.add(created_group)
            db.flush()
            created_group_count += 1

            for task_idx, task in enumerate(sorted(group.tasks, key=lambda item: item.sort_order or 0), start=1):
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
                    skill_solution_id=task.skill_solution_id,
                    skill_vendor_id=task.skill_vendor_id,
                    sort_order=task_idx,
                )
                db.add(created_task)
                created_task_count += 1

    db.commit()
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Project", entity_type="Project",
        entity_id=project.id, action="UPDATE", project_id=project.id, resource_name=project.name,
        severity="CRITICAL",
        description=(
            f"Áp dụng template '{template.name}' — xóa và ghi đè toàn bộ Phase/Task Group/Task hiện có của dự án "
            f"'{project.name}' ({created_phase_count} phase, {created_group_count} task group, {created_task_count} task mới)"
        )
    )
    db.commit()
    return {
        "ok": True,
        "applied": True,
        "overwritten": True,
        "created_phase_count": created_phase_count,
        "created_group_count": created_group_count,
        "created_task_count": created_task_count,
    }


@router.post("/projects/{project_id}/export-to-template")
def export_project_to_template(
    project_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(require_super_admin),
):
    """Admin-only. Takes an Admin-selected subset of a real Project's Phase/TaskGroup/Task
    tree and copies it into a brand-new, independent ProjectTemplate (Settings → Project
    Template). This is a one-way snapshot copy — no FK is kept back to the source project,
    and only template-relevant fields are copied (no assignee/status/actuals/KPI data)."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Template name is required")

    duplicate = db.query(ProjectTemplate).filter(func.lower(ProjectTemplate.name) == name.lower()).first()
    if duplicate:
        raise HTTPException(400, f"A template named '{name}' already exists. Please choose a different name.")

    selected_phase_ids = {int(x) for x in (body.get("selected_phase_ids") or [])}
    selected_group_ids = {int(x) for x in (body.get("selected_task_group_ids") or [])}
    selected_task_ids = {int(x) for x in (body.get("selected_task_ids") or [])}

    all_phases = (
        db.query(Phase)
        .filter(Phase.project_id == project.id)
        .order_by(Phase.sort_order, Phase.id)
        .all()
    )

    # Selecting a Task/Group must keep its parent Group/Phase as a container even if the
    # frontend didn't explicitly include the parent id — mirrors the tree's "checking a
    # child keeps the ancestor (indeterminate state)" rule, enforced defensively here too.
    effective_group_ids = set(selected_group_ids)
    effective_phase_ids = set(selected_phase_ids)
    for phase in all_phases:
        for group in phase.task_groups:
            if group.id in effective_group_ids or any(t.id in selected_task_ids for t in group.tasks):
                effective_group_ids.add(group.id)
                effective_phase_ids.add(phase.id)

    export_phases = [p for p in all_phases if p.id in effective_phase_ids]
    if not export_phases:
        raise HTTPException(400, "Please select at least 1 Phase (or a Group/Task under it) to export.")

    phase_names = [p.name for p in export_phases]
    if len(phase_names) != len(set(phase_names)):
        raise HTTPException(
            400,
            "Selected phases contain duplicated names — rename them in the project before exporting."
        )
    for p in export_phases:
        if not (p.name or "").strip():
            raise HTTPException(400, f"Phase #{p.id} has an empty name and cannot be exported.")

    # Build the export tree first (read-only), validating every selected Task's Skill
    # fields BEFORE creating anything — only tasks the Admin actually selected are checked.
    export_tree = []  # [(phase, [(group, [task, ...]), ...]), ...]
    for phase in export_phases:
        groups = sorted(
            (g for g in phase.task_groups if g.id in effective_group_ids),
            key=lambda g: (g.sort_order or 0, g.id)
        )
        group_entries = []
        for group in groups:
            tasks = sorted(
                (t for t in group.tasks if t.id in selected_task_ids),
                key=lambda t: (t.sort_order or 0, t.id)
            )
            for task in tasks:
                if not task.skill_solution_id or not task.skill_vendor_id:
                    raise HTTPException(
                        400,
                        f"Task '{task.detail}' (group '{group.name}', phase '{phase.name}') is missing "
                        "Skill Area / Skill and cannot be exported. Add the missing skill in "
                        "the project or deselect this task."
                    )
                try:
                    validate_skill_area_consistency(task.skill_solution_id, task.skill_vendor_id, db)
                except HTTPException as exc:
                    raise HTTPException(
                        400,
                        f"Task '{task.detail}' (group '{group.name}', phase '{phase.name}') cannot be "
                        f"exported: {exc.detail}"
                    )
            group_entries.append((group, tasks))
        export_tree.append((phase, group_entries))

    # All validated — create the independent template.
    template = ProjectTemplate(name=name, description=(body.get("description") or "").strip() or None)
    db.add(template)
    db.flush()

    created_phase_count = 0
    created_group_count = 0
    created_task_count = 0
    for phase_idx, (phase, group_entries) in enumerate(export_tree, start=1):
        tpl_phase = ProjectTemplatePhase(
            template_id=template.id,
            name=phase.name,
            description=phase.description,
            sort_order=phase_idx,
            is_active=True,
        )
        db.add(tpl_phase)
        db.flush()
        created_phase_count += 1

        for group_idx, (group, tasks) in enumerate(group_entries, start=1):
            tpl_group = ProjectTemplateTaskGroup(
                phase_id=tpl_phase.id,
                name=group.name,
                description=group.description,
                manday_est=group.manday_est,
                sort_order=group_idx,
            )
            db.add(tpl_group)
            db.flush()
            created_group_count += 1

            for task_idx, task in enumerate(tasks, start=1):
                tpl_task = ProjectTemplateTask(
                    task_group_id=tpl_group.id,
                    detail=task.detail,
                    priority=task.priority,
                    manday_est=task.manday_est,
                    status="Waiting",  # template is a blueprint, never copies runtime status
                    skill_solution_id=task.skill_solution_id,
                    skill_vendor_id=task.skill_vendor_id,
                    sort_order=task_idx,
                )
                db.add(tpl_task)
                created_task_count += 1

    db.commit()
    db.refresh(template)
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Project Template", entity_type="ProjectTemplate",
        entity_id=template.id, action="CREATE", project_id=project.id, resource_name=template.name,
        description=(
            f"Xuất template '{template.name}' từ project '{project.name}' "
            f"({created_phase_count} phase, {created_group_count} task group, {created_task_count} task)"
        )
    )
    db.commit()
    return {
        "ok": True,
        "template_id": template.id,
        "name": template.name,
        "created_phase_count": created_phase_count,
        "created_group_count": created_group_count,
        "created_task_count": created_task_count,
    }
