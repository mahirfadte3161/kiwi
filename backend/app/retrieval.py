"""
Retrieval Engine for Kiwi / SAM7 AI Document Assistant
=======================================================
Multi-strategy retrieval pipeline:

  QueryPlan (from query_processor)
      |
      +-- keyword_search()        exact/substring + frequency scoring
      +-- filename_search()       filename/path metadata matching
      +-- fuzzy_search()          rapidfuzz / difflib fuzzy token matching
      +-- vector_search()         ChromaDB semantic similarity
      +-- number_search()         exact numeric token matching
      |
      merge_candidates()          union with multi-signal evidence counts
      |
      rerank_candidates()         composite score: keyword + fuzzy + number
                                  + filename + vector + phrase + metadata
      |
      top-K chunks / documents

Debug mode exposes WHY every candidate was retrieved.
"""

from __future__ import annotations

import logging
import re
from collections import defaultdict
from dataclasses import dataclass, field
from difflib import SequenceMatcher

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Try rapidfuzz, fall back to difflib
# ---------------------------------------------------------------------------
try:
    from rapidfuzz import fuzz as _rfuzz
    def _fuzzy_ratio(a: str, b: str) -> float:
        return _rfuzz.token_set_ratio(a, b) / 100.0
    def _partial_ratio(a: str, b: str) -> float:
        return _rfuzz.partial_ratio(a, b) / 100.0
    _RAPIDFUZZ = True
except ImportError:
    def _fuzzy_ratio(a: str, b: str) -> float:
        return SequenceMatcher(None, a, b).ratio()
    def _partial_ratio(a: str, b: str) -> float:
        return SequenceMatcher(None, a, b).ratio()
    _RAPIDFUZZ = False


# ---------------------------------------------------------------------------
# Stop words for internal scoring (shorter list than query processor)
# ---------------------------------------------------------------------------
_SCORE_STOP_WORDS = frozenset({
    "what", "is", "are", "the", "in", "of", "and", "a", "an", "to", "for",
    "with", "on", "at", "from", "by", "about", "how", "why", "who", "when",
    "where", "which", "can", "you", "tell", "me", "explain", "describe",
    "discuss", "does", "did", "do", "give", "show", "brief", "please",
    "define", "definition", "overview", "write", "detail", "details",
    "short", "long", "answer", "question", "questions",
    "document", "documents", "doc", "docs", "file", "files",
    "pdf", "pdfs", "pptx", "ppt", "notes",
    "contain", "contains", "having", "mention", "mentions", "mentioning",
    "find", "search", "looking", "look", "get", "need", "want", "provide",
    "topic", "topics", "subtopic", "subtopics", "subject", "subjects",
    "unit", "units", "chapter", "chapters", "module", "modules",
    "syllabus", "material", "materials",
    "page", "pages", "slide", "slides", "course", "info", "information",
    "specific", "specifically",
})

# Protected 1-2 char abbreviations that must never be ignored in scoring
_PROTECTED = frozenset({
    "ai", "ml", "dl", "cg", "cd", "db", "os", "cn", "se", "ds",
    "iot", "ar", "vr", "sql", "er", "io", "it", "cs", "ec", "ee",
})

# Fuzzy threshold — don't fuzzy-match tokens shorter than this
_FUZZY_MIN_LEN = 4
# Minimum fuzzy ratio to count as a match
_FUZZY_THRESHOLD = 0.78


# ---------------------------------------------------------------------------
# Internal scoring helpers
# ---------------------------------------------------------------------------

def _meaningful(tokens: list) -> list:
    """Filter stop-words while preserving protected abbreviations."""
    result = []
    for t in tokens:
        if t in _PROTECTED:
            result.append(t)
        elif len(t) > 1 and t not in _SCORE_STOP_WORDS:
            result.append(t)
    return result


