"""
AI summary + proposed tasks for a single WIP log (ProjectFeatureLog), on
demand (not periodic like Zalo's digest). Same 3-part shape family as
Meeting Intelligence / Zalo's daily digest, but tuned specifically so a
content-rich WIP log (which almost always has its own "NEXT STEPS"/"OPEN
ISSUES" sections) yields several concrete tasks instead of collapsing
everything into 1-2 — WIP logs are far more detailed than a sparse meeting
transcript, so under-extraction there was a prompt-wording gap, not a data
gap.
"""
import logging

from sqlalchemy.orm import Session

from .ai_client import chat_completion_json, AiClientError
from ..models.project_feature import ProjectFeatureLog

logger = logging.getLogger("project_feature_ai")

SYSTEM_PROMPT = """Bạn là trợ lý phân tích nhật ký công việc (WIP log) của một dự án phần mềm.
Đọc nội dung WIP log bên dưới và trả về JSON THUẦN TÚY (JSON Object), KHÔNG bọc trong markdown
block, KHÔNG thêm câu dẫn:
{
  "summary": "Tóm tắt 2-4 câu ngắn gọn, chính xác tuyệt đối từ nội dung — WIP này đang làm gì, đã xong tới đâu.",
  "tasks": [
    {
      "detail_task": "Một đầu việc/next step CỤ THỂ được nhắc tới trong nội dung",
      "priority": "Critical | High | Normal",
      "assigned_name": "Tên người phụ trách nếu nội dung nói rõ, ngược lại để rỗng \\"\\"",
      "deadline": "YYYY-MM-DD nếu nội dung nói rõ, ngược lại để rỗng \\"\\""
    }
  ]
}

QUY TẮC TRÍCH XUẤT TASK (BẮT BUỘC TUÂN THỦ):
1. Nội dung WIP log thường có các phần liệt kê nhiều đầu việc (ví dụ "NEXT STEPS", "OPEN ISSUES",
   "VẤN ĐỀ ĐANG TỒN TẠI", "CÁC BƯỚC TIẾP THEO") — hãy tách MỖI đầu việc cụ thể trong các phần này
   thành MỘT task riêng biệt. TUYỆT ĐỐI KHÔNG gộp nhiều đầu việc khác nhau thành một task chung
   chung duy nhất.
2. Nếu nội dung đủ chi tiết (đa số WIP log đều vậy), hãy trả về TỪ 3 ĐẾN 6 task. Chỉ trả về ít
   hơn 3 task nếu nội dung thực sự chỉ mô tả đúng 1-2 đầu việc cụ thể — không được vì muốn đủ số
   lượng mà bịa thêm việc không có căn cứ trong nội dung.
3. Đánh giá mức độ khẩn cấp thực tế: nếu nội dung có phần "vấn đề tồn tại"/rủi ro/việc gây tắc
   nghẽn tiến độ, BẮT BUỘC gắn priority="Critical" cho 1 đến 2 task quan trọng/rủi ro cao nhất
   trong số đó. Các task còn lại gắn "High" hoặc "Normal" tùy mức độ khẩn cấp thực tế được thể
   hiện trong nội dung. Nếu nội dung không có tín hiệu khẩn cấp/rủi ro nào rõ ràng, không bắt
   buộc phải có task Critical — ưu tiên phản ánh đúng thực tế hơn là ép buộc.
4. KHÔNG bịa người phụ trách hay deadline không có căn cứ trong nội dung — để rỗng "" nếu không
   có."""


def summarize_feature_log(db: Session, log: ProjectFeatureLog) -> None:
    """Pure mutator — writes log.ai_summary/log.ai_tasks, caller commits.
    Raises AiClientError on failure (caller decides how to surface it)."""
    content = (log.content or "").strip()
    if not content:
        raise AiClientError("Log không có nội dung để tóm tắt")

    result = chat_completion_json(SYSTEM_PROMPT, content, max_tokens=1500, temperature=0.3)

    summary = (result.get("summary") or "").strip()
    if not summary:
        raise AiClientError("AI không trả về tóm tắt hợp lệ")

    tasks = [
        {
            "detail_task": str(t.get("detail_task", "")).strip(),
            "priority": (t.get("priority") or "Normal").strip() or "Normal",
            "assigned_name": (t.get("assigned_name") or "").strip(),
            "deadline": (t.get("deadline") or "").strip(),
        }
        for t in (result.get("tasks") or [])
        if isinstance(t, dict) and str(t.get("detail_task") or "").strip()
    ]

    log.ai_summary = summary
    log.ai_tasks = tasks or None
