"""
Skill taxonomy consistency check — shared by every entry point that writes
skill_solution_id (Skill Area / Group) and skill_vendor_id (Skill) onto a
Task, so a Task can never end up with a Skill that belongs to a different
Skill Area than the one stored on it. The frontend already pairs/clears
these two fields correctly, but the backend must not trust that — this is
the single source of truth all routers call into instead of re-implementing
the check ad hoc.
"""
from fastapi import HTTPException
from sqlalchemy.orm import Session
from ..models.skill_master import Skill


def validate_skill_area_consistency(skill_solution_id, skill_vendor_id, db: Session) -> None:
    if not skill_solution_id or not skill_vendor_id:
        return
    skill = db.query(Skill).filter(Skill.id == skill_vendor_id).first()
    if not skill:
        raise HTTPException(400, "Skill đã chọn không tồn tại.")
    if skill.group_id != skill_solution_id:
        raise HTTPException(400, "Skill đã chọn không thuộc Skill Area đã chọn.")
