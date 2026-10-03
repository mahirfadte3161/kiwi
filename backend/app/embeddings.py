import hashlib
import math
import re


class EmbeddingProvider:
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self.embed_query(text) for text in texts]

    def embed_query(self, text: str) -> list[float]:
        raise NotImplementedError


class LocalHashEmbeddings(EmbeddingProvider):
    """Deterministic, dependency-free baseline; replaceable by API/local models."""
    dimensions = 384

    def embed_query(self, text: str) -> list[float]:
        vector = [0.0] * self.dimensions
        for token in re.findall(r"[a-z0-9]+", text.lower()):
            index = int(hashlib.sha256(token.encode()).hexdigest(), 16) % self.dimensions
            vector[index] += 1.0
        norm = math.sqrt(sum(value * value for value in vector)) or 1.0
        return [value / norm for value in vector]


def create_embeddings(provider: str) -> EmbeddingProvider:
    if provider == "local":
        return LocalHashEmbeddings()
    raise ValueError(f"Unsupported embedding provider: {provider}")
