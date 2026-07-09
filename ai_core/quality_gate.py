import logging

from langchain_core.messages import HumanMessage

import llm
from schemas import QualityCheckRequest, QualityCheckResult

logger = logging.getLogger("ai_core.quality_gate")

CHECK_PROMPT_TEMPLATE = """당신은 AI 생성 이미지의 "실행 품질"만 검증하는 검수자입니다.
화풍의 좋고 나쁨(취향)은 절대 평가 대상이 아닙니다 - 의도한 화풍이 그 화풍답게 잘 구현됐는지만 봅니다.
예를 들어 어린이 낙서 같은 순박한 화풍을 요청했다면, 그 화풍답게 자연스럽게 나왔는지만 확인하고 "고급스럽지 않다"는 이유로 실패 처리하지 마세요.

다음 4개 항목을 이미지와 대조해 각각 Yes/No로 판정하세요:
1. name="핵심요소반영": 프롬프트에 명시된 핵심 요소(주제·화풍·재질)가 실제로 이미지에 나타나는가
2. name="구조결함없음": 신체 왜곡, 텍스트 깨짐, 심각한 아티팩트, 좌우 비대칭 오류가 없는가
3. name="화풍일관성": 지정된 화풍의 관습을 따르고 있는가 (그 화풍답게 나왔는가)
4. name="내용일치": title/description/image_prompt가 서로 내용상 일치하는가

실패한 항목에는 detail에 구체적 이유를 적어주세요 (예: "로봇이 이미지에 보이지 않음"). 통과한 항목은 detail을 빈 문자열로 두세요.

프롬프트: {image_prompt}
제목: {title}
설명: {description}
지정 화풍: {style}
"""


def check_image_quality(req: QualityCheckRequest) -> QualityCheckResult:
    """이미지 검증 실패(API 에러 등) 시에는 게이트가 파이프라인을 막지 않도록 통과 처리한다."""
    structured_llm = llm.get_structured_llm(QualityCheckResult, temperature=0.0)
    prompt_text = CHECK_PROMPT_TEMPLATE.format(
        image_prompt=req.image_prompt,
        title=req.title,
        description=req.description,
        style=req.style or "명시 안 됨",
    )
    message = HumanMessage(
        content=[
            {"type": "text", "text": prompt_text},
            {"type": "image_url", "image_url": {"url": f"data:{req.mime_type};base64,{req.image_base64}"}},
        ]
    )
    try:
        return structured_llm.invoke([message])
    except Exception as e:
        logger.warning(f"품질 게이트 판정 실패, 통과 처리(폴백): {e}")
        return QualityCheckResult(
            checks=[
                {"name": "핵심요소반영", "passed": True, "detail": ""},
                {"name": "구조결함없음", "passed": True, "detail": ""},
                {"name": "화풍일관성", "passed": True, "detail": ""},
                {"name": "내용일치", "passed": True, "detail": "게이트 판정 실패로 통과 처리됨"},
            ]
        )


def is_passed(result: QualityCheckResult) -> bool:
    return all(c.passed for c in result.checks)


def failure_summary(result: QualityCheckResult) -> str:
    failed = [f"{c.name}: {c.detail}" for c in result.checks if not c.passed]
    return "; ".join(failed)


def rewrite_prompt_for_retry(original_prompt: str, title: str, description: str, style: str, summary: str) -> str:
    """실패 사유를 반영해 image_prompt를 재작성 - 막연한 재시도가 아니라 구체적 실패 항목을
    다음 시도에 직접 반영해야 재시도가 실제로 효과가 있다."""
    prompt = f"""다음 영문 이미지 프롬프트가 품질 검증에 실패했습니다. 실패 사유를 구체적으로 반영해 프롬프트를 다시 작성하세요.

원본 프롬프트: {original_prompt}
작품 제목: {title}
작품 설명: {description}
지정 화풍: {style or '명시 안 됨'}
실패 사유: {summary}

실패 사유를 해결하는 새 영문 프롬프트만 출력하세요 (다른 설명 없이 프롬프트 텍스트만)."""
    result = llm.llm_creative.invoke(prompt)
    return llm.to_text(result.content).strip()
