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
    # 뱃지 정보 포함
    badge: str | None = None 
    class Config:
        from_attributes = True

# === 추천 전시 (마이페이지용) ===
class RecommendationResponse(BaseModel):
    title: str
    reason: str

# === A2A (AI 에이전트) [NEW] ===
class A2AChatRequest(BaseModel):
    message: str
    wallet_address: str

class A2AChatResponse(BaseModel):
    reply: str

class A2ARecommendationItem(BaseModel):
    id: int
    title: str
    reason: str

class ProposalAgentRequest(BaseModel):
    intent: str

class ProposalAgentResponse(BaseModel):
    proposal_text: str
    suggested_title: str

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
    feedbacks: List[FeedbackResponse] = []
    class Config:
        from_attributes = True
        
# schemas.py

# ... (기존 코드들) ...

# ==========================================
# ✅ [NEW] AI 에이전트 센터 (Agent Squad)
# ==========================================

# 1. 비평가 (Critic)
class AgentReviewRequest(BaseModel):
    art_info: str

class AgentReviewResponse(BaseModel):
    review_text: str

# 2. 마케터 (Marketer)
class AgentPromoteRequest(BaseModel):
    exhibition_title: str
    target_audience: str

class AgentPromoteResponse(BaseModel):
    promo_text: str

# 3. 경매사 (Auctioneer)
class AgentAuctionRequest(BaseModel):
    art_info: str
    critic_review: str

class AgentAuctionResponse(BaseModel):
    auction_report: str