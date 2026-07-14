from typing import List, Optional
from pydantic import BaseModel, Field


# ---- LLM 구조화 출력 스키마 ----

class TrendKeywords(BaseModel):
    eras: List[str] = Field(description="Reddit 크롤링 결과에서 추출한 트렌디한 시대 및 공간적 배경 키워드 한국어 3개", min_length=3, max_length=3)
    subjects: List[str] = Field(description="Reddit 크롤링 결과에서 추출한 트렌디한 핵심 피사체/캐릭터 키워드 한국어 3개", min_length=3, max_length=3)
    backgrounds: List[str] = Field(description="Reddit 크롤링 결과에서 추출한 트렌디한 세부 배경/장소 키워드 한국어 3개", min_length=3, max_length=3)
    styles: List[str] = Field(description="Reddit 크롤링 결과에서 추출한 트렌디한 화풍 및 표현 기법 키워드 한국어 3개", min_length=3, max_length=3)
    moods: List[str] = Field(description="Reddit 크롤링 결과에서 추출한 트렌디한 분위기 및 조명 키워드 한국어 3개", min_length=3, max_length=3)

    ai_eras: List[str] = Field(description="AI가 자체 트렌드 지식으로 선정한 독창적이고 인기 있는 시대 및 공간적 배경 키워드 한국어 3개", min_length=3, max_length=3)
    ai_subjects: List[str] = Field(description="AI가 자체 트렌드 지식으로 선정한 독창적이고 인기 있는 핵심 피사체/캐릭터 키워드 한국어 3개", min_length=3, max_length=3)
    ai_backgrounds: List[str] = Field(description="AI가 자체 트렌드 지식으로 선정한 독창적이고 인기 있는 세부 배경/장소 키워드 한국어 3개", min_length=3, max_length=3)
    ai_styles: List[str] = Field(description="AI가 자체 트렌드 지식으로 선정한 독창적이고 인기 있는 화풍 및 표현 기법 키워드 한국어 3개", min_length=3, max_length=3)
    ai_moods: List[str] = Field(description="AI가 자체 트렌드 지식으로 선정한 독창적이고 인기 있는 분위기 및 조명 키워드 한국어 3개", min_length=3, max_length=3)


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
