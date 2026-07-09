"""
Migration script v5: Convert old flat structure to new 4-level hierarchy.

sheets → projects
phase_name → phases (table)
is_section=1 → task_groups
tasks (flat) → tasks_v2 (under task_groups)
chat_groups → project_links + platforms
"""
import traceback


def migrate_v4_to_v5():
    """Run migration from v4 (sheets+tasks) to v5 (projects+phases+task_groups+tasks_v2)."""
    from .database import SessionLocal, engine
    from sqlalchemy import text, inspect

    db = SessionLocal()
    inspector = inspect(engine)
    existing_tables = inspector.get_table_names()

    try:
        # Check if migration is needed
        if "projects" not in existing_tables:
            print("[migrate_v5] 'projects' table not found yet. Skipping migration (tables will be created by create_all).")
            return

        # Check if already migrated (projects table has data)
        project_count = db.execute(text("SELECT COUNT(*) FROM projects")).scalar()
        if project_count > 0:
            print(f"[migrate_v5] Already migrated ({project_count} projects exist). Skipping.")
            return

        # Check if old tables exist
        if "sheets" not in existing_tables:
            print("[migrate_v5] No 'sheets' table found. Nothing to migrate.")
            return

        print("[migrate_v5] Starting migration from v4 → v5...")

        # Drop and recreate legacy phases table if it has the sheet_id column
        if "phases" in existing_tables:
            columns = [c['name'] for c in inspector.get_columns('phases')]
            if 'sheet_id' in columns:
                print("[migrate_v5] Legacy 'phases' table detected. Dropping and recreating it for v5...")
                db.execute(text("DROP TABLE IF EXISTS phases CASCADE"))
                db.commit()
                from .models.phase import Phase
                Phase.__table__.create(bind=engine)

        # 1. Migrate sheets → projects
        old_sheets = db.execute(text(
            "SELECT id, name, project_code, customer_name, leader_email, pm_email, is_active, created_at FROM sheets"
        )).fetchall()

        sheet_to_project = {}  # old_sheet_id → new_project_id
        existing_codes = set()

        for s in old_sheets:
            sid, sname, code, customer, leader, pm, is_active, created = s
            status = "Developing" if is_active else "Archived"

            # Ensure code is unique during migration
            base_code = (code or f"PROJ_{sid}").strip()
            unique_code = base_code
            counter = 1
            while unique_code in existing_codes:
                unique_code = f"{base_code}_{counter}"
                counter += 1
            existing_codes.add(unique_code)

            db.execute(text(
                "INSERT INTO projects (name, code, customer_name, status, created_at) "
                "VALUES (:name, :code, :customer, :status, :created)"
            ), {"name": sname or f"Project_{sid}", "code": unique_code, "customer": customer,
                "status": status, "created": created})
            db.flush()

            new_pid = db.execute(text("SELECT MAX(id) FROM projects")).scalar()
            sheet_to_project[sid] = new_pid
            print(f"  Sheet {sid} '{sname}' → Project {new_pid} (Code: {unique_code})")

        # 2. Migrate old project_members → project_members_v2
        if "project_members" in existing_tables:
            old_members = db.execute(text(
                "SELECT sheet_id, member_id FROM project_members"
            )).fetchall()
            for om in old_members:
                old_sid, mid = om
                new_pid = sheet_to_project.get(old_sid)
                if new_pid:
                    try:
                        db.execute(text(
                            "INSERT INTO project_members_v2 (project_id, member_id, role) "
                            "VALUES (:pid, :mid, 'Member')"
                        ), {"pid": new_pid, "mid": mid})
                    except Exception:
                        pass  # duplicate
            print(f"  Migrated {len(old_members)} project member associations")

        # 3. Migrate chat_groups → platforms + project_links
        if "chat_groups" in existing_tables:
            old_chats = db.execute(text(
                "SELECT id, sheet_id, name, platform, link, \"desc\", created_at FROM chat_groups"
            )).fetchall()

            platform_cache = {}
            for cg in old_chats:
                cgid, sid, cname, plat, curl, cdesc, ccreated = cg
                new_pid = sheet_to_project.get(sid)
                if not new_pid:
                    continue

                # Find or create platform
                plat_id = None
                if plat:
                    if plat not in platform_cache:
                        existing = db.execute(text(
                            "SELECT id FROM platforms WHERE name = :n"
                        ), {"n": plat}).fetchone()
                        if existing:
                            platform_cache[plat] = existing[0]
                        else:
                            db.execute(text(
                                "INSERT INTO platforms (name, is_active) VALUES (:n, true)"
                            ), {"n": plat})
                            db.flush()
                            new_plat_id = db.execute(text("SELECT MAX(id) FROM platforms")).scalar()
                            platform_cache[plat] = new_plat_id
                    plat_id = platform_cache.get(plat)

                db.execute(text(
                    "INSERT INTO project_links (project_id, platform_id, name, url, description, sort_order) "
                    "VALUES (:pid, :plid, :name, :url, :desc, 0)"
                ), {"pid": new_pid, "plid": plat_id, "name": cname, "url": curl, "desc": cdesc})

            print(f"  Migrated {len(old_chats)} chat groups → project_links")

        # 4. Migrate phases + tasks
        if "tasks" in existing_tables:
            for old_sid, new_pid in sheet_to_project.items():
                # Get distinct phase_names for this sheet
                phase_names_rows = db.execute(text(
                    "SELECT DISTINCT phase_name FROM tasks WHERE sheet_id = :sid AND phase_name IS NOT NULL AND phase_name != ''"
                ), {"sid": old_sid}).fetchall()

                phase_names = [r[0] for r in phase_names_rows]
                if not phase_names:
                    phase_names = ["Default"]

                phase_map = {}  # phase_name → new_phase_id

                for idx, pname in enumerate(phase_names):
                    db.execute(text(
                        "INSERT INTO phases (project_id, name, sort_order, status) "
                        "VALUES (:pid, :name, :order, 'Waiting')"
                    ), {"pid": new_pid, "name": pname, "order": idx})
                    db.flush()
                    new_phid = db.execute(text("SELECT MAX(id) FROM phases")).scalar()
                    phase_map[pname] = new_phid

                # Get section tasks (is_section=1) to create task_groups
                sections = db.execute(text(
                    "SELECT id, task_id, detail, phase_name FROM tasks "
                    "WHERE sheet_id = :sid AND is_section = 1 ORDER BY id"
                ), {"sid": old_sid}).fetchall()

                section_to_group = {}  # old_section_task_id → new_task_group_id

                for sidx, sec in enumerate(sections):
                    sec_id, sec_task_id, sec_detail, sec_phase = sec
                    phase_name = sec_phase or "Default"
                    phid = phase_map.get(phase_name)
                    if not phid:
                        phid = list(phase_map.values())[0] if phase_map else None
                    if not phid:
                        continue

                    db.execute(text(
                        "INSERT INTO task_groups (phase_id, name, sort_order, status) "
                        "VALUES (:phid, :name, :order, 'Waiting')"
                    ), {"phid": phid, "name": sec_detail or f"Group {sidx+1}", "order": sidx})
                    db.flush()
                    new_gid = db.execute(text("SELECT MAX(id) FROM task_groups")).scalar()
                    section_to_group[sec_task_id] = new_gid
                    section_to_group[str(sec_id)] = new_gid

                # Create default group for orphan tasks
                for pname, phid in phase_map.items():
                    if not db.execute(text(
                        "SELECT id FROM task_groups WHERE phase_id = :phid"
                    ), {"phid": phid}).fetchone():
                        db.execute(text(
                            "INSERT INTO task_groups (phase_id, name, sort_order, status) "
                            "VALUES (:phid, 'General', 0, 'Waiting')"
                        ), {"phid": phid})
                        db.flush()

                # Get non-section tasks
                tasks = db.execute(text(
                    "SELECT id, task_id, detail, priority, manday_est, status, start_date, "
                    "assigned_id, support_id, kpi_ratio_assign, kpi_ratio_support, "
                    "skill_solution_id, skill_vendor_id, ticket_id, remark, send, "
                    "end_date_est, manday_actual, end_date_actual, days_late, "
                    "kpi_base, kpi_perform, kpi_ot, kpi_final, kpi_assigned, kpi_support, "
                    "notes, solution, phase_name, root_task "
                    "FROM tasks WHERE sheet_id = :sid AND (is_section = 0 OR is_section IS NULL) ORDER BY id"
                ), {"sid": old_sid}).fetchall()

                for tidx, t in enumerate(tasks):
                    (t_id, task_id_str, detail, priority, manday_est, status, start_date,
                     assigned_id, support_id, kpi_ratio_assign, kpi_ratio_support,
                     skill_solution_id, skill_vendor_id, ticket_id, remark, send,
                     end_date_est, manday_actual, end_date_actual, days_late,
                     kpi_base, kpi_perform, kpi_ot, kpi_final, kpi_assigned, kpi_support,
                     notes, solution, phase_name, root_task) = t

                    # Find task group
                    group_id = None
                    if root_task:
                        group_id = section_to_group.get(root_task)
                    if not group_id:
                        # Try to find a group in the same phase
                        pname = phase_name or "Default"
                        phid = phase_map.get(pname) or list(phase_map.values())[0]
                        default_group = db.execute(text(
                            "SELECT id FROM task_groups WHERE phase_id = :phid ORDER BY sort_order LIMIT 1"
                        ), {"phid": phid}).fetchone()
                        group_id = default_group[0] if default_group else None

                    if not group_id:
                        continue

                    db.execute(text(
                        "INSERT INTO tasks_v2 (task_group_id, task_code, detail, priority, manday_est, "
                        "status, start_date, assigned_id, support_id, kpi_ratio_assign, kpi_ratio_support, "
                        "skill_solution_id, skill_vendor_id, ticket_id, remark, send, "
                        "end_date_est, manday_actual, end_date_actual, days_late, "
                        "kpi_base, kpi_perform, kpi_ot, kpi_final, kpi_assigned, kpi_support, "
                        "notes, solution, sort_order) "
                        "VALUES (:gid, :code, :detail, :priority, :manday, :status, :start, "
                        ":assigned, :support, :ratio_a, :ratio_s, :sol_id, :vendor_id, :ticket, "
                        ":remark, :send, :end_est, :md_actual, :end_actual, :days_late, "
                        ":kpi_base, :kpi_perform, :kpi_ot, :kpi_final, :kpi_assigned, :kpi_support, "
                        ":notes, :solution, :sort)"
                    ), {
                        "gid": group_id, "code": task_id_str, "detail": detail or "Untitled",
                        "priority": priority or "Normal", "manday": manday_est, "status": status or "Waiting",
                        "start": start_date, "assigned": assigned_id, "support": support_id,
                        "ratio_a": kpi_ratio_assign or 100, "ratio_s": kpi_ratio_support or 0,
                        "sol_id": skill_solution_id, "vendor_id": skill_vendor_id,
                        "ticket": ticket_id, "remark": remark, "send": send,
                        "end_est": end_date_est, "md_actual": manday_actual,
                        "end_actual": end_date_actual, "days_late": days_late,
                        "kpi_base": kpi_base or 0, "kpi_perform": kpi_perform or 0,
                        "kpi_ot": kpi_ot or 0, "kpi_final": kpi_final or 0,
                        "kpi_assigned": kpi_assigned or 0, "kpi_support": kpi_support or 0,
                        "notes": notes, "solution": solution, "sort": tidx
                    })

                task_count = db.execute(text(
                    "SELECT COUNT(*) FROM tasks_v2 tg "
                    "JOIN task_groups g ON tg.task_group_id = g.id "
                    "JOIN phases p ON g.phase_id = p.id "
                    "WHERE p.project_id = :pid"
                ), {"pid": new_pid}).scalar()
                print(f"  Project {new_pid}: migrated {task_count} tasks")

        db.commit()
        print("[migrate_v5] ✅ Migration completed successfully!")

    except Exception as e:
        db.rollback()
        print(f"[migrate_v5] ❌ Migration failed: {e}")
        traceback.print_exc()
    finally:
        db.close()
