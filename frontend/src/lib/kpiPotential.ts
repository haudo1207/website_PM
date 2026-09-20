// Status-agnostic KPI Giao helpers.
//
// Used by Dashboard surfaces where `Manday Giao` / `KPI Giao` must count
// ASSIGNED workload regardless of completion status (DONE / DOING / OVERDUE
// / etc.). The existing backend columns `kpi_base` / `kpi_final` /
// `kpi_assigned` / `kpi_support` are only populated when a task reaches
// `Done` (see `backend/app/utils/kpi_engine.py` lines 268–278 and 384–391),
// so reading them directly would silently zero-out any non-Done task.
//
// Instead, derive the "potential" KPI directly from the task's planned
// inputs (`priority`, `manday_est`, `kpi_ratio_assign/support`) which are
// always populated regardless of status:
//
//   kpi_potential = priority_kpi_base * manday_est
//
// and split Assignee / Support exactly the same way `kpi_engine.py` does
// for Done tasks, so the resulting per-Member share matches the share
// the Member WOULD earn once the task is completed.
//
// IMPORTANT: This helper is ONLY for `Giao` (target) values. The `HT`
// (completed) value must continue to come from the existing Done-only
// sources (`getTaskKpiForMember`, `getMyTaskKpi`, etc.) — those must
// NOT be replaced.
//
// Backend `Manday Giao` already works because `manday_est` is NOT NULL
// and status-agnostic — no helper needed there.

const PRIORITY_KPI_BASE: Record<string, number> = {
  // Names as stored in tasks_v2.priority (case-insensitive lookup below).
  // Mirrors the seeded `task_priorities.kpi_base` values and the
  // fallback aliases used by `get_priority_kpi_base()` in
  // `backend/app/utils/kpi_engine.py` lines 69-93.
  Normal: 6,
  Medium: 6,
  High: 12,
  Critical: 20,
  Urgent: 20,
  Interrupt: 25,
};

const DEFAULT_PRIORITY_KPI = 6;

export function getPriorityKpiBase(priority?: string | null): number {
  if (!priority) return DEFAULT_PRIORITY_KPI;
  const exact = PRIORITY_KPI_BASE[priority];
  if (typeof exact === 'number') return exact;
  // Case-insensitive lookup with trimmed input.
  const key = String(priority).trim();
  if (!key) return DEFAULT_PRIORITY_KPI;
  const lower = key.toLowerCase();
  const capitalized = lower.charAt(0).toUpperCase() + lower.slice(1);
  if (typeof PRIORITY_KPI_BASE[capitalized] === 'number') {
    return PRIORITY_KPI_BASE[capitalized];
  }
  return DEFAULT_PRIORITY_KPI;
}

/**
 * Status-agnostic KPI Giao share for a single Member on a single Task.
 *
 * Formula (mirrors `kpi_engine.calc_kpi_split` for Done tasks but uses
 * the planned inputs so it works regardless of status):
 *
 *   kpi_potential    = priority_kpi_base × manday_est
 *   kpi_giao_member  = kpi_potential × (kpi_ratio_assign/100)   [if assigned]
 *                    + kpi_potential × (kpi_ratio_support/100)   [if support]
 *
 * If the Member is neither the Assignee nor the Support, returns 0.
 *
 * Defaults for the ratio columns match `kpi_engine.recalculate_task`:
 * - When `support_id` is absent: ratio_assign = 100, ratio_support = 0.
 * - Otherwise: ratio_assign = 90, ratio_support = 10 (column-level defaults).
 */
export function getKpiGiaoForMember(task: any, memberId: any): number {
  if (!task || memberId == null) return 0;
  const manday = Number(task.manday_est);
  if (!Number.isFinite(manday) || manday <= 0) return 0;

  const priorityKpi = getPriorityKpiBase(task.priority);
  const basePotential = priorityKpi * manday;

  const assignedId = task.assigned_id;
  const supportId = task.support_id;
  const isAssigned = assignedId != null && String(assignedId) === String(memberId);
  const isSupport = supportId != null && String(supportId) === String(memberId);
  if (!isAssigned && !isSupport) return 0;

  // Resolve the effective Assign/Support ratio for this task. Same
  // semantics as `kpi_engine.recalculate_task` (lines 379-382) and the
  // column-level defaults on `tasks_v2.kpi_ratio_assign/support`.
  const hasSupport = supportId != null;
  const ratioAssign =
    task.kpi_ratio_assign != null
      ? Number(task.kpi_ratio_assign)
      : hasSupport
        ? 90
        : 100;
  const ratioSupport =
    task.kpi_ratio_support != null
      ? Number(task.kpi_ratio_support)
      : hasSupport
        ? 10
        : 0;

  let share = 0;
  if (isAssigned) share += basePotential * (ratioAssign / 100);
  if (isSupport) share += basePotential * (ratioSupport / 100);
  return share;
}

/**
 * Status-agnostic KPI Giao for a Project (sums both Assignee + Support
 * shares so each unit of KPI is counted exactly once). Equivalent to
 * `Σ priority_kpi × manday_est` over every assigned task in the project,
 * regardless of completion status.
 *
 * Used for the per-project cards' "KPI Giao" value.
 */
export function getProjectKpiGiao(task: any): number {
  if (!task) return 0;
  const manday = Number(task.manday_est);
  if (!Number.isFinite(manday) || manday <= 0) return 0;
  return getPriorityKpiBase(task.priority) * manday;
}
