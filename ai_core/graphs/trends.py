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
    eras: list
    subjects: list
    backgrounds: list
    styles: list
    ai_eras: list
    ai_subjects: list
    ai_backgrounds: list
    ai_styles: list


def search_node(state: TrendsState) -> TrendsState:
    push_log(state["session_id"], AGENT_NAME, "action", "🔧 도구 사용: Reddit 인기 피드 크롤링")
    try:
        result = tools.fetch_reddit_trends()
    except Exception as e:
        logger.warning(f"Reddit 크롤링 실패, 검색 도구 폴백 시도: {e}")
        try:
            result = tools.search_trends("2026 digital art trend keywords cyberpunk vaporwave glitch")
        except Exception as ex:
            logger.warning(f"검색 실패, 결과 없이 진행: {ex}")
            result = ""
    return {**state, "search_result": result}


def extract_node(state: TrendsState) -> TrendsState:
    push_log(state["session_id"], AGENT_NAME, "thought", "크롤링한 Reddit 데이터 분석 및 AI 자체 지식 결합하여 4대 슬롯 트렌드 추출 중...")
    structured_llm = llm.get_structured_llm(TrendKeywords, temperature=0.5)
    prompt = f"""해외 디지털 아트/AI 커뮤니티(Reddit) 피드를 분석한 실시간 트렌드 키워드(crawled trends)와, AI가 직접 생각하고 고안한 트렌디한 아트 키워드(AI internal knowledge trends)를 각각 추출하세요.

크롤링 결과: {state['search_result'] or '(데이터 없음 - AI 지식만으로 대체)'}

[추출 및 생성 기준]
1. 크롤링 기반 (eras, subjects, backgrounds, styles): 제공된 크롤링 결과에 근거하여 카테고리당 한국어 단어 3개씩 추출하세요.
2. AI 자체 추천 (ai_eras, ai_subjects, ai_backgrounds, ai_styles): 크롤링 자료와 무관하게, AI가 생각하는 2026년 가장 인상적이고 독특한 최신 디지털 아트/서브컬처 트렌드 단어들을 카테고리당 한국어 단어 3개씩 생성하세요. (크롤링 결과에서 뽑은 단어들과 가급적 겹치지 않게 다양하게 생성하세요.)

[카테고리별 작성 규격 - 매우 중요]
- 시대 (eras, ai_eras): 무조건 배경이 되는 시대나 Epoch를 나타내는 표현이어야 하며, 단어가 **'시대'** 또는 **'제국 시대'**로 끝나야 합니다. (예: 조선 시대, 고대 이집트 시대, 로마 제국 시대, 사이버펑크 미래 시대, 중세 판타지 시대, 포스트 아포칼립스 시대 등)
- 세부 배경 (backgrounds, ai_backgrounds): 무조건 피사체가 서 있는 **'물리적 장소/위치'**여야 하며, 시대적 형용사나 번들거림 묘사 없이 담백하고 고유한 명사형 장소여야 합니다. (예: 골목길, 정원, 서재, 우주선 내부, 대성당 내부, 산 정상, 도서관 등)
- 피사체 (subjects, ai_subjects): 기획 대상이나 캐릭터 피사체 (예: 공룡, 로봇, 고양이, 기사, 소나무 등)
- 화풍 (styles, ai_styles): 미술 스타일 및 기법 (예: 전통 수묵화, 점토 클레이아트, 픽셀 도트 등)"""
    result: TrendKeywords = structured_llm.invoke(prompt)
    push_log(state["session_id"], AGENT_NAME, "task_complete", f"✅ 크롤링 및 AI 자체 트렌드 추출 완료\n{result.model_dump()}")
    return {
        **state,
        "eras": result.eras,
        "subjects": result.subjects,
        "backgrounds": result.backgrounds,
        "styles": result.styles,
        "ai_eras": result.ai_eras,
        "ai_subjects": result.ai_subjects,
        "ai_backgrounds": result.ai_backgrounds,
        "ai_styles": result.ai_styles,
    }


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