def _clean_snippet(text: str, target_terms: list, max_len: int = 240) -> str:
    """Extract a readable snippet around the first matched term."""
    cleaned = re.sub(r"[\u200b\u200c\u200d\ufeff\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    text_clean = " ".join(cleaned.replace("\n", " ").split())
    text_lower = text_clean.lower()

    best_pos = -1
    for term in target_terms:
        if not term or len(term) < 2:
            continue
        pos = text_lower.find(term.lower())
        if pos != -1 and (best_pos == -1 or pos < best_pos):
            best_pos = pos

    if best_pos == -1:
        snippet = text_clean[:max_len]
        return f"{snippet}..." if len(text_clean) > max_len else snippet

    start = max(0, best_pos - 60)
    end = min(len(text_clean), best_pos + 160)
    snippet = text_clean[start:end].strip()
    return f"{'...' if start > 0 else ''}{snippet}{'...' if end < len(text_clean) else ''}"


def _fuzzy_token_match(query_token: str, text: str) -> tuple:
    """
    Returns (matched: bool, ratio: float, matched_form: str).
    Tries each word in `text` against `query_token`.
    Protects abbreviations from fuzzy matching.
    """
    if query_token in _PROTECTED or len(query_token) < _FUZZY_MIN_LEN:
        # For protected/short terms use exact only
        if query_token in text:
            return True, 1.0, query_token
        return False, 0.0, ""

    text_tokens = re.findall(r"[a-z0-9]+", text.lower())
    best_r, best_form = 0.0, ""
    for t in text_tokens:
        if len(t) < _FUZZY_MIN_LEN:
            continue
        r = _fuzzy_ratio(query_token, t)
        if r > best_r:
            best_r, best_form = r, t

    if best_r >= _FUZZY_THRESHOLD:
        return True, best_r, best_form
    return False, best_r, ""


# ---------------------------------------------------------------------------
# Candidate dataclass
# ---------------------------------------------------------------------------

@dataclass
class Candidate:
    chunk_id: str
    document_id: str
    text: str
    metadata: dict

    # Evidence accumulators
    keyword_score: float = 0.0
    fuzzy_score: float = 0.0
    number_score: float = 0.0
    filename_score: float = 0.0
    vector_score: float = 0.0
    phrase_score: float = 0.0
    metadata_score: float = 0.0
    multi_query_hits: int = 0       # how many query variants retrieved this

    match_reasons: list = field(default_factory=list)

    @property
    def total_score(self) -> float:
        return (
            self.keyword_score * 1.0
            + self.fuzzy_score * 0.8
            + self.number_score * 2.0     # numbers are very strong signal
            + self.filename_score * 1.5
            + self.vector_score * 0.6
            + self.phrase_score * 1.2
            + self.metadata_score * 0.5
            + self.multi_query_hits * 8.0  # reward multi-strategy agreement
        )

    def add_reason(self, reason: str):
        if reason not in self.match_reasons:
            self.match_reasons.append(reason)


# ---------------------------------------------------------------------------
# Retriever
# ---------------------------------------------------------------------------

class Retriever:
    """
    Drop-in replacement for the original Retriever.
    Public API preserved:
        chunks(query, top_k)        -> list[dict]   (used by /ask)
        find_documents(query, top_k)-> list[dict]   (used by /find, /documents/search)
        invalidate_cache()
    New:
        retrieve_debug(query, top_k) -> dict        (full debug output)
    """

    def __init__(self, store):
        self.store = store
        self._all_chunks_cache = None

    def invalidate_cache(self) -> None:
        self._all_chunks_cache = None

    def _get_all_chunks(self) -> dict:
        if self._all_chunks_cache is None:
            self._all_chunks_cache = self.store.collection.get(
                include=["documents", "metadatas"]
            )
        return self._all_chunks_cache

    # ------------------------------------------------------------------
    # Individual retrieval strategies
    # ------------------------------------------------------------------

    def _keyword_search(
        self,
        keywords: list,
        numbers: list,
        phrases: list,
        all_data: dict,
    ) -> dict:
        """
        Exact keyword + phrase + number substring search over all chunks.
        Returns {chunk_id: Candidate}.
        """
        candidates: dict = {}
        if not all_data or not all_data.get("ids"):
            return candidates

        phrase_variants = [p for p in phrases if p]

        for cid, doc_text, meta in zip(
            all_data["ids"], all_data["documents"], all_data["metadatas"]
        ):
            text_lower = doc_text.lower()
            fname_lower = meta.get("filename", "").lower()
            rel_lower = meta.get("relative_path", "").lower()
            meta_text = f"{fname_lower} {meta.get('unit', '').lower()} {rel_lower}"

            score = 0.0
            reasons = []

            # --- Exact number matches (highest priority) ---
            for num in numbers:
                if re.search(r"\b" + re.escape(num) + r"\b", text_lower):
                    score += 30.0
                    reasons.append(f"exact number: {num}")
                elif num in text_lower:
                    score += 15.0
                    reasons.append(f"number substring: {num}")

            # --- Exact phrase matches ---
            for phrase in phrase_variants:
                if phrase and len(phrase.split()) > 1:
                    ph_hyphen = phrase.replace(" ", "-")
                    if phrase in text_lower or ph_hyphen in text_lower:
                        count = text_lower.count(phrase) + text_lower.count(ph_hyphen)
                        score += 35.0 + count * 5.0
                        reasons.append(f"phrase: '{phrase}'")

            # --- Individual keyword matches ---
            if keywords:
                matched_kws = []
                for t in keywords:
                    if t in _PROTECTED:
                        # Protected: exact match only
                        pattern = r"(?<![a-z])" + re.escape(t) + r"(?![a-z])"
                        if re.search(pattern, text_lower):
                            matched_kws.append(t)
                            score += 12.0
                            reasons.append(f"keyword: {t}")
                    elif t in text_lower:
                        count = text_lower.count(t)
                        matched_kws.append(t)
                        score += 8.0 + min(4, count)
                        reasons.append(f"keyword: {t}")

                if matched_kws:
                    ratio = len(matched_kws) / len(keywords)
                    score += ratio * 10.0
                    if ratio == 1.0:
                        score += 15.0  # all terms matched

            # --- Filename match ---
            fname_score = 0.0
            for phrase in phrase_variants[:3]:
                ph_hyphen = phrase.replace(" ", "-")
                if phrase in fname_lower or ph_hyphen in fname_lower:
                    fname_score = max(fname_score, 60.0)
                    reasons.append(f"filename phrase: '{phrase}'")
            for t in keywords:
                # FIX: No len > 2 gate — protected abbreviations always checked
                if t in _PROTECTED and t in fname_lower:
                    fname_score = max(fname_score, 45.0)
                    reasons.append(f"filename abbrev: {t}")
                elif len(t) > 2 and t in fname_lower:
                    fname_score = max(fname_score, 25.0)
                    reasons.append(f"filename keyword: {t}")
            for num in numbers:
                if num in fname_lower:
                    fname_score = max(fname_score, 35.0)
                    reasons.append(f"filename number: {num}")
            score += fname_score

            # --- Metadata (path/unit) match ---
            meta_score = 0.0
            for t in keywords:
                if t in meta_text:
                    meta_score += 3.0
            for num in numbers:
                if num in meta_text:
                    meta_score += 5.0
            score += meta_score

            if score > 0:
                did = meta.get("document_id", cid)
                c = Candidate(
                    chunk_id=cid,
                    document_id=did,
                    text=doc_text,
                    metadata=meta,
                    keyword_score=score,
                    number_score=0.0,  # accounted in keyword_score
                    filename_score=fname_score,
                    metadata_score=meta_score,
                )
                for r in reasons:
                    c.add_reason(r)
                candidates[cid] = c

        return candidates

    def _fuzzy_search(
        self,
        keywords: list,
        all_data: dict,
    ) -> dict:
        """
        Fuzzy token matching for misspelled keywords.
        Returns {chunk_id: Candidate}.
        """
        candidates: dict = {}
        if not all_data or not all_data.get("ids"):
            return candidates

        # Only fuzzy-match keywords that look like they might be misspelled
        fuzzy_targets = [k for k in keywords
                         if k not in _PROTECTED and len(k) >= _FUZZY_MIN_LEN]
        if not fuzzy_targets:
            return candidates

        for cid, doc_text, meta in zip(
            all_data["ids"], all_data["documents"], all_data["metadatas"]
        ):
            text_lower = doc_text.lower()
            fname_lower = meta.get("filename", "").lower()
            combined = text_lower + " " + fname_lower

            score = 0.0
            reasons = []

            for token in fuzzy_targets:
                matched, ratio, form = _fuzzy_token_match(token, combined)
                if matched and form and form != token:
                    # Only give credit if the fuzzy match is to a DIFFERENT form
                    # (exact matches already handled by keyword search)
                    score += ratio * 15.0
                    reasons.append(f"fuzzy: '{token}' ≈ '{form}' ({ratio:.2f})")

            if score > 0:
                did = meta.get("document_id", cid)
                c = Candidate(
                    chunk_id=cid,
                    document_id=did,
                    text=doc_text,
                    metadata=meta,
                    fuzzy_score=score,
                )
                for r in reasons:
                    c.add_reason(r)
                candidates[cid] = c

        return candidates

    def _filename_search(
        self,
        keywords: list,
        numbers: list,
        phrases: list,
        all_data: dict,
    ) -> dict:
        """
        Dedicated filename/metadata-only search pass.
        Returns {chunk_id: Candidate}.
        """
        candidates: dict = {}
        if not all_data or not all_data.get("ids"):
            return candidates

        for cid, doc_text, meta in zip(
            all_data["ids"], all_data["documents"], all_data["metadatas"]
        ):
            fname_lower = meta.get("filename", "").lower()
            rel_lower = meta.get("relative_path", "").lower()
            unit_lower = meta.get("unit", "").lower()
            combined = f"{fname_lower} {rel_lower} {unit_lower}"

            score = 0.0
            reasons = []

            for phrase in phrases:
                ph_hyphen = phrase.replace(" ", "-")
                if phrase in combined or ph_hyphen in combined:
                    score += 70.0
                    reasons.append(f"filename phrase match: '{phrase}'")

            for t in keywords:
                if t in _PROTECTED and t in combined:
                    score += 40.0
                    reasons.append(f"filename abbrev: {t}")
                elif len(t) > 2 and t in combined:
                    score += 20.0
                    reasons.append(f"filename kw: {t}")

            for num in numbers:
                if num in combined:
                    score += 35.0
                    reasons.append(f"filename number: {num}")

            if score > 0:
                did = meta.get("document_id", cid)
                c = Candidate(
                    chunk_id=cid,
                    document_id=did,
                    text=doc_text,
                    metadata=meta,
                    filename_score=score,
                )
                for r in reasons:
                    c.add_reason(r)
                candidates[cid] = c

        return candidates

    def _vector_search(self, query: str, limit: int) -> dict:
        """
        ChromaDB semantic search. Returns {chunk_id: Candidate}.
        """
        candidates: dict = {}
        try:
            result = self.store.search(query, limit)
            for doc_text, meta, dist in zip(
                result["documents"][0],
                result["metadatas"][0],
                result["distances"][0],
            ):
                sim = max(0.0, 1.0 - dist)  # convert distance to similarity
                cid = meta.get("chunk_id", "")
                did = meta.get("document_id", cid)
                c = Candidate(
                    chunk_id=cid,
                    document_id=did,
                    text=doc_text,
                    metadata=meta,
                    vector_score=sim * 20.0,
                )
                c.add_reason(f"vector similarity: {sim:.3f}")
                candidates[cid] = c
        except Exception as exc:
            logger.warning("Vector search failed: %s", exc)
        return candidates

    def _number_search(self, numbers: list, all_data: dict) -> dict:
        """
        Dedicated number-only search for experiment IDs like '630'.
        Returns {chunk_id: Candidate}.
        """
        candidates: dict = {}
        if not numbers or not all_data or not all_data.get("ids"):
            return candidates

        for cid, doc_text, meta in zip(
            all_data["ids"], all_data["documents"], all_data["metadatas"]
        ):
            text_lower = doc_text.lower()
            fname_lower = meta.get("filename", "").lower()
            combined = text_lower + " " + fname_lower

            score = 0.0
            reasons = []
            for num in numbers:
                # Word-boundary match is a very strong signal
                if re.search(r"\b" + re.escape(num) + r"\b", combined):
                    score += 50.0
                    reasons.append(f"exact number boundary: {num}")
                elif num in combined:
                    score += 20.0
                    reasons.append(f"number substring: {num}")

            if score > 0:
                did = meta.get("document_id", cid)
                c = Candidate(
                    chunk_id=cid,
                    document_id=did,
                    text=doc_text,
                    metadata=meta,
                    number_score=score,
                )
                for r in reasons:
                    c.add_reason(r)
                candidates[cid] = c

        return candidates

    # ------------------------------------------------------------------
    # Merge + Rerank
    # ------------------------------------------------------------------

    def _merge_candidates(self, *strategy_results) -> dict:
        """
        Union of all candidate dicts. When same chunk_id appears in multiple
        strategies, scores are additive and multi_query_hits is incremented.
        """
        merged: dict = {}
        for strategy_candidates in strategy_results:
            for cid, cand in strategy_candidates.items():
                if cid not in merged:
                    merged[cid] = Candidate(
                        chunk_id=cid,
                        document_id=cand.document_id,
                        text=cand.text,
                        metadata=cand.metadata,
                    )
                existing = merged[cid]
                existing.keyword_score += cand.keyword_score
                existing.fuzzy_score += cand.fuzzy_score
                existing.number_score += cand.number_score
                existing.filename_score += cand.filename_score
                existing.vector_score += cand.vector_score
                existing.phrase_score += cand.phrase_score
                existing.metadata_score += cand.metadata_score
                # Count unique strategies that contributed
                if any(s > 0 for s in [
                    cand.keyword_score, cand.fuzzy_score, cand.number_score,
                    cand.filename_score, cand.vector_score, cand.phrase_score,
                ]):
                    existing.multi_query_hits += 1
                for r in cand.match_reasons:
                    existing.add_reason(r)
        return merged

    def _rerank(self, candidates: dict, top_k: int) -> list:
        """Sort merged candidates by composite total_score, return top_k."""
        ranked = sorted(candidates.values(), key=lambda c: c.total_score, reverse=True)
        return ranked[:top_k]

    # ------------------------------------------------------------------
    # Full pipeline internals
    # ------------------------------------------------------------------

    def _run_pipeline(
        self,
        query: str,
        top_k: int,
        candidate_pool: int = 50,
    ) -> tuple:
        """
        Run the full multi-strategy pipeline.
        Returns (ranked_candidates, query_plan).
        """
        from .query_processor import build_query_plan
        plan = build_query_plan(query)

        all_data = self._get_all_chunks()

        # Strategy 1: keyword/phrase/number search on original + curated + expanded queries
        kw_results = {}
        for q_variant in plan.all_queries[:6]:  # cap to avoid redundant work
            kws, nums, phrases = plan.keywords, plan.numbers, plan.phrases
            # Re-extract terms for each variant (curated/expanded may have different terms)
            from .query_processor import extract_query_terms, normalize_query
            norm_v = normalize_query(q_variant)
            v_kws, v_nums, v_phrases = extract_query_terms(norm_v)
            # Union of terms
            merged_kws = list(dict.fromkeys(v_kws + kws))
            merged_nums = list(dict.fromkeys(v_nums + nums))
            merged_phrases = list(dict.fromkeys(v_phrases + phrases))

            partial = self._keyword_search(merged_kws, merged_nums, merged_phrases, all_data)
            for cid, cand in partial.items():
                if cid not in kw_results:
                    kw_results[cid] = cand
                else:
                    kw_results[cid].keyword_score += cand.keyword_score * 0.5
                    kw_results[cid].filename_score = max(
                        kw_results[cid].filename_score, cand.filename_score
                    )
                    kw_results[cid].multi_query_hits += 1
                    for r in cand.match_reasons:
                        kw_results[cid].add_reason(r)

        # Strategy 2: Fuzzy search (original keywords)
        fuzzy_results = self._fuzzy_search(plan.keywords, all_data)

        # Strategy 3: Filename-dedicated search
        filename_results = self._filename_search(
            plan.keywords, plan.numbers, plan.phrases, all_data
        )

        # Strategy 4: Vector search (original + curated queries)
        vector_results_orig = self._vector_search(query, candidate_pool // 2)
        vector_results_cur = {}
        if plan.curated_query and plan.curated_query.lower() != query.lower():
            vector_results_cur = self._vector_search(plan.curated_query, candidate_pool // 4)

        # Strategy 5: Number-specific search
        number_results = self._number_search(plan.numbers, all_data)

        # Merge all strategies
        merged = self._merge_candidates(
            kw_results,
            fuzzy_results,
            filename_results,
            vector_results_orig,
            vector_results_cur,
            number_results,
        )

        # Rerank
        ranked = self._rerank(merged, candidate_pool)
        return ranked, plan

    # ------------------------------------------------------------------
    # Public API (backward-compatible)
    # ------------------------------------------------------------------

    def chunks(self, query: str, top_k: int = 6) -> list:
        """
        Returns top_k chunks for context injection into LLM (/ask endpoint).
        Backward-compatible with original API.
        """
        ranked, _ = self._run_pipeline(query, top_k * 3, candidate_pool=50)
        results = []
        seen_docs: set = set()
        for cand in ranked[:top_k * 4]:
            results.append({
                "text": cand.text,
                "metadata": cand.metadata,
                "distance": max(0.01, 1.0 / (1.0 + cand.total_score)),
            })
            if len(results) >= top_k:
                break
        return results

    def find_documents(self, query: str, top_k: int = 15) -> list:
        """
        Returns ranked documents (not chunks) for /find and /documents/search.
        Backward-compatible with original API.
        """
        ranked, plan = self._run_pipeline(query, 200, candidate_pool=200)

        # Aggregate chunks → documents
        doc_stats: dict = {}
        for cand in ranked:
            did = cand.document_id
            if did not in doc_stats:
                doc_stats[did] = {
                    "document_id": did,
                    "metadata": cand.metadata,
                    "total_score": 0.0,
                    "max_score": 0.0,
                    "hit_chunks": 0,
                    "locations": set(),
                    "snippets": [],
                    "reasons": [],
                }
            entry = doc_stats[did]
            entry["total_score"] += cand.total_score
            entry["max_score"] = max(entry["max_score"], cand.total_score)
            entry["hit_chunks"] += 1

            loc_str = cand.metadata.get("locations", "")
            if loc_str:
                entry["locations"].update(
                    v.strip() for v in loc_str.split(",") if v.strip()
                )

            if len(entry["snippets"]) < 3:
                snippet = _clean_snippet(cand.text, plan.phrases + plan.keywords)
                if snippet and snippet not in entry["snippets"]:
                    entry["snippets"].append(snippet)

            for r in cand.match_reasons:
                if r not in entry["reasons"]:
                    entry["reasons"].append(r)

        # Build output list
        ranked_docs = []
        for entry in doc_stats.values():
            meta = entry["metadata"]
            final_score = entry["max_score"] * 2.0 + min(50.0, entry["total_score"] * 0.1)

            if final_score < 5.0:
                continue

            loc_list = sorted(int(v) for v in entry["locations"] if v.isdigit())
            is_pdf = meta.get("file_type") == "pdf"
            key = "pages" if is_pdf else "slides"
            loc_label = "pages" if is_pdf else "slides"
            first_page = loc_list[0] if loc_list else 1

            ranked_docs.append({
                "document_id": entry["document_id"],
                "filename": meta.get("filename", ""),
                "file_type": meta.get("file_type", ""),
                "relative_path": meta.get("relative_path", ""),
                "unit": meta.get("unit", ""),
                key: loc_list,
                "first_page": first_page,
                "locations": (
                    f"{loc_label} {', '.join(map(str, loc_list[:8]))}"
                    f"{'...' if len(loc_list) > 8 else ''}"
                ),
                "final_score": round(final_score, 2),
                "match_count": max(1, entry["hit_chunks"]),
                "snippets": (
                    entry["snippets"]
                    if entry["snippets"]
                    else [_clean_snippet(meta.get("filename", ""), plan.keywords)]
                ),
                "match_reasons": entry["reasons"][:8],
            })

        ranked_docs.sort(key=lambda d: d["final_score"], reverse=True)

        # Normalize relevance scores
        max_s = ranked_docs[0]["final_score"] if ranked_docs else 1.0
        for doc in ranked_docs:
            doc["relevance"] = round(min(1.0, doc["final_score"] / max_s), 4)

        return ranked_docs[:top_k]

    def retrieve_debug(self, query: str, top_k: int = 10) -> dict:
        """
        Full debug output: explains every retrieval decision.
        Exposed via /debug endpoint (see main.py).
        """
        ranked, plan = self._run_pipeline(query, top_k * 4, candidate_pool=80)

        chunk_debug = []
        for cand in ranked[:top_k * 2]:
            chunk_debug.append({
                "chunk_id": cand.chunk_id,
                "document_id": cand.document_id,
                "filename": cand.metadata.get("filename", ""),
                "total_score": round(cand.total_score, 3),
                "score_breakdown": {
                    "keyword": round(cand.keyword_score, 3),
                    "fuzzy": round(cand.fuzzy_score, 3),
                    "number": round(cand.number_score, 3),
                    "filename": round(cand.filename_score, 3),
                    "vector": round(cand.vector_score, 3),
                    "phrase": round(cand.phrase_score, 3),
                    "metadata": round(cand.metadata_score, 3),
                    "multi_query_hits": cand.multi_query_hits,
                },
                "match_reasons": cand.match_reasons,
                "snippet": _clean_snippet(cand.text, plan.keywords + plan.phrases),
            })

        return {
            "original_query": plan.original_query,
            "normalized_query": plan.normalized_query,
            "curated_query": plan.curated_query,
            "keywords": plan.keywords,
            "numbers": plan.numbers,
            "phrases": plan.phrases,
            "expanded_queries": plan.expanded_queries,
            "abbrev_expansions": plan.abbrev_expansions,
            "all_query_variants": plan.all_queries,
            "llm_enriched": plan.debug.get("llm_enriched", False),
            "rapidfuzz_available": _RAPIDFUZZ,
            "candidates_evaluated": len(ranked),
            "top_chunks": chunk_debug,
        }
