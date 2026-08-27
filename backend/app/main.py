import os

from typing import Optional
from fastapi import FastAPI, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from .routers import auth, users, settings_router, skills, system_categories, members, meetings as meetings_router, performance_settings, accounts, ai_review, lunch as lunch_router, chat_ai, system_audit, notifications as notifications_router
from .routers import projects as projects_router
from .routers import task_groups as task_groups_router
from .routers import leave_requests as leave_requests_router
from .routers import project_templates as project_templates_router
from .routers import telegram as telegram_router
from .routers import project_documents as project_documents_router
from .database import engine, Base, get_db
from .models import user, setting, member, skill_master, system_category, meeting as meeting_model, performance_setting as performance_setting_model, google_token as google_token_model, ai_review as ai_review_model, refresh_token as refresh_token_model
from .models import project as project_model
from .models import lunch_record as lunch_record_model
from .models import phase as phase_model
from .models import task_group as task_group_model
from .models import task as task_model
from .models import leave_request as leave_request_model
from .models import project_template as project_template_model
from .models import notification as notification_model
from .models import workspace_access as workspace_access_model
from .models import telegram_connection as telegram_connection_model
from sqlalchemy import text

def apply_schema_updates():
    """Small idempotent migrations for existing installs without Alembic."""
    with engine.begin() as conn:
        conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS data_scope VARCHAR(50) "
            "NOT NULL DEFAULT 'infrastructure'"
        ))
        # SQLAlchemy create_all() does not add columns to an existing table. The
        # account/member link was introduced after the original installations,
        # so keep this migration safe to run on every container start.
        conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS member_id INTEGER"
        ))
        conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR"
        ))
        conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR"
        ))
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_google_sub_unique "
            "ON users (google_sub) WHERE google_sub IS NOT NULL"
        ))
        # Microsoft (Outlook) login identities — mirrors the google_sub pattern.
        # outlook_mail is the admin pre-provisioned Microsoft Mail used to match
        # the login; outlook_sub is the linked Microsoft identity on first login.
        conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_mail VARCHAR"
        ))
        conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_sub VARCHAR"
        ))
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_outlook_mail_unique "
            "ON users (outlook_mail) WHERE outlook_mail IS NOT NULL"
        ))
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_outlook_sub_unique "
            "ON users (outlook_sub) WHERE outlook_sub IS NOT NULL"
        ))
        # Consolidate the legacy three-role model into the new 4-role model.
        # Permissions remain independent from project data scope.
        conn.execute(text(
            "UPDATE users SET role = 'member' WHERE role IN ('group_a', 'group_b')"
        ))
        # Migrate the 2-role model (admin/member) to the 4-role model.
        # admin → super_admin. member stays as member.
        conn.execute(text(
            "UPDATE users SET role = 'super_admin' WHERE role = 'admin'"
        ))
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'users_member_id_fkey'
                      AND conrelid = 'users'::regclass
                ) THEN
                    ALTER TABLE users
                    ADD CONSTRAINT users_member_id_fkey
                    FOREIGN KEY (member_id) REFERENCES members(id)
                    ON DELETE SET NULL;
                END IF;
            END $$
        """))
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_member_id_unique "
            "ON users (member_id) WHERE member_id IS NOT NULL"
        ))
        conn.execute(text(
            "ALTER TABLE projects ADD COLUMN IF NOT EXISTS data_scope VARCHAR(50) "
            "NOT NULL DEFAULT 'infrastructure'"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_projects_data_scope ON projects (data_scope)"
        ))
        # The legacy seed inserted users.id=1 explicitly and left the sequence at 1.
        conn.execute(text(
            "SELECT setval(pg_get_serial_sequence('users', 'id'), "
            "GREATEST(COALESCE((SELECT MAX(id) FROM users), 1), 1), true)"
        ))

        # Auto-link unlinked users to members by matching Email, Full Name or Display Name
        conn.execute(text("""
            UPDATE users u
            SET member_id = m.id
            FROM members m
            WHERE u.member_id IS NULL
              AND m.id NOT IN (SELECT member_id FROM users WHERE member_id IS NOT NULL)
              AND (
                (u.email IS NOT NULL AND u.email != '' AND LOWER(u.email) = LOWER(m.email))
                OR (u.full_name IS NOT NULL AND u.full_name != '' AND (LOWER(u.full_name) = LOWER(m.full_name) OR LOWER(u.full_name) = LOWER(m.display_name)))
              )
        """))

        # Add AI Review columns to projects
        conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_status VARCHAR(50) NOT NULL DEFAULT 'NOT_CHECKED'"))
        conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_ai_check_at TIMESTAMP NULL"))
        conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_ai_score INTEGER NULL"))
        conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_review_id INTEGER NULL"))

        # Add AI Review columns to phases
        conn.execute(text("ALTER TABLE phases ADD COLUMN IF NOT EXISTS ai_status VARCHAR(50) NOT NULL DEFAULT 'NOT_CHECKED'"))
        conn.execute(text("ALTER TABLE phases ADD COLUMN IF NOT EXISTS last_ai_check_at TIMESTAMP NULL"))
        conn.execute(text("ALTER TABLE phases ADD COLUMN IF NOT EXISTS last_ai_score INTEGER NULL"))
        conn.execute(text("ALTER TABLE phases ADD COLUMN IF NOT EXISTS last_review_id INTEGER NULL"))

        # Add AI Review columns to tasks_v2
        conn.execute(text("ALTER TABLE tasks_v2 ADD COLUMN IF NOT EXISTS ai_status VARCHAR(50) NOT NULL DEFAULT 'NOT_CHECKED'"))
        conn.execute(text("ALTER TABLE tasks_v2 ADD COLUMN IF NOT EXISTS last_ai_check_at TIMESTAMP NULL"))
        conn.execute(text("ALTER TABLE tasks_v2 ADD COLUMN IF NOT EXISTS last_ai_score INTEGER NULL"))
        conn.execute(text("ALTER TABLE tasks_v2 ADD COLUMN IF NOT EXISTS last_review_id INTEGER NULL"))

        # Add customer_id to projects and sync existing customer_names
        conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS customer_id INTEGER"))
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'projects_customer_id_fkey'
                      AND conrelid = 'projects'::regclass
                ) THEN
                    ALTER TABLE projects
                    ADD CONSTRAINT projects_customer_id_fkey
                    FOREIGN KEY (customer_id) REFERENCES customers(id)
                    ON DELETE SET NULL;
                END IF;
            END $$
        """))
        conn.execute(text("""
            UPDATE projects 
            SET customer_id = (SELECT id FROM customers WHERE customers.name = projects.customer_name)
            WHERE customer_id IS NULL AND customer_name IS NOT NULL
        """))
        conn.execute(text(
            "ALTER TABLE members ADD COLUMN IF NOT EXISTS cv_link VARCHAR(255)"
        ))
        conn.execute(text(
            "ALTER TABLE members ADD COLUMN IF NOT EXISTS leader_name VARCHAR(100)"
        ))
        conn.execute(text(
            "ALTER TABLE members ADD COLUMN IF NOT EXISTS leader_email VARCHAR(255)"
        ))
        conn.execute(text(
            "ALTER TABLE members ADD COLUMN IF NOT EXISTS leader_member_id INTEGER"
        ))
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'members_leader_member_id_fkey'
                      AND conrelid = 'members'::regclass
                ) THEN
                    ALTER TABLE members
                    ADD CONSTRAINT members_leader_member_id_fkey
                    FOREIGN KEY (leader_member_id) REFERENCES members(id)
                    ON DELETE SET NULL;
                END IF;
            END $$
        """))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_members_leader_member_id ON members (leader_member_id)"
        ))

        # Add business_unit column to customers and drop obsolete unique name constraint
        conn.execute(text("ALTER TABLE customers ADD COLUMN IF NOT EXISTS business_unit VARCHAR(50) NOT NULL DEFAULT 'infrastructure'"))
        conn.execute(text("ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_name_key"))
        conn.execute(text("UPDATE customers SET business_unit = 'infrastructure' WHERE LOWER(business_unit) IN ('securityzone', 'securityzone')"))

        # Add business column to projects
        conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS business VARCHAR(30) NOT NULL DEFAULT 'Infrastructure'"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_projects_business ON projects (business)"))
        conn.execute(text("""
            UPDATE projects 
            SET business = 'Markee' 
            WHERE customer_id IN (SELECT id FROM customers WHERE LOWER(business_unit) = 'markee')
        """))

        # Add sales_id to projects
        conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS sales_id INTEGER"))
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'projects_sales_id_fkey'
                      AND conrelid = 'projects'::regclass
                ) THEN
                    ALTER TABLE projects
                    ADD CONSTRAINT projects_sales_id_fkey
                    FOREIGN KEY (sales_id) REFERENCES members(id)
                    ON DELETE SET NULL;
                END IF;
            END $$
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_projects_sales_id ON projects (sales_id)"))

        # Create audit_logs table and indices if not exists
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id SERIAL PRIMARY KEY,
                event_id VARCHAR(50),
                project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
                module VARCHAR(50) NOT NULL,
                entity_type VARCHAR(50) NOT NULL,
                entity_id VARCHAR(100),
                action VARCHAR(30) NOT NULL,
                field_name VARCHAR(100),
                old_value TEXT,
                new_value TEXT,
                description TEXT,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_project_id ON audit_logs (project_id);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_module ON audit_logs (module);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_entity_type ON audit_logs (entity_type);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_action ON audit_logs (action);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_user_id ON audit_logs (user_id);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_created_at ON audit_logs (created_at);"))
        # event_id was added to the ORM after some production databases had
        # already been created. Keep this idempotent migration before creating
        # its index so old installs cannot fail every audited write.
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS event_id VARCHAR(50);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_event_id ON audit_logs (event_id);"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS business_unit VARCHAR(50);"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS customer_id INTEGER;"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address VARCHAR(50);"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent VARCHAR(255);"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS request_url VARCHAR(255);"))
        # Keep legacy production databases aligned with the full AuditLog ORM.
        # CREATE TABLE IF NOT EXISTS does not add columns to an existing table,
        # so every audited write would otherwise fail after the model evolves.
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS severity VARCHAR(20) NOT NULL DEFAULT 'INFO';"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS login_method VARCHAR(50);"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS resource_name VARCHAR(255);"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS source VARCHAR(50) NOT NULL DEFAULT 'WEB';"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'Administration';"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS session_id VARCHAR(100);"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_risk VARCHAR(30) NOT NULL DEFAULT 'Internal';"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(100);"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_user_id INTEGER;"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_customer_id INTEGER;"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_department VARCHAR(100);"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS snapshot_json TEXT;"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS outcome VARCHAR(20) NOT NULL DEFAULT 'SUCCESS';"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS duration_ms INTEGER;"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS browser VARCHAR(100);"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS os VARCHAR(100);"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS device_type VARCHAR(50) NOT NULL DEFAULT 'Desktop';"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS is_new_ip BOOLEAN NOT NULL DEFAULT FALSE;"))
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS is_new_device BOOLEAN NOT NULL DEFAULT FALSE;"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_business_unit ON audit_logs (business_unit);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_customer_id ON audit_logs (customer_id);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_severity ON audit_logs (severity);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_resource_name ON audit_logs (resource_name);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_source ON audit_logs (source);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_category ON audit_logs (category);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_session_id ON audit_logs (session_id);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_ip_risk ON audit_logs (ip_risk);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_correlation_id ON audit_logs (correlation_id);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_target_user_id ON audit_logs (target_user_id);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_target_customer_id ON audit_logs (target_customer_id);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_target_department ON audit_logs (target_department);"))

        # Add remark_type and description to performance_settings
        conn.execute(text("ALTER TABLE performance_settings ADD COLUMN IF NOT EXISTS remark_type VARCHAR(20) NOT NULL DEFAULT 'Bonus'"))
        conn.execute(text("ALTER TABLE performance_settings ADD COLUMN IF NOT EXISTS description TEXT"))

        # Create notifications table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,
                sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                task_id INTEGER REFERENCES tasks_v2(id) ON DELETE SET NULL,
                task_group_id INTEGER REFERENCES task_groups(id) ON DELETE SET NULL,
                project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                message VARCHAR NOT NULL,
                notification_type VARCHAR DEFAULT 'task_reminder',
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        """))
        conn.execute(text("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS task_group_id INTEGER REFERENCES task_groups(id) ON DELETE SET NULL;"))
        conn.execute(text("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_notifications_recipient_id ON notifications (recipient_id);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_notifications_task_id ON notifications (task_id);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_notifications_task_group_id ON notifications (task_group_id);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_notifications_project_id ON notifications (project_id);"))

        # Add new columns to chat_ai_tasks
        conn.execute(text("ALTER TABLE chat_ai_tasks ADD COLUMN IF NOT EXISTS skill_solution_id INTEGER NULL"))
        conn.execute(text("ALTER TABLE chat_ai_tasks ADD COLUMN IF NOT EXISTS skill_vendor_id INTEGER NULL"))
        conn.execute(text("ALTER TABLE chat_ai_tasks ADD COLUMN IF NOT EXISTS ticket_id VARCHAR(500) NULL"))
        conn.execute(text("ALTER TABLE chat_ai_tasks ADD COLUMN IF NOT EXISTS remark VARCHAR(500) NULL"))
        conn.execute(text("ALTER TABLE chat_ai_tasks ADD COLUMN IF NOT EXISTS send VARCHAR(500) NULL"))
        conn.execute(text("ALTER TABLE chat_ai_tasks ADD COLUMN IF NOT EXISTS target_status VARCHAR(50) NOT NULL DEFAULT 'Waiting'"))

        # Clean up Low priority and guarantee Normal, High, Critical, Interrupt exist
        conn.execute(text("DELETE FROM task_priorities WHERE LOWER(name) = 'low'"))
        conn.execute(text("UPDATE tasks_v2 SET priority = 'Normal' WHERE LOWER(priority) = 'low'"))
        conn.execute(text("UPDATE chat_ai_tasks SET priority = 'Normal' WHERE LOWER(priority) = 'low'"))

        conn.execute(text("INSERT INTO task_priorities (name, kpi_base, color) VALUES ('Normal', 6, '🟢 Xanh') ON CONFLICT (name) DO NOTHING"))
        conn.execute(text("INSERT INTO task_priorities (name, kpi_base, color) VALUES ('High', 12, '🟠 Cam') ON CONFLICT (name) DO NOTHING"))
        conn.execute(text("INSERT INTO task_priorities (name, kpi_base, color) VALUES ('Critical', 20, '🔴 Đỏ') ON CONFLICT (name) DO NOTHING"))
        conn.execute(text("INSERT INTO task_priorities (name, kpi_base, color) VALUES ('Interrupt', 25, '🟣 Tím') ON CONFLICT (name) DO NOTHING"))

        # ── Workspace Master (Single Source of Truth) ──
        # Seed the Workspace Master and migrate every legacy hard-coded value
        # (infrastructure / markee) to the centralized Workspace records.
        conn.execute(text("""
            INSERT INTO workspaces (name, code, description)
            SELECT 'INFRA', 'infra', 'Workspace Infrastructure'
            WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE LOWER(code) = 'infra' OR LOWER(name) = 'infra')
        """))
        conn.execute(text("""
            INSERT INTO workspaces (name, code, description)
            SELECT 'DEV', 'dev', 'Workspace Dev'
            WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE LOWER(code) = 'dev' OR LOWER(name) = 'dev')
        """))
        conn.execute(text("UPDATE users SET data_scope = 'infra' WHERE LOWER(data_scope) = 'infrastructure'"))
        conn.execute(text("UPDATE users SET data_scope = 'dev' WHERE LOWER(data_scope) = 'markee'"))
        conn.execute(text("UPDATE projects SET data_scope = 'infra' WHERE LOWER(data_scope) = 'infrastructure'"))
        conn.execute(text("UPDATE projects SET data_scope = 'dev' WHERE LOWER(data_scope) = 'markee'"))
        conn.execute(text("UPDATE projects SET business = 'INFRA' WHERE LOWER(business) = 'infrastructure'"))
        conn.execute(text("UPDATE projects SET business = 'DEV' WHERE LOWER(business) = 'markee'"))
        conn.execute(text("UPDATE customers SET business_unit = 'infra' WHERE LOWER(business_unit) = 'infrastructure'"))
        conn.execute(text("UPDATE customers SET business_unit = 'dev' WHERE LOWER(business_unit) = 'markee'"))
        conn.execute(text("UPDATE audit_logs SET business_unit = 'INFRA' WHERE LOWER(business_unit) = 'infrastructure'"))
        conn.execute(text("UPDATE audit_logs SET business_unit = 'DEV' WHERE LOWER(business_unit) = 'markee'"))

        # Performance: index the tasks_v2 FK columns hit hardest by Dashboard
        # Overview's per-member/per-skill JOIN and GROUP BY queries.
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tasks_v2_assigned_id ON tasks_v2 (assigned_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tasks_v2_support_id ON tasks_v2 (support_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tasks_v2_skill_solution_id ON tasks_v2 (skill_solution_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tasks_v2_skill_vendor_id ON tasks_v2 (skill_vendor_id)"))

        # The Project model's last_activity_at column (sort projects by most
        # recently touched) was never given a matching migration here — every
        # pre-existing `projects` row is missing it on any install where the
        # table already existed before this column was added, breaking any
        # query that touches Project (Dashboard, Meetings, project edit, ...).
        conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ"))
        conn.execute(text("UPDATE projects SET last_activity_at = COALESCE(updated_at, created_at, now()) WHERE last_activity_at IS NULL"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_projects_last_activity_at ON projects (last_activity_at)"))
        # ── Portal refresh sessions (Phase 1 persistent login) ──
        # Opaque refresh tokens are stored hashed; the raw token lives only in
        # the HttpOnly cookie. No rotation in Phase 1.
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash VARCHAR(64) NOT NULL UNIQUE,
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                last_used_at TIMESTAMP WITH TIME ZONE,
                revoked_at TIMESTAMP WITH TIME ZONE
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_refresh_tokens_user_id ON refresh_tokens (user_id)"))
        # ── Telegram integration (Leave Request notifications) ──
        # Store the Telegram chat_id of the admin/super_admin account so the
        # backend can send them Leave Request notifications. Nullable because
        # not every admin/super_admin will have connected Telegram.
        conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR"
        ))
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_telegram_chat_id_unique "
            "ON users (telegram_chat_id) WHERE telegram_chat_id IS NOT NULL"
        ))
        # Short-lived, single-use connection tokens used to link an account to
        # a Telegram chat (see models/telegram_connection.py).
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS telegram_connections (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,
                token VARCHAR(64) UNIQUE NOT NULL,
                expires_at TIMESTAMPTZ,
                used BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_telegram_connections_user_id ON telegram_connections (user_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_telegram_connections_token ON telegram_connections (token)"))

        # ── Project Template: Task Cha MandayEST, Task Con Skill Solution/Vendor ──
        conn.execute(text(
            "ALTER TABLE project_template_task_groups ADD COLUMN IF NOT EXISTS manday_est NUMERIC(5,2)"
        ))
        conn.execute(text(
            "ALTER TABLE project_template_tasks ALTER COLUMN manday_est TYPE NUMERIC(5,2)"
        ))
        conn.execute(text(
            "ALTER TABLE project_template_tasks ADD COLUMN IF NOT EXISTS skill_solution_id INTEGER"
        ))
        conn.execute(text(
            "ALTER TABLE project_template_tasks ADD COLUMN IF NOT EXISTS skill_vendor_id INTEGER"
        ))
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'project_template_tasks_skill_solution_id_fkey'
                      AND conrelid = 'project_template_tasks'::regclass
                ) THEN
                    ALTER TABLE project_template_tasks
                    ADD CONSTRAINT project_template_tasks_skill_solution_id_fkey
                    FOREIGN KEY (skill_solution_id) REFERENCES groups(id)
                    ON DELETE SET NULL;
                END IF;
            END $$
        """))
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'project_template_tasks_skill_vendor_id_fkey'
                      AND conrelid = 'project_template_tasks'::regclass
                ) THEN
                    ALTER TABLE project_template_tasks
                    ADD CONSTRAINT project_template_tasks_skill_vendor_id_fkey
                    FOREIGN KEY (skill_vendor_id) REFERENCES skills(id)
                    ON DELETE SET NULL;
                END IF;
            END $$
        """))

        # Marks a ProjectDocument as auto-managed from a Task's LINK column
        # (Task.ticket_id) rather than added by hand via the Resources tab.
        conn.execute(text(
            "ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS "
            "synced_from_task_link BOOLEAN NOT NULL DEFAULT false"
        ))

