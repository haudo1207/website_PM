import os
os.environ["GOOGLE_API_USE_MTLS_ENDPOINT"] = "never"
import socket
socket.setdefaulttimeout(120)  # Tăng thời gian chờ phản hồi từ Google API lên 120 giây
from google.oauth2 import service_account
from googleapiclient.discovery import build
from ..config import settings
 
def get_credentials():
    path = settings.GOOGLE_APPLICATION_CREDENTIALS
    if not os.path.exists(path):
        # Resolve path relative to this file: .../backend/app/worker/google_sheet.py -> secrets/google-service-account.json
        local_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "secrets", "google-service-account.json"))
        if os.path.exists(local_path):
            path = local_path
        else:
            # Try current working directory
            path = "secrets/google-service-account.json"
    
    return service_account.Credentials.from_service_account_file(
        path,
        scopes=[
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive"
        ])

def get_service():
    creds = get_credentials()
    return build("sheets", "v4", credentials=creds, cache_discovery=False)
 
def find_matching_tab(tab_name: str, config_tab_names: list) -> str:
    if not config_tab_names:
        return tab_name
    
    tab_name_lower = tab_name.strip().lower()
    for tn in config_tab_names:
        if tn.strip().lower() == tab_name_lower:
            return tn
            
    import re
    def normalize(name: str) -> str:
        return re.sub(r'[\d\.\s\/\\_]+', '', name).lower()
        
    norm_tab = normalize(tab_name)
    if norm_tab:
        for tn in config_tab_names:
            if normalize(tn) == norm_tab:
                return tn
                
    for tn in config_tab_names:
        tn_lower = tn.strip().lower()
        if tab_name_lower in tn_lower or tn_lower in tab_name_lower:
            return tn
            
    return None

def read_tabs(spreadsheet_id: str, required_cols: list, tab_names: list = None) -> list:
    svc = get_service()
    meta = svc.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    req_set = set(c.strip().upper() for c in required_cols)
    results = []
    for sheet in meta.get("sheets", []):
        tab = sheet["properties"]["title"]
        if tab.strip().lower() == "master":
            continue
        if tab_names:
            matched = find_matching_tab(tab, tab_names)
            if not matched:
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
            d = {}
            for h, v in zip(headers, padded):
                h_clean = h.strip()
                if h_clean not in d:
                    d[h_clean] = v
            d["_row"] = i
            if not any(str(v).strip() for k,v in d.items() if k != "_row"):
                continue
            # Lay ten task thuc su (Detail Task, Task, Description, v.v.)
            detail_val = ""
            for k, v in d.items():
                k_up = str(k).strip().upper()
                if k_up in ["DETAIL TASK", "DETAIL", "TASK", "DESCRIPTION", "MÔ TẢ", "TÊN TASK"]:
                    detail_val = str(v).strip()
                    break
            
            # Neu ca detail_val va task_id_val deu trong thi bo qua
            task_id_val = str(d.get(task_id_col, "")).strip() if task_id_col else ""
            if not detail_val and not task_id_val:
                continue
            tab_rows.append(d)
        if tab_rows:
            results.append({"tab_name": tab, "rows": tab_rows})
    return results

