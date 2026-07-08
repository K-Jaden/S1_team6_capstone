import logging
from typing import TypedDict

from langgraph.graph import END, StateGraph

import llm
import rag
from schemas import CandidateList
from streaming import push_log

logger = logging.getLogger("ai_core.graphs.candidates")

PLANNER_NAME = "키워드 스토리텔러 (전시 기획자)"
PAINTER_NAME = "가중치 프롬프터 (디지털 아티스트)"


class CandidatesState(TypedDict):
    session_id: str
    weights: dict
    style: str
    rag_context: str
    plan_draft: str
    candidates: list


def _dist_str(weights: dict) -> str:
    return ", ".join([f"'{k}' ({int(v * 100)}% 비중)" for k, v in weights.items()])


def retrieve_context_node(state: CandidatesState) -> CandidatesState:
    query = f"{', '.join(state['weights'].keys())} {state['style']}"
    digest = rag.get_current_digest()
    top_rounds = rag.get_top_rounds(limit=2)
    similar = rag.search_similar(query, k=3)

    parts = []
    log_bits = []
    if digest:
        parts.append(f"[커뮤니티 방향성 요약]\n{digest}")
        log_bits.append("방향성 요약")
    if top_rounds:
        parts.append("[역대 인기 라운드]\n" + "\n".join(f"- {t}" for t in top_rounds))
        log_bits.append(f"역대 인기작 {len(top_rounds)}건")
    if similar:
        parts.append("[이번 주제와 유사한 과거 라운드]\n" + "\n".join(f"- {s}" for s in similar))
        log_bits.append(f"유사 라운드 {len(similar)}건")

    if log_bits:
        push_log(state["session_id"], PLANNER_NAME, "thought", f"📚 참고 자료 확보: {', '.join(log_bits)}")

    return {**state, "rag_context": "\n\n".join(parts)}


def plan_node(state: CandidatesState) -> CandidatesState:
    dist_str = _dist_str(state["weights"])
    push_log(state["session_id"], PLANNER_NAME, "thought", f"🎨 유저 투표 반영 기획 시작: {dist_str}")

    context_block = (
        f"\n\n참고할 과거 라운드 (동일하게 베끼지 말고 차별화하되, 호평받은 요소는 참고):\n{state['rag_context']}"
        if state["rag_context"]
        else ""
    )
    prompt = f"유저 투표 결과 키워드 비중: {dist_str}\n총 5개의 후보작 컨셉을 한국어로 기획하세요.{context_block}"
    result = llm.llm_creative.invoke(prompt)
    plan_text = llm.to_text(result.content)
    push_log(state["session_id"], PLANNER_NAME, "task_complete", f"✅ 작업 완료\n{plan_text}")
    return {**state, "plan_draft": plan_text}


def format_node(state: CandidatesState) -> CandidatesState:
    dist_str = _dist_str(state["weights"])
    push_log(state["session_id"], PAINTER_NAME, "thought", "기획안을 영문 이미지 프롬프트로 변환 중...")

    prompt = f"""아래 기획안을 바탕으로 총 5개의 고해상도 영문 이미지 프롬프트를 작성하세요.

기획안: {state['plan_draft']}

[필수 반영 요소]
1. 핵심 테마와 비중: {dist_str}
2. 고정 표현 방식(화풍 및 재질): 무조건 '{state['style']}' 반영

[프롬프트 작성 황금 공식]
'[가중치가 반영된 테마들], in the style of [고정 표현 방식]'"""

    structured_llm = llm.get_structured_llm(CandidateList, temperature=0.9)
    try:
        result: CandidateList = structured_llm.invoke(prompt)
    except Exception as e:
        logger.warning(f"구조화 출력 1차 실패, 1회 재시도: {e}")
        retry_prompt = prompt + f"\n\n(직전 시도가 스키마 오류로 실패했습니다: {e}\nJSON 스키마를 정확히 지켜 다시 작성하세요.)"
        result: CandidateList = structured_llm.invoke(retry_prompt)

    candidates = [c.model_dump() for c in result.candidates]
    push_log(state["session_id"], PAINTER_NAME, "task_complete", f"✅ 작업 완료\n후보작 {len(candidates)}개 생성")
    return {**state, "candidates": candidates}


def build_candidates_graph():
    graph = StateGraph(CandidatesState)
    graph.add_node("retrieve_context", retrieve_context_node)
    graph.add_node("plan", plan_node)
    graph.add_node("format", format_node)
    graph.set_entry_point("retrieve_context")
    graph.add_edge("retrieve_context", "plan")
    graph.add_edge("plan", "format")
    graph.add_edge("format", END)
    return graph.compile()


_candidates_graph = None


def get_candidates_graph():
    global _candidates_graph
    if _candidates_graph is None:
        _candidates_graph = build_candidates_graph()
    return _candidates_graph
