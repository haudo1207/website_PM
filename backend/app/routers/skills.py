from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from ..database import get_db
from ..models.skill_master import Category, Group, Skill, user_skills
from ..models.task import Task
from ..utils.auth import require_admin, get_current_user

router = APIRouter()

def is_skill_used_by_task(db: Session, skill_name: str) -> bool:
    # Check if any task is assigned this skill vendor ID
    skill = db.query(Skill).filter(Skill.name.ilike(skill_name.strip())).first()
    if not skill:
        return False
    exists = db.query(Task).filter(Task.skill_vendor_id == skill.id).first()
    return exists is not None

def is_group_used_by_task(db: Session, group_name: str) -> bool:
    # Check if any task is assigned this skill solution group ID
    grp = db.query(Group).filter(Group.name.ilike(group_name.strip())).first()
    if not grp:
        return False
    exists = db.query(Task).filter(Task.skill_solution_id == grp.id).first()
    return exists is not None

def is_skill_used_by_member(db: Session, skill_id: int) -> bool:
    row = db.execute(
        text("SELECT 1 FROM user_skills WHERE skill_id = :sid LIMIT 1"),
        {"sid": skill_id}
    ).first()
    return row is not None

def is_group_used_by_member(db: Session, group_id: int) -> bool:
    # A group is used by member if any of its skills are used by member
    skills = db.query(Skill).filter(Skill.group_id == group_id).all()
    for s in skills:
        if is_skill_used_by_member(db, s.id):
            return True
    return False

def is_category_used_by_member(db: Session, category_id: int) -> bool:
    # A category is used by member if any of its groups are used by member
    groups = db.query(Group).filter(Group.category_id == category_id).all()
    for g in groups:
        if is_group_used_by_member(db, g.id):
            return True
    return False


# --- CATEGORIES ---

