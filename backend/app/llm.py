import json
import os
from urllib import error, request


SYSTEM_PROMPT = """You are a semester document assistant.
Answer only from the supplied document context. Do not invent facts about the
semester material. If the context does not answer the question, say so clearly.
Include concise source references using the filenames and page/slide locations
shown in the context."""


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


def _post_json(url: str, payload: dict, headers: dict[str, str]) -> dict:
    body = json.dumps(payload).encode("utf-8")
    call = request.Request(url, data=body, headers={**headers, "Content-Type": "application/json"})
    try:
        with request.urlopen(call, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"LLM provider returned HTTP {exc.code}: {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Could not reach LLM provider: {exc.reason}") from exc


def _gemini_answer(prompt: str) -> str:
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY is required when LLM_PROVIDER=gemini")
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
    result = _post_json(url, {"contents": [{"parts": [{"text": prompt}]}]}, {})
    try:
        return result["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("Gemini returned no usable answer") from exc


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
