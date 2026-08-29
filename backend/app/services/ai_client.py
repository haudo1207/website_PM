"""Shared OpenAI-compatible chat-completion helper.

Extracted from the near-identical `requests.post(f"{AI_BASE_URL}/chat/completions", ...)`
call previously duplicated in ai_review.py, meeting_sync.py and chat_ai.py. New
callers (e.g. the meeting "AI đề xuất mục tiêu & agenda" copilot) should use this
instead of adding a 4th copy. The three pre-existing call sites are left as-is —
not in scope to refactor here.
"""
import json
import requests
from ..config import settings


class AiClientError(RuntimeError):
    pass


def chat_completion_json(system_prompt: str, user_content: str, *, max_tokens: int = 2000, temperature: float = 0.4) -> dict:
    """Call the configured OpenAI-compatible endpoint and parse a strict-JSON reply.

    Raises AiClientError on transport failure, non-200 response, empty output,
    or invalid JSON — callers should catch this and fall back gracefully.
    """
    if not settings.AI_API_KEY:
        raise AiClientError("AI_API_KEY is not configured")

    resp = requests.post(
        f"{settings.AI_BASE_URL}/chat/completions",
        headers={
            "Authorization": f"Bearer {settings.AI_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "model": settings.AI_MODEL,
            "max_tokens": max_tokens,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            "temperature": temperature,
        },
        timeout=settings.AI_TIMEOUT_SECONDS,
    )

    if resp.status_code != 200:
        raise AiClientError(f"AI API error: {resp.text}")

    ai_output = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "").strip()
    if not ai_output:
        raise AiClientError("AI returned an empty response")

    if ai_output.startswith("```"):
        lines = ai_output.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        ai_output = "\n".join(lines).strip()

    try:
        return json.loads(ai_output)
    except Exception as e:
        raise AiClientError(f"Failed to parse AI output as JSON: {ai_output}. Details: {e}")
