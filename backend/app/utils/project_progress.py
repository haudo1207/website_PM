"""
Shared Project Progress helpers.

Settings → Danh mục hệ thống → Giai đoạn dự án (MasterPhase.progress_pct) is
the single source of truth for **Project Progress** across the entire system
(Dashboard Team Load, System Audit, Project Detail, Project Card/List).

Project Progress MUST NOT be conflated with:
  * Task completion (done_tasks / total_tasks)
  * Timeline percentage (project dates)

These are three different metrics.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from ..models.master_phase import MasterPhase


def _is_cancel_phase_name(name: Optional[str]) -> bool:
    """Cancel/abort phases follow the '0.' prefix convention in this system
    (e.g. '0. Huỷ'). This is the only reliable in-data signal — no business
    rule column exists, so we follow the established naming convention.

    Kept module-local so the helper stays testable in isolation."""
    if not name:
        return False
    return str(name).strip().startswith("0.")


def get_progress_pct_for_phase(db: Session, phase_name: Optional[str]) -> float:
    """Resolve Project Progress (%) from the configured Master Phase.

    Returns a float in the [0, 100] range. Returns 0.0 when:
      * phase_name is None / empty
      * phase_name does not match any configured Master Phase
      * the matched Master Phase has progress_pct NULL (defensive; back-fill
        in apply_schema_updates() should ensure every active phase has a
        configured value).

    Falls back to 0.0 rather than guessing — Project Progress is meant to be
    read from the configuration, never invented at read-time.
    """
    if not phase_name:
        return 0.0
    mp = (
        db.query(MasterPhase)
        .filter(MasterPhase.name == phase_name)
        .first()
    )
    if mp is None or mp.progress_pct is None:
        return 0.0
    try:
        return float(mp.progress_pct)
    except (TypeError, ValueError):
        return 0.0


def get_progress_pct_map(db: Session) -> dict[str, float]:
    """Bulk lookup helper. Returns a name→percentage dict for every active
    Master Phase, used by list endpoints that need to enrich many projects
    with their configured Project Progress in one pass.

    Phases whose progress_pct is NULL are included with 0.0 so the consumer
    sees the full mapping (and can decide to display "—" if desired).
    Cancel phases (name starting with "0.") are included with 0.0 too —
    they should never be considered as making forward Project Progress.
    """
    out: dict[str, float] = {}
    for mp in db.query(MasterPhase).all():
        if not mp.name:
            continue
        if mp.progress_pct is None:
            out[mp.name] = 0.0
        else:
            try:
                out[mp.name] = float(mp.progress_pct)
            except (TypeError, ValueError):
                out[mp.name] = 0.0
    return out
