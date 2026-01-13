from sqlalchemy import Column, Integer, String, Text, DateTime, Float, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base

# 1. 사용자 (User) - 마이페이지 정보 저장
class User(Base):
    __tablename__ = "users"

    wallet_address = Column(String(255), primary_key=True, index=True)
    nickname = Column(String(50), nullable=True)
    membership_grade = Column(String(20), default="Bronze") # Bronze, Silver, Gold
    token_balance = Column(Float, default=0.0)      # 보유 토큰
    pending_rewards = Column(Float, default=0.0)    # 미수령 보상
    is_delegated = Column(Boolean, default=False)   # 위임 여부
    delegated_to = Column(String(255), nullable=True)
    
    # 관계 설정
    proposals = relationship("ArtRequest", back_populates="creator")
    feedbacks = relationship("GalleryFeedback", back_populates="author")

# 2. 안건 (ArtRequest) - 기존 유지 + 작성자 연결
class ArtRequest(Base):
    __tablename__ = "art_requests"

    id = Column(Integer, primary_key=True, index=True)
    wallet_address = Column(String(255), ForeignKey("users.wallet_address")) # FK 추가
    
    topic = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    style = Column(String(50), default="General")
    image_url = Column(Text, nullable=True)
    
    status = Column(String(50), default="OPEN") # OPEN, VOTING, PASSED, REJECTED
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    creator = relationship("User", back_populates="proposals")

# 3. 전시 작품 (GalleryItem) - 기존 유지
class GalleryItem(Base):
    __tablename__ = "gallery_items"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255))
    artist_address = Column(String(255))
    image_url = Column(Text)
    description = Column(Text)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    feedbacks = relationship("GalleryFeedback", back_populates="item")

# 4. 관람평/방명록 (Feedback) - [NEW] 명세서 추가 기능
class GalleryFeedback(Base):
    __tablename__ = "gallery_feedbacks"

    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(Integer, ForeignKey("gallery_items.id"))
    wallet_address = Column(String(255), ForeignKey("users.wallet_address"))
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    item = relationship("GalleryItem", back_populates="feedbacks")
    author = relationship("User", back_populates="feedbacks")