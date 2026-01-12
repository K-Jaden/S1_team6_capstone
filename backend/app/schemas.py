from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

# === 공통 ===
class TokenResponse(BaseModel):
    access_token: str
    token_type: str

class WalletLoginRequest(BaseModel):
    wallet_address: str
    signature: str

# === 안건 (Proposals) ===
class ProposalCreate(BaseModel):
    wallet_address: str
    topic: str
    description: str | None = None
    style: str | None = "Cyberpunk"
    image_url: str | None = None # AI 스튜디오에서 만든 이미지

class ProposalResponse(BaseModel):
    id: int
    wallet_address: str
    topic: str
    description: str | None
    status: str
    image_url: str | None
    created_at: datetime
    class Config:
        from_attributes = True

# === AI 창작 스튜디오 (New!) ===
class StudioDraftRequest(BaseModel):
    intent: str # "사이버펑크 풍의 우울한 도시를 그리고 싶어"

class StudioDraftResponse(BaseModel):
    draft_text: str # AI가 써준 기획서 초안

class StudioImageRequest(BaseModel):
    keywords: str # "Neon, Rain, City"

class StudioImageResponse(BaseModel):
    image_url: str

# === 온라인 전시관 (New!) ===
class GalleryItemResponse(BaseModel):
    id: int
    title: str
    artist_address: str
    image_url: str
    description: str
    class Config:
        from_attributes = True