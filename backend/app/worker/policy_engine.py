def check_row(row: dict, policy: dict, required_cols: list) -> list:
    violations = []
    def add(code, msg):
        violations.append({"code":code,"message":msg})
    col_map = {}
    for rc in required_cols:
        for k in row.keys():
            if k.strip().upper() == rc.strip().upper():
                col_map[rc.strip().upper()] = k
                break
    for rule in policy.get("rules", []):
        field = rule.get("field","").strip().upper()
        col_name = col_map.get(field, field)
        cell_val = str(row.get(col_name,"")).strip()
        rule_val = str(rule.get("value","")).strip()
        if rule_val and cell_val.upper() != rule_val.upper():
            continue
        if rule.get("manday_max") is not None:
            md_col = col_map.get("MANDAY (EST)","MANDAY (EST)")
            try:
                mv = float(str(row.get(md_col,0) or 0).replace(",","."))
                if mv > rule["manday_max"]:
                    add("MANDAY_TOO_HIGH",f"Manday={mv} exceeds max {rule['manday_max']}")
            except:
                add("MANDAY_NOT_NUMBER","Manday must be a number")
        if rule.get("manday_min") is not None:
            md_col = col_map.get("MANDAY (EST)","MANDAY (EST)")
            try:
                mv = float(str(row.get(md_col,0) or 0).replace(",","."))
                if mv < rule["manday_min"]:
                    add("MANDAY_TOO_LOW",f"Manday={mv} below min {rule['manday_min']}")
            except:
                pass
        if rule.get("min_words") is not None:
            task_col = col_map.get("DETAIL TASK","DETAIL TASK")
            tv = str(row.get(task_col,"")).strip()
            limit = 10
            if len(tv.split()) < limit:
                add("DESC_TOO_SHORT",f"Need at least {limit} words")
        for rf in rule.get("required_fields",[]):
            rc2 = col_map.get(rf.strip().upper(), rf)
            if not str(row.get(rc2,"")).strip():
                add("MISSING_FIELD",f"Required: {rf}")
    return violations
