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

// This route calls a paid Gemini/OpenAI-compatible API before it ever checks
// whether meetingId is one the caller can actually write to (the backend
// PUT /api/meetings/{id} call further down does enforce that) — an
// unauthenticated caller could still burn through the shared API key's quota
// with arbitrary transcripts. Require a valid session (any role; the
// per-meeting project-access check stays with the backend PUT below).
async function requireAuth(request: Request): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://backend:8000';
  const forwardHeaders = new Headers();
  const cookie = request.headers.get('cookie');
  if (cookie) forwardHeaders.set('cookie', cookie);
  const auth = request.headers.get('authorization');
  if (auth) forwardHeaders.set('authorization', auth);

  try {
    const res = await fetch(`${backendUrl}/api/users/me`, { headers: forwardHeaders });
    if (!res.ok) return { ok: false, status: 401, error: 'Chưa đăng nhập.' };
    return { ok: true };
  } catch (e) {
    return { ok: false, status: 401, error: 'Không thể xác thực người dùng.' };
  }
}

function getGeminiApiKey(): string | undefined {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (process.env.AI_API_KEY) return process.env.AI_API_KEY;

  try {
    const envPaths = [
      path.join(process.cwd(), '.env'),
      path.join(process.cwd(), '..', '.env'),
      path.join(process.cwd(), 'frontend', '.env'),
    ];
    for (const envPath of envPaths) {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('GEMINI_API_KEY=')) {
            const val = trimmed.substring('GEMINI_API_KEY='.length).trim();
            if (val) return val;
          }
          if (trimmed.startsWith('AI_API_KEY=')) {
            const val = trimmed.substring('AI_API_KEY='.length).trim();
            if (val) return val;
          }
        }
      }
    }
  } catch (e) {
    console.error('Error reading fallback .env file:', e);
  }
  return undefined;
}

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }
  try {
    const body = await request.json();
    const { meetingId, transcript } = body;

    if (!meetingId || !transcript) {
      return NextResponse.json(
        { success: false, error: 'Thiếu ID cuộc họp hoặc nội dung transcript.' },
        { status: 400 }
      );
    }

    const geminiKey = getGeminiApiKey();
    if (!geminiKey) {
      return NextResponse.json(
        { success: false, error: 'Chưa cấu hình GEMINI_API_KEY hoặc AI_API_KEY trong file .env. Vui lòng kiểm tra lại.' },
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

    // 2. Query AI Model (Gemini REST API -> OpenRouter / OpenAI API Fallback)
    const jsonPrompt = `Bạn là trợ lý AI phân tích cuộc họp chuyên nghiệp. Hãy đọc kỹ biên bản/transcript cuộc họp bên dưới và trích xuất thông tin THỰC TẾ thành kết quả JSON THUẦN TÚY (JSON Object), KHÔNG bọc trong markdown codeblock, KHÔNG thêm lời dẫn:

BIÊN BẢN/TRANSCRIPT THỰC TẾ:
${transcript}

QUAN TRỌNG: Transcript có thể ngắn, rời rạc, hoặc lẫn đoạn test mic/chào hỏi không liên quan — TUYỆT ĐỐI KHÔNG vì vậy mà bỏ qua các từ khóa được nói THẲNG và RÕ RÀNG (ví dụ: "Critical", "gấp", "deadline ngày X", tên người được giao việc...). Dù transcript chỉ có 1-2 câu thực chất, vẫn phải quét kỹ và trích xuất đúng những gì đã nói ra, không được mặc định để trống/"Không đề cập" nếu từ khóa đó tồn tại trong transcript.

CẤU TRÚC JSON YÊU CẦU:
{
  "executive_summary": "Tóm tắt điều hành 2-3 câu ngắn gọn chính xác tuyệt đối từ transcript.",
  "decisions": [
    "Quyết định chính 1 từ transcript",
    "Quyết định chính 2 từ transcript"
  ],
  "recommended_tasks": [
    {
      "detail_task": "Tên công việc cụ thể được giao",
      "priority": "Critical | High | Normal",
      "assigned_name": "Tên người chịu trách nhiệm (nếu có, để rỗng nếu không có)",
      "deadline": "Định dạng YYYY-MM-DD nếu transcript có nêu, để rỗng nếu không có"
    }
  ]
}`;

    let generatedText = '';
    if (geminiKey && geminiKey.startsWith('AIza')) {
      const geminiModels = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"];
      for (const modelName of geminiModels) {
        try {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;
          const res = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: jsonPrompt }] }] })
          });
          if (res.ok) {
            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              generatedText = text;
              break;
            }
          }
        } catch (err) {
          console.warn(`Gemini API (${modelName}) failed:`, err);
        }
      }
    }

    const effectiveKey = process.env.AI_API_KEY || geminiKey;
    if (!generatedText && effectiveKey) {
      const baseUrl = (process.env.AI_BASE_URL || 'https://api.shopaikey.com/v1').replace(/\/$/, '');
      let model = process.env.AI_MODEL || 'gpt-4o-mini';
      if (model.startsWith('gemini-2.5')) model = 'gpt-4o-mini';

      // Shopaikey routes through shared channels that intermittently return
      // 429/503/529 (rate-limited/no-channel/overloaded) even for a valid
      // model — retry a couple of times before giving up.
      const maxRetries = 2;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: model,
              messages: [{ role: 'user', content: jsonPrompt }]
            })
          });
          if (res.ok) {
            const data = await res.json();
            generatedText = data.choices?.[0]?.message?.content || '';
            break;
          }
          const errText = await res.text();
          console.warn(`ShopAIKey response not OK (attempt ${attempt + 1}):`, res.status, errText);
          if (![429, 503, 529].includes(res.status) || attempt === maxRetries) break;
          await new Promise(r => setTimeout(r, 1500));
        } catch (err) {
          console.error(`OpenAI / ShopAIKey API fallback failed (attempt ${attempt + 1}):`, err);
          if (attempt === maxRetries) break;
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    }

    if (!generatedText) {
      return NextResponse.json(
        { success: false, error: 'Không nhận được kết quả tóm tắt từ AI. Vui lòng kiểm tra lại cấu hình API key.' },
        { status: 500 }
      );
    }

    let parsedSummary: any = null;
    try {
      let cleaned = generatedText.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.replace('```json', '').trim();
      if (cleaned.startsWith('```')) cleaned = cleaned.replace('```', '').trim();
      if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3).trim();
      parsedSummary = JSON.parse(cleaned);
    } catch (e) {
      console.warn("Failed to parse JSON AI response in route.ts:", e);
      parsedSummary = {
        executive_summary: generatedText,
        decisions: ["Chốt mục tiêu chính của cuộc họp"],
        recommended_tasks: [
          { detail_task: `Thực hiện kết luận cuộc họp`, priority: "High", assigned_name: "", deadline: "" }
        ]
      };
    }

    // Guard against the model inventing a name/date instead of leaving the
    // field empty as instructed — only keep assigned_name if it's actually
    // present in the source transcript, otherwise it's a fabrication.
    if (Array.isArray(parsedSummary?.recommended_tasks)) {
      const transcriptLower = transcript.normalize('NFC').toLowerCase();
      parsedSummary.recommended_tasks = parsedSummary.recommended_tasks.map((t: any) => {
        const name = (t?.assigned_name || '').trim();
        if (!name) return t;
        // assigned_name can list multiple people separated by commas — check each
        // individually since they're often mentioned in different sentences, not
        // as one contiguous phrase.
        const names = name.split(',').map((n: string) => n.trim()).filter(Boolean);
        const validNames = names.filter((n: string) => transcriptLower.includes(n.normalize('NFC').toLowerCase()));
        return { ...t, assigned_name: validNames.join(', ') };
      });
    }

    // Update the meeting in PostgreSQL via FastAPI Backend
    const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://backend:8000';
    const reqHeaders = request.headers;
    const forwardHeaders = new Headers();
    const cookie = reqHeaders.get('cookie');
    if (cookie) forwardHeaders.set('cookie', cookie);
    const auth = reqHeaders.get('authorization');
    if (auth) forwardHeaders.set('authorization', auth);
    forwardHeaders.set('Content-Type', 'application/json');

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

    const updateRes = await fetch(`${backendUrl}/api/meetings/${meetingId}`, {
      method: 'PUT',
      headers: forwardHeaders,
      body: JSON.stringify({
        ...currentMeeting,
        transcript: transcript,
        status: 'ĐÃ DIỄN RA',
        ai_summary: parsedSummary
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
      executive_summary: parsedSummary.executive_summary,
      decisions: parsedSummary.decisions,
      recommended_tasks: parsedSummary.recommended_tasks,
      data: updatedMeetingData.data || updatedMeetingData
    });

  } catch (error: any) {
    console.error('AI Summary API Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi không xác định khi tạo tóm tắt.' },
      { status: 500 }
    );
  }
}
