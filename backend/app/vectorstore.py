from pathlib import Path


class ChromaVectorStore:
    def __init__(self, directory: Path, embeddings):
        import chromadb
        self.client = chromadb.PersistentClient(path=str(directory))
        self.collection = self.client.get_or_create_collection("sam7_chunks")
        self.embeddings = embeddings

    def replace_document(self, document_id: str, records: list[dict]) -> None:
        existing = self.collection.get(where={"document_id": document_id}, include=[])
        if existing["ids"]:
            self.collection.delete(ids=existing["ids"])
        if records:
            self.collection.add(
                ids=[r["id"] for r in records],
                documents=[r["text"] for r in records],
                metadatas=[r["metadata"] for r in records],
                embeddings=self.embeddings.embed_documents([r["text"] for r in records]),
            )

    def search(self, query: str, limit: int):
        return self.collection.query(
            query_embeddings=[self.embeddings.embed_query(query)],
            n_results=limit,
            include=["documents", "metadatas", "distances"],
        )
