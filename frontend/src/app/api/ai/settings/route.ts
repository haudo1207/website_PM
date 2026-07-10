import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const settingsFilePath = path.join(process.cwd(), 'data', 'ai-settings.json');

const DEFAULT_PROMPT = `Bạn là một trợ lý ảo phân tích cuộc họp chuyên nghiệp. Hãy tóm tắt nội dung cuộc họp dựa trên biên bản/transcript được cung cấp theo đúng cấu trúc sau đây:

MEETING SUMMARY – [Tên Cuộc Họp]
Ngày họp: [Ngày diễn ra cuộc họp định dạng DD/MM/YYYY]
Team: [Tên Team tham gia, ví dụ: Dev, Marketing, HR... nếu không có thì ghi "Không đề cập"]
Người summary: [Tên người tóm tắt/chủ trì, nếu không có thì ghi "Không đề cập"]

Task cha đã chốt
1. Project: [Tên dự án liên quan, nếu không có thì ghi "Không đề cập"]
• Task cha: [Tên công việc chính cần làm]
• Priority: [Độ ưu tiên: Critical, High, Medium, Low, nếu không có thì ghi "Không đề cập"]
• Manday Budget: [Số ngày công ước tính, nếu không có thì ghi "Không đề cập"]
• Owner: [Người chịu trách nhiệm thực hiện, nếu không có thì ghi "Không đề cập"]
• Deadline: [Hạn chót hoàn thành, nếu không có thì ghi "Chưa xác định"]
• KPI / Output: [Kết quả đầu ra dự kiến của task]

(Nếu có nhiều task, hãy lặp lại cấu trúc đánh số 1, 2, 3... ở trên. Nếu không có task nào được chốt, hãy ghi "Không đề cập" ở phần Task cha đã chốt).

Lưu ý: Không viết thêm bất kỳ lời dẫn hay kết luận nào, chỉ trả về nội dung theo đúng cấu trúc trên.`;

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    let promptTemplate = DEFAULT_PROMPT;
    
    if (fs.existsSync(settingsFilePath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'));
        if (settings.promptTemplate) {
          promptTemplate = settings.promptTemplate;
        }
      } catch (e) {
        console.error('Failed to parse ai-settings.json, using default', e);
      }
    }
    
    const hasApiKey = !!process.env.GEMINI_API_KEY;
    return NextResponse.json({ success: true, promptTemplate, hasApiKey });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { promptTemplate } = body;

    if (!promptTemplate || promptTemplate.trim() === '') {
      return NextResponse.json({ success: false, error: 'Thiếu mẫu Prompt (promptTemplate).' }, { status: 400 });
    }

    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(settingsFilePath, JSON.stringify({ promptTemplate }, null, 2), 'utf8');

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
