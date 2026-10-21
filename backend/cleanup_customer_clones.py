"""
Cleanup: Customer rows that were auto-cloned into another Workspace when an
"All" project was created/updated (that cloning has been removed — a
Customer's Workspaces are now derived from its Projects).

A row is reported as a likely clone when:
  - it has NO projects (neither by customer_id nor legacy customer_name), and
  - another Customer with the same name (case-insensitive) DOES have projects.

Dry run by default — only prints the candidates. Nothing is deleted unless you
pass the ids you reviewed:

    python cleanup_customer_clones.py                 # list candidates
    python cleanup_customer_clones.py --apply 12 34   # delete customers 12 and 34

--apply re-checks every id against the same rule and skips any that no longer
qualify, so a stale list can't delete a Customer that has gained a project.
"""
import sys
from collections import defaultdict

from sqlalchemy import func

import app.models  # noqa: F401  (register mappers)
from app.database import SessionLocal
from app.models.project import Project
from app.models.system_category import Customer


def find_candidates(db):
    by_id = dict(
        db.query(Project.customer_id, func.count(Project.id))
        .filter(Project.customer_id.isnot(None))
        .group_by(Project.customer_id)
        .all()
    )
    legacy_names = {
        (n or "").strip().lower()
        for (n,) in db.query(Project.customer_name).filter(Project.customer_id.is_(None)).all()
        if n
    }
    groups = defaultdict(list)
    for c in db.query(Customer).all():
        groups[(c.name or "").strip().lower()].append(c)

    candidates = []
    for key, rows in groups.items():
        if len(rows) < 2:
            continue
        with_projects = [c for c in rows if by_id.get(c.id)]
        if not with_projects:
            continue
        for c in rows:
            if by_id.get(c.id) or key in legacy_names:
                continue
            keeper = with_projects[0]
            candidates.append((c, keeper, by_id.get(keeper.id, 0)))
    return candidates


def main(argv):
    db = SessionLocal()
    try:
        candidates = find_candidates(db)
        if "--apply" not in argv:
            if not candidates:
                print("Không có khách hàng nào nghi là bản sao.")
                return
            print(f"{len(candidates)} khách hàng nghi là bản sao (0 dự án, trùng tên với khách hàng có dự án):\n")
            print(f"{'ID':>6}  {'BU':<12} {'Tên':<40} → giữ lại ID (BU, số dự án)")
            for c, keeper, n in sorted(candidates, key=lambda t: (t[0].name or "").lower()):
                print(f"{c.id:>6}  {(c.business_unit or ''):<12} {(c.name or '')[:40]:<40} → {keeper.id} ({keeper.business_unit}, {n})")
            print("\nDuyệt danh sách rồi chạy:  python cleanup_customer_clones.py --apply <id> <id> ...")
            return

        ids = {int(x) for x in argv[argv.index("--apply") + 1:] if x.isdigit()}
        if not ids:
            print("Không có id nào được truyền sau --apply.")
            return
        allowed = {c.id: c for c, _, _ in candidates}
        for cid in sorted(ids):
            c = allowed.get(cid)
            if not c:
                print(f"  ✗ {cid}: bỏ qua — không (còn) thỏa điều kiện bản sao.")
                continue
            db.delete(c)
            print(f"  ✓ {cid}: đã xóa '{c.name}' ({c.business_unit}).")
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    main(sys.argv[1:])
