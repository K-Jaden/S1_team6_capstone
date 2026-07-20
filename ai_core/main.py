import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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
from schemas import (
    ChatRequest,
    FeedbackArchiveRequest,
    FeedbackSentiment,
    LosingCandidateArchiveRequest,
    QualityCheckRequest,
    WeightedCandidateRequest,
    WinnerEvalOnlyRequest,
)

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
            "eras": ["중세 판타지 시대", "사이버펑크 미래 시대", "포스트 아포칼립스 시대"],
            "subjects": ["숲의 정령", "우주 비행사", "안드로이드"],
            "backgrounds": ["유적지", "골목길", "공중 도시"],
            "styles": ["몽환적인 수채화풍", "레트로 픽셀 아트", "실사 영화 화풍"],
            "ai_eras": ["조선 시대", "빅토리아 스팀펑크 시대", "서부 개척 시대"],
            "ai_subjects": ["메타버스", "인공지능", "포스트 아포칼립스"],
            "ai_backgrounds": ["정원", "우주선 내부", "공동묘지"],
            "ai_styles": ["전통 수묵화", "3D 복셀", "점토 클레이아트"]
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
                    "image_prompt": f"masterpiece, {req.style}, set in {req.background}, {req.era} era",
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

    # VQAScore 방식 정합성 점수 - OpenAI(logprobs) 설정 시에만 계산, 없으면 필드 자체를 생략
    alignment_score = quality_gate.compute_alignment_score(req.image_base64, req.mime_type, req.image_prompt)
    if alignment_score is not None:
        response["alignment_score"] = alignment_score

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


@app.post("/api/agent/archive-losing-candidates")
def archive_losing_candidates(req: LosingCandidateArchiveRequest):
    """실제 라운드에서 우승하지 못한 후보들을 낙선 후보(doc_type=losing_candidate)로 아카이브.
    reason은 backend가 득표 비교 등 사실 기반으로 미리 계산해 넘긴다 - 여기서는 LLM 호출 없이
    그대로 저장만 하므로 추가 API 비용이 들지 않는다."""
    archived = 0
    for item in req.items:
        try:
            rag.archive_losing_candidate(
                round_id=item.round_id,
                keywords=item.keywords,
                title=item.title,
                description=item.description,
                vp_votes=item.vp_votes,
                reason=item.reason,
            )
            archived += 1
        except Exception as e:
            logger.warning(f"낙선 후보 아카이브 실패 ('{item.title}'): {e}")
    return {"archived": archived}


@app.post("/api/agent/archive-feedback")
def archive_feedback_endpoint(req: FeedbackArchiveRequest):
    """실제 유저 관람평을 감정 분류 후 관람평(doc_type=feedback)으로 아카이브.
    관람평 제출은 라운드당 최대 5회 뿐인 이미지 생성/품질검증과 달리 빈도가 낮고 유저가 직접
    트리거하는 이벤트라, 감정 분류에 LLM 호출 1회를 쓰는 비용은 감내 가능하다고 판단."""
    sentiment = "중립"
    try:
        structured_llm = llm_module.get_structured_llm(FeedbackSentiment, temperature=0)
        result: FeedbackSentiment = structured_llm.invoke(
            f"다음은 전시 작품에 대한 유저 관람평입니다. 감정을 '긍정'/'부정'/'중립' 중 하나로만 분류하세요.\n관람평: {req.comment}"
        )
        sentiment = result.sentiment
    except Exception as e:
        logger.warning(f"관람평 감정 분류 실패, 중립으로 처리: {e}")

    try:
        rag.archive_feedback(round_id=req.round_id, title=req.title, comment=req.comment, sentiment=sentiment)
    except Exception as e:
        logger.warning(f"관람평 아카이브 실패: {e}")

    return {"sentiment": sentiment}


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


# =========================================================
# 🎨 [AI 스튜디오] 화풍별 RAG 스타일 가이드 기반 프롬프트 생성
# 사용자가 직접 스튜디오에서 화풍을 선택하면 RAG에서 유사 작품의
# 어휘·재질 가이드를 검색하여 정교한 이미지 프롬프트를 반환한다.
# =========================================================
class GeneratePromptReq(BaseModel):
    subject: str
    style: str
    mood: str = ""


@app.post("/generate")
def generate_prompt(req: GeneratePromptReq):
    """스튜디오 전용 - RAG 스타일 가이드를 검색하여 이미지 프롬프트 강화.
    화풍 고유의 어휘(붓터치, 재질 등)를 기계적으로 삽입하여 품질 향상."""
    try:
        # RAG 스타일 컬렉션에서 입력 화풍과 가장 유사한 가이드 검색
        style_guide = rag.search_similar_debug(req.style, k=2, collection="styles")
        guide_text = " ".join([r.get("text", "") for r in style_guide]) if style_guide else ""

        # 화풍 고유 어휘를 담은 스타일 수식어 구성
        style_map = {
            "유화": "thick impasto brushstrokes, knife-painted texture, rich oil pigments, canvas grain",
            "유채": "thick impasto brushstrokes, knife-painted texture, rich oil pigments, canvas grain",
            "수묵화": "ink wash gradients, rice paper texture, monochrome tonal range, spontaneous brushwork",
            "픽셀": "pixel grid, 8-bit color palette, sharp edges, no anti-aliasing",
            "수채화": "watercolor washes, wet-on-wet bleeding, translucent layers, paper texture",
        }
        style_vocab = ""
        for key, vocab in style_map.items():
            if key in req.style:
                style_vocab = vocab
                break

        # 최종 프롬프트 조합
        parts = [req.subject]
        if req.mood:
            parts.append(req.mood)
        parts.append(req.style)
        if style_vocab:
            parts.append(style_vocab)
        if guide_text:
            parts.append(guide_text[:200])

        prompt = ", ".join(parts)
        return {"prompt": prompt, "style_vocab": style_vocab}
    except Exception as e:
        logger.warning(f"프롬프트 생성 실패, 폴백 사용: {e}")
        prompt = f"{req.subject}, {req.style}"
        if req.mood:
            prompt += f", {req.mood}"
        return {"prompt": prompt, "style_vocab": ""}
