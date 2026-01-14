from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

# === 공통/인증 ===
class WalletLoginRequest(BaseModel):
    wallet_address: str
    signature: str

# === 사용자 ===
class UserResponse(BaseModel):
    wallet_address: str
    membership_grade: str
    token_balance: float
    pending_rewards: float
    # [추가] 뱃지 정보도 응답에 포함
    badge: str | None = None 
    class Config:
        from_attributes = True

# === 추천 전시 (New!) ===
class RecommendationResponse(BaseModel):
    title: str
    reason: str

# === 안건 (Proposals) ===
class ProposalCreate(BaseModel):
    wallet_address: str
    title: str
    meta_hash: str | None = None
    description: str | None = None
    style: str | None = "General"
    image_url: str | None = None

class ProposalUpdate(BaseModel):
    title: str | None = None
    meta_hash: str | None = None
    description: str | None = None
    image_url: str | None = None

class ProposalResponse(BaseModel):
    id: int
    wallet_address: str
    title: str
    meta_hash: str | None
    description: str | None
    status: str
    image_url: str | None
    created_at: datetime
    class Config:
        from_attributes = True

# === AI 스튜디오, 갤러리 ===
class StudioDraftRequest(BaseModel):
    intent: str
class StudioDraftResponse(BaseModel):
    draft_text: str
class StudioImageRequest(BaseModel):
    keywords: str
class StudioImageResponse(BaseModel):
    image_url: str
class FeedbackResponse(BaseModel):
    id: int
    wallet_address: str
    content: str
    created_at: datetime
    class Config:
        from_attributes = True
class GalleryItemResponse(BaseModel):
    id: int
    title: str
    artist_address: str
    image_url: str
    description: str
    feedbacks: List[FeedbackResponse] = []
    class Config:
        from_attributes = True