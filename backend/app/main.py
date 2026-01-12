from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from app import models, schemas, database
import time

# DB 테이블 생성
models.Base.metadata.create_all(bind=database.engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

get_db = database.get_db

# =====================================
# 1. 인증 & 안건 (기존 기능)
# =====================================
@app.post("/api/auth/wallet-login")
def wallet_login(req: schemas.WalletLoginRequest):
    return {"access_token": "mock_token", "token_type": "bearer"}

@app.get("/api/proposals", response_model=list[schemas.ProposalResponse])
def get_proposals(db: Session = Depends(get_db)):
    return db.query(models.ArtRequest).all()

@app.post("/api/proposals")
def create_proposal(req: schemas.ProposalCreate, db: Session = Depends(get_db)):
    new_p = models.ArtRequest(
        wallet_address=req.wallet_address,
        topic=req.topic,
        description=req.description,
        style=req.style,
        image_url=req.image_url,
        status="OPEN"
    )
    db.add(new_p)
    db.commit()
    db.refresh(new_p)
    return new_p

# =====================================
# 2. 🎨 AI 창작 스튜디오 (New!)
# =====================================
@app.post("/api/studio/draft", response_model=schemas.StudioDraftResponse)
def generate_draft(req: schemas.StudioDraftRequest):
    # TODO: Proposal Creation Agent 연결
    time.sleep(1) # AI 생각하는 척
    return {"draft_text": f"제목: {req.intent} 기반 전시\n\n기획 의도: 이 전시는 현대 사회의 이면을 {req.intent} 스타일로 표현하며..."}

@app.post("/api/studio/image", response_model=schemas.StudioImageResponse)
def generate_studio_image(req: schemas.StudioImageRequest):
    # TODO: Image Generation Agent 연결
    time.sleep(2) # 그림 그리는 척
    return {"image_url": "https://via.placeholder.com/300x300.png?text=AI+Generated+Art"}

@app.get("/api/studio/check")
def check_similarity(topic: str):
    # TODO: Similarity Check Agent (Vector DB)
    return {"similarity_score": 15, "message": "독창적인 아이디어입니다!"}

# =====================================
# 3. 🖼️ 온라인 전시관 & 도슨트 (New!)
# =====================================
@app.get("/api/gallery/items", response_model=list[schemas.GalleryItemResponse])
def get_gallery_items():
    # Mock Data
    return [
        {"id": 1, "title": "Digital Dreams", "artist_address": "0x123...abc", "image_url": "https://via.placeholder.com/400x300?text=Gallery+Item+1", "description": "꿈과 현실의 경계를 표현한 작품입니다."},
        {"id": 2, "title": "Cyber Punk City", "artist_address": "0x987...xyz", "image_url": "https://via.placeholder.com/400x300?text=Gallery+Item+2", "description": "2077년의 네온사인을 형상화했습니다."}
    ]

@app.post("/api/gallery/docent")
def get_docent_explanation(item_id: int):
    # TODO: Docent Agent
    return {"audio_url": "mock_audio.mp3", "text_script": "이 작품은 색채의 대비를 통해 감정을 극대화하고 있습니다..."}