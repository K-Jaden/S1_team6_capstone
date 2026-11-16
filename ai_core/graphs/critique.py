import logging
from typing import List, Optional, TypedDict

from langgraph.graph import END, StateGraph

import config
import llm
import rag
from streaming import push_log

logger = logging.getLogger("ai_core.graphs.critique")

CRITIC_NAME = "가치 증명자 (미술 비평가)"


class CritiqueState(TypedDict):
    session_id: str
    title: str
    description: str
    round_id: Optional[int]
    keywords: List[str]
    vp_votes: int
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


def _synthesize_digest() -> Optional[str]:
    round_texts = rag.get_all_round_texts(limit=50)
    if len(round_texts) < 3:
        return None
    joined = "\n".join(f"- {t}" for t in round_texts)
    prompt = f"""다음은 ArtDAO 커뮤니티의 지난 라운드 우승작 기록들입니다. 개별 라운드를 나열하지 말고,
이 커뮤니티가 전반적으로 어떤 주제·화풍·정서를 지향해왔는지 3~4문장으로 경향성 위주로 종합 요약하세요.

{joined}"""
    result = llm.llm_creative.invoke(prompt)
    return llm.to_text(result.content)


def refresh_digest_now() -> Optional[str]:
    """%10 조건과 무관하게 즉시 방향성 요약본을 재생성 - 시드 스크립트 등에서 강제 호출용."""
    try:
        text = _synthesize_digest()
    except Exception as e:
        logger.warning(f"방향성 요약본 생성 실패: {e}")
        return None
    if text:
        rag.archive_digest(text)
        logger.info("커뮤니티 방향성 요약본 갱신 완료")
    return text


def maybe_refresh_digest(round_id: Optional[int]):
    """실제 게임 라운드(양수) N개마다만 재생성 - 시드 데이터(음수 round_id)에는 반응하지 않는다."""
    if not round_id or round_id <= 0 or round_id % config.DIGEST_REFRESH_INTERVAL != 0:
        return
    refresh_digest_now()


def archive_node(state: CritiqueState) -> CritiqueState:
    rag.archive_round(
        round_id=state.get("round_id"),
        keywords=state.get("keywords") or [],
        title=state["title"],
        description=state["description"],
        report=state["report"],
        vp_votes=state.get("vp_votes", 0),
    )
    maybe_refresh_digest(state.get("round_id"))
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
