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


def archive_round(
    round_id: Optional[int],
    keywords: List[str],
    title: str,
    description: str,
    report: str,
    doc_id: Optional[str] = None,
    vp_votes: int = 0,
):
    """doc_id를 지정하면 같은 라운드를 재아카이브해도 중복 저장되지 않고 덮어써진다(upsert).
    실제 게임 라운드는 doc_id=None으로 호출해 자동 ID를 쓰고, 시드 데이터는 seed_rag.py에서
    "seed-..." 형태의 고정 ID를 넘겨 재실행해도 안전하게(idempotent) 한다.
    vp_votes(득표수)는 get_top_rounds()의 "역대 인기작" 채널이 유사도 검색과 무관하게
    커뮤니티의 대표작을 항상 노출시키기 위해 쓰인다."""
    vs = get_vectorstore()
    if vs is None:
        return
    try:
        keyword_str = ", ".join(keywords) if keywords else "N/A"
        round_label = round_id if round_id is not None else "?"
        doc_text = f"라운드 {round_label} | 키워드: {keyword_str} | 우승작 '{title}': {description} | 비평 요지: {report[:300]}"
        metadata = {
            "doc_type": "round",
            "round_id": round_id or 0,
            "keywords": keyword_str,
            "title": title,
            "vp_votes": vp_votes,
        }
        ids = [doc_id] if doc_id else None
        vs.add_texts([doc_text], metadatas=[metadata], ids=ids)
    except Exception as e:
        logger.warning(f"라운드 아카이브 실패: {e}")


def archive_reference(name: str, text: str, tags: Optional[List[str]] = None):
    """게임 라운드가 아닌 외부 참고 자료(학교 마스코트 등)를 저장.
    doc_type='reference'로 별도 태깅해 get_top_rounds()/get_all_round_texts()의
    doc_type='round' 필터에 섞여 라운드 집계·방향성 요약본을 왜곡하지 않게 한다.
    search_similar()은 doc_type 필터가 없으므로 유사도 검색에는 round 문서와 동일하게 걸린다.
    doc_id를 name 기반 고정값으로 둬서 재실행해도 upsert (중복 안 쌓임)."""
    vs = get_vectorstore()
    if vs is None:
        return
    try:
        metadata = {"doc_type": "reference", "name": name, "tags": ", ".join(tags or [])}
        vs.add_texts([text], metadatas=[metadata], ids=[f"reference-{name}"])
    except Exception as e:
        logger.warning(f"참고 자료 아카이브 실패: {e}")


def archive_digest(text: str):
    """커뮤니티 방향성 요약본을 고정 ID로 upsert - 항상 최신 1건만 유지된다."""
    vs = get_vectorstore()
    if vs is None:
        return
    try:
        vs.add_texts([text], metadatas=[{"doc_type": "digest"}], ids=[config.COMMUNITY_DIGEST_DOC_ID])
    except Exception as e:
        logger.warning(f"방향성 요약본 저장 실패: {e}")


def get_current_digest() -> str:
    """유사도 검색이 아니라 고정 ID로 직접 조회 - 쿼리와 무관하게 항상 최신 요약본을 가져온다."""
    vs = get_vectorstore()
    if vs is None:
        return ""
    try:
        result = vs._collection.get(ids=[config.COMMUNITY_DIGEST_DOC_ID], include=["documents"])
        docs = result.get("documents") or []
        return docs[0] if docs else ""
    except Exception as e:
        logger.warning(f"방향성 요약본 조회 실패: {e}")
        return ""


def get_all_round_texts(limit: int = 50) -> List[str]:
    """방향성 요약본 재생성용 - doc_type='round'인 문서를 round_id 내림차순으로 최대 limit개 반환."""
    vs = get_vectorstore()
    if vs is None:
        return []
    try:
        raw = vs._collection.get(where={"doc_type": "round"}, include=["documents", "metadatas"])
        docs = list(zip(raw["documents"], raw["metadatas"]))
        docs.sort(key=lambda d: d[1].get("round_id", 0), reverse=True)
        return [d[0] for d in docs[:limit]]
    except Exception as e:
        logger.warning(f"라운드 전체 조회 실패: {e}")
        return []


def get_top_rounds(limit: int = 2) -> List[str]:
    """득표수(vp_votes) 기준 역대 인기작 - 유사도 검색과 무관하게 커뮤니티의 '뿌리'를
    항상 노출시키기 위한 채널. 새 라운드 키워드가 우연히 안 겹쳐도 대표작이 빠지지 않는다."""
    vs = get_vectorstore()
    if vs is None:
        return []
    try:
        raw = vs._collection.get(where={"doc_type": "round"}, include=["documents", "metadatas"])
        docs = list(zip(raw["documents"], raw["metadatas"]))
        docs.sort(key=lambda d: d[1].get("vp_votes", 0), reverse=True)
        return [d[0] for d in docs[:limit] if d[1].get("vp_votes", 0) > 0]
    except Exception as e:
        logger.warning(f"인기작 조회 실패: {e}")
        return []


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


def search_similar_debug(query: str, k: int = 5) -> List[dict]:
    """데모/디버그용 - 매칭된 문서와 거리 점수를 함께 반환.
    Chroma 컬렉션에 정규화 거리함수(hnsw:space)가 명시되어 있지 않으면
    similarity_search_with_relevance_scores()가 예외를 던지므로, 정규화 없는 raw distance를 쓰는
    similarity_search_with_score()를 사용한다 (값이 작을수록 더 유사, L2 거리 기준)."""
    vs = get_vectorstore()
    if vs is None:
        return []
    try:
        results = vs.similarity_search_with_score(query, k=k)
        return [{"content": doc.page_content, "metadata": doc.metadata, "distance": score} for doc, score in results]
    except Exception as e:
        logger.warning(f"RAG 디버그 검색 실패: {e}")
        return []


def count() -> int:
    vs = get_vectorstore()
    if vs is None:
        return 0
    try:
        return vs._collection.count()
    except Exception as e:
        logger.warning(f"컬렉션 카운트 조회 실패: {e}")
        return 0
