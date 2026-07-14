import logging
from typing import TypedDict

from langgraph.graph import END, StateGraph

import llm
import rag
from schemas import CandidateList
from streaming import push_log

logger = logging.getLogger("ai_core.graphs.candidates")

PLANNER_NAME = "키워드 스토리텔러 (전시 기획자)"
CRITIC_NAME = "가치 증명자 (미술 비평가)"
PAINTER_NAME = "가중치 프롬프터 (디지털 아티스트)"


class CandidatesState(TypedDict):
    session_id: str
    weights: dict
    style: str
    rag_context: str
    plan_draft: str
    feedback: str
    turn_count: int
    candidates: list


def _dist_str(weights: dict) -> str:
    return ", ".join([f"'{k}' (가중치: {v})" for k, v in weights.items()])


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
    session_id = state["session_id"]
    turn = state.get("turn_count", 0)

    context_block = (
        f"\n\n참고할 과거 라운드 (동일하게 베끼지 말고 차별화하되, 호평받은 요소는 참고):\n{state['rag_context']}"
        if state["rag_context"]
        else ""
    )

    if turn == 0:
        push_log(session_id, PLANNER_NAME, "thought", f"🎨 유저 투표 반영 기획 시작: {dist_str}")
        prompt = f"유저 투표 결과 키워드 비중: {dist_str}\n총 5개의 후보작 컨셉을 한국어로 기획하세요.{context_block}"
        result = llm.llm_creative.invoke(prompt)
        plan_text = llm.to_text(result.content)
        push_log(session_id, PLANNER_NAME, "task_complete", f"✅ 초안 작성 완료\n{plan_text}")
        return {**state, "plan_draft": plan_text, "turn_count": 0}
    else:
        push_log(session_id, PLANNER_NAME, "thought", "비평가의 피드백을 반영하여 기획안 수정 중...")
        prompt = f"""유저 투표 결과 키워드 비중: {dist_str}
고정 표현 방식: {state['style']}
과거 참고 자료: {state['rag_context']}

이전 작성했던 기획안 초안:
{state['plan_draft']}

미술 비평가의 피드백:
{state['feedback']}

[미션] 비평가의 피드백을 적극 수용하여 기존 기획안을 보완하고 완성도를 높인 최종 5개 후보작 컨셉 기획안을 한국어로 작성하세요."""
        result = llm.llm_creative.invoke(prompt)
        plan_text = llm.to_text(result.content)
        push_log(session_id, PLANNER_NAME, "task_complete", f"✅ 최종 기획안 수정 완료\n{plan_text}")
        return {**state, "plan_draft": plan_text, "turn_count": 1}


def critic_node(state: CandidatesState) -> CandidatesState:
    session_id = state["session_id"]
    dist_str = _dist_str(state["weights"])
    push_log(session_id, CRITIC_NAME, "thought", "기획안 초안에 대한 미술 비평 및 보완 의견 작성 중...")

    prompt = f"""당신은 미술 비평가로서 기획자의 후보작 기획안 초안을 분석하고 보완점을 제시해야 합니다.
    
기획안 초안:
{state['plan_draft']}

핵심 테마와 가중치: {dist_str}
고정 표현 방식(화풍 및 재질): {state['style']}

[비평 가이드라인]
1. 기획안의 스토리라인과 컨셉이 유저들이 투표한 핵심 테마 및 가중치 비중과 부합하는지 비판적으로 평가하세요.
2. 각 후보작의 개성이 겹치지 않고 다채로운지 지적하세요.
3. 이미지 생성 프롬프트로 변환하기에 비주얼적 묘사가 부족한 부분을 지적하세요.
4. 개선을 위한 명확하고 구체적인 피드백을 한국어로 신랄하지만 설득력 있게 작성하세요. (절대 직접 가격이나 숫자를 책정하지 마세요.)"""
    
    result = llm.llm_creative.invoke(prompt)
    feedback_text = llm.to_text(result.content)
    push_log(session_id, CRITIC_NAME, "task_complete", f"✅ 비평 및 피드백 완료\n{feedback_text}")
    return {**state, "feedback": feedback_text, "turn_count": 1}


def format_node(state: CandidatesState) -> CandidatesState:
    dist_str = _dist_str(state["weights"])
    push_log(state["session_id"], PAINTER_NAME, "thought", "기획안을 영문 이미지 프롬프트로 변환 중...")

    prompt = f"""아래 기획안을 바탕으로 총 5개의 고해상도 영문 이미지 프롬프트를 작성하세요.

기획안: {state['plan_draft']}

[필수 반영 요소]
1. 핵심 테마와 비중: {dist_str}
2. 고정 표현 방식(화풍 및 재질): 무조건 '{state['style']}' 반영

[프롬프트 작성 황금 공식]
이미지 생성 AI가 키워드별 가중치를 정확히 인식할 수 있도록, 전달받은 가중치 점수를 이용해 반드시 수학적 괄호 문법 (keyword: weight)을 프롬프트 안에 삽입하세요.
예시 포맷: '(주요 키워드: 가중치 값), (부차적 키워드: 가중치 값), in the style of [고정 표현 방식]'"""

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


def route_after_plan(state: CandidatesState):
    if state.get("turn_count", 0) == 0:
        return "critic"
    else:
        return "format"


def build_candidates_graph():
    graph = StateGraph(CandidatesState)
    graph.add_node("retrieve_context", retrieve_context_node)
    graph.add_node("plan", plan_node)
    graph.add_node("critic", critic_node)
    graph.add_node("format", format_node)
    
    graph.set_entry_point("retrieve_context")
    graph.add_edge("retrieve_context", "plan")
    
    graph.add_conditional_edges(
        "plan",
        route_after_plan,
        {
            "critic": "critic",
            "format": "format"
        }
    )
    
    graph.add_edge("critic", "plan")
    graph.add_edge("format", END)
    return graph.compile()


_candidates_graph = None


def get_candidates_graph():
    global _candidates_graph
    if _candidates_graph is None:
        _candidates_graph = build_candidates_graph()
    return _candidates_graph
