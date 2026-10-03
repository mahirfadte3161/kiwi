from dataclasses import dataclass
from pathlib import Path
import os
from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    root_dir: Path
    chroma_dir: Path
    manifest_path: Path
    chunk_size: int
    chunk_overlap: int
    embedding_provider: str
    llm_provider: str
    top_k: int

    @classmethod
    def from_env(cls) -> "Settings":
        base = Path(__file__).resolve().parents[2]
        root = Path(os.getenv("SAM7_ROOT", str(base / "SEM 7"))).resolve()
        data = Path(os.getenv("SAM7_DATA_DIR", str(base / "data"))).resolve()
        return cls(
            root, data / "chroma", data / "manifest.json",
            int(os.getenv("CHUNK_SIZE", "420")),
            int(os.getenv("CHUNK_OVERLAP", "70")),
            os.getenv("EMBEDDING_PROVIDER", "local"),
            os.getenv("LLM_PROVIDER", "none"),
            int(os.getenv("TOP_K", "6")),
        )
