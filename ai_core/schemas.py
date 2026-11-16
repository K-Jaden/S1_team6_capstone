from typing import List, Optional
from pydantic import BaseModel, Field


# ---- LLM 구조화 출력 스키마 ----

class TrendKeywords(BaseModel):
    eras: List[str] = Field(description="Reddit 크롤링 결과에서 추출한 트렌디한 시대 키워드 한국어 3개 (반드시 시대/제국으로 끝나야 함)", min_length=3, max_length=3)
    subjects: List[str] = Field(description="Reddit 크롤링 결과에서 추출한 트렌디한 핵심 피사체/캐릭터 키워드 한국어 3개", min_length=3, max_length=3)
    backgrounds: List[str] = Field(description="Reddit 크롤링 결과에서 추출한 트렌디한 세부 장소 키워드 한국어 3개 (구체적인 장소/위치)", min_length=3, max_length=3)
    styles: List[str] = Field(description="Reddit 크롤링 결과에서 추출한 트렌디한 화풍 및 표현 기법 키워드 한국어 3개", min_length=3, max_length=3)

    ai_eras: List[str] = Field(description="AI가 자체 트렌드 지식으로 선정한 독창적이고 인기 있는 시대 키워드 한국어 3개 (반드시 시대/제국으로 끝나야 함)", min_length=3, max_length=3)
    ai_subjects: List[str] = Field(description="AI가 자체 트렌드 지식으로 선정한 독창적이고 인기 있는 핵심 피사체/캐릭터 키워드 한국어 3개", min_length=3, max_length=3)
    ai_backgrounds: List[str] = Field(description="AI가 자체 트렌드 지식으로 선정한 독창적이고 인기 있는 세부 장소 키워드 한국어 3개 (구체적인 장소/위치)", min_length=3, max_length=3)
    ai_styles: List[str] = Field(description="AI가 자체 트렌드 지식으로 선정한 독창적이고 인기 있는 화풍 및 표현 기법 키워드 한국어 3개", min_length=3, max_length=3)


class CandidateConcept(BaseModel):
    title: str = Field(description="한국어 제목")
    description: str = Field(description="한국어 설명, 2~3문장")
    image_prompt: str = Field(description="영문 이미지 프롬프트. '[가중치가 반영된 테마들], in the style of [고정 표현 방식]' 형식")


class CandidateList(BaseModel):
    candidates: List[CandidateConcept] = Field(min_length=5, max_length=5)


class SeedRound(BaseModel):
    keywords: List[str] = Field(description="이 라운드의 핵심 테마/화풍 키워드 2~3개")
    title: str = Field(description="한국어 전시/작품 제목")
    description: str = Field(description="한국어 설명, 2~3문장")
    report: str = Field(description="미술 비평가 톤의 비평 요지, 2~3문단")


class SeedRoundBatch(BaseModel):
    rounds: List[SeedRound]


class SeedLosingCandidate(BaseModel):
    keywords: List[str] = Field(description="이 낙선 후보가 다룬 테마/화풍 키워드 2~3개")
    title: str = Field(description="한국어 제목")
    description: str = Field(description="한국어 설명, 1~2문장")
    vp_votes: int = Field(description="당선작 대비 낮은 득표수 (예: 5~40 사이)")
    reason: str = Field(description="왜 이 컨셉이 우승작보다 덜 선호됐을지에 대한 구체적 추정 이유, 1문장 (예: 임팩트 부족, 테마와 화풍의 어색한 결합 등)")


class SeedFeedback(BaseModel):
    comment: str = Field(description="유저가 남긴 것 같은 자연스러운 한국어 관람평 한두 문장 (AI 비평문 톤이 아니라 일반 유저 말투)")
    sentiment: str = Field(description="긍정/부정/중립 중 하나")


class SeedCommunitySignalBatch(BaseModel):
    losing_candidates: List[SeedLosingCandidate] = Field(min_length=2, max_length=2)
    feedbacks: List[SeedFeedback] = Field(min_length=2, max_length=2)


class QualityCheckItem(BaseModel):
    name: str = Field(description="체크 항목 이름 (예: 핵심요소반영, 구조결함없음, 화풍일관성, 내용일치)")
    passed: bool = Field(description="이 항목을 통과했는가")
    detail: str = Field(default="", description="실패 시 구체적 이유 (통과 시 빈 문자열)")


class QualityCheckResult(BaseModel):
    checks: List[QualityCheckItem] = Field(min_length=4, max_length=4)


# ---- API 요청/응답 모델 ----

class WeightedCandidateRequest(BaseModel):
    weights: dict
    era: str = "modern era"
    background: str = "simple background"
    style: str = "digital art style"
    mood: str = "cinematic lighting"
    session_id: str = ""



class WinnerEvalOnlyRequest(BaseModel):
    title: str
    description: str
    session_id: str = ""
    round_id: Optional[int] = None
    keywords: List[str] = []
    vp_votes: int = 0


class ChatRequest(BaseModel):
    message: str
    wallet_address: str = ""


class QualityCheckRequest(BaseModel):
    image_base64: str  # 순수 base64 (data: 접두사 없이)
    mime_type: str = "image/png"
    image_prompt: str
    title: str
    description: str
    style: str = ""
    session_id: str = ""


class PushLogRequest(BaseModel):
    session_id: str
    agent_role: str
    log_type: str
    content: str


class LosingCandidateArchiveItem(BaseModel):
    round_id: Optional[int] = None
    keywords: List[str] = []
    title: str
    description: str
    vp_votes: int = 0
    reason: str = ""  # 사실 기반 낙선 이유 (예: "우승작 대비 득표 32% 수준") - backend에서 계산해 전달


class LosingCandidateArchiveRequest(BaseModel):
    items: List[LosingCandidateArchiveItem]


class FeedbackArchiveRequest(BaseModel):
    round_id: Optional[int] = None
    title: str
    comment: str


class FeedbackSentiment(BaseModel):
    sentiment: str = Field(description="관람평에 담긴 감정 분류 - '긍정'/'부정'/'중립' 중 하나만 정확히 반환")
