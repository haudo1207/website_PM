import os
os.environ["GOOGLE_API_USE_MTLS_ENDPOINT"] = "never"
from google.oauth2 import service_account
from googleapiclient.discovery import build
from ..config import settings
 
def get_service():
    path = settings.GOOGLE_APPLICATION_CREDENTIALS
    if not os.path.exists(path):
        # Resolve path relative to this file: .../backend/app/worker/google_sheet.py -> secrets/google-service-account.json
        local_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "secrets", "google-service-account.json"))
        if os.path.exists(local_path):
            path = local_path
        else:
            # Try current working directory
            path = "secrets/google-service-account.json"
    
    creds = service_account.Credentials.from_service_account_file(
        path,
        scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"])
    return build("sheets", "v4", credentials=creds, cache_discovery=False)
 
def read_tabs(spreadsheet_id: str, required_cols: list, tab_names: list = None) -> list:
    svc = get_service()
    meta = svc.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    req_set = set(c.strip().upper() for c in required_cols)
    results = []
    for sheet in meta.get("sheets", []):
        tab = sheet["properties"]["title"]
        if tab_names and tab not in tab_names:
            continue
        data = svc.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=tab).execute()
        rows = data.get("values", [])
        if not rows:
            continue
        headers_up = [h.strip().upper() for h in rows[0]]
        if not req_set.issubset(set(headers_up)):
            continue
        headers = [h.strip() for h in rows[0]]
 
        # Tim cot Task ID (cot dau hoac cot co "ID" trong ten)
        task_id_col = None
        for h in headers:
            if h.strip().upper() in ["TASK ID","ID","TASK_ID","#","NO","STT"]:
                task_id_col = h.strip()
                break
        if task_id_col is None and headers:
            task_id_col = headers[0]
 
        tab_rows = []
        for i, row in enumerate(rows[1:], start=2):
            padded = row + [""] * (len(headers) - len(row))
            d = dict(zip(headers, padded))
            d["_row"] = i
            if not any(str(v).strip() for k,v in d.items() if k != "_row"):
                continue
            # Chi check dong co Task ID la so thuc su (bo qua header mau, dong tieu de)
            task_id_val = str(d.get(task_id_col, "")).strip() if task_id_col else ""
            if not task_id_val:
                continue
            if not any(c.isdigit() for c in task_id_val):
                continue
            # Chi lay cac dong co ten task thuc su (Detail Task, Task, Description, v.v.)
            detail_val = ""
            for k, v in d.items():
                k_up = str(k).strip().upper()
                if k_up in ["DETAIL TASK", "DETAIL", "TASK", "DESCRIPTION", "MÔ TẢ", "TÊN TASK"]:
                    detail_val = str(v).strip()
                    break
            if not detail_val:
                continue
            tab_rows.append(d)
        if tab_rows:
            results.append({"tab_name": tab, "rows": tab_rows})
    return results
