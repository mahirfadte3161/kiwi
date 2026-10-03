import re
from collections import defaultdict


STOP_WORDS = {
    "what", "is", "are", "the", "in", "of", "and", "a", "an", "to", "for", "with",
    "on", "at", "from", "by", "about", "how", "why", "who", "when", "where", "which",
    "can", "you", "tell", "me", "explain", "describe", "discuss", "does", "did", "do",
    "give", "show", "brief", "notes", "please", "define", "definition", "overview",
    "write", "detail", "details", "short", "long", "answer", "question", "questions"
}


def _extract_terms(query: str) -> tuple[str, list[str]]:
    query_stripped = query.strip()
    raw_tokens = [t.lower() for t in re.findall(r"[a-zA-Z0-9]+", query_stripped)]
    meaningful = [t for t in raw_tokens if len(t) > 1 and t not in STOP_WORDS]
    terms = meaningful if meaningful else [t for t in raw_tokens if len(t) > 1]
    phrase = " ".join(terms) if terms else query_stripped.lower()
    return phrase, terms


def _clean_snippet(text: str, target_terms: list[str], max_len: int = 220) -> str:
    """Extracts a neat snippet around the first matched term."""
    cleaned = re.sub(r"[\u200b\u200c\u200d\ufeff\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    text_clean = " ".join(cleaned.replace("\n", " ").split())
    text_lower = text_clean.lower()

    # Find earliest term match
    best_pos = -1
    for term in target_terms:
        if not term:
            continue
        pos = text_lower.find(term.lower())
        if pos != -1 and (best_pos == -1 or pos < best_pos):
            best_pos = pos

    if best_pos == -1:
        snippet = text_clean[:max_len]
        return f"{snippet}..." if len(text_clean) > max_len else snippet

    start = max(0, best_pos - 70)
    end = min(len(text_clean), best_pos + 130)
    snippet = text_clean[start:end].strip()
    prefix = "..." if start > 0 else ""
    suffix = "..." if end < len(text_clean) else ""
    return f"{prefix}{snippet}{suffix}"


class Retriever:
    def __init__(self, store):
        self.store = store
        self._all_chunks_cache: dict | None = None

    def invalidate_cache(self) -> None:
        self._all_chunks_cache = None

    def _get_all_chunks(self) -> dict:
        if self._all_chunks_cache is None:
            self._all_chunks_cache = self.store.collection.get(include=["documents", "metadatas"])
        return self._all_chunks_cache

    def chunks(self, query: str, top_k: int = 6) -> list[dict]:
        """Hybrid chunk retrieval combining keyword/content search with vector search."""
        phrase, terms = _extract_terms(query)

        # 1. Content keyword search over all chunks
        all_data = self._get_all_chunks()
        keyword_hits = []
        if terms and all_data and all_data.get("ids"):
            for cid, doc_text, meta in zip(all_data["ids"], all_data["documents"], all_data["metadatas"]):
                text_lower = doc_text.lower()
                meta_text = f"{meta.get('filename', '')} {meta.get('unit', '')} {meta.get('relative_path', '')}".lower()

                score = 0.0
                if phrase and len(terms) > 1 and phrase in text_lower:
                    score += 25.0 + text_lower.count(phrase) * 4.0
                else:
                    matched_terms = [t for t in terms if t in text_lower]
                    if matched_terms:
                        match_ratio = len(matched_terms) / len(terms)
                        score += match_ratio * 15.0
                        if len(matched_terms) == len(terms):
                            score += 10.0
                        # Reward frequency of key terms
                        for t in matched_terms:
                            score += min(5, text_lower.count(t))

                if phrase and phrase in meta_text:
                    score += 15.0
                elif any(t in meta_text for t in terms):
                    score += 6.0

                if score > 0:
                    fake_dist = max(0.01, 1.0 / (1.0 + score))
                    keyword_hits.append({
                        "id": cid,
                        "text": doc_text,
                        "metadata": meta,
                        "distance": fake_dist,
                        "score": score
                    })

        keyword_hits.sort(key=lambda x: x["score"], reverse=True)

        # 2. Vector search as supplement / fallback
        vector_chunks = []
        try:
            result = self.store.search(query, top_k * 2)
            vector_chunks = [
                {"text": text, "metadata": metadata, "distance": distance, "id": metadata.get("chunk_id", "")}
                for text, metadata, distance in zip(
                    result["documents"][0], result["metadatas"][0], result["distances"][0]
                )
            ]
        except Exception:
            vector_chunks = []

        # Merge, prioritizing keyword matches
        seen_ids = set()
        combined = []
        for item in keyword_hits:
            cid = item["id"]
            if cid not in seen_ids:
                seen_ids.add(cid)
                combined.append({"text": item["text"], "metadata": item["metadata"], "distance": item["distance"]})
            if len(combined) >= top_k:
                break

        for item in vector_chunks:
            cid = item["id"]
            if cid not in seen_ids:
                seen_ids.add(cid)
                combined.append({"text": item["text"], "metadata": item["metadata"], "distance": item["distance"]})
            if len(combined) >= top_k:
                break

        return combined[:top_k]

    def find_documents(self, query: str, top_k: int = 15) -> list[dict]:
        """Deep content & subtopic search across all document chunks and metadata."""
        phrase, terms = _extract_terms(query)
        if not terms and not phrase:
            return []

        all_data = self._get_all_chunks()
        grouped = {}
        if all_data and all_data.get("ids"):
            for cid, doc_text, meta in zip(all_data["ids"], all_data["documents"], all_data["metadatas"]):
                text_lower = doc_text.lower()
                meta_text = f"{meta.get('filename', '')} {meta.get('unit', '')} {meta.get('relative_path', '')}".lower()

                content_score = 0.0
                is_match = False

                if phrase and len(terms) > 1 and phrase in text_lower:
                    occurrences = text_lower.count(phrase)
                    content_score += 30.0 + occurrences * 5.0
                    is_match = True
                elif terms:
                    matched_count = sum(1 for t in terms if t in text_lower)
                    if matched_count > 0:
                        content_score += (matched_count / len(terms)) * 15.0
                        if matched_count == len(terms):
                            content_score += 10.0
                        for t in terms:
                            if t in text_lower:
                                content_score += min(6, text_lower.count(t))
                        is_match = True

                if phrase and phrase in meta_text:
                    content_score += 20.0
                    is_match = True
                elif terms and any(t in meta_text for t in terms):
                    content_score += 8.0
                    is_match = True

                if is_match and content_score > 0:
                    doc_id = meta["document_id"]
                    if doc_id not in grouped:
                        grouped[doc_id] = {
                            "document_id": doc_id,
                            "metadata": meta,
                            "locations": set(),
                            "score": 0.0,
                            "match_count": 0,
                            "snippets": [],
                        }
                    entry = grouped[doc_id]
                    entry["score"] += content_score
                    entry["match_count"] += 1

                    loc_str = meta.get("locations", "")
                    if loc_str:
                        entry["locations"].update(loc_str.split(","))

                    if len(entry["snippets"]) < 3:
                        snippet = _clean_snippet(doc_text, [phrase] + terms)
                        if snippet not in entry["snippets"]:
                            entry["snippets"].append(snippet)

        # Fallback to vector search if no keyword hits
        if not grouped:
            try:
                vector_chunks = self.store.search(query, top_k * 2)
                for doc_text, meta, dist in zip(vector_chunks["documents"][0], vector_chunks["metadatas"][0], vector_chunks["distances"][0]):
                    doc_id = meta["document_id"]
                    if doc_id not in grouped:
                        grouped[doc_id] = {
                            "document_id": doc_id,
                            "metadata": meta,
                            "locations": set(),
                            "score": 1.0 / (1.0 + dist),
                            "match_count": 1,
                            "snippets": [_clean_snippet(doc_text, [phrase] + terms)],
                        }
                    else:
                        grouped[doc_id]["score"] = max(grouped[doc_id]["score"], 1.0 / (1.0 + dist))
                    loc_str = meta.get("locations", "")
                    if loc_str:
                        grouped[doc_id]["locations"].update(loc_str.split(","))
            except Exception:
                pass

        results = []
        max_score = max((g["score"] for g in grouped.values()), default=1.0) or 1.0

        for entry in grouped.values():
            meta = entry["metadata"]
            loc_list = sorted(int(v) for v in entry["locations"] if v.isdigit())
            key = "pages" if meta.get("file_type") == "pdf" else "slides"
            relevance = round(min(1.0, entry["score"] / max_score), 4)

            results.append({
                "document_id": entry["document_id"],
                "filename": meta.get("filename", ""),
                "file_type": meta.get("file_type", ""),
                "relative_path": meta.get("relative_path", ""),
                "unit": meta.get("unit", ""),
                key: loc_list,
                "first_page": loc_list[0] if loc_list else 1,
                "locations": f"{'pages' if meta.get('file_type') == 'pdf' else 'slides'} {', '.join(map(str, loc_list[:8]))}{'...' if len(loc_list) > 8 else ''}",
                "relevance": relevance,
                "match_count": entry["match_count"],
                "snippets": entry["snippets"],
            })

        results.sort(key=lambda item: (item["relevance"], item["match_count"]), reverse=True)
        return results[:top_k]
