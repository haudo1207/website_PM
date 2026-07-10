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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { meetingId, transcript } = body;

    if (!meetingId || !transcript) {
      return NextResponse.json(
        { success: false, error: 'Thiếu ID cuộc họp hoặc nội dung transcript.' },
        { status: 400 }
      );
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      return NextResponse.json(
        { success: false, error: 'Chưa cấu hình GEMINI_API_KEY trong file .env. Vui lòng kiểm tra lại.' },
        { status: 500 }
      );
    }

    // 1. Read Prompt Template
    let promptTemplate = DEFAULT_PROMPT;
    if (fs.existsSync(settingsFilePath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'));
        if (settings.promptTemplate) {
          promptTemplate = settings.promptTemplate;
        }
      } catch (e) {
        console.error('Failed to read ai-settings.json, using default prompt', e);
      }
    }

    // 2. Query Google Gemini API
    const prompt = `${promptTemplate}\n\n[BIÊN BẢN CUỘC HỌP/TRANSCRIPT]:\n${transcript}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
    
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { success: false, error: `Gemini API error: ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!generatedText) {
      return NextResponse.json(
        { success: false, error: 'Không nhận được kết quả tóm tắt từ Gemini AI.' },
        { status: 500 }
      );
    }

    // 3. Clean up the generated markdown to parse into list array
    const lines = generatedText
      .split('\n')
      .map((line: string) => line.trimEnd())
      .filter((line: string) => line.trim().length > 0 && !line.toLowerCase().startsWith('dưới đây là') && !line.toLowerCase().startsWith('tóm tắt cuộc họp'));

    // 4. Update the meeting in PostgreSQL via FastAPI Backend
    const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://backend:8000';
    
    // Forward incoming request credentials/headers for authorization
    const reqHeaders = request.headers;
    const forwardHeaders = new Headers();
    const cookie = reqHeaders.get('cookie');
    if (cookie) forwardHeaders.set('cookie', cookie);
    const auth = reqHeaders.get('authorization');
    if (auth) forwardHeaders.set('authorization', auth);
    forwardHeaders.set('Content-Type', 'application/json');

    // First fetch current meeting to not override other details
    const getRes = await fetch(`${backendUrl}/api/meetings/${meetingId}`, {
      headers: forwardHeaders
    });

    if (!getRes.ok) {
      const errorText = await getRes.text();
      return NextResponse.json(
        { success: false, error: `Không thể tải cuộc họp từ backend: ${errorText}` },
        { status: getRes.status }
      );
    }

    const currentMeeting = await getRes.json();

    // Perform PUT update to database
    const updateRes = await fetch(`${backendUrl}/api/meetings/${meetingId}`, {
      method: 'PUT',
      headers: forwardHeaders,
      body: JSON.stringify({
        ...currentMeeting,
        transcript: transcript,
        status: 'ĐÃ DIỄN RA', // Will map to 'DONE' in database
        ai_summary: {
          summary: generatedText,
          decisions: [],
          issues: [],
          action_items: lines
        }
      })
    });

    if (!updateRes.ok) {
      const errorText = await updateRes.text();
      return NextResponse.json(
        { success: false, error: `Lỗi lưu cuộc họp lên backend database: ${errorText}` },
        { status: updateRes.status }
      );
    }

    const updatedMeetingData = await updateRes.json();

    return NextResponse.json({
      success: true,
      summary: updatedMeetingData.summary || lines,
      transcript: transcript
    });

  } catch (error: any) {
    console.error('AI Summary API Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi không xác định khi tạo tóm tắt.' },
      { status: 500 }
    );
  }
}
