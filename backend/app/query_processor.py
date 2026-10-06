"""
Query Processor for Kiwi / SAM7 AI Document Assistant
======================================================
Provides deterministic (no-LLM) query normalization, term extraction,
curated-query generation, and query expansion.

An optional LLM path can be enabled via QUERY_LLM=gemini (or openai)
which calls the same LLM infrastructure used by answer_with_context.
When the LLM is unavailable the deterministic path is always the fallback.

Pipeline:
    raw user query
        normalize_query()          (deterministic)
        extract_query_terms()      (deterministic)
        curate_query()             (deterministic heuristics)
        expand_queries()           (deterministic)
        [optional] llm_enrich()    (AI enrichment, non-blocking)
        QueryPlan (returned to Retriever)
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Academic abbreviations that must NEVER be filtered, expanded, or dropped
# ---------------------------------------------------------------------------
PROTECTED_ABBREVS: frozenset = frozenset({
    "ai", "ml", "dl", "cg", "cd", "db", "os", "cn", "se", "ds",
    "iot", "ar", "vr", "api", "sql", "dbms", "rdbms", "er",
    "dsa", "daa", "oop", "oops", "sdlc", "uml", "erd",
    "tcp", "udp", "ip", "http", "dns", "ftp", "ssl",
    "cpu", "ram", "rom", "gpu", "io",
    "nndl", "ann", "cnn", "rnn", "gan", "nlp",
    "cs", "it", "ec", "ee", "me", "ce",
})

# Common academic stop-words stripped during scoring but PRESERVED in phrases
QUERY_STOP_WORDS: frozenset = frozenset({
    "find", "show", "get", "give", "search", "look", "fetch", "display",
    "where", "is", "are", "the", "a", "an", "in", "of", "and", "to",
    "for", "with", "on", "at", "from", "by", "about", "how", "why",
    "who", "when", "which", "can", "you", "tell", "me", "explain",
    "describe", "discuss", "does", "did", "do", "write", "detail",
    "details", "short", "long", "answer", "question", "questions",
    "brief", "please", "define", "definition", "overview", "provide",
    "document", "documents", "doc", "docs", "file", "files",
    "pdf", "pdfs", "pptx", "ppt", "notes",
    "contain", "contains", "have", "has", "mention", "mentions",
    "topic", "topics", "subject", "subjects",
    "page", "pages", "slide", "slides",
    "course", "info", "information", "specific",
})

# Common misspelling corrections
_SPELL_MAP: dict = {
    "expriment": "experiment",
    "experment": "experiment",
    "exprement": "experiment",
    "experiance": "experience",
    "practial": "practical",
    "practcal": "practical",
    "labbatory": "laboratory",
    "labratory": "laboratory",
    "labortory": "laboratory",
    "asignment": "assignment",
    "assgnment": "assignment",
    "comupter": "computer",
    "comptuer": "computer",
    "grphics": "graphics",
    "graphcis": "graphics",
    "databse": "database",
    "datbase": "database",
    "netork": "network",
    "netwrok": "network",
    "operting": "operating",
    "sytsem": "system",
    "systm": "system",
    "enginering": "engineering",
    "sofware": "software",
    "algortihm": "algorithm",
    "algorith": "algorithm",
    "algrithm": "algorithm",
    "alogirthm": "algorithm",
    "artifical": "artificial",
    "inteligence": "intelligence",
    "intellgence": "intelligence",
}

# Domain-specific abbreviation expansions
_ABBREV_EXPANSIONS: dict = {
    "cd": ["compiler design", "computer design"],
    "cg": ["computer graphics"],
    "db": ["database"],
    "dbms": ["database management system"],
    "os": ["operating system"],
    "cn": ["computer networks", "computer network"],
    "se": ["software engineering"],
    "ai": ["artificial intelligence"],
    "ml": ["machine learning"],
    "dl": ["deep learning"],
    "ds": ["data structures", "data science"],
    "dsa": ["data structures and algorithms"],
    "daa": ["design and analysis of algorithms"],
    "nndl": ["neural networks and deep learning"],
    "ann": ["artificial neural network"],
    "cnn": ["convolutional neural network"],
    "rnn": ["recurrent neural network"],
    "iot": ["internet of things"],
    "nlp": ["natural language processing"],
}


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class QueryPlan:
    """All retrieval inputs derived from one user query."""
    original_query: str
    normalized_query: str
    curated_query: str
    keywords: list
    numbers: list
    phrases: list
    expanded_queries: list
    abbrev_expansions: list
    all_queries: list
    debug: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Stage 1 — Normalize
# ---------------------------------------------------------------------------

def normalize_query(query: str) -> str:
    """
    Deterministic normalization: lowercase, collapse whitespace,
    strip noise punctuation, preserve numbers and abbreviations.
    """
    q = query.strip()
    q = re.sub(r"[\u200b\u200c\u200d\ufeff\x00-\x08\x0b\x0c\x0e-\x1f]", "", q)
    # Normalize dashes/underscores to space
    q = re.sub(r"[-\u2013\u2014_]+", " ", q)
    # Remove punctuation except apostrophe and period (period kept for numbers like "630.5")
    q = re.sub(r"[^\w\s'.]", " ", q)
    # Remove standalone periods
    q = re.sub(r"(?<!\d)\.(?!\d)", " ", q)
    # Collapse whitespace
    q = re.sub(r"\s+", " ", q).strip().lower()
    return q


# ---------------------------------------------------------------------------
# Stage 2 — Extract terms
# ---------------------------------------------------------------------------

def extract_query_terms(normalized: str):
    """
    Returns (keywords, numbers, phrases).

    keywords  - meaningful tokens (stop-word filtered, abbrevs preserved)
    numbers   - all numeric tokens (critical for experiment IDs)
    phrases   - multi-word sub-sequences worth exact-phrase searching
    """
    tokens = re.findall(r"[a-z0-9]+", normalized)
    numbers = [t for t in tokens if t.isdigit()]

    keywords = []
    for t in tokens:
        if t in PROTECTED_ABBREVS:
            keywords.append(t)
        elif len(t) >= 2 and t not in QUERY_STOP_WORDS:
            keywords.append(t)

    # Build phrases: sliding windows of 2-3 keywords
    phrases = []
    for wlen in (3, 2):
        for i in range(len(keywords) - wlen + 1):
            ph = " ".join(keywords[i:i + wlen])
            if ph not in phrases:
                phrases.append(ph)
    full_phrase = " ".join(keywords)
    if full_phrase and full_phrase not in phrases and len(keywords) > 1:
        phrases.insert(0, full_phrase)

    return keywords, numbers, phrases


# ---------------------------------------------------------------------------
# Stage 3 — Spell correction
# ---------------------------------------------------------------------------

def _spell_correct_token(token: str) -> str:
    """
    Correct a single token.
    1. Exact lookup in _SPELL_MAP
    2. Protected abbreviations kept as-is
    3. Fuzzy match (ratio >= 0.82) for tokens >= 5 chars
    """
    if token in _SPELL_MAP:
        return _SPELL_MAP[token]
    if token in PROTECTED_ABBREVS:
        return token
    if len(token) >= 5:
        best_ratio, best_fix = 0.0, token
        for wrong, right in _SPELL_MAP.items():
            r = SequenceMatcher(None, token, wrong).ratio()
            if r > best_ratio and r >= 0.82:
                best_ratio, best_fix = r, right
        return best_fix
    return token


def _spell_correct_tokens(tokens: list) -> list:
    return [_spell_correct_token(t) for t in tokens]


# ---------------------------------------------------------------------------
# Stage 4 — Curate
# ---------------------------------------------------------------------------

def curate_query(keywords: list, numbers: list) -> str:
    """
    Spell-correct + uppercase abbreviations + attach numbers.
    """
    corrected = _spell_correct_tokens(keywords)
    display = []
    for t in corrected:
        if t in PROTECTED_ABBREVS:
            display.append(t.upper())
        else:
            display.append(t)
    for num in numbers:
        if num not in display:
            display.append(num)
    return " ".join(display)


# ---------------------------------------------------------------------------
# Stage 5 — Expand
# ---------------------------------------------------------------------------

def expand_queries(keywords: list, corrected_keywords: list, numbers: list, max_variants: int = 5):
    """
    Returns (expanded_queries, abbrev_expansions).
    """
    expanded = []
    abbrev_expansions = []

    # Corrected phrase
    corrected_phrase = " ".join(corrected_keywords)
    if corrected_phrase:
        expanded.append(corrected_phrase)

    # Number-position variants
    if numbers:
        num_str = " ".join(numbers)
        kw_no_num = [k for k in corrected_keywords if k not in numbers]
        if kw_no_num:
            variant_end = " ".join(kw_no_num) + " " + num_str
            variant_front = num_str + " " + " ".join(kw_no_num)
            if variant_end not in expanded:
                expanded.append(variant_end)
            if variant_front not in expanded:
                expanded.append(variant_front)

    # Abbreviation full-form expansions
    for i, (kw_orig, kw_corr) in enumerate(zip(keywords, corrected_keywords)):
        token = kw_orig  # check original abbrev
        if token in _ABBREV_EXPANSIONS:
            for exp_text in _ABBREV_EXPANSIONS[token]:
                rest = [c for j, (o, c) in enumerate(zip(keywords, corrected_keywords))
                        if j != i and c not in numbers]
                variant = " ".join([exp_text] + rest + numbers).strip()
                if variant not in abbrev_expansions:
                    abbrev_expansions.append(variant)

    # Lab/experiment keyword substitution variants
    exp_terms = {"experiment", "practical", "lab"}
    if any(k in exp_terms or k == "exp" for k in corrected_keywords):
        for alt in ("experiment", "practical", "lab"):
            variant_kws = [alt if (k in exp_terms or k == "exp") else k
                           for k in corrected_keywords]
            v = " ".join(variant_kws)
            if v not in expanded:
                expanded.append(v)

    # Deduplicate
    seen = set()
    result = []
    for v in expanded + abbrev_expansions:
        v_clean = v.strip()
        if v_clean and v_clean not in seen:
            seen.add(v_clean)
            result.append(v_clean)

    return result[:max_variants], abbrev_expansions[:max_variants]


# ---------------------------------------------------------------------------
# Optional LLM enrichment
# ---------------------------------------------------------------------------

def _llm_enrich(original_query: str, curated: str, keywords: list):
    """
    Calls QUERY_LLM (gemini/openai) for optional enrichment.
    Returns dict or None (never raises — failures are non-fatal).
    """
    provider = os.getenv("QUERY_LLM", "none").lower()
    if provider == "none":
        return None

    prompt = (
        "You are a search query analyst for an academic document retrieval system.\n"
        "Given the user's raw query and a pre-processed curated version, return a JSON object "
        "with ONLY these fields:\n"
        "  curated_query: string\n"
        "  keywords: list[string]\n"
        "  expanded_queries: list[string] (2-5 variants)\n\n"
        f"original_query: {original_query}\n"
        f"pre_curated: {curated}\n"
        f"pre_keywords: {json.dumps(keywords)}\n\n"
        "Respond with ONLY the JSON object."
    )

    try:
        from .llm import _gemini_answer, _openai_answer
        if provider == "gemini":
            raw = _gemini_answer(prompt)
        elif provider == "openai":
            raw = _openai_answer(prompt)
        else:
            return None

        json_match = re.search(r"\{.*\}", raw, re.DOTALL)
        if json_match:
            return json.loads(json_match.group())
    except Exception as exc:
        logger.warning("LLM query enrichment skipped: %s", exc)
    return None


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def build_query_plan(raw_query: str, use_llm: bool = True) -> QueryPlan:
    """
    Full pipeline: raw query -> QueryPlan with all retrieval inputs.
    Always deterministic; optionally enriched by LLM.
    """
    normalized = normalize_query(raw_query)
    keywords, numbers, phrases = extract_query_terms(normalized)
    corrected_kws = _spell_correct_tokens(keywords)
    curated = curate_query(keywords, numbers)
    expanded, abbrev_exp = expand_queries(keywords, corrected_kws, numbers)

    llm_result = None
    if use_llm:
        llm_result = _llm_enrich(raw_query, curated, keywords)
        if llm_result:
            llm_curated = llm_result.get("curated_query", "").strip()
            if llm_curated:
                if llm_curated not in expanded:
                    expanded.insert(0, llm_curated)
                curated = llm_curated
            for v in llm_result.get("expanded_queries", []):
                v = v.strip()
                if v and v not in expanded:
                    expanded.append(v)
            expanded = expanded[:8]

    seen = set()
    all_queries = []
    for q in [raw_query, normalized, curated] + expanded + abbrev_exp:
        q_clean = q.strip()
        if q_clean and q_clean not in seen:
            seen.add(q_clean)
            all_queries.append(q_clean)

    return QueryPlan(
        original_query=raw_query,
        normalized_query=normalized,
        curated_query=curated,
        keywords=keywords,
        numbers=numbers,
        phrases=phrases,
        expanded_queries=expanded,
        abbrev_expansions=abbrev_exp,
        all_queries=all_queries,
        debug={
            "llm_enriched": llm_result is not None,
            "llm_result": llm_result,
        },
    )
