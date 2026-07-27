"""
Export real Infrastructure & Markee Customer & Project data to SQL script.
Excludes test projects/customers.
"""
import os
import sys

# Ensure UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

from app.main import app
from app.database import SessionLocal
from app.models.system_category import Customer
from app.models.project import Project, project_members, ProjectLink
from app.models.phase import Phase
from app.models.task_group import TaskGroup
from app.models.task import Task

def is_test_project(proj):
    name = (proj.name or '').lower()
    code = (proj.code or '').lower()
    test_keywords = ['test', 'dự án mẫu', 'demo', 'testing']
    return any(kw in name or kw in code for kw in test_keywords)

def export_to_sql(output_filename="real_data_infra_markee.sql"):
    db = SessionLocal()
    
    # 1. Fetch real projects
    all_projects = db.query(Project).all()
    real_projects = [p for p in all_projects if not is_test_project(p)]
    real_project_ids = set(p.id for p in real_projects)
    
    # 2. Fetch real customer IDs referenced by real projects
    real_cust_ids = set(p.customer_id for p in real_projects if p.customer_id is not None)
    all_customers = db.query(Customer).all()
    real_customers = [c for c in all_customers if c.id in real_cust_ids or not (c.name and 'test' in c.name.lower())]
    
    # 3. Fetch phases, task groups, tasks
    real_phases = db.query(Phase).filter(Phase.project_id.in_(real_project_ids)).all()
    real_phase_ids = set(ph.id for ph in real_phases)
    
    real_task_groups = db.query(TaskGroup).filter(TaskGroup.phase_id.in_(real_phase_ids)).all()
    real_tg_ids = set(tg.id for tg in real_task_groups)
    
    real_tasks = db.query(Task).filter(Task.task_group_id.in_(real_tg_ids)).all()
    
    # 4. Fetch project links & members junction
    real_links = db.query(ProjectLink).filter(ProjectLink.project_id.in_(real_project_ids)).all()
    
    proj_mem_rows = db.execute(
        project_members.select().where(project_members.c.project_id.in_(real_project_ids))
    ).fetchall()

    print(f"Export Summary:")
    print(f" - Real Customers: {len(real_customers)}")
    print(f" - Real Projects: {len(real_projects)}")
    print(f" - Phases: {len(real_phases)}")
    print(f" - Task Groups: {len(real_task_groups)}")
    print(f" - Tasks: {len(real_tasks)}")
    print(f" - Project Links: {len(real_links)}")
    print(f" - Project Member Assignments: {len(proj_mem_rows)}")

    # Generate SQL file
    lines = []
    lines.append("-- SQL Export: Real Infrastructure & Markee Data Only\n")
    lines.append("BEGIN;\n\n")
    
    # Clean string helper
    def clean_str(val):
        if val is None:
            return "NULL"
        s = str(val).replace("'", "''")
        return f"'{s}'"

    def clean_num(val):
        if val is None:
            return "NULL"
        return str(val)

    # Customers INSERT
    lines.append("-- 1. CUSTOMERS\n")
    for c in real_customers:
        lines.append(
            f"INSERT INTO customers (id, name, description, business_unit) "
            f"VALUES ({c.id}, {clean_str(c.name)}, {clean_str(c.description)}, {clean_str(c.business_unit)}) "
            f"ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, business_unit=EXCLUDED.business_unit;\n"
        )

    # Projects INSERT
    lines.append("\n-- 2. PROJECTS\n")
    for p in real_projects:
        lines.append(
            f"INSERT INTO projects (id, name, code, customer_name, customer_id, year, pm_id, technical_leader_id, description, status, current_phase, business, data_scope) "
            f"VALUES ({p.id}, {clean_str(p.name)}, {clean_str(p.code)}, {clean_str(p.customer_name)}, {clean_num(p.customer_id)}, {clean_num(p.year)}, {clean_num(p.pm_id)}, {clean_num(p.technical_leader_id)}, {clean_str(p.description)}, {clean_str(p.status)}, {clean_str(p.current_phase)}, {clean_str(p.business)}, {clean_str(p.data_scope)}) "
            f"ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, business=EXCLUDED.business, data_scope=EXCLUDED.data_scope;\n"
        )

    # Phases INSERT
    lines.append("\n-- 3. PHASES\n")
    for ph in real_phases:
        lines.append(
            f"INSERT INTO phases (id, project_id, name, description, sort_order, status) "
            f"VALUES ({ph.id}, {ph.project_id}, {clean_str(ph.name)}, {clean_str(ph.description)}, {ph.sort_order or 0}, {clean_str(ph.status)}) "
            f"ON CONFLICT (id) DO NOTHING;\n"
        )

    # Task Groups INSERT
    lines.append("\n-- 4. TASK GROUPS\n")
    for tg in real_task_groups:
        lines.append(
            f"INSERT INTO task_groups (id, phase_id, name, description, status, progress, manday_est, sort_order) "
            f"VALUES ({tg.id}, {tg.phase_id}, {clean_str(tg.name)}, {clean_str(tg.description)}, {clean_str(tg.status)}, {clean_num(tg.progress)}, {clean_num(tg.manday_est)}, {clean_num(tg.sort_order)}) "
            f"ON CONFLICT (id) DO NOTHING;\n"
        )

    # Tasks INSERT
    lines.append("\n-- 5. TASKS\n")
    for t in real_tasks:
        lines.append(
            f"INSERT INTO tasks_v2 (id, task_group_id, task_code, detail, priority, manday_est, status, assigned_id, support_id, kpi_ratio_assign, kpi_ratio_support, skill_solution_id) "
            f"VALUES ({t.id}, {t.task_group_id}, {clean_str(t.task_code)}, {clean_str(t.detail)}, {clean_str(t.priority)}, {clean_num(t.manday_est)}, {clean_str(t.status)}, {clean_num(t.assigned_id)}, {clean_num(t.support_id)}, {clean_num(t.kpi_ratio_assign)}, {clean_num(t.kpi_ratio_support)}, {clean_num(t.skill_solution_id)}) "
            f"ON CONFLICT (id) DO NOTHING;\n"
        )

    # Project Members INSERT
    lines.append("\n-- 6. PROJECT MEMBERS ASSIGNMENTS\n")
    for pm_row in proj_mem_rows:
        lines.append(
            f"INSERT INTO project_members_v2 (id, project_id, member_id, role) "
            f"VALUES ({pm_row.id}, {pm_row.project_id}, {pm_row.member_id}, {clean_str(pm_row.role)}) "
            f"ON CONFLICT (id) DO NOTHING;\n"
        )

    # Update sequence IDs
    lines.append("\n-- 7. UPDATE SEQUENCE IDS\n")
    lines.append("SELECT setval(pg_get_serial_sequence('customers', 'id'), COALESCE((SELECT MAX(id) FROM customers), 1));\n")
    lines.append("SELECT setval(pg_get_serial_sequence('projects', 'id'), COALESCE((SELECT MAX(id) FROM projects), 1));\n")
    lines.append("SELECT setval(pg_get_serial_sequence('phases', 'id'), COALESCE((SELECT MAX(id) FROM phases), 1));\n")
    lines.append("SELECT setval(pg_get_serial_sequence('task_groups', 'id'), COALESCE((SELECT MAX(id) FROM task_groups), 1));\n")
    lines.append("SELECT setval(pg_get_serial_sequence('tasks_v2', 'id'), COALESCE((SELECT MAX(id) FROM tasks_v2), 1));\n")
    lines.append("SELECT setval(pg_get_serial_sequence('project_members_v2', 'id'), COALESCE((SELECT MAX(id) FROM project_members_v2), 1));\n")

    lines.append("\nCOMMIT;\n")

    file_path = os.path.join("d:\\DoHau_TTNN\\Plane.so", output_filename)
    with open(file_path, "w", encoding="utf-8") as f:
        f.writelines(lines)

    print(f"\nSuccessfully generated clean SQL file: {file_path}")

if __name__ == "__main__":
    export_to_sql()
