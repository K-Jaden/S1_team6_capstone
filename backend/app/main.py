from fastapi import FastAPI, Depends, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from app import models, schemas, database
from typing import List, Optional
import time

# DB 테이블 생성 (이제 User, Feedback 테이블도 생성됨)
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

# =========================================================
# 1. 🔑 인증 & 유저 관리 (DB 연동)
# =========================================================
@app.post("/api/auth/wallet-login")
def wallet_login(req: schemas.WalletLoginRequest, db: Session = Depends(get_db)):
    # 1. 유저가 DB에 있는지 확인
    user = db.query(models.User).filter(models.User.wallet_address == req.wallet_address).first()
    
    # 2. 없으면 회원가입(자동 생성)
    if not user:
        user = models.User(wallet_address=req.wallet_address, token_balance=100.0) # 가입 보너스
        db.add(user)
        db.commit()
        db.refresh(user)
        print(f"새 유저 생성: {req.wallet_address}")
    
    return {"status": "success", "wallet_address": user.wallet_address}

# =========================================================
# 2. 👤 마이 페이지 (진짜 DB 데이터 조회)
# =========================================================
def get_user_or_404(wallet_address: str, db: Session):
    user = db.query(models.User).filter(models.User.wallet_address == wallet_address).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@app.get("/api/user/membership")
def get_membership(wallet_address: str, db: Session = Depends(get_db)):
    user = get_user_or_404(wallet_address, db)
    return {"grade": user.membership_grade}

@app.get("/api/wallet/balance")
def get_token_balance(wallet_address: str, db: Session = Depends(get_db)):
    user = get_user_or_404(wallet_address, db)
    return {"balance": user.token_balance}

@app.get("/api/wallet/rewards")
def get_pending_rewards(wallet_address: str, db: Session = Depends(get_db)):
    user = get_user_or_404(wallet_address, db)
    return {"pending_amount": user.pending_rewards}

@app.get("/api/dao/delegation")
def get_delegation_status(wallet_address: str, db: Session = Depends(get_db)):
    user = get_user_or_404(wallet_address, db)
    return {"delegated_to": user.delegated_to, "amount": 0} # 위임량 로직은 추후 구현

# 활동 내역은 아직 DB에 로그 테이블이 없어서 Mock 유지 (복잡도 때문)
@app.get("/api/user/activity")
def get_user_activity(wallet_address: str):
    return [{"type": "login", "date": "2025-01-01"}, {"type": "vote", "date": "2025-01-10"}]

@app.get("/api/user/referral")
def get_referral_stats(wallet_address: str):
    return {"invite_count": 0, "reward": 0}

@app.get("/api/user/proposals")
def get_my_proposals(wallet_address: str, db: Session = Depends(get_db)):
    return db.query(models.ArtRequest).filter(models.ArtRequest.wallet_address == wallet_address).all()

# =========================================================
# 3. 🖼️ 온라인 전시관 & 관람평 (DB 연동)
# =========================================================
@app.get("/api/gallery/items", response_model=List[schemas.GalleryItemResponse])
def get_gallery_items(db: Session = Depends(get_db)):
    return db.query(models.GalleryItem).all()

@app.post("/api/gallery/feedback")
def create_feedback(item_id: int, content: str, wallet_address: str, db: Session = Depends(get_db)):
    # 방명록 저장
    feedback = models.GalleryFeedback(
        item_id=item_id, 
        content=content, 
        wallet_address=wallet_address
    )
    db.add(feedback)
    db.commit()
    return {"status": "feedback_saved"}

@app.post("/api/gallery/docent")
def get_docent_explanation(item_id: int):
    # TODO: AI 연동
    return {"audio_url": "mock.mp3", "text_script": "이 작품은 작가의 고뇌가 담겨있으며..."}

# =========================================================
# 4. 안건 및 AI 스튜디오 (기존 동일)
# =========================================================
@app.get("/api/proposals", response_model=List[schemas.ProposalResponse])
def get_proposals(status: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(models.ArtRequest)
    if status:
        query = query.filter(models.ArtRequest.status == status)
    return query.all()

@app.post("/api/proposals")
def create_proposal(req: schemas.ProposalCreate, db: Session = Depends(get_db)):
    new_p = models.ArtRequest(**req.dict(), status="OPEN")
    db.add(new_p)
    db.commit()
    return new_p

@app.post("/api/studio/draft")
def generate_draft(req: schemas.StudioDraftRequest):
    time.sleep(1)
    return {"draft_text": f"AI 기획서: {req.intent}에 대한 내용..."}

@app.post("/api/studio/image")
def generate_studio_image(req: schemas.StudioImageRequest):
    time.sleep(2)
    return {"image_url": "https://via.placeholder.com/500x500"}

@app.get("/api/studio/check")
def check_similarity(topic: str):
    return {"similarity_score": 10, "message": "통과"}

@app.post("/api/a2a/chat")
def a2a_chat(message: str, wallet_address: str):
    return {"reply": f"AI: '{message}'에 대해 말씀드리자면..."}