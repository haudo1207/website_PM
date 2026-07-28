import os
import sys

# Setup environment variables for DB connection
# Use Docker port mapping or default
os.environ['DATABASE_URL'] = 'postgresql://postgres:postgres@localhost:5432/postgres'

# Append backend directory to path
sys.path.append('d:/projectsCompany/pm-new/backend')

from app.database import SessionLocal
from app.models.task import Task
from app.models.member import Member
from sqlalchemy import func, extract
from sqlalchemy.orm import joinedload

db = SessionLocal()

try:
    # Build assigned query
    q_assigned = db.query(
        Task.assigned_id.label('member_id'),
        Task.kpi_assigned.label('kpi_final'),
        (Task.manday_actual * Task.kpi_ratio_assign / 100.0).label('manday_actual'),
        (Task.manday_est * Task.kpi_ratio_assign / 100.0).label('manday_est'),
        (Task.kpi_base * Task.kpi_ratio_assign / 100.0).label('kpi_base'),
        Task.id.label('task_id')
    ).filter(Task.status == 'Done', Task.end_date_actual.isnot(None), Task.assigned_id.isnot(None))

    # Build support query
    q_support = db.query(
        Task.support_id.label('member_id'),
        Task.kpi_support.label('kpi_final'),
        (Task.manday_actual * Task.kpi_ratio_support / 100.0).label('manday_actual'),
        (Task.manday_est * Task.kpi_ratio_support / 100.0).label('manday_est'),
        (Task.kpi_base * Task.kpi_ratio_support / 100.0).label('kpi_base'),
        Task.id.label('task_id')
    ).filter(Task.status == 'Done', Task.end_date_actual.isnot(None), Task.support_id.isnot(None))

    union_q = q_assigned.union_all(q_support).subquery('union_q')

    task_query = db.query(
        union_q.c.member_id,
        func.sum(union_q.c.kpi_final).label('kpi_total'),
        func.count(union_q.c.task_id).label('task_count'),
        func.sum(union_q.c.manday_actual).label('manday_total'),
        func.sum(union_q.c.manday_est).label('manday_est_total'),
        func.sum(union_q.c.kpi_base).label('kpi_base_total')
    ).group_by(union_q.c.member_id)

    kpi_subq = task_query.subquery()

    q = db.query(
        Member.display_name,
        func.coalesce(kpi_subq.c.kpi_total, 0).label('kpi_total'),
        func.coalesce(kpi_subq.c.task_count, 0).label('task_count'),
        func.coalesce(kpi_subq.c.manday_total, 0).label('manday_total'),
        func.coalesce(kpi_subq.c.manday_est_total, 0).label('manday_est_total'),
        func.coalesce(kpi_subq.c.kpi_base_total, 0).label('kpi_base_total')
    ).outerjoin(
        kpi_subq, Member.id == kpi_subq.c.member_id
    )

    for row in q.limit(5).all():
        print(row)

except Exception as e:
    print("ERROR:", e)
finally:
    db.close()
