from typing import List, Optional
from pydantic import BaseModel, Field


# ---- LLM 구조화 출력 스키마 ----

class TrendKeywords(BaseModel):
    subjects: List[str] = Field(description="트렌디한 기획 대상/테마 키워드 한국어 3개", min_length=3, max_length=3)
    styles: List[str] = Field(description="트렌디한 표현 방식/화풍/재질 키워드 한국어 3개", min_length=3, max_length=3)


class CandidateConcept(BaseModel):
    title: str = Field(description="한국어 제목")
    description: str = Field(description="한국어 설명, 2~3문장")
    image_prompt: str = Field(description="영문 이미지 프롬프트. '[가중치가 반영된 테마들], in the style of [고정 표현 방식]' 형식")


class CandidateList(BaseModel):
    candidates: List[CandidateConcept] = Field(min_length=5, max_length=5)


# ---- API 요청/응답 모델 ----

class WeightedCandidateRequest(BaseModel):
    weights: dict
    style: str = "digital art style"
    session_id: str = ""


class WinnerEvalOnlyRequest(BaseModel):
    title: str
    description: str
    session_id: str = ""
    round_id: Optional[int] = None
    keywords: List[str] = []


class ChatRequest(BaseModel):
    message: str
    wallet_address: str = ""
