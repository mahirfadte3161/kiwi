import re
from collections import defaultdict


STOP_WORDS = {
    "what", "is", "are", "the", "in", "of", "and", "a", "an", "to", "for", "with",
    "on", "at", "from", "by", "about", "how", "why", "who", "when", "where", "which",
    "can", "you", "tell", "me", "explain", "describe", "discuss", "does", "did", "do",
    "give", "show", "brief", "please", "define", "definition", "overview",
    "write", "detail", "details", "short", "long", "answer", "question", "questions",
    # Document & Subtopic query framing words
    "document", "documents", "doc", "docs", "file", "files", "pdf", "pdfs", "pptx", "ppt",
    "notes", "contain", "contains", "containing", "have", "has", "having", "mention", "mentions", "mentioning",
    "find", "search", "looking", "look", "get", "need", "want", "provide",
    "topic", "topics", "subtopic", "subtopics", "subject", "subjects",
    "unit", "units", "chapter", "chapters", "module", "modules", "syllabus", "material", "materials",
    "page", "pages", "slide", "slides", "course", "info", "information", "specific", "specifically"
}


def _extract_terms(query: str) -> tuple[str, list[str]]:
    query_stripped = query.strip()
    raw_tokens = [t.lower() for t in re.findall(r"[a-zA-Z0-9]+", query_stripped)]
    # Keep meaningful words or valid technical single letters like 'k' in k-means
    meaningful = [t for t in raw_tokens if (len(t) > 1 or t in {"k", "c", "r"}) and t not in STOP_WORDS]
    terms = meaningful if meaningful else [t for t in raw_tokens if len(t) > 1]
    phrase = " ".join(terms) if terms else query_stripped.lower()
    return phrase, terms


