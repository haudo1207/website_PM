"""
Read-only schema-drift audit — NO ALTER/UPDATE/INSERT/DELETE anywhere in
this file. Compares every SQLAlchemy model's declared columns (name +
type) against the live DB's actual columns via introspection, and reports:
  - missing columns   (model declares it, DB table doesn't have it)
  - extra columns     (DB table has it, no model column declares it)
  - type mismatches   (both have the column, but the declared type differs
                        from the reflected DB type)

Also prints the row count of `project_pins` specifically, since that is
the one table already known to be behind (model uses `user_id`, some
installs' table still has the old `member_id`) — a row count of 0 there
confirms it's safe to drop `member_id` with no data loss before applying
the project_pins migration in apply_schema_updates().

Usage — run INSIDE a backend container (needs the app's own Python env
and SQLAlchemy models), does not require deploying this file first:

    docker exec -i <backend_container_name> python < check_schema_drift.py

e.g. on production:   docker exec -i task_backend python < check_schema_drift.py
     on dev:           docker exec -i kpi_portal_developer-backend-1 python < check_schema_drift.py

Exit code is always 0 — this is a report, not a gate.
"""
import app.main  # noqa: F401 — importing registers every model on Base.metadata
from app.database import engine, Base
from sqlalchemy import inspect, text


def _norm(type_str: str) -> str:
    """Loose-normalize a SQLAlchemy type's string form for comparison —
    collapses case and drops length/precision specifics (VARCHAR(50) vs
    VARCHAR(255) is not a drift worth flagging here, just a different
    constraint on the same kind of column)."""
    return type_str.upper().split("(")[0].strip()


# SQLAlchemy's generic type name vs. Postgres' reflected name often differ
# for the exact same underlying column (DateTime -> "DATETIME" in the model,
# but introspection reports "TIMESTAMP"/"TIMESTAMP WITH TIME ZONE"). These
# are NOT drift — flagging them would bury the real signal under ~60 tables
# of noise, as a first pass of this script found.
_TYPE_EQUIVALENCE_GROUPS = [
    {"DATETIME", "TIMESTAMP", "TIMESTAMP WITH TIME ZONE", "TIMESTAMP WITHOUT TIME ZONE"},
    {"FLOAT", "DOUBLE PRECISION", "REAL"},
    {"INTEGER", "SERIAL"},
    {"BIGINT", "BIGSERIAL"},
]


def _types_compatible(a: str, b: str) -> bool:
    if a == b:
        return True
    return any(a in group and b in group for group in _TYPE_EQUIVALENCE_GROUPS)


def audit_schema_drift():
    insp = inspect(engine)
    existing_tables = set(insp.get_table_names())
    problems = []

    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            problems.append({"table": table.name, "missing_table": True})
            continue

        db_cols = {c["name"]: c for c in insp.get_columns(table.name)}
        model_cols = {c.name: c for c in table.columns}

        missing_in_db = sorted(set(model_cols) - set(db_cols))
        extra_in_db = sorted(set(db_cols) - set(model_cols))

        type_mismatches = []
        for name in sorted(set(model_cols) & set(db_cols)):
            model_type = _norm(str(model_cols[name].type))
            db_type = _norm(str(db_cols[name]["type"]))
            if not _types_compatible(model_type, db_type):
                type_mismatches.append(
                    f"{name}: model declares {model_type!s} ({model_cols[name].type}), "
                    f"DB has {db_type!s} ({db_cols[name]['type']})"
                )

        if missing_in_db or extra_in_db or type_mismatches:
            problems.append({
                "table": table.name,
                "missing_table": False,
                "missing_in_db": missing_in_db,
                "extra_in_db": extra_in_db,
                "type_mismatches": type_mismatches,
            })

    print(f"Tables checked: {len(Base.metadata.sorted_tables)}")
    print(f"Tables with drift: {len(problems)}")
    print()
    for p in problems:
        print(f"--- {p['table']} ---")
        if p.get("missing_table"):
            print("  MISSING TABLE ENTIRELY (model declares it, DB has no such table)")
            continue
        if p["missing_in_db"]:
            print(f"  Missing in DB (model has, DB doesn't): {p['missing_in_db']}")
        if p["extra_in_db"]:
            print(f"  Extra in DB (DB has, model doesn't):   {p['extra_in_db']}")
        for m in p["type_mismatches"]:
            print(f"  Type mismatch — {m}")
        print()

    if not problems:
        print("No schema drift found across any registered table.")


def print_project_pins_row_count():
    print()
    print("--- project_pins row count ---")
    with engine.connect() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM project_pins")).scalar()
    print(f"project_pins has {count} row(s).")
    if count == 0:
        print("Safe to drop the legacy member_id column — no data to lose.")
    else:
        print("NON-ZERO — STOP. Back up and inspect these rows (and map them to "
              "user_id via users.member_id) before dropping member_id.")


if __name__ == "__main__":
    audit_schema_drift()
    print_project_pins_row_count()
