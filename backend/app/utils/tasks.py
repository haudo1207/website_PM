import datetime
import math

def parse_date(date_str):
    if not date_str:
        return None
    date_str = str(date_str).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.datetime.strptime(date_str, fmt).date()
        except ValueError:
            continue
    return None

def format_date(dt):
    if not dt:
        return ""
    return dt.strftime("%d/%m/%Y")

def compute_derived_fields(task_data: dict) -> dict:
    # We want to maintain original keys, but ensure casing matches dynamically
    # Look up keys case-insensitively
    keys_lower = {k.lower().strip(): k for k in task_data.keys()}
    
    # 1. PRIORITY & KPI BASE
    priority_key = keys_lower.get("priority", "PRIORITY")
    priority_val = str(task_data.get(priority_key, "")).strip().lower()
    
    if priority_val in ["critical", "urgent"]:
        kpi_base = 20
    elif priority_val in ["high"]:
        kpi_base = 12
    elif priority_val in ["normal", "medium"]:
        kpi_base = 6
    else:
        kpi_base = 6  # Default Normal
        
    kpi_base_key = keys_lower.get("kpi base", "KPI BASE")
    task_data[kpi_base_key] = str(kpi_base)
    
    # 2. MANDAY EST & KPI PERFORM
    manday_est_key = keys_lower.get("manday est", keys_lower.get("manday (est)", "MANDAY EST"))
    manday_est_val = str(task_data.get(manday_est_key, "0")).strip()
    try:
        manday_est = float(manday_est_val) if manday_est_val else 0.0
    except ValueError:
        manday_est = 0.0
        
    kpi_perform = kpi_base * manday_est
    kpi_perform_key = keys_lower.get("kpi perform", "KPI PERFORM")
    task_data[kpi_perform_key] = f"{kpi_perform:.1f}" if kpi_perform % 1 != 0 else str(int(kpi_perform))
    
    # 3. START DATE -> END DATE EST, WEEK EST, MONTH EST
    start_date_key = keys_lower.get("start date", "START DATE")
    start_date = parse_date(task_data.get(start_date_key, ""))
    
    end_date_est_key = keys_lower.get("end date est", "END DATE EST")
    week_est_key = keys_lower.get("week est", "WEEK EST")
    month_est_key = keys_lower.get("month est", "MONTH EST")
    
    if start_date:
        # Calculate END DATE EST = START_DATE + MANDAY_EST days
        # Round up manday_est to add integer days
        days_to_add = max(1, math.ceil(manday_est))
        end_date_est = start_date + datetime.timedelta(days=days_to_add)
        task_data[end_date_est_key] = format_date(end_date_est)
        
        # WEEK EST & MONTH EST
        iso_year, iso_week, _ = start_date.isocalendar()
        task_data[week_est_key] = f"W{iso_week:02d}"
        task_data[month_est_key] = f"M{start_date.month:02d}"
    else:
        # If no start date, clear/set default
        task_data[end_date_est_key] = ""
        task_data[week_est_key] = ""
        task_data[month_est_key] = ""
        
    # 4. END ACTUAL -> WEEK ACTUAL, MONTH ACTUAL, DAYS LATE
    end_actual_key = keys_lower.get("end actual", "END ACTUAL")
    end_actual = parse_date(task_data.get(end_actual_key, ""))
    
    week_actual_key = keys_lower.get("week actual", "WEEK ACTUAL")
    month_actual_key = keys_lower.get("month actual", "MONTH ACTUAL")
    days_late_key = keys_lower.get("days late", "DAYS LATE")
    
    if end_actual:
        iso_year, iso_week, _ = end_actual.isocalendar()
        task_data[week_actual_key] = f"W{iso_week:02d}"
        task_data[month_actual_key] = f"M{end_actual.month:02d}"
        
        # DAYS LATE
        end_date_est = parse_date(task_data.get(end_date_est_key, ""))
        if end_date_est:
            delta = (end_actual - end_date_est).days
            task_data[days_late_key] = str(max(0, delta))
        else:
            task_data[days_late_key] = "0"
    else:
        task_data[week_actual_key] = ""
        task_data[month_actual_key] = ""
        task_data[days_late_key] = ""

    # Ensure other auto columns exist as empty if not set
    for col in ["MD ACTUAL", "KPI OVERTIME", "KPI FINAL", "SUB ID"]:
        col_key = keys_lower.get(col.lower(), col)
        if col_key not in task_data:
            task_data[col_key] = ""

    return task_data
