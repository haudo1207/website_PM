from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import json

from ..database import get_db
from ..models.system_category import Position, Department, TaskPriority, TaskStatus, Team, Customer
from ..models.user import User
from ..models.task import Task
from ..utils.auth import require_admin, get_current_user

router = APIRouter()

# ----------------- POSITIONS -----------------
@router.get("/positions")
def list_positions(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(Position).order_by(Position.name.asc()).all()

@router.post("/positions")
def create_position(body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên chức vụ không được để trống")
    
    desc = str(body.get("description", "")).strip()
    
    existing = db.query(Position).filter(Position.name.ilike(name)).first()
    if existing:
        raise HTTPException(400, f"Chức vụ '{name}' đã tồn tại")
        
    pos = Position(name=name, description=desc or None)
    db.add(pos)
    db.commit()
    db.refresh(pos)
    return pos

@router.put("/positions/{id}")
def update_position(id: int, body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    pos = db.query(Position).filter(Position.id == id).first()
    if not pos:
        raise HTTPException(404, "Không tìm thấy chức vụ")
        
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên chức vụ không được để trống")
        
    desc = str(body.get("description", "")).strip()
    
    existing = db.query(Position).filter(Position.name.ilike(name), Position.id != id).first()
    if existing:
        raise HTTPException(400, f"Chức vụ '{name}' đã tồn tại")
        
    old_name = pos.name
    pos.name = name
    pos.description = desc or None
    
    # Cascade name update to existing users
    if old_name.lower() != name.lower():
        db.query(User).filter(User.position == old_name).update({User.position: name})
        
    db.commit()
    db.refresh(pos)
    return pos

@router.delete("/positions/{id}")
def delete_position(id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    pos = db.query(Position).filter(Position.id == id).first()
    if not pos:
        raise HTTPException(404, "Không tìm thấy chức vụ")
        
    # Check if used by any user
    user_using = db.query(User).filter(User.position == pos.name).first()
    if user_using:
        raise HTTPException(400, f"Không thể xóa chức vụ '{pos.name}' vì đang được sử dụng bởi thành viên khác")
        
    db.delete(pos)
    db.commit()
    return {"message": "Đã xóa chức vụ thành công"}


# ----------------- DEPARTMENTS -----------------
@router.get("/departments")
def list_departments(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(Department).order_by(Department.name.asc()).all()

@router.post("/departments")
def create_department(body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên phòng ban không được để trống")
    
    desc = str(body.get("description", "")).strip()
    
    existing = db.query(Department).filter(Department.name.ilike(name)).first()
    if existing:
        raise HTTPException(400, f"Phòng ban '{name}' đã tồn tại")
        
    dept = Department(name=name, description=desc or None)
    db.add(dept)
    db.commit()
    db.refresh(dept)
    return dept

@router.put("/departments/{id}")
def update_department(id: int, body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    dept = db.query(Department).filter(Department.id == id).first()
    if not dept:
        raise HTTPException(404, "Không tìm thấy phòng ban")
        
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên phòng ban không được để trống")
        
    desc = str(body.get("description", "")).strip()
    
    existing = db.query(Department).filter(Department.name.ilike(name), Department.id != id).first()
    if existing:
        raise HTTPException(400, f"Phòng ban '{name}' đã tồn tại")
        
    old_name = dept.name
    dept.name = name
    dept.description = desc or None
    
    # Cascade name update to existing users
    if old_name.lower() != name.lower():
        db.query(User).filter(User.department == old_name).update({User.department: name})
        
    db.commit()
    db.refresh(dept)
    return dept

@router.delete("/departments/{id}")
def delete_department(id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    dept = db.query(Department).filter(Department.id == id).first()
    if not dept:
        raise HTTPException(404, "Không tìm thấy phòng ban")
        
    # Check if used by any user
    user_using = db.query(User).filter(User.department == dept.name).first()
    if user_using:
        raise HTTPException(400, f"Không thể xóa phòng ban '{dept.name}' vì đang được sử dụng bởi thành viên khác")
        
    db.delete(dept)
    db.commit()
    return {"message": "Đã xóa phòng ban thành công"}


# ----------------- PRIORITIES -----------------
@router.get("/priorities")
def list_priorities(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(TaskPriority).order_by(TaskPriority.kpi_base.asc()).all()

@router.post("/priorities")
def create_priority(body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên mức độ ưu tiên không được để trống")
        
    try:
        kpi = int(body.get("kpi_base", 6))
    except (ValueError, TypeError):
        raise HTTPException(400, "KPI Base phải là số nguyên")
        
    if kpi <= 0:
        raise HTTPException(400, "KPI Base phải lớn hơn 0")
        
    color = str(body.get("color", "")).strip()
    if not color:
        raise HTTPException(400, "Màu sắc hiển thị không được để trống")
        
    existing = db.query(TaskPriority).filter(TaskPriority.name.ilike(name)).first()
    if existing:
        raise HTTPException(400, f"Mức độ ưu tiên '{name}' đã tồn tại")
        
    prio = TaskPriority(name=name, kpi_base=kpi, color=color)
    db.add(prio)
    db.commit()
    db.refresh(prio)
    return prio

@router.put("/priorities/{id}")
def update_priority(id: int, body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    prio = db.query(TaskPriority).filter(TaskPriority.id == id).first()
    if not prio:
        raise HTTPException(404, "Không tìm thấy mức độ ưu tiên")
        
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên mức độ ưu tiên không được để trống")
        
    try:
        kpi = int(body.get("kpi_base", prio.kpi_base))
    except (ValueError, TypeError):
        raise HTTPException(400, "KPI Base phải là số nguyên")
        
    if kpi <= 0:
        raise HTTPException(400, "KPI Base phải lớn hơn 0")
        
    color = str(body.get("color", prio.color)).strip()
    if not color:
        raise HTTPException(400, "Màu sắc hiển thị không được để trống")
        
    existing = db.query(TaskPriority).filter(TaskPriority.name.ilike(name), TaskPriority.id != id).first()
    if existing:
        raise HTTPException(400, f"Mức độ ưu tiên '{name}' đã tồn tại")
        
    old_name = prio.name
    prio.name = name
    prio.kpi_base = kpi
    prio.color = color
    
    # Cascade name updates inside task priority column
    if old_name.lower() != name.lower():
        db.query(Task).filter(Task.priority.ilike(old_name)).update({Task.priority: name}, synchronize_session=False)
                
    db.commit()
    db.refresh(prio)
    return prio

@router.delete("/priorities/{id}")
def delete_priority(id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    prio = db.query(TaskPriority).filter(TaskPriority.id == id).first()
    if not prio:
        raise HTTPException(404, "Không tìm thấy mức độ ưu tiên")
        
    # Check if used by any task
    in_use = db.query(Task).filter(Task.priority.ilike(prio.name)).first() is not None
            
    if in_use:
        raise HTTPException(400, f"Không thể xóa mức độ ưu tiên '{prio.name}' vì đang được sử dụng bởi một hoặc nhiều task")
        
    db.delete(prio)
    db.commit()
    return {"message": "Đã xóa mức độ ưu tiên thành công"}


# ----------------- STATUSES -----------------
@router.get("/statuses")
def list_statuses(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(TaskStatus).order_by(TaskStatus.name.asc()).all()

@router.post("/statuses")
def create_status(body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên trạng thái không được để trống")
        
    existing = db.query(TaskStatus).filter(TaskStatus.name.ilike(name)).first()
    if existing:
        raise HTTPException(400, f"Trạng thái '{name}' đã tồn tại")
        
    st = TaskStatus(name=name)
    db.add(st)
    db.commit()
    db.refresh(st)
    return st

@router.put("/statuses/{id}")
def update_status(id: int, body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    st = db.query(TaskStatus).filter(TaskStatus.id == id).first()
    if not st:
        raise HTTPException(404, "Không tìm thấy trạng thái")
        
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên trạng thái không được để trống")
        
    existing = db.query(TaskStatus).filter(TaskStatus.name.ilike(name), TaskStatus.id != id).first()
    if existing:
        raise HTTPException(400, f"Trạng thái '{name}' đã tồn tại")
        
    old_name = st.name
    st.name = name
    
    # Cascade name updates inside task status column
    if old_name.lower() != name.lower():
        db.query(Task).filter(Task.status.ilike(old_name)).update({Task.status: name}, synchronize_session=False)
                
    db.commit()
    db.refresh(st)
    return st

@router.delete("/statuses/{id}")
def delete_status(id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    st = db.query(TaskStatus).filter(TaskStatus.id == id).first()
    if not st:
        raise HTTPException(404, "Không tìm thấy trạng thái")
        
    # Check if used by any task
    in_use = db.query(Task).filter(Task.status.ilike(st.name)).first() is not None
            
    if in_use:
        raise HTTPException(400, f"Không thể xóa trạng thái '{st.name}' vì đang được sử dụng bởi một hoặc nhiều task")
        
    db.delete(st)
    db.commit()
    return {"message": "Đã xóa trạng thái thành công"}


# ----------------- TEAMS -----------------
@router.get("/teams")
def list_teams(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(Team).order_by(Team.name.asc()).all()

@router.post("/teams")
def create_team(body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên team không được để trống")
    if db.query(Team).filter(Team.name.ilike(name)).first():
        raise HTTPException(400, f"Team '{name}' đã tồn tại")
    t = Team(name=name, description=body.get("description") or None)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t

@router.put("/teams/{id}")
def update_team(id: int, body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    t = db.query(Team).filter(Team.id == id).first()
    if not t:
        raise HTTPException(404, "Không tìm thấy team")
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên team không được để trống")
    dup = db.query(Team).filter(Team.name.ilike(name), Team.id != id).first()
    if dup:
        raise HTTPException(400, f"Team '{name}' đã tồn tại")
    t.name = name
    t.description = body.get("description") or None
    db.commit()
    db.refresh(t)
    return t

@router.delete("/teams/{id}")
def delete_team(id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    t = db.query(Team).filter(Team.id == id).first()
    if not t:
        raise HTTPException(404, "Không tìm thấy team")
    db.delete(t)
    db.commit()
    return {"message": "Đã xóa team thành công"}

# ----------------- CUSTOMERS -----------------
@router.get("/customers")
def list_customers(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(Customer).order_by(Customer.name.asc()).all()

@router.post("/customers")
def create_customer(body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên khách hàng không được để trống")
    if db.query(Customer).filter(Customer.name.ilike(name)).first():
        raise HTTPException(400, f"Khách hàng '{name}' đã tồn tại")
    c = Customer(name=name, description=body.get("description") or None)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c

@router.put("/customers/{id}")
def update_customer(id: int, body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    c = db.query(Customer).filter(Customer.id == id).first()
    if not c:
        raise HTTPException(404, "Không tìm thấy khách hàng")
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Tên khách hàng không được để trống")
    dup = db.query(Customer).filter(Customer.name.ilike(name), Customer.id != id).first()
    if dup:
        raise HTTPException(400, f"Khách hàng '{name}' đã tồn tại")
    c.name = name
    c.description = body.get("description") or None
    db.commit()
    db.refresh(c)
    return c

@router.delete("/customers/{id}")
def delete_customer(id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    c = db.query(Customer).filter(Customer.id == id).first()
    if not c:
        raise HTTPException(404, "Không tìm thấy khách hàng")
    db.delete(c)
    db.commit()
    return {"message": "Đã xóa khách hàng thành công"}
