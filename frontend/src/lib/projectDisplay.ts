// Shared "Tên khách hàng - Tên dự án" formatting for any project card/list
// row that wants customer context next to the project name. Different
// callers surface the customer name under different keys depending on
// which backend endpoint fed them (`/api/projects`'s serialize_project
// uses `customer_name`; task-based endpoints like
// `/api/system-audit/team-comparison-tasks` stamp it per-task as
// `customerName`) — this accepts either so callers don't each need their
// own normalization.
export function formatProjectCardTitle(p: {
  name?: string | null;
  customer_name?: string | null;
  customerName?: string | null;
} | null | undefined): string {
  if (!p) return '';
  const customerName = (p.customer_name || p.customerName || '').trim();
  const name = p.name || '';
  return customerName ? `${customerName} - ${name}` : name;
}
