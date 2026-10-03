import tempfile
import unittest
from pathlib import Path

from backend.app.ingestion.chunker import chunk_pages
from backend.app.ingestion.discovery import discover, document_id
from backend.app.retrieval import Retriever


class CoreTests(unittest.TestCase):
    def test_recursive_discovery_and_stable_id(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = root / "Unit 1" / "Topic" / "notes.pdf"
            pdf.parent.mkdir(parents=True)
            pdf.write_bytes(b"pdf")
            (root / "ignored.docx").write_bytes(b"docx")
            supported, unsupported = discover(root)
            self.assertEqual(len(supported), 1)
            self.assertEqual(supported[0].relative_path, "Unit 1/Topic/notes.pdf")
            self.assertEqual(supported[0].unit, "Unit 1")
            self.assertEqual(len(unsupported), 1)
            self.assertEqual(document_id(supported[0]), document_id(supported[0]))

    def test_chunk_locations_are_preserved(self):
        chunks = chunk_pages([(1, "one two three"), (2, "four five six")], 4, 1)
        self.assertTrue(chunks)
        self.assertEqual(chunks[0].locations, [1, 2])

    def test_content_search_finds_subtopic(self):
        class MockCollection:
            def get(self, include=None):
                return {
                    "ids": ["doc1_00001", "doc2_00001"],
                    "documents": [
                        "Backpropagation calculates gradients through chain rule in neural networks.",
                        "Syntax trees are parsed by LR parser."
                    ],
                    "metadatas": [
                        {"document_id": "doc1", "filename": "nndl.pdf", "file_type": "pdf", "relative_path": "nndl.pdf", "unit": "NNDL", "locations": "5,6"},
                        {"document_id": "doc2", "filename": "cd.pdf", "file_type": "pdf", "relative_path": "cd.pdf", "unit": "CD", "locations": "10"}
                    ]
                }

        class MockStore:
            collection = MockCollection()
            def search(self, q, k):
                return {"documents": [[]], "metadatas": [[]], "distances": [[]]}

        r = Retriever(MockStore())
        results = r.find_documents("backpropagation")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["document_id"], "doc1")
        self.assertTrue(any("backpropagation" in s.lower() for s in results[0]["snippets"]))


if __name__ == "__main__":
    unittest.main()
