from sqlalchemy import Column, Integer, String, Text, DateTime, Float, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base
from datetime import datetime

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
    feedbacks = relationship("GalleryFeedback", back_populates="author")
    # [추가] A2A 관련 관계
    chat_logs = relationship("A2AChatLog", back_populates="user")
    recommendations = relationship("UserRecommendation", back_populates="user")


# 1. 라운드 (시즌/주차) 테이블
class Round(Base):
    __tablename__ = "rounds"

    id = Column(Integer, primary_key=True, index=True)
    round_number = Column(Integer, unique=True, index=True) # 예: 1 (1주차), 2 (2주차)
    status = Column(String(50), default="ACTIVE") # 'ACTIVE' (투표중), 'ENDED' (종료 및 민팅됨)
    start_time = Column(DateTime, default=datetime.utcnow)
    end_time = Column(DateTime, nullable=True) # 라운드 종료 시간

    # 관계 설정 (1대다)
    candidates = relationship("Candidate", back_populates="round")
    votes = relationship("VoteLog", back_populates="round")


# 2. 후보작 테이블 (A2A가 생성한 10개의 오프체인 그림들)
class Candidate(Base):
    __tablename__ = "candidates"

    id = Column(Integer, primary_key=True, index=True)
    round_id = Column(Integer, ForeignKey("rounds.id"))
    
    title = Column(String(255), nullable=False) # 작품명
    description = Column(Text, nullable=False) # AI 비평가/기획자가 작성한 세계관
    image_url = Column(String(255), nullable=False) # 웹 표시용 URL
    ipfs_hash = Column(String(255), nullable=False) # 나중에 NFT 민팅할 때 쓸 IPFS 해시
    
    vp_votes = Column(Integer, default=0) # 현재까지 획득한 VP(투표) 총합
    is_winner = Column(Boolean, default=False) # 1등 우승작 여부
    auction_price = Column(Integer, nullable=True) # 1등 확정 후 AI 경매사가 책정한 가격 (TUK)

    # 관계 설정
    round = relationship("Round", back_populates="candidates")
    votes = relationship("VoteLog", back_populates="candidate")


# 3. 투표 기록 테이블 (가장 중요 ⭐ - 나중에 수익 분배할 때 씁니다)
class VoteLog(Base):
    __tablename__ = "vote_logs"

    id = Column(Integer, primary_key=True, index=True)
    round_id = Column(Integer, ForeignKey("rounds.id"))
    candidate_id = Column(Integer, ForeignKey("candidates.id"))
    voter_wallet = Column(String(255), index=True) # 투표한 유저의 지갑 주소
    vp_used = Column(Integer, nullable=False) # 이 후보작에 던진 VP 개수
    created_at = Column(DateTime, default=datetime.utcnow)

    # 관계 설정
    round = relationship("Round", back_populates="votes")
    candidate = relationship("Candidate", back_populates="votes")

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