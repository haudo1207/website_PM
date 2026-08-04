"""
Migration: Add parent_id and is_parent columns to performance_settings table.
- is_parent = True  → đây là "Remark Cha"
- parent_id  → FK tự tham chiếu, cho biết Remark con thuộc Remark cha nào
"""
from app.database import engine
from sqlalchemy import text


def run_migration():
    with engine.connect() as conn:
        result = conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'performance_settings'"
        ))
        existing_cols = {row[0] for row in result}

        if "is_parent" not in existing_cols:
            print("Adding column 'is_parent' to 'performance_settings'...")
            conn.execute(text(
                "ALTER TABLE performance_settings "
                "ADD COLUMN is_parent BOOLEAN NOT NULL DEFAULT FALSE"
            ))
            conn.commit()
            print("  ✓ is_parent added.")
        else:
            print("  ✓ is_parent already exists, skipping.")

        if "parent_id" not in existing_cols:
            print("Adding column 'parent_id' to 'performance_settings'...")
            conn.execute(text(
                "ALTER TABLE performance_settings "
                "ADD COLUMN parent_id INTEGER NULL "
                "REFERENCES performance_settings(id) ON DELETE SET NULL"
            ))
            conn.commit()
            print("  ✓ parent_id added.")
        else:
            print("  ✓ parent_id already exists, skipping.")

        print("Migration completed successfully!")


if __name__ == "__main__":
    run_migration()
