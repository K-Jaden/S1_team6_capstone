from pydantic import BaseModel
from datetime import datetime

class ProposalCreate(BaseModel):
    wallet_address: str
    topic: str

class ProposalResponse(BaseModel):
    id: int
    wallet_address: str
    topic: str
    status: str
    image_url: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True