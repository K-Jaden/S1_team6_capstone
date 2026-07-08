import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger("ai_core")

import chat as chat_module
import llm as llm_module
import rag
import streaming
from graphs.candidates import get_candidates_graph
from graphs.critique import get_critique_graph
from graphs.trends import get_trends_graph
from schemas import ChatRequest, WeightedCandidateRequest, WinnerEvalOnlyRequest

app = FastAPI(title="ArtDAO LangGraph A2A Server", version="9.0-LangGraph")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    llm_ready = bool(os.getenv("GOOGLE_API_KEY")) and llm_module.llm_creative is not None
    return {
        "status": "ok" if llm_ready else "degraded",
        "llm_ready": llm_ready,
        "active_sessions": len(streaming.discussion_queues),
    }


@app.get("/api/agent/stream/{session_id}")
async def stream_discussion(session_id: str):
    return await streaming.stream_response(session_id)


@app.get("/api/agent/trends-keywords")
def get_trends_keywords():
    try:
        graph = get_trends_graph()
        result = graph.invoke({"session_id": "", "search_result": "", "subjects": [], "styles": []})
        return {"subjects": result["subjects"], "styles": result["styles"]}
    except Exception as e:
        logger.warning(f"🔥 트렌드 추출 실패: {e}")
        return {
            "subjects": ["메타버스 공간", "우주 탐사선", "포스트 아포칼립스"],
            "styles": ["베이퍼웨이브", "3D 복셀", "글리치 아트"],
        }


@app.post("/api/agent/generate-weighted-candidates")
def generate_weighted_candidates(req: WeightedCandidateRequest):
    session_id = req.session_id
    streaming.ensure_session(session_id)
    try:
        graph = get_candidates_graph()
        result = graph.invoke(
            {
                "session_id": session_id,
                "weights": req.weights,
                "style": req.style,
                "rag_context": "",
                "plan_draft": "",
                "candidates": [],
            }
        )
        candidates = result["candidates"]
        streaming.push_log(session_id, "시스템", "final", f"🎉 토론 완료! 후보작 {len(candidates)}개 생성 완료.")
        return {"candidates": candidates[:5]}
    except Exception as e:
        streaming.push_log(session_id, "시스템", "error", f"⚠️ AI 사고 회로 지연: {str(e)}")
        streaming.push_log(session_id, "시스템", "final", "⚠️ 안전 모드로 전환하여 렌더링을 진행합니다.")
        return {
            "candidates": [
                {"title": f"안전 렌더링 {i}", "description": "복구 처리됨", "image_prompt": f"masterpiece, {req.style}"}
                for i in range(1, 6)
            ]
        }


@app.post("/api/agent/evaluate-winner-only")
def evaluate_winner_only(req: WinnerEvalOnlyRequest):
    session_id = req.session_id
    streaming.ensure_session(session_id)
    try:
        graph = get_critique_graph()
        result = graph.invoke(
            {
                "session_id": session_id,
                "title": req.title,
                "description": req.description,
                "round_id": req.round_id,
                "keywords": req.keywords,
                "vp_votes": req.vp_votes,
                "report": "",
            }
        )
        streaming.push_log(session_id, "시스템", "final", "✅ 가치 증명 비평 완료")
        return {"report": result["report"]}
    except Exception as e:
        streaming.push_log(session_id, "시스템", "error", f"비평 에러: {e}")
        streaming.push_log(session_id, "시스템", "final", "✅ 비평 완료 (오류)")
        return {"report": "비평문 생성 중 오류가 발생했습니다."}


@app.get("/api/agent/rag-debug")
def rag_debug(query: str, k: int = 5):
    """데모/디버그 전용 - RAG에 실제로 어떤 데이터가 들어있고 특정 쿼리에 무엇이 검색되는지,
    커뮤니티 방향성 요약본·역대 인기작이 뭘로 잡히는지 눈으로 바로 확인하기 위한 엔드포인트.
    채팅/생성 흐름에는 영향 없는 읽기 전용 조회."""
    return {
        "query": query,
        "total_documents": rag.count(),
        "community_digest": rag.get_current_digest(),
        "top_rounds": rag.get_top_rounds(limit=3),
        "results": rag.search_similar_debug(query, k=k),
    }


@app.post("/chat")
def chat_endpoint(req: ChatRequest):
    try:
        reply = chat_module.chat_reply(req.message, req.wallet_address)
        return {"reply": reply}
    except Exception:
        logger.exception("채팅 처리 실패")
        return {"reply": "죄송해요, 지금은 답변을 드리기 어려워요. 잠시 후 다시 시도해주세요."}