def _clean_snippet(text: str, target_terms: list[str], max_len: int = 220) -> str:
    """Extracts a neat snippet around the first matched term or phrase."""
    cleaned = re.sub(r"[\u200b\u200c\u200d\ufeff\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    text_clean = " ".join(cleaned.replace("\n", " ").split())
    text_lower = text_clean.lower()

    # Find earliest term match
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
    end = min(len(text_clean), best_pos + 140)
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
        phrase_hyphen = phrase.replace(" ", "-") if phrase else ""

        # 1. Content keyword search over all chunks
        all_data = self._get_all_chunks()
        keyword_hits = []
        if terms and all_data and all_data.get("ids"):
            for cid, doc_text, meta in zip(all_data["ids"], all_data["documents"], all_data["metadatas"]):
                text_lower = doc_text.lower()
                fname_lower = meta.get("filename", "").lower()
                meta_text = f"{fname_lower} {meta.get('unit', '')} {meta.get('relative_path', '')}".lower()

                score = 0.0

                # Filename match (strongest intent signal)
                if phrase and (phrase in fname_lower or (phrase_hyphen and phrase_hyphen in fname_lower)):
                    score += 60.0
                elif any(t in fname_lower for t in terms if len(t) > 2):
                    score += 25.0

                # Phrase match in chunk text
                if phrase and len(terms) > 1 and (phrase in text_lower or (phrase_hyphen and phrase_hyphen in text_lower)):
                    p_count = text_lower.count(phrase) + (text_lower.count(phrase_hyphen) if phrase_hyphen else 0)
                    score += 40.0 + p_count * 6.0
                else:
                    matched_terms = [t for t in terms if t in text_lower]
                    if matched_terms:
                        match_ratio = len(matched_terms) / len(terms)
                        # Require at least 50% term overlap if multiple terms
                        if len(terms) == 1 or match_ratio >= 0.5:
                            score += match_ratio * 20.0
                            if len(matched_terms) == len(terms):
                                score += 15.0
                            for t in matched_terms:
                                score += min(5, text_lower.count(t))

                # Unit/path metadata match
                if any(t in meta_text for t in terms):
                    score += 5.0

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

        phrase_hyphen = phrase.replace(" ", "-") if phrase else ""
        all_data = self._get_all_chunks()
        doc_stats = {}

        if all_data and all_data.get("ids"):
            for cid, doc_text, meta in zip(all_data["ids"], all_data["documents"], all_data["metadatas"]):
                doc_id = meta["document_id"]
                if doc_id not in doc_stats:
                    doc_stats[doc_id] = {
                        "document_id": doc_id,
                        "metadata": meta,
                        "phrase_hits": 0,
                        "term_matches": set(),
                        "max_chunk_score": 0.0,
                        "total_chunk_score": 0.0,
                        "hit_chunks": 0,
                        "locations": set(),
                        "snippets": [],
                    }
                
                entry = doc_stats[doc_id]
                text_lower = doc_text.lower()
                chunk_score = 0.0

                # 1. Exact phrase match in chunk text
                if phrase and len(terms) > 1 and (phrase in text_lower or (phrase_hyphen and phrase_hyphen in text_lower)):
                    p_count = text_lower.count(phrase) + (text_lower.count(phrase_hyphen) if phrase_hyphen else 0)
                    chunk_score += 40.0 + p_count * 6.0
                    entry["phrase_hits"] += p_count

                # 2. Individual term matches
                matched = [t for t in terms if t in text_lower]
                if matched:
                    entry["term_matches"].update(matched)
                    ratio = len(matched) / len(terms)
                    if len(terms) == 1 or ratio >= 0.5:
                        chunk_score += ratio * 15.0
                        if len(matched) == len(terms):
                            chunk_score += 15.0
                        for t in matched:
                            chunk_score += min(4, text_lower.count(t))

                if chunk_score > 0:
                    entry["total_chunk_score"] += chunk_score
                    entry["max_chunk_score"] = max(entry["max_chunk_score"], chunk_score)
                    entry["hit_chunks"] += 1

                    loc_str = meta.get("locations", "")
                    if loc_str:
                        entry["locations"].update(loc_str.split(","))

                    if len(entry["snippets"]) < 3:
                        snippet = _clean_snippet(doc_text, [phrase, phrase_hyphen] + terms)
                        if snippet and snippet not in entry["snippets"]:
                            entry["snippets"].append(snippet)

        # Vector search fallback if no keyword hits found
        if not any(e["max_chunk_score"] > 0 for e in doc_stats.values()):
            try:
                vector_chunks = self.store.search(query, top_k * 2)
                for doc_text, meta, dist in zip(vector_chunks["documents"][0], vector_chunks["metadatas"][0], vector_chunks["distances"][0]):
                    doc_id = meta["document_id"]
                    sim_score = 1.0 / (1.0 + dist)
                    if doc_id not in doc_stats:
                        doc_stats[doc_id] = {
                            "document_id": doc_id,
                            "metadata": meta,
                            "phrase_hits": 0,
                            "term_matches": set(terms),
                            "max_chunk_score": sim_score * 20.0,
                            "total_chunk_score": sim_score * 20.0,
                            "hit_chunks": 1,
                            "locations": set(),
                            "snippets": [_clean_snippet(doc_text, [phrase] + terms)],
                        }
                    else:
                        doc_stats[doc_id]["max_chunk_score"] = max(doc_stats[doc_id]["max_chunk_score"], sim_score * 20.0)
                    loc_str = meta.get("locations", "")
                    if loc_str:
                        doc_stats[doc_id]["locations"].update(loc_str.split(","))
            except Exception:
                pass

        # Calculate balanced document-level relevance
        ranked_docs = []
        for entry in doc_stats.values():
            meta = entry["metadata"]
            fname_lower = meta.get("filename", "").lower()
            rel_lower = meta.get("relative_path", "").lower()
            
            # Coverage validation: require reasonable match unless title matches
            matched_ratio = len(entry["term_matches"]) / len(terms) if terms else 0
            title_phrase_match = phrase and (phrase in fname_lower or (phrase_hyphen and phrase_hyphen in fname_lower))
            
            if matched_ratio < 0.5 and not entry["phrase_hits"] and not title_phrase_match:
                continue

            # Title & filename relevance bonus (huge signal)
            title_bonus = 0.0
            if title_phrase_match:
                title_bonus += 120.0
            elif any(t in fname_lower for t in terms if len(t) > 2):
                title_bonus += 35.0

            if any(t in rel_lower for t in terms if len(t) > 2):
                title_bonus += 15.0

            final_score = (
                entry["max_chunk_score"] * 2.5 +
                min(60.0, entry["total_chunk_score"] * 0.15) +
                entry["phrase_hits"] * 20.0 +
                title_bonus +
                (matched_ratio * 40.0)
            )

            if final_score > 10.0:
                loc_list = sorted(int(v) for v in entry["locations"] if v.isdigit())
                key = "pages" if meta.get("file_type") == "pdf" else "slides"
                first_page = loc_list[0] if loc_list else 1
                loc_label = "pages" if meta.get("file_type") == "pdf" else "slides"

                ranked_docs.append({
                    "document_id": entry["document_id"],
                    "filename": meta.get("filename", ""),
                    "file_type": meta.get("file_type", ""),
                    "relative_path": meta.get("relative_path", ""),
                    "unit": meta.get("unit", ""),
                    key: loc_list,
                    "first_page": first_page,
                    "locations": f"{loc_label} {', '.join(map(str, loc_list[:8]))}{'...' if len(loc_list) > 8 else ''}",
                    "final_score": round(final_score, 2),
                    "match_count": max(1, entry["phrase_hits"] + entry["hit_chunks"]),
                    "snippets": entry["snippets"] if entry["snippets"] else [_clean_snippet(meta.get("filename", ""), terms)],
                })

        ranked_docs.sort(key=lambda item: item["final_score"], reverse=True)
        max_s = ranked_docs[0]["final_score"] if ranked_docs else 1.0
        for doc in ranked_docs:
            doc["relevance"] = round(min(1.0, doc["final_score"] / max_s), 4)

        return ranked_docs[:top_k]
