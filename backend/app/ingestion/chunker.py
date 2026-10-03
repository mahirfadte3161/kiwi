from dataclasses import dataclass


@dataclass(frozen=True)
class Chunk:
    text: str
    locations: list[int]


def chunk_pages(pages: list[tuple[int, str]], size: int, overlap: int) -> list[Chunk]:
    if size <= overlap:
        raise ValueError("chunk size must be greater than overlap")
    chunks: list[Chunk] = []
    words: list[tuple[str, int]] = []
    for location, text in pages:
        words.extend((word, location) for word in text.split())
    step = size - overlap
    for start in range(0, len(words), step):
        window = words[start:start + size]
        if not window:
            break
        chunks.append(Chunk(" ".join(word for word, _ in window), sorted(set(loc for _, loc in window))))
        if start + size >= len(words):
            break
    return chunks
