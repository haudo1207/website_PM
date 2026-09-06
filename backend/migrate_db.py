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
            
        if "member_id" not in existing_users_cols:
            print("Adding column 'member_id' to 'users' table...")
            conn.execute(text("ALTER TABLE users ADD COLUMN member_id INTEGER NULL UNIQUE REFERENCES members(id)"))
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

        # Check members table columns
        result = conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'members'"
        ))
        existing_members_cols = {row[0] for row in result}
        
        member_additions = []
        if "leader_name" not in existing_members_cols:
            member_additions.append("ADD COLUMN leader_name VARCHAR(100)")
        if "leader_email" not in existing_members_cols:
            member_additions.append("ADD COLUMN leader_email VARCHAR(255)")
            
        if member_additions:
            print(f"Adding columns to 'members' table: {member_additions}")
            conn.execute(text("ALTER TABLE members " + ", ".join(member_additions)))
            conn.commit()

        # Check tasks_v2 table columns (Task Review workflow - approve/request
        # changes, layer riêng với `status` - xem models/task.py)
        result = conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'tasks_v2'"
        ))
        existing_task_cols = {row[0] for row in result}

        task_additions = []
        if "review_status" not in existing_task_cols:
            task_additions.append("ADD COLUMN review_status VARCHAR(30) NULL")
        if "review_requested_at" not in existing_task_cols:
            task_additions.append("ADD COLUMN review_requested_at TIMESTAMP NULL")
        if "review_requested_by" not in existing_task_cols:
            task_additions.append("ADD COLUMN review_requested_by INTEGER NULL")
        if "approved_at" not in existing_task_cols:
            task_additions.append("ADD COLUMN approved_at TIMESTAMP NULL")
        if "approved_by" not in existing_task_cols:
            task_additions.append("ADD COLUMN approved_by INTEGER NULL")
        if "change_requested_at" not in existing_task_cols:
            task_additions.append("ADD COLUMN change_requested_at TIMESTAMP NULL")
        if "change_requested_by" not in existing_task_cols:
            task_additions.append("ADD COLUMN change_requested_by INTEGER NULL")
        if "change_request_reason" not in existing_task_cols:
            task_additions.append("ADD COLUMN change_request_reason TEXT NULL")
        if "last_review_action_at" not in existing_task_cols:
            task_additions.append("ADD COLUMN last_review_action_at TIMESTAMP NULL")

        if task_additions:
            print(f"Adding columns to 'tasks_v2' table: {task_additions}")
            conn.execute(text("ALTER TABLE tasks_v2 " + ", ".join(task_additions)))
            conn.commit()

        # Legacy backfill: tasks already sitting on a tenant-custom "Review"
        # status before review_status existed - treat them as pending exactly
        # once (idempotent: only touches rows still NULL).
        backfill = conn.execute(text("""
            UPDATE tasks_v2 SET review_status = 'pending', review_requested_at = COALESCE(updated_at, created_at, NOW())
            WHERE review_status IS NULL AND status ILIKE '%review%'
        """))
        conn.commit()
        if backfill.rowcount:
            print(f"Backfilled review_status='pending' on {backfill.rowcount} legacy task(s).")

        # Task Blocking workflow columns (separate layer from `status`, cùng
        # mô hình với Review workflow ở trên).
        block_additions = []
        if "is_blocked" not in existing_task_cols:
            block_additions.append("ADD COLUMN is_blocked BOOLEAN NOT NULL DEFAULT false")
        if "blocked_at" not in existing_task_cols:
            block_additions.append("ADD COLUMN blocked_at TIMESTAMP NULL")
        if "blocked_by" not in existing_task_cols:
            block_additions.append("ADD COLUMN blocked_by INTEGER NULL")
        if "blocked_reason" not in existing_task_cols:
            block_additions.append("ADD COLUMN blocked_reason TEXT NULL")
        if "blocked_by_task_id" not in existing_task_cols:
            block_additions.append("ADD COLUMN blocked_by_task_id INTEGER NULL REFERENCES tasks_v2(id) ON DELETE SET NULL")
        if "unblocked_at" not in existing_task_cols:
            block_additions.append("ADD COLUMN unblocked_at TIMESTAMP NULL")
        if "unblocked_by" not in existing_task_cols:
            block_additions.append("ADD COLUMN unblocked_by INTEGER NULL")

        if block_additions:
            print(f"Adding blocking-workflow columns to 'tasks_v2' table: {block_additions}")
            conn.execute(text("ALTER TABLE tasks_v2 " + ", ".join(block_additions)))
            conn.commit()

        # Legacy backfill: tasks đã có status tên chứa "block" trước khi có
        # is_blocked - chỉ backfill 1 LẦN DUY NHẤT (guard bằng blocked_at IS
        # NULL, không phải is_blocked=false) để không tự block lại 1 task đã
        # được unblock chủ động qua workflow mới.
        block_backfill = conn.execute(text("""
            UPDATE tasks_v2 SET is_blocked = true, blocked_at = COALESCE(updated_at, created_at, NOW())
            WHERE blocked_at IS NULL AND is_blocked = false AND status ILIKE '%block%'
        """))
        conn.commit()
        if block_backfill.rowcount:
            print(f"Backfilled is_blocked=true on {block_backfill.rowcount} legacy task(s).")

        print("Database schema migration completed successfully!")

if __name__ == "__main__":
    run_migration()
