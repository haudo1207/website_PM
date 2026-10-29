"""
Read-only. Identifies a specific Phase by id (e.g. the "Phase id(s) [69]"
missing from the reorder payload) — prints its name, project, sort_order,
and whether it's currently pinned-visible or in the "Phase khác" overflow
group is a pure frontend concept (pinnedPhaseIds, localStorage), so this
only confirms the Phase itself and its project context; it cannot tell
you whether THIS particular browser/account had it pinned or not.

Usage (inside the backend container):
    docker exec -i <backend_container> python - 69 < diagnose_phase_69.py
"""
import sys

from app.database import SessionLocal
from app.models.phase import Phase
from app.models.project import Project


def main():
    if len(sys.argv) < 2:
        print("Usage: diagnose_phase_69.py <phase_id> [more_phase_ids...]")
        return
    db = SessionLocal()
    try:
        for raw_id in sys.argv[1:]:
            try:
                pid = int(raw_id)
            except ValueError:
                print(f"Skipping invalid id: {raw_id!r}")
                continue
            ph = db.query(Phase).filter(Phase.id == pid).first()
            if not ph:
                print(f"Phase id={pid}: NOT FOUND (deleted, or never existed)")
                continue
            proj = db.query(Project).filter(Project.id == ph.project_id).first()
            all_phases = (
                db.query(Phase)
                .filter(Phase.project_id == ph.project_id)
                .order_by(Phase.sort_order, Phase.id)
                .all()
            )
            print(f"Phase id={pid}: name={ph.name!r}, status={ph.status!r}, "
                  f"sort_order={ph.sort_order}, is_protected={ph.is_protected}, "
                  f"project_id={ph.project_id} ({proj.name if proj else '???'})")
            print(f"  All phases in this project, in sort_order: "
                  f"{[(p.id, p.name) for p in all_phases]}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