def create_new_sheet(title: str, pm_email: str = None, leader_email: str = None, member_emails: str = None) -> dict:
    creds = get_credentials()
    sheets_service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    drive_service = build("drive", "v3", credentials=creds, cache_discovery=False)

    tab_names = ["master", "1.Sale/Admin", "2.Init", "2.1.Lab/PoC", "3.Implement", "4.MA"]
    sheets_metadata = [{"properties": {"title": name}} for name in tab_names]

    spreadsheet_body = {
        "properties": {"title": title},
        "sheets": sheets_metadata
    }

    spreadsheet = sheets_service.spreadsheets().create(
        body=spreadsheet_body,
        fields="spreadsheetId,spreadsheetUrl"
    ).execute()
    
    spreadsheet_id = spreadsheet.get("spreadsheetId")
    spreadsheet_url = spreadsheet.get("spreadsheetUrl")

    # Set up headers and formula
    headers = ["TASK ID", "DETAIL TASK", "PRIORITY", "MANDAY (EST)", "STATUS", "ASSIGNED"]
    
    # 1. Fill headers on all tabs
    data = []
    for tab in tab_names:
        data.append({
            "range": f"'{tab}'!A1:F1",
            "values": [headers]
        })
        
    sheets_service.spreadsheets().values().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={
            "valueInputOption": "USER_ENTERED",
            "data": data
        }
    ).execute()

    # 2. Write consolidation formula to master!A2
    formula = (
        "=QUERY({"
        "IFERROR(FILTER('1.Sale/Admin'!A2:F, LEN('1.Sale/Admin'!B2:B)>0), {\"\",\"\",\"\",\"\",\"\",\"\"});"
        "IFERROR(FILTER('2.Init'!A2:F, LEN('2.Init'!B2:B)>0), {\"\",\"\",\"\",\"\",\"\",\"\"});"
        "IFERROR(FILTER('2.1.Lab/PoC'!A2:F, LEN('2.1.Lab/PoC'!B2:B)>0), {\"\",\"\",\"\",\"\",\"\",\"\"});"
        "IFERROR(FILTER('3.Implement'!A2:F, LEN('3.Implement'!B2:B)>0), {\"\",\"\",\"\",\"\",\"\",\"\"});"
        "IFERROR(FILTER('4.MA'!A2:F, LEN('4.MA'!B2:B)>0), {\"\",\"\",\"\",\"\",\"\",\"\"})"
        "}, \"where Col1 is not null or Col2 is not null\", 0)"
    )
    
    sheets_service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range="'master'!A2",
        valueInputOption="USER_ENTERED",
        body={"values": [[formula]]}
    ).execute()

    # 3. Share permissions with PM, Leader, and members
    emails = []
    if pm_email:
        emails.append(pm_email.strip())
    if leader_email:
        emails.append(leader_email.strip())
    if member_emails:
        for m in member_emails.split(","):
            if m.strip():
                emails.append(m.strip())
                
    # Deduplicate
    emails = list(set(emails))
    
    for email in emails:
        try:
            drive_service.permissions().create(
                fileId=spreadsheet_id,
                body={
                    "type": "user",
                    "role": "writer",
                    "emailAddress": email
                },
                fields="id"
            ).execute()
        except Exception as e:
            print(f"Could not share sheet with {email}: {e}")

    # Make link viewable by anyone in the company/network who has the link
    try:
        drive_service.permissions().create(
            fileId=spreadsheet_id,
            body={
                "type": "anyone",
                "role": "reader"
            },
            fields="id"
        ).execute()
    except Exception as e:
        print(f"Could not set anyone-with-link read access: {e}")

    return {
        "spreadsheet_id": spreadsheet_id,
        "spreadsheet_url": spreadsheet_url
    }

def insert_row_in_sheet(spreadsheet_id: str, tab_name: str, after_row: int, row_data: dict) -> int:
    """
    Inserts a row in the Google Sheet after `after_row` (1-indexed).
    Fills the inserted row with `row_data` based on the column headers of that tab.
    Returns the new row number (1-indexed).
    """
    svc = get_service()
    
    # 1. Fetch metadata to get the sheetId of the tab_name
    meta = svc.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    sheet_id = None
    for sheet in meta.get("sheets", []):
        if sheet["properties"]["title"] == tab_name:
            sheet_id = sheet["properties"]["sheetId"]
            break
            
    if sheet_id is None:
        raise Exception(f"Tab '{tab_name}' not found")
        
    # 2. Insert a row at index after_row (which is 1-indexed, so row 5 is index 5 in insertDimension)
    insert_index = after_row
    
    body = {
        "requests": [
            {
                "insertDimension": {
                    "range": {
                        "sheetId": sheet_id,
                        "dimension": "ROWS",
                        "startIndex": insert_index,
                        "endIndex": insert_index + 1
                    },
                    "inheritFromBefore": True
                }
            }
        ]
    }
    svc.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body=body).execute()
    
    # 3. Read headers from row 1 to align row_data keys
    header_data = svc.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"'{tab_name}'!1:1"
    ).execute()
    
    headers = []
    if header_data.get("values"):
        headers = [h.strip() for h in header_data["values"][0]]
        
    # Build list of values matching the headers
    new_row_values = []
    for h in headers:
        val = ""
        h_up = h.upper()
        for k, v in row_data.items():
            if k.strip().upper() == h_up:
                val = str(v)
                break
        new_row_values.append(val)
        
    new_row_values += [""] * (len(headers) - len(new_row_values))
    
    # 4. Update the values of the newly inserted row
    new_row_num = insert_index + 1
    svc.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"'{tab_name}'!A{new_row_num}",
        valueInputOption="USER_ENTERED",
        body={"values": [new_row_values]}
    ).execute()
    
    return new_row_num


def get_worksheet_names(spreadsheet_id: str) -> list[str]:
    """
    Trả về danh sách tên các worksheet trong Google Spreadsheet.
    """

    svc = get_service()

    meta = svc.spreadsheets().get(
        spreadsheetId=spreadsheet_id
    ).execute()

    return [
        sheet["properties"]["title"]
        for sheet in meta.get("sheets", [])
    ]

