import os

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
SERPER_API_KEY = os.getenv("SERPER_API_KEY")
CHROMA_URL = os.getenv("CHROMA_URL", "http://chroma:8000")

PRIMARY_MODEL = "gemini-3.1-flash-lite"
FALLBACK_MODEL = "gemini-1.5-flash"
EMBEDDING_MODEL = "models/gemini-embedding-001"

# with_structured_output()의 기본값(json_schema)이 불안정할 경우 "function_calling"/"json_mode"로 전환
STRUCTURED_OUTPUT_METHOD = os.getenv("STRUCTURED_OUTPUT_METHOD") or None

QUEUE_TTL_SECONDS = 30 * 60

RAG_COLLECTION_NAME = "round_history"
