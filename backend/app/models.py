from sqlalchemy import Column, Integer, String, Text, DateTime, Float, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base

# ==========================================
# 1. 사용자 (User)
# ==========================================
class User(Base):
    __tablename__ = "users"

    wallet_address = Column(String(255), primary_key=True, index=True)
    nickname = Column(String(50), nullable=True)
    membership_grade = Column(String(20), default="Bronze")
    token_balance = Column(Float, default=0.0)
    pending_rewards = Column(Float, default=0.0)
    is_delegated = Column(Boolean, default=False)
    delegated_to = Column(String(255), nullable=True)
    
    # 큐레이터 뱃지 상태
    badge = Column(String(50), nullable=True)

    # 관계 설정
    proposals = relationship("ArtRequest", back_populates="creator")
    feedbacks = relationship("GalleryFeedback", back_populates="author")
    # [추가] A2A 관련 관계
    chat_logs = relationship("A2AChatLog", back_populates="user")
    recommendations = relationship("UserRecommendation", back_populates="user")


# ==========================================
# 2. 안건 (ArtRequest)
# ==========================================
class ArtRequest(Base):
    __tablename__ = "art_requests"

    id = Column(Integer, primary_key=True, index=True)
    wallet_address = Column(String(255), ForeignKey("users.wallet_address"))
    
    title = Column(String(255), nullable=False)
    meta_hash = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    style = Column(String(50), default="General")
    image_url = Column(Text, nullable=True)
    
    status = Column(String(50), default="OPEN") 
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    creator = relationship("User", back_populates="proposals")


# ==========================================
# 3. 전시 작품 (GalleryItem)
# ==========================================
class GalleryItem(Base):
    __tablename__ = "gallery_items"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255))
    artist_address = Column(String(255))
    image_url = Column(Text)
    description = Column(Text)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    feedbacks = relationship("GalleryFeedback", back_populates="item")


# ==========================================
# 4. 관람평 (GalleryFeedback)
# ==========================================
class GalleryFeedback(Base):
    __tablename__ = "gallery_feedbacks"

    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(Integer, ForeignKey("gallery_items.id"))
    wallet_address = Column(String(255), ForeignKey("users.wallet_address"))
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    item = relationship("GalleryItem", back_populates="feedbacks")
    author = relationship("User", back_populates="feedbacks")


# ==========================================
# 5. [NEW] A2A 채팅 기록 (A2AChatLog)
# ==========================================
class A2AChatLog(Base):
    __tablename__ = "a2a_chat_logs"

    id = Column(Integer, primary_key=True, index=True)
    wallet_address = Column(String(255), ForeignKey("users.wallet_address"))
    
    # 사용자 질문 & AI 답변
    user_message = Column(Text, nullable=False)
    ai_reply = Column(Text, nullable=False)
    
    # 어떤 에이전트인지 (Curator, Docent 등)
    agent_type = Column(String(50), default="Curator") 
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="chat_logs")


# ==========================================
# 6. [NEW] 사용자 맞춤 추천 (UserRecommendation)
# ==========================================
class UserRecommendation(Base):
    __tablename__ = "user_recommendations"

    id = Column(Integer, primary_key=True, index=True)
    wallet_address = Column(String(255), ForeignKey("users.wallet_address"))
    
    # 추천 내용
    recommended_title = Column(String(255)) # 추천된 작품/전시 제목
    reason = Column(Text) # 추천 이유 (AI 분석 결과)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="recommendations")