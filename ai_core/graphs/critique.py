from typing import List, Optional, TypedDict

from langgraph.graph import END, StateGraph

import llm
import rag
from streaming import push_log

CRITIC_NAME = "가치 증명자 (미술 비평가)"


class CritiqueState(TypedDict):
    session_id: str
    title: str
    description: str
    round_id: Optional[int]
    keywords: List[str]
    report: str


def critique_node(state: CritiqueState) -> CritiqueState:
    push_log(state["session_id"], CRITIC_NAME, "thought", f"🏆 우승작 가치 증명 시작: {state['title']}")
    prompt = (
        f"우승작 '{state['title']}'({state['description']})의 미학적, 상업적 가치를 극대화하는 "
        "강력한 비평문을 작성하세요. 절대 직접 가격(숫자)을 책정하지 마세요."
    )
    result = llm.llm_creative.invoke(prompt)
    report = llm.to_text(result.content)
    push_log(state["session_id"], CRITIC_NAME, "task_complete", f"✅ 작업 완료\n{report}")
    return {**state, "report": report}


def archive_node(state: CritiqueState) -> CritiqueState:
    rag.archive_round(
        round_id=state.get("round_id"),
        keywords=state.get("keywords") or [],
        title=state["title"],
        description=state["description"],
        report=state["report"],
    )
    return state


def build_critique_graph():
    graph = StateGraph(CritiqueState)
    graph.add_node("critique", critique_node)
    graph.add_node("archive", archive_node)
    graph.set_entry_point("critique")
    graph.add_edge("critique", "archive")
    graph.add_edge("archive", END)
    return graph.compile()


_critique_graph = None


def get_critique_graph():
    global _critique_graph
    if _critique_graph is None:
        _critique_graph = build_critique_graph()
    return _critique_graph
