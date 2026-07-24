"""
Auto Import Markee Projects & Customers from Excel into PostgreSQL database
"""
import sys
import os
import openpyxl
import re

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.database import SessionLocal
from app.models.skill_master import Category, Group, Skill
from app.models.member import Member
from app.models.user import User
from app.models.system_category import Customer
from app.models.phase import Phase
from app.models.task_group import TaskGroup
from app.models.task import Task
from app.models.project import Project, Platform, ProjectLink

def run_import():
    excel_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "dự án markee.xlsx")
    if not os.path.exists(excel_path):
        print(f"Excel file not found at {excel_path}")
        return

    wb = openpyxl.load_workbook(excel_path, data_only=True)
    sheet = wb.active

    db = SessionLocal()
    imported_custs = 0
    imported_projs = 0

    try:
        for row in sheet.iter_rows(values_only=True):
            if not row or not row[0]:
                continue
            cust_name = str(row[0]).strip()

            # Find or create customer under 'markee' business unit
            cust = db.query(Customer).filter(
                Customer.name.ilike(cust_name),
                Customer.business_unit == 'markee'
            ).first()

            if not cust:
                cust = Customer(name=cust_name, business_unit='markee')
                db.add(cust)
                db.commit()
                db.refresh(cust)
                imported_custs += 1

            for cell in row[1:]:
                if cell and str(cell).strip():
                    p_str = str(cell).strip()
                    year_match = re.match(r"^\[(\d{4})\]\s*(.*)", p_str)
                    if year_match:
                        yr = int(year_match.group(1))
                        p_name = year_match.group(2).strip()
                    else:
                        yr = 2026
                        p_name = p_str

                    # Check existing project
                    existing = db.query(Project).filter(
                        Project.name == p_name,
                        Project.customer_id == cust.id,
                        Project.year == yr
                    ).first()

                    if not existing:
                        proj = Project(
                            name=p_name,
                            customer_id=cust.id,
                            year=yr,
                            status='Planning',
                            current_phase='1. Tư vấn'
                        )
                        db.add(proj)
                        imported_projs += 1

        db.commit()
        print(f"SUCCESS: Imported {imported_custs} new Markee Customers and {imported_projs} new Markee Projects.")
    except Exception as e:
        db.rollback()
        print(f"ERROR during import: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    run_import()
