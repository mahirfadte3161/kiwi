import json
import os
from urllib import error, request


SYSTEM_PROMPT = """You are Kiwi, a smart academic assistant for semester studies.

You have two modes — choose the right one based on the user's message:

1. DOCUMENT MODE (when the user asks about their study material, files, experiments, practicals, notes, or anything that could be in the uploaded documents):
   - Answer primarily from the DOCUMENT CONTEXT provided below.
   - Always cite the source filename and page/slide number.
   - If the document context is insufficient, supplement with your general knowledge but clearly say so.

2. CHAT MODE (when the user asks a general question, wants an explanation, asks you to explain a concept in simple terms, asks something conversational, or the document context is empty or irrelevant):
   - Answer naturally and helpfully from your general knowledge, like a knowledgeable tutor.
   - You do NOT need to restrict yourself to documents for general conceptual explanations.
   - Be friendly, clear, and concise.

Rules:
- If document context is provided AND relevant, always prefer it and cite it.
- If the user just wants a concept explained (e.g. "explain backpropagation simply"), explain it clearly — don't just say "not in documents".
- Never refuse to answer a reasonable academic question.
- Maintain conversation context from the chat history."""


def _prompt(question: str, chunks: list[dict], history: list[dict] | None = None) -> str:
    context = "\n\n".join(
        f"[{item['metadata']['filename']} - {item['metadata']['location']}]\n{item['text']}"
        for item in chunks
    )
    history_text = ""
    if history:
        recent = history[-6:]
        history_lines = []
        for msg in recent:
            role = "User" if msg.get("role") == "user" else "Assistant"
            history_lines.append(f"{role}: {msg.get('content', '')}")
        history_text = "\n\nCONVERSATION HISTORY:\n" + "\n".join(history_lines)

    return f"{SYSTEM_PROMPT}\n\nDOCUMENT CONTEXT:\n{context}{history_text}\n\nQUESTION:\n{question}"


import time


def _post_json(url: str, payload: dict, headers: dict[str, str], max_retries: int = 2) -> dict:
    body = json.dumps(payload).encode("utf-8")
    call = request.Request(url, data=body, headers={**headers, "Content-Type": "application/json"})
    
    last_exc = None
    for attempt in range(max_retries + 1):
        try:
            with request.urlopen(call, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            last_exc = exc
            detail = exc.read().decode("utf-8", errors="replace")
            # If 503 (Overloaded / Unavailable) or 429 (Rate Limit / Quota Spikes), wait and retry
            if exc.code in (503, 429) and attempt < max_retries:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise RuntimeError(f"LLM provider returned HTTP {exc.code}: {detail}") from exc
        except error.URLError as exc:
            last_exc = exc
            if attempt < max_retries:
                time.sleep(1.0)
                continue
            raise RuntimeError(f"Could not reach LLM provider: {exc.reason}") from exc
            
    raise RuntimeError(f"LLM provider request failed after retries: {last_exc}")


def _gemini_answer(prompt: str) -> str:
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY is required when LLM_PROVIDER=gemini")
    
    primary_model = os.getenv("GEMINI_MODEL", "gemini-flash-lite-latest")
    # Candidate models to try in case the primary is overloaded or quota-limited
    models_to_try = [primary_model]
    for fallback in ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-flash", "gemma-4-26b-a4b-it"]:
        if fallback not in models_to_try:
            models_to_try.append(fallback)
            
    last_error = None
    for model in models_to_try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
        try:
            result = _post_json(url, {"contents": [{"parts": [{"text": prompt}]}]}, {})
            return result["candidates"][0]["content"]["parts"][0]["text"]
        except Exception as exc:
            last_error = exc
            err_str = str(exc)
            # If 503 (overloaded) or 429 (quota/rate limit), try the next fallback model
            if "503" in err_str or "429" in err_str:
                continue
            raise exc

    raise last_error or RuntimeError("Gemini returned no usable answer")


def _openai_answer(prompt: str) -> str:
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OPENAI_API_KEY is required when LLM_PROVIDER=openai")
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    result = _post_json(
        os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1") + "/chat/completions",
        {"model": model, "messages": [{"role": "user", "content": prompt}], "temperature": 0.1},
        {"Authorization": f"Bearer {key}"},
    )
    try:
        return result["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("OpenAI returned no usable answer") from exc


def _offline_format(chunks: list[dict]) -> str:
    sections = []
    for item in chunks:
        meta = item.get("metadata", {})
        filename = meta.get("filename", "Document")
        location = meta.get("location", "")
        unit = meta.get("unit", "")
        unit_badge = f" [{unit}]" if unit else ""
        text = item.get("text", "").strip()
        sections.append(f"#### 📄 {filename}{unit_badge} — *{location}*\n\n{text}")
    return "### Relevant Information from Semester Documents\n\n" + "\n\n---\n\n".join(sections)


def answer_with_context(question: str, chunks: list[dict], history: list[dict] | None = None) -> str:
    if not chunks:
        return "I could not find that topic or subtopic in the available semester documents."
    prompt = _prompt(question, chunks, history)
    provider = os.getenv("LLM_PROVIDER", "none").lower()

    if provider == "gemini":
        try:
            return _gemini_answer(prompt)
        except Exception as exc:
            # Fallback gracefully to offline document context if API has high demand or rate limits
            return f"> ℹ️ *Note: Gemini API temporarily unavailable ({str(exc)[:80]}). Displaying direct excerpts from course materials below:*\n\n" + _offline_format(chunks)

    if provider == "openai":
        try:
            return _openai_answer(prompt)
        except Exception as exc:
            return f"> ℹ️ *Note: OpenAI API temporarily unavailable. Displaying direct excerpts from course materials below:*\n\n" + _offline_format(chunks)

    return _offline_format(chunks)