def init_db_defaults():
    from .database import SessionLocal
    from .models.user import User
    from .models.setting import Setting
    from .utils.auth import hash_password
    from .config import settings as app_settings
    import json
    import os

    db = SessionLocal()
    try:
        # 1. Initialize settings if missing
        if not db.query(Setting).filter(Setting.key == "column_config").first():
            cols = {
                "cols": ["DETAIL TASK", "PRIORITY", "MANDAY (EST)", "STATUS", "ASSIGNED"],
                "tab_names": []
            }
            db.add(Setting(key="column_config", value=json.dumps(cols, ensure_ascii=False)))

        if not db.query(Setting).filter(Setting.key == "policy").first():
            policy = {
                "rules": [
                    {
                        "field": "PRIORITY",
                        "value": "URGENT",
                        "manday_max": 2.0,
                        "min_words": 10,
                        "required_fields": ["ASSIGNED", "STATUS"]
                    },
                    {
                        "field": "PRIORITY",
                        "value": "CRITICAL",
                        "manday_max": 3.0,
                        "min_words": 15,
                        "required_fields": ["ASSIGNED", "STATUS"]
                    },
                    {
                        "field": "PRIORITY",
                        "value": "HIGH",
                        "manday_max": 5.0,
                        "min_words": 5,
                        "required_fields": ["ASSIGNED"]
                    }
                ]
            }
            db.add(Setting(key="policy", value=json.dumps(policy, ensure_ascii=False)))

        if not db.query(Setting).filter(Setting.key == "ai_config").first():
            ai = {
                "base_url": os.environ.get("AI_BASE_URL", "https://api.shopaikey.com/v1"),
                "api_key": os.environ.get("AI_API_KEY", ""),
                "model": os.environ.get("AI_MODEL", "gpt-4o-mini"),
                "system_prompt": (
                    "Bạn là trợ lý ảo kiểm soát chất lượng & tuân thủ quy trình dự án.\n"
                    "Hãy đánh giá dòng công việc (task) sau từ Google Sheet:\n"
                    "1. Kiểm tra xem mô tả công việc (DETAIL TASK) có đủ rõ ràng, có đầy đủ mục tiêu, kết quả bàn giao hay không.\n"
                    "2. Đánh giá xem Manday (MANDAY (EST)) có quá cao hay quá thấp so với mô tả công việc không.\n"
                    "3. Trả về phán quyết (PASS, FAIL, hoặc REVIEW).\n"
                    "4. Đưa ra Lý do (tiếng Việt).\n"
                    "5. Đưa ra Gợi ý cải thiện cụ thể (tiếng Việt).\n"
                    "Định dạng trả về bắt buộc là JSON hợp lệ có dạng: {\"verdict\":\"...\",\"reason\":\"...\",\"suggestion\":\"...\"}\n"
                    "Không viết markdown, không thêm ký tự ngoài JSON."
                ),
                "check_interval_hours": 1
            }
            db.add(Setting(key="ai_config", value=json.dumps(ai, ensure_ascii=False)))

        from .models.project_template import ProjectTemplate, ProjectTemplatePhase, ProjectTemplateTaskGroup, ProjectTemplateTask
        if not db.query(ProjectTemplate).first():
            template = ProjectTemplate(
                name="Template dự án chuẩn",
                description="Template mặc định theo chu kỳ Sale/Admin → Init → Lab/PoC → Implement → MA",
                is_active=True,
            )
            db.add(template)
            db.flush()

            phases = [
                ("1. Sale/Admin", "Khởi tạo phạm vi, kickoff và điều phối ban đầu", 1),
                ("2. Init", "Khảo sát, phân tích và làm kế hoạch triển khai", 2),
                ("2.1 Lab/PoC", "Chứng minh tính khả thi và thử nghiệm trước triển khai", 3),
                ("3. Implement", "Triển khai chính và kiểm thử tích hợp", 4),
                ("4. MA", "Hỗ trợ vận hành và bảo trì sau go-live", 5),
            ]
            for phase_name, description, sort_order in phases:
                phase = ProjectTemplatePhase(template_id=template.id, name=phase_name, description=description, sort_order=sort_order, is_active=True)
                db.add(phase)
                db.flush()

                if phase_name == "1. Sale/Admin":
                    parent_tasks = [
                        "Sales trao đổi với khách hàng",
                        "Presales tư vấn giải pháp",
                        "Presales + Team Admin làm báo giá",
                        "Presales làm specs",
                        "Làm thầu",
                        "Làm rõ thầu và bổ sung tài liệu",
                        "Ký hợp đồng và đặt hàng",
                    ]
                    for index, parent_task_name in enumerate(parent_tasks, start=1):
                        group = ProjectTemplateTaskGroup(phase_id=phase.id, name=parent_task_name, description="Task cha theo spec đã confirm", sort_order=index)
                        db.add(group)
                        db.flush()
                elif phase_name == "2. Init":
                    parent_tasks = [
                        "Ký kết hợp đồng và đặt hàng",
                        "Khảo sát thông tin hệ thống",
                        "Thiết kế hệ thống",
                    ]
                    for index, parent_task_name in enumerate(parent_tasks, start=1):
                        group = ProjectTemplateTaskGroup(phase_id=phase.id, name=parent_task_name, description="Task cha theo spec đã confirm", sort_order=index)
                        db.add(group)
                        db.flush()
                elif phase_name == "2.1 Lab/PoC":
                    pass
                elif phase_name == "3. Implement":
                    parent_tasks = [
                        "Triển khai",
                        "Vận hành, kiểm thử hệ thống, báo cáo kết quả",
                        "Kết thúc dự án",
                    ]
                    for index, parent_task_name in enumerate(parent_tasks, start=1):
                        group = ProjectTemplateTaskGroup(phase_id=phase.id, name=parent_task_name, description="Task cha theo spec đã confirm", sort_order=index)
                        db.add(group)
                        db.flush()
                elif phase_name == "4. MA":
                    parent_tasks = [
                        "Các lỗi xử lý trong quá trình vận hành",
                        "Hệ thống triển khai Log & Monitor",
                        "Hỗ trợ sau dự án",
                    ]
                    for index, parent_task_name in enumerate(parent_tasks, start=1):
                        group = ProjectTemplateTaskGroup(phase_id=phase.id, name=parent_task_name, description="Task cha theo spec đã confirm", sort_order=index)
                        db.add(group)
                        db.flush()

        # 2. Initialize a legacy password admin only when password login is enabled.
        if db.query(User).count() == 0:
            default_admin_password = app_settings.DEFAULT_ADMIN_PASSWORD.strip()
            if not default_admin_password and not app_settings.superadmin_emails:
                raise RuntimeError(
                    "Database has no users. Set AUTH_SUPERADMIN_EMAILS or DEFAULT_ADMIN_PASSWORD."
                )
            if default_admin_password:
                admin = User(
                    id=1,
                    email=app_settings.DEFAULT_ADMIN_EMAIL.strip().lower(),
                    full_name="Admin Company",
                    hashed_pw=hash_password(default_admin_password),
                    role="super_admin",
                    is_active=True
                )
                db.add(admin)
                db.flush()

        # Google-only login still uses the users table as an explicit allow-list.
        # These bootstrap addresses are idempotently guaranteed highest access.
        for email in app_settings.superadmin_emails:
            admin = db.query(User).filter(User.email == email).first()
            if not admin:
                admin = User(
                    email=email,
                    full_name=email.split("@", 1)[0],
                    # NOT NULL legacy column; this marker is intentionally not a
                    # valid password hash because Google is the only login path.
                    hashed_pw="!google-only!",
                    role="super_admin",
                    data_scope="all",
                    is_active=True,
                )
                db.add(admin)
            else:
                admin.role = "super_admin"
                admin.data_scope = "all"
                admin.is_active = True

        # 3. Seed Skills from Excel if empty
        from .models.skill_master import Category, Group, Skill
        if db.query(Category).count() == 0:
            import openpyxl
            xlsx_path = "Skill_Master_From_Sheet.xlsx"
            if os.path.exists(xlsx_path):
                wb = openpyxl.load_workbook(xlsx_path)
                sheet = wb.active
                max_row = sheet.max_row
                max_col = sheet.max_column

                col_mapping = {}
                for col_idx in range(1, max_col + 1):
                    cat_val = sheet.cell(1, col_idx).value
                    group_val = sheet.cell(3, col_idx).value
                    if cat_val is not None:
                        cat_val = str(cat_val).strip()
                    if group_val is not None:
                        group_val = str(group_val).strip()
                    if cat_val or group_val:
                        col_mapping[col_idx] = {"category": cat_val, "group": group_val}

                last_cat = None
                for col_idx in sorted(col_mapping.keys()):
                    if col_mapping[col_idx]["category"]:
                        last_cat = col_mapping[col_idx]["category"]
                    else:
                        col_mapping[col_idx]["category"] = last_cat

                db_categories = {}
                db_groups = {}

                for col_idx, mapping in col_mapping.items():
                    cat_name = mapping["category"]
                    grp_name = mapping["group"]
                    if not cat_name or not grp_name:
                        continue
                    if cat_name not in db_categories:
                        cat_obj = Category(name=cat_name, is_active=True)
                        db.add(cat_obj)
                        db.flush()
                        db_categories[cat_name] = cat_obj
                    grp_key = (cat_name, grp_name)
                    if grp_key not in db_groups:
                        grp_obj = Group(name=grp_name, category_id=db_categories[cat_name].id)
                        db.add(grp_obj)
                        db.flush()
                        db_groups[grp_key] = grp_obj

                for r in range(4, max_row + 1):
                    for col_idx in col_mapping.keys():
                        val = sheet.cell(r, col_idx).value
                        if val is not None:
                            val = str(val).strip()
                            if val:
                                mapping = col_mapping[col_idx]
                                cat_name = mapping["category"]
                                grp_name = mapping["group"]
                                if not cat_name or not grp_name:
                                    continue
                                grp_obj = db_groups.get((cat_name, grp_name))
                                if grp_obj:
                                    existing = db.query(Skill).filter(Skill.name == val, Skill.group_id == grp_obj.id).first()
                                    if not existing:
                                        db.add(Skill(name=val, group_id=grp_obj.id, is_active=True))
                print("[*] Seeded skills from excel")

        # 4. Seed system categories
        from .models.system_category import Position, Department, TaskPriority, TaskStatus, Team, Customer
        if db.query(Position).count() == 0:
            for name in ["PM", "Leader", "Developer", "Tester", "Intern"]:
                db.add(Position(name=name))

        if db.query(Department).count() == 0:
            for name in ["AI", "ERP", "QA", "Infrastructure", "Marketing"]:
                db.add(Department(name=name))

        if db.query(Team).count() == 0:
            for name in ["Sales", "Presales", "Technical", "Intern L2", "Intern L1 Tech",
                          "Developer", "Marketing", "Freelancer", "Back Office", "Intern L1"]:
                db.add(Team(name=name))

        if db.query(TaskPriority).count() == 0:
            priorities = [
                {"name": "Normal", "kpi_base": 6, "color": "🟢 Xanh"},
                {"name": "High", "kpi_base": 12, "color": "🟠 Cam"},
                {"name": "Critical", "kpi_base": 20, "color": "🔴 Đỏ"},
                {"name": "Interrupt", "kpi_base": 6, "color": "🟣 Tím"}
            ]
            for p in priorities:
                db.add(TaskPriority(name=p["name"], kpi_base=p["kpi_base"], color=p["color"]))

        if db.query(TaskStatus).count() == 0:
            statuses = ["Waiting", "Process", "Done", "Cancel", "Rework", "To Do"]
            for name in statuses:
                db.add(TaskStatus(name=name))

        if db.query(Customer).count() == 0:
            customers = ["Samsung SDS", "LG CNS", "Viettel", "FPT Software", "Vingroup"]
            for name in customers:
                db.add(Customer(name=name))

        # 5. Seed default platforms
        from .models.project import Platform
        if db.query(Platform).count() == 0:
            default_platforms = [
                {"name": "Telegram", "icon": "📨", "color": "#0088cc"},
                {"name": "Zalo", "icon": "💬", "color": "#0068ff"},
                {"name": "Slack", "icon": "💼", "color": "#4A154B"},
                {"name": "Microsoft Teams", "icon": "🟦", "color": "#6264A7"},
                {"name": "Discord", "icon": "🎮", "color": "#5865F2"},
                {"name": "WhatsApp", "icon": "📱", "color": "#25D366"},
                {"name": "Khác", "icon": "🔗", "color": "#6b7280"},
            ]
            for p in default_platforms:
                db.add(Platform(name=p["name"], icon=p["icon"], color=p["color"], is_active=True))
            print("[*] Seeded default platforms")

        # 6. Seed initial members
        from .models.member import Member
        if db.query(Member).count() == 0:
            initial_members = [
                # Sales
                {"display_name": "1.Minhpn",  "full_name": "Phan Nhat Minh",  "telegram_username": "@minhuit911",   "team": "Sales"},
                {"display_name": "6.Phil",     "full_name": "Le Phi",  "telegram_username": "@phile0920",    "team": "Sales"},
                {"display_name": "8.NhoLna",  "full_name": "Le Anh Nho",  "telegram_username": "@AnhNho66",     "team": "Sales"},
                {"display_name": "9.Phatnt",   "full_name": "Nguyen Thanh Phat", "telegram_username": "@phatnguyeen",  "team": "Sales"},
                # Presales
                {"display_name": "2.Phuocpv",  "full_name": "Phan Van Phuoc","telegram_username": "@nessivu",      "team": "Presales"},
                {"display_name": "3.Hand",     "full_name": "Diep Han",  "telegram_username": "@handiep",      "team": "Presales"},
                {"display_name": "4.Yemh",     "full_name": "Ma Hong Yen",  "telegram_username": "@yemhoang96",   "team": "Presales"},
                {"display_name": "5.Khoipm",   "full_name": "Phan Minh Khoi", "telegram_username": "@BlackDrag0n98","team": "Presales"},
                # Technical
                {"display_name": "7.Vypt",     "full_name": "Phan Thao Vy",   "telegram_username": "@vyvyzz13",     "team": "Technical"},
                {"display_name": "10.Huyht",   "full_name": "Ho Thanh Huy",  "telegram_username": "@ht_hyu",       "team": "Technical"},
                {"display_name": "11.Hanlnl",  "full_name": "Le Nguyen Linh Han",  "telegram_username": "@Linhhan0399",  "team": "Technical"},
                {"display_name": "12.Vunl",    "full_name": "Nguyen Le Vu",   "telegram_username": "@vu_nguyen27",  "team": "Technical"},
                {"display_name": "14.Tubda",   "full_name": "Bui Duong Anh Tu",   "telegram_username": "@numm0204",     "team": "Technical"},
                {"display_name": "15.Huannv",  "full_name": "Nguyen Van Huan", "telegram_username": "@huannv21",     "team": "Technical"},
                {"display_name": "17.Sonpn",   "full_name": "Pham Ngoc Son",  "telegram_username": "@Sonngocpham",  "team": "Technical"},
                {"display_name": "18.Thuanlh", "full_name": "Le Huu Thuan","telegram_username": "@thuanle0608",  "team": "Technical"},
                {"display_name": "25.Chinhvd", "full_name": "Vo Dai Chinh","telegram_username": "@duci59",       "team": "Technical"},
                {"display_name": "28.Phatntu", "full_name": "Nguyen Tran Ung Phat", "telegram_username": "@phatnguyentuan","team": "Technical"},
                # Intern L2
                {"display_name": "13.Taylt",   "full_name": "Le Thai Tay",  "telegram_username": "@lethitay",     "team": "Intern L2"},
                {"display_name": "16.Dungnh",  "full_name": "Nguyen Hoang Dung", "telegram_username": "@ru4ff",        "team": "Intern L2"},
                {"display_name": "26.Phult",   "full_name": "Le Tan Phu",  "telegram_username": "@letrieuphu",   "team": "Intern L2"},
                {"display_name": "27.Duynd",   "full_name": "Nguyen Dinh Duy",  "telegram_username": "@duyisme_rynn", "team": "Intern L2"},
                {"display_name": "29.Anhpxt",  "full_name": "Pham Xuan Thai Anh",  "telegram_username": "@tunanhdapoet",  "team": "Intern L2"},
                {"display_name": "30.Taipv",   "full_name": "Phan Van Tai",  "telegram_username": "@taipvan",      "team": "Intern L2"},
                {"display_name": "31.Hieplh",  "full_name": "Le Hung Hiep", "telegram_username": "@hhieple03",    "team": "Intern L2"},
                {"display_name": "32.Thanhndn","full_name": "Nguyen Duc Nam Thanh","telegram_username": "@thanh25324",   "team": "Intern L2"},
                {"display_name": "33.Phuongvt","full_name": "Van Thi Phuong","telegram_username": "@tpunn00",      "team": "Intern L2"},
                # Developer
                {"display_name": "Sep Thuong", "full_name": "Nguyen Van Thuong","telegram_username": None,           "team": "Developer"},
                {"display_name": "Sep Nhi",    "full_name": "Bui Thi Thao Nhi",   "telegram_username": None,           "team": "Developer"},
                {"display_name": "Chi Trang",  "full_name": "Do Thi Thuy Trang", "telegram_username": "@Trang07",       "team": "Developer"},
                {"display_name": "Thuy Ha",    "full_name": "Thuy Ha", "telegram_username": "@thuyha06",    "team": "Developer"},
                {"display_name": "Yen Nhi",    "full_name": "Yen Nhi", "telegram_username": "@ynhi03",      "team": "Developer"},
                {"display_name": "Chi Hieu",   "full_name": "Vo Thi Hieu",  "telegram_username": "@HieuNgo027",   "team": "Developer"},
                {"display_name": "Chi Giang",  "full_name": "Phan Thi Giang", "telegram_username": "@GiangHoangThuy","team": "Developer"},
                {"display_name": "Anh Do",     "full_name": "Tay Van Do",    "telegram_username": "@dotran000",    "team": "Developer"},
                {"display_name": "Anh Thanh",  "full_name": "Nguyen Trung Thanh", "telegram_username": "@Thanh_dco",    "team": "Developer"},
                {"display_name": "Anh Hong",   "full_name": "Pham Xuan Hong",  "telegram_username": "@lz30o0",       "team": "Developer"},
                {"display_name": "Anh Nam",    "full_name": "Le Viet Nam",   "telegram_username": "@Buinam_POP",   "team": "Developer"},
                {"display_name": "Anh Son",    "full_name": "Pham Thai Son",   "telegram_username": "@snguyencptit", "team": "Developer"},
                {"display_name": "Anh Thanh2",  "full_name": "Do Thanh", "telegram_username": "@Edgar_Ng",     "team": "Developer"},
                # Marketing
                {"display_name": "16.Thienn",  "full_name": "Nguyen Thien","telegram_username": "@thienng268",  "team": "Marketing"},
                {"display_name": "17.Thuongnv","full_name": "Nguyen Thuong","telegram_username": "@thuongw89",   "team": "Marketing"},
                {"display_name": "18.Maidt",    "full_name": "Dinh Mai",  "telegram_username": "@mmaidt",      "team": "Marketing"},
                {"display_name": "19.Huandg",  "full_name": "Dinh Huan", "telegram_username": "@huandinh2409","team": "Marketing"},
                {"display_name": "20.Thuatn",  "full_name": "Nguyen Thuat","telegram_username": "@thuaatj1204", "team": "Marketing"},
                {"display_name": "21.Dungdt",  "full_name": "Dinh Dung", "telegram_username": None,           "team": "Marketing"},
                {"display_name": "22.Phucb",   "full_name": "Bui Phuc", "telegram_username": "@phuccao123",  "team": "Marketing"},
                {"display_name": "23.Hoangt",  "full_name": "Nguyen Hoang","telegram_username": "@thoangg999",  "team": "Marketing"},
                {"display_name": "24.Quanm",   "full_name": "Mai Quan", "telegram_username": "@mavrickNG",   "team": "Marketing"},
                # Intern L1
                {"display_name": "26.HuyNT",   "full_name": "Nguyen Thanh Huy",  "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "27.Ybinhn",  "full_name": "Ybinh","telegram_username": "@ybinhquach", "team": "Intern L1"},
                {"display_name": "29.TienHT",  "full_name": "Hoang Tien", "telegram_username": "@tien_tth",    "team": "Intern L1"},
                {"display_name": "30.Thunnm",  "full_name": "Nguyen Minh Thu",  "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "31.Duyentt", "full_name": "Trinh Duyen","telegram_username": None,           "team": "Intern L1"},
                {"display_name": "32.Uyenpdp","full_name": "Pham Duy Uyen", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "33.Thanhnd","full_name": "Nguyen Thanh","telegram_username": None,           "team": "Intern L1"},
                {"display_name": "35.KhoaNN",  "full_name": "Nguyen Khoa", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "36.LongTD",  "full_name": "Tran Duy Long", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "37.Longntk", "full_name": "Nguyen Long", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "38.Quanlnm","full_name": "Nguyen Quan", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "39.Thuanpb","full_name": "Bui Thuan","telegram_username": None,           "team": "Intern L1"},
                {"display_name": "40.Phongnv","full_name": "Nguyen Phong","telegram_username": None,           "team": "Intern L1"},
                {"display_name": "41.Phatngt","full_name": "Nguyen Phat", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "42.Tannd",  "full_name": "Nguyen Tan",  "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "43.Vinhttq","full_name": "Tran Vinh", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "44.Vyttt",   "full_name": "Trinh Vy",   "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "45.Thucch", "full_name": "Chu Thuc", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "46.Tienta",  "full_name": "Tien", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "47.VuDQ",    "full_name": "Dang Quang Vu",   "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "48.ThanhNC","full_name": "Chu Thanh","telegram_username": None,           "team": "Intern L1"},
                {"display_name": "49.ThoTD",   "full_name": "Tho",  "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "50.SangPT",  "full_name": "Pham Sang", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "51.NguyenNV","full_name": "Nguyen Nguyen","telegram_username": None,           "team": "Intern L1"},
                {"display_name": "52.VietPQ",  "full_name": "Pham Quang Viet", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "53.HoangNM", "full_name": "Nguyen Minh Hoang","telegram_username": None,           "team": "Intern L1"},
                {"display_name": "54.KhaiLM",  "full_name": "Le Minh Khai", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "55.ThaoVTN","full_name": "Nguyen Thao", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "56.TinHA",   "full_name": "Anh Tin",  "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "57.AnhNTH",  "full_name": "Nguyen Anh",  "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "58.HuyenLTT","full_name": "Le Thi Huyen","telegram_username": None,           "team": "Intern L1"},
                {"display_name": "59.HuyenNTN","full_name": "Nguyen Huyen","telegram_username": None,           "team": "Intern L1"},
                {"display_name": "60.VietND",  "full_name": "Nguyen Duy Viet", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "61.ThangVT", "full_name": "Van Thang","telegram_username": None,           "team": "Intern L1"},
                {"display_name": "62.NamNP",   "full_name": "Pham Nam",  "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "63.QuanLKM", "full_name": "Le Quan", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "64.QuyNT",   "full_name": "Nguyen Quy",  "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "65.HungNP",  "full_name": "Pham Hung", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "66.NhiBTT",  "full_name": "Bui Nhi",  "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "67.QuanVLH", "full_name": "Le Quan", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "68.HoangHNN","full_name": "Nguyen Hoang","telegram_username": None,           "team": "Intern L1"},
                {"display_name": "69.TruyenNT","full_name": "Nguyen Truyen","telegram_username": None,          "team": "Intern L1"},
                {"display_name": "70.NamDV",   "full_name": "Vu Nam",  "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "71.Andd",    "full_name": "An",   "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "72.TungNT",  "full_name": "Nguyen Tung", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "73.LoanDTB", "full_name": "Bui Loan", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "74.GiangNT", "full_name": "Nguyen Giang","telegram_username": None,           "team": "Intern L1"},
                {"display_name": "75.TrinhTTT","full_name": "Trinh Trinh","telegram_username": None,           "team": "Intern L1"},
                {"display_name": "76.NhuBTQ",  "full_name": "Bui Nhu",  "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "77.MyCT",    "full_name": "Chu My",   "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "78.TrinhLTT","full_name": "Le Trinh","telegram_username": None,           "team": "Intern L1"},
                {"display_name": "79.HieuLVM", "full_name": "Le Hieu", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "80.HueTH",   "full_name": "Hue",  "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "81.VanNTH",  "full_name": "Nguyen Van",  "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "82.HuyDNH",  "full_name": "Huy",  "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "83.HauDH",   "full_name": "Hau",  "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "84.PhuongNTT","full_name": "Nguyen Phuong","telegram_username": None,           "team": "Intern L1"},
                {"display_name": "85.TrungNM", "full_name": "Nguyen Minh Trung","telegram_username": None,           "team": "Intern L1"},
                {"display_name": "86.AnhTNK",  "full_name": "Kim Anh",  "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "87.BinhCT",  "full_name": "Binh", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "88.PhuongND","full_name": "Nguyen Phuong","telegram_username": None,           "team": "Intern L1"},
                {"display_name": "89.HaiLV",   "full_name": "Le Hai",  "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "90.VuTVH",  "full_name": "Vu",   "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "91.NhutNT",  "full_name": "Nguyen Nhut", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "92.KhueNP",  "full_name": "Nguyen Khue", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "93.NhatLM",  "full_name": "Le Nhat", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "94.TrangNT", "full_name": "Nguyen Trang", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "95.BengHT",  "full_name": "Beng", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "96.LanhNTM", "full_name": "Nguyen Lanh", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "97.DucTX",   "full_name": "Duc",  "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "98.BinhPV",  "full_name": "Pham Binh", "telegram_username": None,           "team": "Intern L1"},
                {"display_name": "99.DoanTK",  "full_name": "Doan", "telegram_username": None,           "team": "Intern L1"},
                # Freelancer
                {"display_name": "201.HoaT",   "full_name": "Hoa",  "telegram_username": None,           "team": "Freelancer"},
                {"display_name": "202.HienT",  "full_name": "Hien", "telegram_username": None,           "team": "Freelancer"},
                {"display_name": "203.Thai",   "full_name": "Thai", "telegram_username": None,           "team": "Freelancer"},
                # Back-Office
                {"display_name": "801.LanVTN", "full_name": "Vu Lan",   "telegram_username": None,           "team": "Back-Office"},
            ]
            for data in initial_members:
                try:
                    mb = Member(
                        display_name=data["display_name"],
                        full_name=data["full_name"],
                        telegram_username=data.get("telegram_username"),
                        team=data.get("team")
                    )
                    db.add(mb)
                    db.flush()
                except Exception:
                    db.rollback()
            print("[*] Seeded initial members")

        # 4. Seed initial Performance KPI rules
        from .models.performance_setting import PerformanceSetting
        from decimal import Decimal
        if db.query(PerformanceSetting).count() == 0:
            initial_kpi_rules = [
                # I. Tasks khen thưởng
                {"performance": "(T) Có tài liệu đào tạo upload lên securityzone.vn", "kpi": Decimal("5")},
                {"performance": "(T) Có video đào tạo upload lên Youtube Securityzone", "kpi": Decimal("5")},
                {"performance": "(T) Khách hàng phản ảnh tốt", "kpi": Decimal("5")},
                {"performance": "(T) Hoàn thành sớm task NORMAL", "kpi": Decimal("5")},
                {"performance": "(T) Hoàn thành sớm task HIGH", "kpi": Decimal("10")},

                # II. Tasks bị phạt
                {"performance": "(P) Điền sai thông tin form", "kpi": Decimal("-5")},
                {"performance": "(P) Không trao đổi localteam", "kpi": Decimal("-5")},
                {"performance": "(P) Không update email tiến độ", "kpi": Decimal("-5")},
                {"performance": "(P) Trễ tiến độ nhưng có báo cáo, lý do hợp lý", "kpi": Decimal("-5")},
                {"performance": "(P) Task trễ mà không báo cáo PM", "kpi": Decimal("-10")},
                {"performance": "(P) Task phải làm lại do lỗi nội bộ", "kpi": Decimal("-5")},
                {"performance": "(P) Khách phàn nàn mức nhẹ, ảnh hưởng vừa phải", "kpi": Decimal("-10")},
                {"performance": "(P) Khách phàn nàn nặng, ảnh hưởng trực tiếp", "kpi": Decimal("-15")},
                {"performance": "(P) Task thất bại, không hoàn thành, phải thay người", "kpi": Decimal("-20")},
                {"performance": "(P) FAIL 1", "kpi": Decimal("0.7")},
                {"performance": "(P) FAIL 2", "kpi": Decimal("0.5")},
                {"performance": "(P) FAIL 3", "kpi": Decimal("0.0")},

                # III. Tasks làm ngoài giờ
                {"performance": "1 day - Xử lý sự cố TỐI trong tuần", "kpi": Decimal("0")},
                {"performance": "2 day - Xử lý sự cố TỐI trong tuần", "kpi": Decimal("0")},
                {"performance": "3 day - Xử lý sự cố TỐI trong tuần", "kpi": Decimal("0")},
                {"performance": "4 day - Xử lý sự cố TỐI trong tuần", "kpi": Decimal("0")},
                {"performance": "5 day - Xử lý sự cố TỐI trong tuần", "kpi": Decimal("0")},
                {"performance": "1 day - Xử lý sự cố cuối tuần", "kpi": Decimal("0")},
                {"performance": "2 day - Xử lý sự cố cuối tuần", "kpi": Decimal("0")},
                {"performance": "1 day - Xử lý sự cố ngày lễ", "kpi": Decimal("0")},
                {"performance": "2 day - Xử lý sự cố ngày lễ", "kpi": Decimal("0")},
                {"performance": "3 day - Xử lý sự cố ngày lễ", "kpi": Decimal("0")},
                {"performance": "4 day - Xử lý sự cố ngày lễ", "kpi": Decimal("0")},
                {"performance": "5 day - Xử lý sự cố ngày lễ", "kpi": Decimal("0")},

                # IV. Tasks phát sinh
                {"performance": "Rework - Làm lại do lỗi nội bộ", "kpi": Decimal("0")},
                {"performance": "Change request - Do khách hàng yêu cầu", "kpi": Decimal("0")},
                {"performance": "Issue - Sự cố không lường trước", "kpi": Decimal("0")},
                {"performance": "Unplanned - Các công việc nhỏ phát sinh ngoài scope", "kpi": Decimal("0")}
            ]
            for idx, r in enumerate(initial_kpi_rules):
                rtype = "Penalty" if (r["kpi"] < 0 or r["performance"].startswith("(P)")) else "Bonus"
                db.add(PerformanceSetting(
                    performance=r["performance"],
                    kpi=r["kpi"],
                    remark_type=rtype,
                    sort_order=idx,
                    is_active=True
                ))
            print("[*] Seeded initial Performance KPI rules")

        # Seed Master Phases if table empty
        from app.models.master_phase import MasterPhase
        if db.query(MasterPhase).count() == 0:
            default_phases = [
                '1. Tư vấn',
                '2. Báo giá',
                '3. Làm specs',
                '4. Duyệt HSMT',
                '5. Chờ ra thầu',
                '6. Tham gia thầu POP',
                '6. Tham gia thầu nhà phụ',
                '7. Trúng Thầu',
                '7. Rớt thầu',
                '8. Ký hợp đồng',
                '9. Đặt hàng',
                '10. Giao hàng',
                '11. Triển khai',
                '12. Hoàn thành triển khai',
                '13. Nghiệm thu',
                '14. Thanh toán',
                '15. Kết thúc dự án',
                '0. Huỷ'
            ]
            for idx, p_name in enumerate(default_phases, 1):
                db.add(MasterPhase(name=p_name, sort_order=idx, is_active=True))
            print("[*] Seeded initial Master Phases")

        # Backfill user_workspace_access from the existing single data_scope
        # column. Additive/idempotent — gives every current Leader/Member/Viewer
        # exactly the one Workspace they already had, so effective access is
        # unchanged until an admin explicitly grants extra Workspaces later.
        from sqlalchemy import exists as sql_exists
        from .models.workspace_access import UserWorkspaceAccess
        from .models.system_category import Workspace
        from .utils.access import WORKSPACE_SCOPED_ROLES, ALL_SCOPE

        already_has_row = sql_exists().where(UserWorkspaceAccess.user_id == User.id)
        users_needing_backfill = (
            db.query(User)
            .filter(User.role.in_(WORKSPACE_SCOPED_ROLES))
            .filter(User.data_scope != ALL_SCOPE)
            .filter(~already_has_row)
            .all()
        )
        if users_needing_backfill:
            ws_by_code = {w.code.strip().lower(): w for w in db.query(Workspace).all() if w.code}
            backfilled = 0
            for u in users_needing_backfill:
                ws = ws_by_code.get(str(u.data_scope or "").strip().lower())
                if ws:
                    db.add(UserWorkspaceAccess(user_id=u.id, workspace_id=ws.id))
                    backfilled += 1
            print(f"[*] Backfilled user_workspace_access for {backfilled}/{len(users_needing_backfill)} user(s)")

        db.commit()
    except RuntimeError:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        print(f"[!] Error seeding database: {e}")
    finally:
        db.close()

# Uvicorn workers only serve requests. CI runs these schema/default updates in
# one pre-deploy container so workers never race on DDL or pooled DB locks.
def run_startup_once():
    """Apply idempotent schema/default updates in one pre-deploy process."""
    Base.metadata.create_all(bind=engine)
    try:
        apply_schema_updates()
    except Exception as e:
        print(f"[!] Schema updates notice: {e}")
    try:
        init_db_defaults()
    except Exception as e:
        print(f"[!] Database defaults notice: {e}")


# Docker deployments call run_startup_once() explicitly before starting web
# workers. Opt-in import execution remains available for one-process utilities.
if os.getenv("RUN_DB_STARTUP_ON_IMPORT", "false").lower() in {"1", "true", "yes", "on"}:
    run_startup_once()


app = FastAPI(
    title="Task Compliance Portal",
    version="5.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://kpi.markeeai.com",
        "https://kpi.securityzone.vn",
        "https://dev.kpi.markeeai.com",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

app.include_router(auth.router,                prefix="/api/auth")
app.include_router(users.router,               prefix="/api/users")
app.include_router(projects_router.router,     prefix="/api")
app.include_router(project_documents_router.router, prefix="/api")
app.include_router(task_groups_router.router,   prefix="/api")
app.include_router(settings_router.router,     prefix="/api/settings")
app.include_router(skills.router,              prefix="/api/skills")
app.include_router(system_categories.router,   prefix="/api/system-categories")
app.include_router(members.router,             prefix="/api/members")
app.include_router(leave_requests_router.router, prefix="/api/leave-requests")
@app.post("/api/meetings/webhook/n8n-summary")
def ingest_n8n_meeting_summary_public(
    payload: meetings_router.N8nMeetingSummaryPayload,
    db: Session = Depends(get_db),
    x_n8n_webhook_secret: Optional[str] = Header(None, alias="X-N8N-Webhook-Secret")
):
    """Public Webhook endpoint for n8n meeting summary ingestion (authenticates via X-N8N-Webhook-Secret)."""
    return meetings_router.ingest_n8n_meeting_summary(payload=payload, db=db, x_n8n_webhook_secret=x_n8n_webhook_secret)

app.include_router(meetings_router.router,    prefix="/api/meetings")
app.include_router(performance_settings.router, prefix="/api/performance-settings")
app.include_router(accounts.router,            prefix="/api/accounts")
app.include_router(ai_review.router,            prefix="/api")
app.include_router(lunch_router.router,         prefix="/api/lunch")
app.include_router(chat_ai.router,              prefix="/api")
app.include_router(project_templates_router.router, prefix="/api")
app.include_router(system_audit.router,         prefix="/api")
app.include_router(notifications_router.router, prefix="/api/notifications")
app.include_router(telegram_router.router,      prefix="/api/telegram")

@app.get("/health")
@app.get("/api/health")
def health():
    import os
    from datetime import datetime, timezone
    return {
        "status": "ok",
        "version": "5.0.0",
        "commit": os.environ.get("APP_COMMIT", "dev"),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

@app.get("/api/meetings/google/auth-direct")
def google_auth_direct_public():
    """Public helper endpoint to launch Google OAuth authorization flow directly from browser."""
    from .config import settings
    from google_auth_oauthlib.flow import Flow
    from fastapi.responses import RedirectResponse
    from fastapi import HTTPException
    
    client_id = settings.GOOGLE_CLIENT_ID
    client_secret = settings.GOOGLE_CLIENT_SECRET
    if not client_id or not client_secret:
        raise HTTPException(400, "Thiếu GOOGLE_CLIENT_ID hoặc GOOGLE_CLIENT_SECRET trong .env")

    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": client_id,
                "client_secret": client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=[
            "https://www.googleapis.com/auth/calendar",
            "https://www.googleapis.com/auth/drive.readonly",
            "https://www.googleapis.com/auth/meetings.space.readonly",
        ],
        redirect_uri=settings.GOOGLE_REDIRECT_URI,
    )
    auth_url, _ = flow.authorization_url(prompt="consent", access_type="offline")
    return RedirectResponse(url=auth_url)

@app.get("/api/meetings/google/callback")
def google_callback_public(code: str, state: str = None, db: Session = Depends(get_db)):
    """Handle Google OAuth2 callback and save tokens (Public Route)."""
    import os
    import logging
    from .config import settings
    from google_auth_oauthlib.flow import Flow
    from .services.meeting_sync import _save_google_tokens
    from fastapi.responses import RedirectResponse

    logger = logging.getLogger("google_callback")

    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=[
            "https://www.googleapis.com/auth/calendar",
            "https://www.googleapis.com/auth/drive.readonly",
            "https://www.googleapis.com/auth/meetings.space.readonly",
        ],
        redirect_uri=settings.GOOGLE_REDIRECT_URI,
    )
    flow.fetch_token(code=code)
    creds = flow.credentials

    user_id = int(state) if (state and state.isdigit()) else 1
    _save_google_tokens(db, user_id, {
        "access_token": creds.token,
        "refresh_token": creds.refresh_token,
    })
    db.commit()

    if creds.refresh_token:
        settings.GOOGLE_REFRESH_TOKEN = creds.refresh_token
        # Automatically update .env and env files on server
        base_dir = os.path.dirname(os.path.dirname(__file__))
        for env_filename in [".env", "env"]:
            env_path = os.path.join(base_dir, env_filename)
            if os.path.exists(env_path):
                try:
                    with open(env_path, "r", encoding="utf-8") as f:
                        lines = f.readlines()
                    updated = False
                    new_lines = []
                    for line in lines:
                        if line.startswith("GOOGLE_REFRESH_TOKEN="):
                            new_lines.append(f"GOOGLE_REFRESH_TOKEN={creds.refresh_token}\n")
                            updated = True
                        else:
                            new_lines.append(line)
                    if not updated:
                        new_lines.append(f"\nGOOGLE_REFRESH_TOKEN={creds.refresh_token}\n")
                    with open(env_path, "w", encoding="utf-8") as f:
                        f.writelines(new_lines)
                except Exception as e:
                    logger.warning(f"Could not auto-write GOOGLE_REFRESH_TOKEN to {env_filename}: {e}")

    return RedirectResponse(url=f"{settings.FRONTEND_URL}/meetings?google_connected=true")

import asyncio

@app.on_event("startup")
async def start_auto_sync_loop():
    async def _loop():
        await asyncio.sleep(5)  # Allow FastAPI to complete startup first
        from .database import BackgroundSessionLocal
        from .services.meeting_sync import auto_sync_all_ended_meetings
        while True:
            db = BackgroundSessionLocal()
            try:
                await asyncio.to_thread(auto_sync_all_ended_meetings, db)
            except Exception as e:
                pass
            finally:
                db.close()
            await asyncio.sleep(30)

    asyncio.create_task(_loop())

