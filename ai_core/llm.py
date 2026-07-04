import logging
from langchain_google_genai import ChatGoogleGenerativeAI
import config

logger = logging.getLogger("ai_core.llm")


def _primary(temperature: float) -> ChatGoogleGenerativeAI:
    return ChatGoogleGenerativeAI(
        model=config.PRIMARY_MODEL,
        google_api_key=config.GOOGLE_API_KEY,
        temperature=temperature,
        max_retries=3,
    )


def _fallback(temperature: float) -> ChatGoogleGenerativeAI:
    return ChatGoogleGenerativeAI(
        model=config.FALLBACK_MODEL,
        google_api_key=config.GOOGLE_API_KEY,
        temperature=temperature,
        max_retries=2,
    )


def get_llm(temperature: float):
    """일반 텍스트 생성용. gemini-3.1-flash-lite 실패 시 gemini-1.5-flash로 자동 폴백."""
    return _primary(temperature).with_fallbacks([_fallback(temperature)])


def get_structured_llm(schema, temperature: float):
    """구조화 출력용. with_structured_output()을 먼저 바인딩한 뒤 그 결과에 폴백을 걸어야 한다
    (with_fallbacks()가 반환하는 RunnableWithFallbacks는 with_structured_output을 지원하지 않음)."""
    kwargs = {"method": config.STRUCTURED_OUTPUT_METHOD} if config.STRUCTURED_OUTPUT_METHOD else {}
    primary = _primary(temperature).with_structured_output(schema, **kwargs)
    fallback = _fallback(temperature).with_structured_output(schema, **kwargs)
    return primary.with_fallbacks([fallback])


def to_text(content) -> str:
    """AIMessage.content 정규화. Gemini는 문자열 대신 [{"type": "text", "text": "...", "extras": {...}}] 형태의
    콘텐츠 블록 리스트를 반환하기도 하므로, 어느 경우든 순수 텍스트만 뽑아낸다."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
        return "".join(parts)
    return str(content)


try:
    llm_creative = get_llm(0.9)
    llm_factual = get_llm(0.2)
    llm_chat = get_llm(0.6)
except Exception as e:
    logger.error(f"LLM 로드 실패: {e}")
    llm_creative = llm_factual = llm_chat = None
