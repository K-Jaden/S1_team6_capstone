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
import quality_gate
import rag
import streaming
from graphs.candidates import get_candidates_graph
from graphs.critique import get_critique_graph
from graphs.trends import get_trends_graph
from schemas import ChatRequest, QualityCheckRequest, WeightedCandidateRequest, WinnerEvalOnlyRequest

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
        result = graph.invoke({
            "session_id": "",
            "search_result": "",
            "eras": [],
            "subjects": [],
            "backgrounds": [],
            "styles": [],
            "moods": [],
            "ai_eras": [],
            "ai_subjects": [],
            "ai_backgrounds": [],
            "ai_styles": [],
            "ai_moods": []
        })
        return {
            "eras": result.get("eras", []),
            "subjects": result.get("subjects", []),
            "backgrounds": result.get("backgrounds", []),
            "styles": result.get("styles", []),
            "moods": result.get("moods", []),
            "ai_eras": result.get("ai_eras", []),
            "ai_subjects": result.get("ai_subjects", []),
            "ai_backgrounds": result.get("ai_backgrounds", []),
            "ai_styles": result.get("ai_styles", []),
            "ai_moods": result.get("ai_moods", [])
        }
    except Exception as e:
        logger.warning(f"🔥 트렌드 추출 실패: {e}")
        return {
            "eras": ["중세 판타지", "사이버펑크 미래", "포스트 아포칼립스"],
            "subjects": ["신비로운 숲의 정령", "우주 탐사 비행사", "사이버네틱 안드로이드"],
            "backgrounds": ["고대 유적지 내부", "네온 불빛 가득한 골목길", "구름 위 떠 있는 공중 도시"],
            "styles": ["몽환적인 수채화풍", "레드로 픽셀 아트", "실사 영화 같은 극사실주의"],
            "moods": ["쓸쓸하고 고독한 분위기", "시네마틱한 강렬한 조명", "따스하고 포근한 황금빛"],
            "ai_eras": ["조선시대", "빅토리아 스팀펑크", "서부 개척 시대"],
            "ai_subjects": ["메타버스 가상현실", "초거대 AI", "포스트 아포칼립스"],
            "backgrounds": ["벚꽃 정원", "우주선 조종실", "안개 낀 공동묘지"],
            "styles": ["전통 수묵화", "3D 복셀", "점토 클레이아트"],
            "moods": ["화려한 네온 라이팅", "차가운 새벽 공기", "몽환적 안개"]
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
                "era": req.era,
                "background": req.background,
                "style": req.style,
                "mood": req.mood,
                "rag_context": "",
                "plan_draft": "",
                "feedback": "",
                "turn_count": 0,
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
                {
                    "title": f"안전 렌더링 {i}",
                    "description": "복구 처리됨",
                    "image_prompt": f"masterpiece, {req.style}, {req.mood}, set in {req.background}, {req.era} era",
                }
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


@app.post("/api/agent/quality-check")
def quality_check(req: QualityCheckRequest):
    """축 A(실행 품질)만 검증 - 화풍 취향은 판단하지 않는다 (docs/quality_validation_framework.md 참고).
    실패 시 재수정 프롬프트까지 함께 반환해 backend가 별도 왕복 없이 바로 재시도할 수 있게 한다."""
    result = quality_gate.check_image_quality(req)
    passed = quality_gate.is_passed(result)
    response = {"passed": passed, "checks": [c.model_dump() for c in result.checks]}
    if not passed:
        summary = quality_gate.failure_summary(result)
        response["failure_summary"] = summary
        try:
            response["revised_prompt"] = quality_gate.rewrite_prompt_for_retry(
                req.image_prompt, req.title, req.description, req.style, summary
            )
        except Exception as e:
            logger.warning(f"재수정 프롬프트 생성 실패: {e}")
            response["revised_prompt"] = req.image_prompt
    return response


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
