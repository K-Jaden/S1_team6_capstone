import logging
from typing import TypedDict

from langgraph.graph import END, StateGraph

import llm
import tools
from schemas import TrendKeywords
from streaming import push_log

logger = logging.getLogger("ai_core.graphs.trends")

AGENT_NAME = "트렌드 수집가"


class TrendsState(TypedDict):
    session_id: str
    search_result: str
    subjects: list
    styles: list


def search_node(state: TrendsState) -> TrendsState:
    push_log(state["session_id"], AGENT_NAME, "action", "🔧 도구 사용: 웹 검색(2026 디지털 아트 트렌드)")
    try:
        result = tools.search_trends("2026 digital art trend keywords cyberpunk vaporwave glitch")
    except Exception as e:
        logger.warning(f"웹 검색 실패, 검색 결과 없이 진행: {e}")
        result = ""
    return {**state, "search_result": result}


def extract_node(state: TrendsState) -> TrendsState:
    push_log(state["session_id"], AGENT_NAME, "thought", "검색 결과를 분석해 트렌드 키워드 추출 중...")
    structured_llm = llm.get_structured_llm(TrendKeywords, temperature=0.2)
    prompt = f"""다음 웹 검색 결과를 참고하여 현재 전 세계 디지털 아트 트렌드 키워드를 한국어로 추출하세요.
검색 결과: {state['search_result'] or '(검색 결과 없음 - 최신 트렌드 지식으로 대체)'}

1. subjects (기획 대상/테마): 예) 사이버펑크 닌자, 해저 도시 등
2. styles (표현 방식/화풍/재질): 예) 베이퍼웨이브, 3D 언리얼 엔진, 글리치 왜곡 등"""
    result: TrendKeywords = structured_llm.invoke(prompt)
    push_log(state["session_id"], AGENT_NAME, "task_complete", f"✅ 작업 완료\n{result.model_dump()}")
    return {**state, "subjects": result.subjects, "styles": result.styles}


def build_trends_graph():
    graph = StateGraph(TrendsState)
    graph.add_node("search", search_node)
    graph.add_node("extract", extract_node)
    graph.set_entry_point("search")
    graph.add_edge("search", "extract")
    graph.add_edge("extract", END)
    return graph.compile()


_trends_graph = None


def get_trends_graph():
    global _trends_graph
    if _trends_graph is None:
        _trends_graph = build_trends_graph()
    return _trends_graph
