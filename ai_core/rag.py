import logging
from typing import List, Optional
from urllib.parse import urlparse

from langchain_chroma import Chroma
from langchain_google_genai import GoogleGenerativeAIEmbeddings

import config

logger = logging.getLogger("ai_core.rag")

_vectorstore: Optional[Chroma] = None
_init_failed = False


def get_vectorstore() -> Optional[Chroma]:
    """Chroma 연결 실패 시 None을 반환한다 - RAG는 부가 기능이라 실패해도 파이프라인은 계속 진행되어야 함."""
    global _vectorstore, _init_failed
    if _vectorstore is not None:
        return _vectorstore
    if _init_failed:
        return None
    try:
        parsed = urlparse(config.CHROMA_URL)
        embeddings = GoogleGenerativeAIEmbeddings(model=config.EMBEDDING_MODEL, google_api_key=config.GOOGLE_API_KEY)
        _vectorstore = Chroma(
            collection_name=config.RAG_COLLECTION_NAME,
            embedding_function=embeddings,
            host=parsed.hostname,
            port=parsed.port,
        )
        return _vectorstore
    except Exception as e:
        logger.warning(f"Chroma 연결 실패 - RAG 비활성화: {e}")
        _init_failed = True
        return None


def archive_round(round_id: Optional[int], keywords: List[str], title: str, description: str, report: str):
    vs = get_vectorstore()
    if vs is None:
        return
    try:
        keyword_str = ", ".join(keywords) if keywords else "N/A"
        round_label = round_id if round_id is not None else "?"
        doc_text = f"라운드 {round_label} | 키워드: {keyword_str} | 우승작 '{title}': {description} | 비평 요지: {report[:300]}"
        vs.add_texts([doc_text], metadatas=[{"round_id": round_id or 0}])
    except Exception as e:
        logger.warning(f"라운드 아카이브 실패: {e}")


def search_similar(query: str, k: int = 3) -> List[str]:
    vs = get_vectorstore()
    if vs is None:
        return []
    try:
        results = vs.similarity_search(query, k=k)
        return [r.page_content for r in results]
    except Exception as e:
        logger.warning(f"RAG 검색 실패: {e}")
        return []
