"""
Migration v6: Add manday_est, manday_actual, end_date_actual to task_groups table.
Run inside Docker: docker compose exec backend python -m app.migrate_v6
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import engine
from sqlalchemy import text


def migrate():
    with engine.connect() as conn:
        # Check which columns already exist
        result = conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'task_groups'"
        ))
        existing = {row[0] for row in result}

        additions = []

        if "manday_est" not in existing:
            additions.append("ADD COLUMN manday_est NUMERIC(5,2)")
        if "manday_actual" not in existing:
            additions.append("ADD COLUMN manday_actual NUMERIC(5,2)")
        if "end_date_actual" not in existing:
            additions.append("ADD COLUMN end_date_actual DATE")

        if additions:
            sql = "ALTER TABLE task_groups " + ", ".join(additions)
            conn.execute(text(sql))
            conn.commit()
            print(f"✅ Migration v6: Added {len(additions)} column(s) to task_groups")
            for a in additions:
                print(f"   → {a}")
        else:
            print("✅ Migration v6: All columns already exist, nothing to do.")


if __name__ == "__main__":
    migrate()
