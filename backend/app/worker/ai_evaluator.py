import json, re, requests as http
 
def evaluate_task(row: dict, ai_config: dict, required_cols: list) -> dict:
    url = ai_config.get("base_url")
    key = ai_config.get("api_key")
    model = ai_config.get("model")
    custom_sys = ai_config.get("system_prompt","")
    if not url or not key:
        return {"verdict":"REVIEW","reason":"AI API not configured","suggestion":"Provide API keys"}
 
    col_map = {}
    for rc in required_cols:
        for k in row.keys():
            if k.strip().upper() == rc.strip().upper():
                col_map[rc.strip().upper()] = k
                break
    task_desc = row.get(col_map.get("DETAIL TASK","DETAIL TASK"),"")
    priority  = row.get(col_map.get("PRIORITY","PRIORITY"),"")
    manday    = row.get(col_map.get("MANDAY (EST)","MANDAY (EST)"),"")
    status    = row.get(col_map.get("STATUS","STATUS"),"")
    assignee  = row.get(col_map.get("ASSIGNED","ASSIGNED"),"")
 
    sys_prompt = custom_sys if custom_sys else (
        "Bạn là trợ lý kiểm soát chất lượng & tuân thủ quy trình dự án.\n"
        "Đánh giá dòng công việc (task) sau từ Google Sheet:\n"
        "1. Trả về phán quyết (PASS, FAIL, hoặc REVIEW).\n"
        "2. Đưa ra Lý do (tiếng Việt).\n"
        "3. Đưa ra Gợi ý cải thiện (tiếng Việt).\n"
        "Định dạng trả về bắt buộc là JSON hợp lệ có dạng: {\"verdict\":\"...\",\"reason\":\"...\",\"suggestion\":\"...\"}\n"
        "Không viết markdown, không thêm ký tự ngoài JSON."
    )
 
    user_prompt = f"DETAIL TASK: {task_desc}\nPRIORITY: {priority}\nMANDAY (EST): {manday}\nSTATUS: {status}\nASSIGNED: {assignee}"
 
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.2
    }
 
    try:
        r = http.post(f"{url}/chat/completions", json=payload, headers=headers, timeout=60)
        if r.status_code != 200:
            return {"verdict":"REVIEW","reason":f"AI API HTTP {r.status_code}","suggestion":r.text[:200]}
        txt = r.json()["choices"][0]["message"]["content"].strip()
        txt = re.sub(r"^```json\s*|```$", "", txt, flags=re.MULTILINE).strip()
        return json.loads(txt)
    except Exception as e:
        return {"verdict":"REVIEW","reason":"AI error","suggestion":str(e)}
