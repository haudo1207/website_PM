from app.database import engine
from sqlalchemy import text

def run_migration():
    with engine.connect() as conn:
        # Check users table columns
        result = conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'users'"
        ))
        existing_users_cols = {row[0] for row in result}
        
        if "position" not in existing_users_cols:
            print("Adding column 'position' to 'users' table...")
            conn.execute(text("ALTER TABLE users ADD COLUMN position VARCHAR(255) NULL"))
            conn.commit()
            
        if "department" not in existing_users_cols:
            print("Adding column 'department' to 'users' table...")
            conn.execute(text("ALTER TABLE users ADD COLUMN department VARCHAR(255) NULL"))
            conn.commit()
            
        # Check task_groups table columns
        result = conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'task_groups'"
        ))
        existing_tg_cols = {row[0] for row in result}
        
        additions = []
        if "manday_est" not in existing_tg_cols:
            additions.append("ADD COLUMN manday_est NUMERIC(5,2)")
        if "manday_actual" not in existing_tg_cols:
            additions.append("ADD COLUMN manday_actual NUMERIC(5,2)")
        if "end_date_actual" not in existing_tg_cols:
            additions.append("ADD COLUMN end_date_actual DATE")
            
        if additions:
            print(f"Adding columns to 'task_groups' table: {additions}")
            conn.execute(text("ALTER TABLE task_groups " + ", ".join(additions)))
            conn.commit()
            
        print("Database schema migration completed successfully!")

if __name__ == "__main__":
    run_migration()
