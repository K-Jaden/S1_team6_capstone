from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from app.database import Base

class ArtRequest(Base):
    __tablename__ = "art_requests"

    id = Column(Integer, primary_key=True, index=True)
    wallet_address = Column(String(255), nullable=False)
    topic = Column(String(255), nullable=False)
    status = Column(String(50), default="WAITING")
    
    image_url = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())