from app.database import SessionLocal
from app.models.task import Task
db = SessionLocal()
tasks = db.query(Task).all()
has_error = False
for t in tasks:
    if t.skill_solution_id is not None and not isinstance(t.skill_solution_id, int):
        print("Invalid skill_solution_id:", t.id, t.skill_solution_id)
        has_error = True
    if t.skill_vendor_id is not None and not isinstance(t.skill_vendor_id, int):
        print("Invalid skill_vendor_id:", t.id, t.skill_vendor_id)
        has_error = True
if not has_error:
    print("All tasks have valid IDs")
