from sqlalchemy import Column, Integer, String, Text, DateTime, Float, ForeignKey, Boolean, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base
from datetime import datetime
import enum

# ==========================================
# 🔥 [NEW] 라운드 진행 상태 Enum
# ==========================================
class RoundPhase(str, enum.Enum):
    TREND_SEARCH = "trend_search"      # AI가 트렌드 검색 중
    KEYWORD_VOTING = "keyword_voting"  # 유저가 키워드 투표 중
    IMAGE_GENERATING = "image_generating"# 투표 결과로 그림 생성 중
    CANDIDATE_VOTING = "voting"        # 후보작 VP 투자 진행 중
    VALUATION = "valuation"            # 결산 및 가격 책정 중
    ENDED = "ended"                    # 종료 (NFT 민팅 완료)

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
    badge = Column(String(50), nullable=True)

    feedbacks = relationship("GalleryFeedback", back_populates="author")
    chat_logs = relationship("A2AChatLog", back_populates="user")
    recommendations = relationship("UserRecommendation", back_populates="user")


# ==========================================
# 2. 라운드 및 키워드 (Round & Keyword)
# ==========================================
class Round(Base):
    __tablename__ = "rounds"

    id = Column(Integer, primary_key=True, index=True)
    round_number = Column(Integer, unique=True, index=True)
    status = Column(Enum(RoundPhase), default=RoundPhase.TREND_SEARCH) 
    
    top_keywords = Column(Text, nullable=True) # JSON 문자열 예: '{"Cyberpunk": 0.5}'
    duration_days = Column(Integer, default=7) 
    
    start_time = Column(DateTime, default=datetime.utcnow)
    end_time = Column(DateTime, nullable=True)

    candidates = relationship("Candidate", back_populates="round")
    votes = relationship("VoteLog", back_populates="round")
    keywords = relationship("Keyword", back_populates="round")

class Keyword(Base):
    __tablename__ = "keywords"

    id = Column(Integer, primary_key=True, index=True)
    round_id = Column(Integer, ForeignKey("rounds.id"))
    word = Column(String(50), nullable=False)
    type = Column(String(20), default="theme")
    vote_count = Column(Integer, default=0)

    round = relationship("Round", back_populates="keywords")


# ==========================================
# 3. 후보작 및 투표 (Candidate & VoteLog)
# ==========================================
class Candidate(Base):
    __tablename__ = "candidates"

    id = Column(Integer, primary_key=True, index=True)
    round_id = Column(Integer, ForeignKey("rounds.id"))
    
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    image_url = Column(String(255), nullable=False)
    ipfs_hash = Column(String(255), nullable=False)
    
    vp_votes = Column(Integer, default=0)
    is_winner = Column(Boolean, default=False)
    auction_price = Column(Integer, nullable=True)

    round = relationship("Round", back_populates="candidates")
    votes = relationship("VoteLog", back_populates="candidate")

class VoteLog(Base):
    __tablename__ = "vote_logs"

    id = Column(Integer, primary_key=True, index=True)
    round_id = Column(Integer, ForeignKey("rounds.id"))
    candidate_id = Column(Integer, ForeignKey("candidates.id"))
    voter_wallet = Column(String(255), index=True)
    vp_used = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    round = relationship("Round", back_populates="votes")
    candidate = relationship("Candidate", back_populates="votes")


# ==========================================
# 4. 기타 기존 테이블들
# ==========================================
class GalleryItem(Base):
    __tablename__ = "gallery_items"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255))
    artist_address = Column(String(255))
    image_url = Column(Text)
    description = Column(Text)
    is_sold = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    feedbacks = relationship("GalleryFeedback", back_populates="item")

class GalleryFeedback(Base):
    __tablename__ = "gallery_feedbacks"
    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(Integer, ForeignKey("gallery_items.id"))
    wallet_address = Column(String(255), ForeignKey("users.wallet_address"))
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    item = relationship("GalleryItem", back_populates="feedbacks")
    author = relationship("User", back_populates="feedbacks")

class A2AChatLog(Base):
    __tablename__ = "a2a_chat_logs"
    id = Column(Integer, primary_key=True, index=True)
    wallet_address = Column(String(255), ForeignKey("users.wallet_address"))
    user_message = Column(Text, nullable=False)
    ai_reply = Column(Text, nullable=False)
    agent_type = Column(String(50), default="Curator") 
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    user = relationship("User", back_populates="chat_logs")

class UserRecommendation(Base):
    __tablename__ = "user_recommendations"
    id = Column(Integer, primary_key=True, index=True)
    wallet_address = Column(String(255), ForeignKey("users.wallet_address"))
    recommended_title = Column(String(255))
    reason = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    user = relationship("User", back_populates="recommendations")
