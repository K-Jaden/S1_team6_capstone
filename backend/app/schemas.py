from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

# === 공통/인증 ===
class WalletLoginRequest(BaseModel):
    wallet_address: str
    signature: str

# === 사용자 (마이페이지) ===
class UserResponse(BaseModel):
    wallet_address: str
    membership_grade: str
    token_balance: float
    pending_rewards: float
    class Config:
        from_attributes = True

# === 안건 (Proposals) ===
class ProposalCreate(BaseModel):
    wallet_address: str
    topic: str
    description: str | None = None
    style: str | None = "General"
    image_url: str | None = None

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

# === AI 스튜디오 ===
class StudioDraftRequest(BaseModel):
    intent: str
class StudioDraftResponse(BaseModel):
    draft_text: str
class StudioImageRequest(BaseModel):
    keywords: str
class StudioImageResponse(BaseModel):
    image_url: str

# === 갤러리 & 피드백 ===
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
    # 해당 작품에 달린 피드백도 같이 보여주기
    feedbacks: List[FeedbackResponse] = []
    class Config:
        from_attributes = True