@router.get("/categories")
def list_categories(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    categories = db.query(Category).order_by(Category.id).all()
    result = []
    for c in categories:
        groups_list = []
        for g in c.groups:
            skills_list = []
            for s in g.skills:
                skills_list.append({
                    "id": s.id,
                    "name": s.name,
                    "group_id": s.group_id,
                    "is_active": s.is_active,
                    "is_used": is_skill_used_by_task(db, s.name) or is_skill_used_by_member(db, s.id)
                })
            groups_list.append({
                "id": g.id,
                "name": g.name,
                "category_id": g.category_id,
                "skills": skills_list,
                "is_used": is_group_used_by_task(db, g.name) or is_group_used_by_member(db, g.id)
            })
        result.append({
            "id": c.id,
            "name": c.name,
            "is_active": c.is_active,
            "groups": groups_list,
            "is_used": any(g["is_used"] for g in groups_list) or is_category_used_by_member(db, c.id)
        })
    return result

@router.post("/categories")
def create_category(body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(400, "Category name cannot be empty")
    existing = db.query(Category).filter(Category.name == name).first()
    if existing:
        raise HTTPException(400, "Category name already exists")
    
    cat = Category(name=name, is_active=True)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat

@router.put("/categories/{cid}")
def update_category(cid: int, body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    cat = db.query(Category).filter(Category.id == cid).first()
    if not cat:
        raise HTTPException(404, "Category not found")
    
    if "name" in body:
        name = body["name"].strip()
        if not name:
            raise HTTPException(400, "Category name cannot be empty")
        existing = db.query(Category).filter(Category.name == name, Category.id != cid).first()
        if existing:
            raise HTTPException(400, "Category name already exists")
        cat.name = name
        
    if "is_active" in body:
        cat.is_active = bool(body["is_active"])
        
    db.commit()
    db.refresh(cat)
    return cat

@router.delete("/categories/{cid}")
def delete_category(cid: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    cat = db.query(Category).filter(Category.id == cid).first()
    if not cat:
        raise HTTPException(404, "Category not found")
    
    # Check if category is used
    # 1. By member
    if is_category_used_by_member(db, cid):
        raise HTTPException(400, "Cannot delete category: One of its skills is currently assigned to a member.")
    
    # 2. By task
    for g in cat.groups:
        if is_group_used_by_task(db, g.name):
            raise HTTPException(400, f"Cannot delete category: Group '{g.name}' is used by a task.")
        for s in g.skills:
            if is_skill_used_by_task(db, s.name):
                raise HTTPException(400, f"Cannot delete category: Skill '{s.name}' is used by a task.")
                
    db.delete(cat)
    db.commit()
    return {"message": "Category deleted successfully"}


# --- GROUPS ---

@router.post("/groups")
def create_group(body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    name = body.get("name", "").strip()
    category_id = body.get("category_id")
    if not name:
        raise HTTPException(400, "Group name cannot be empty")
    if not category_id:
        raise HTTPException(400, "Category ID is required")
        
    cat = db.query(Category).filter(Category.id == category_id).first()
    if not cat:
        raise HTTPException(404, "Category not found")
        
    grp = Group(name=name, category_id=category_id)
    db.add(grp)
    db.commit()
    db.refresh(grp)
    return grp

@router.put("/groups/{gid}")
def update_group(gid: int, body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    grp = db.query(Group).filter(Group.id == gid).first()
    if not grp:
        raise HTTPException(404, "Group not found")
        
    if "name" in body:
        name = body["name"].strip()
        if not name:
            raise HTTPException(400, "Group name cannot be empty")
        grp.name = name
        
    if "category_id" in body:
        cat_id = body["category_id"]
        cat = db.query(Category).filter(Category.id == cat_id).first()
        if not cat:
            raise HTTPException(404, "Category not found")
        grp.category_id = cat_id
        
    db.commit()
    db.refresh(grp)
    return grp

@router.delete("/groups/{gid}")
def delete_group(gid: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    grp = db.query(Group).filter(Group.id == gid).first()
    if not grp:
        raise HTTPException(404, "Group not found")
        
    # Check if used
    if is_group_used_by_task(db, grp.name):
        raise HTTPException(400, f"Cannot delete group: Group name '{grp.name}' is used by a task.")
    if is_group_used_by_member(db, gid):
        raise HTTPException(400, "Cannot delete group: One of its skills is currently assigned to a member.")
        
    for s in grp.skills:
        if is_skill_used_by_task(db, s.name):
            raise HTTPException(400, f"Cannot delete group: Skill '{s.name}' is used by a task.")
            
    db.delete(grp)
    db.commit()
    return {"message": "Group deleted successfully"}


# --- SKILLS ---

@router.post("/skills")
def create_skill(body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    name = body.get("name", "").strip()
    group_id = body.get("group_id")
    if not name:
        raise HTTPException(400, "Skill name cannot be empty")
    if not group_id:
        raise HTTPException(400, "Group ID is required")
        
    grp = db.query(Group).filter(Group.id == group_id).first()
    if not grp:
        raise HTTPException(404, "Group not found")
        
    skill = Skill(name=name, group_id=group_id, is_active=True)
    db.add(skill)
    db.commit()
    db.refresh(skill)
    return skill

@router.put("/skills/{sid}")
def update_skill(sid: int, body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    skill = db.query(Skill).filter(Skill.id == sid).first()
    if not skill:
        raise HTTPException(404, "Skill not found")
        
    if "name" in body:
        name = body["name"].strip()
        if not name:
            raise HTTPException(400, "Skill name cannot be empty")
        skill.name = name
        
    if "group_id" in body:
        grp_id = body["group_id"]
        grp = db.query(Group).filter(Group.id == grp_id).first()
        if not grp:
            raise HTTPException(404, "Group not found")
        skill.group_id = grp_id
        
    if "is_active" in body:
        skill.is_active = bool(body["is_active"])
        
    db.commit()
    db.refresh(skill)
    return skill

@router.delete("/skills/{sid}")
def delete_skill(sid: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    skill = db.query(Skill).filter(Skill.id == sid).first()
    if not skill:
        raise HTTPException(404, "Skill not found")
        
    # Check if used
    if is_skill_used_by_task(db, skill.name):
        raise HTTPException(400, f"Cannot delete skill: Skill '{skill.name}' is used by a task.")
    if is_skill_used_by_member(db, sid):
        raise HTTPException(400, "Cannot delete skill: Skill is currently assigned to a member.")
        
    db.delete(skill)
    db.commit()
    return {"message": "Skill deleted successfully"}
