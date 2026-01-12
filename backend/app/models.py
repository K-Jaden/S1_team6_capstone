from sqlalchemy import Column, Integer, String, Text, DateTime, Float, Boolean, func
from .database import Base

# 1. 안건 (기존 + AI 창작 스튜디오 데이터 추가)
class ArtRequest(Base):
    __tablename__ = "art_requests"

    id = Column(Integer, primary_key=True, index=True)
    wallet_address = Column(String(255), nullable=False)
    
    # 기획서 내용
    topic = Column(String(255), nullable=False) # 제목/주제
    description = Column(Text, nullable=True)   # 기획 의도 (AI가 써준 초안)
    style = Column(String(50), default="General")
    
    # 결과물
    image_url = Column(Text, nullable=True)     # 포스터/시안 이미지
    metadata_uri = Column(String(255), nullable=True)
    
    # 블록체인 상태
    tx_hash = Column(String(255), nullable=True)
    status = Column(String(50), default="WAITING") # WAITING, VOTING, PASSED
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())

# 2. 온라인 전시관 작품 (New!)
class GalleryItem(Base):
    __tablename__ = "gallery_items"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255))
    artist_address = Column(String(255))
    image_url = Column(Text)
    description = Column(Text) # 도슨트 설명용 텍스트
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())