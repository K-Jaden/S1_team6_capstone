from fastapi import FastAPI, Depends, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app import models, schemas, database
from typing import List, Optional
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

# =========================================================
# 1. 🔑 인증 & 유저 관리 (DB 연동)
# =========================================================
@app.post("/api/auth/wallet-login")
def wallet_login(req: schemas.WalletLoginRequest, db: Session = Depends(get_db)):
    # 1. 유저 확인
    user = db.query(models.User).filter(models.User.wallet_address == req.wallet_address).first()
    
    # 2. 없으면 자동 가입
    if not user:
        user = models.User(wallet_address=req.wallet_address, token_balance=100.0)
        db.add(user)
        db.commit()
        db.refresh(user)
    
    return {"status": "success", "wallet_address": user.wallet_address}

# 유저 조회 헬퍼 함수
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
    return {"delegated_to": user.delegated_to, "amount": 0}

@app.get("/api/user/activity")
def get_user_activity(wallet_address: str):
    return [{"type": "login", "date": "2025-01-01"}, {"type": "vote", "date": "2025-01-10"}]

@app.get("/api/user/referral")
def get_referral_stats(wallet_address: str):
    return {"invite_count": 0, "reward": 0}

@app.get("/api/user/proposals")
def get_my_proposals(wallet_address: str, db: Session = Depends(get_db)):
    return db.query(models.ArtRequest).filter(models.ArtRequest.wallet_address == wallet_address).all()

# [복구] 마이페이지 개인별 전시 추천 (명세서: GET /api/user/recommend)
@app.get("/api/user/recommend", response_model=schemas.RecommendationResponse)
def get_user_recommendation(wallet_address: str, db: Session = Depends(get_db)):
    return {
        "title": "디지털 르네상스: 비트코인과 예술",
        "reason": "회원님의 최근 활동(사이버펑크 선호)을 분석하여 추천된 전시입니다."
    }

# [복구] 큐레이터 뱃지 관리 (명세서: PATCH /api/user/badge)
@app.patch("/api/user/badge")
def update_user_badge(wallet_address: str, db: Session = Depends(get_db)):
    user = get_user_or_404(wallet_address, db)
    user.badge = "Certified Curator" # 예시 로직
    db.commit()
    return {"status": "updated", "badge": "Certified Curator"}


# =========================================================
# 2. 🖼️ 온라인 전시관 & 관람평
# =========================================================
@app.get("/api/gallery/items", response_model=List[schemas.GalleryItemResponse])
def get_gallery_items(db: Session = Depends(get_db)):
    return db.query(models.GalleryItem).all()

@app.post("/api/gallery/feedback")
def create_feedback(item_id: int, content: str, wallet_address: str, db: Session = Depends(get_db)):
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
    # Agent: Docent Agent
    return {"audio_url": "mock.mp3", "text_script": f"작품 {item_id}번에 대한 AI 도슨트 해설입니다..."}


# =========================================================
# 3. 안건 (Proposals)
# =========================================================
@app.get("/api/proposals", response_model=List[schemas.ProposalResponse], summary="안건 목록 조회")
def get_proposals(
    status: Optional[str] = Query(None),
    sort: Optional[str] = Query("latest"),
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db)
):
    query = db.query(models.ArtRequest)
    if status:
        query = query.filter(models.ArtRequest.status == status)
    
    if sort == "latest":
        query = query.order_by(models.ArtRequest.created_at.desc())
    elif sort == "oldest":
        query = query.order_by(models.ArtRequest.created_at.asc())
    
    offset = (page - 1) * limit
    return query.offset(offset).limit(limit).all()

# [안건 DB 저장]
@app.post("/api/proposals", summary="안건 생성(DB저장)")
def create_proposal(req: schemas.ProposalCreate, db: Session = Depends(get_db)):
    new_p = models.ArtRequest(
        wallet_address=req.wallet_address,
        title=req.title,
        meta_hash=req.meta_hash,
        description=req.description,
        style=req.style,
        image_url=req.image_url,
        status="OPEN"
    )
    db.add(new_p)
    db.commit()
    db.refresh(new_p)
    return new_p

@app.patch("/api/proposals/{proposal_id}")
def update_proposal(proposal_id: int, req: schemas.ProposalUpdate, db: Session = Depends(get_db)):
    proposal = db.query(models.ArtRequest).filter(models.ArtRequest.id == proposal_id).first()
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found")
    
    if req.title: proposal.title = req.title
    if req.description: proposal.description = req.description
    if req.meta_hash: proposal.meta_hash = req.meta_hash
    if req.image_url: proposal.image_url = req.image_url
    
    db.commit()
    return {"status": "updated", "id": proposal_id}

@app.delete("/api/proposals/{proposal_id}")
def delete_proposal(proposal_id: int, db: Session = Depends(get_db)):
    proposal = db.query(models.ArtRequest).filter(models.ArtRequest.id == proposal_id).first()
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found")
    
    db.delete(proposal)
    db.commit()
    return {"status": "deleted", "id": proposal_id}


# =========================================================
# 4. AI 에이전트 & 스튜디오 (A2A 기능)
# =========================================================

# [명세서 추가 요청 1] 미술품 추천 및 질의응답 (A2A Chat)
@app.post("/api/a2a/chat")
def a2a_chat(message: str, wallet_address: str):
    # Agent: Agent Orchestrator (Feedback, Inquiry Agent)
    return {"reply": f"AI 큐레이터: '{message}'에 대해 답변해 드릴게요. 이 작품은..."}

# [명세서 추가 요청 2] 사용자 맞춤 작품 매칭 (A2A Recommend)
@app.get("/api/a2a/recommend", summary="사용자 맞춤 작품 매칭")
def a2a_recommend(wallet_address: str):
    # Agent: Member Info Agent + Exhibition Item Agent
    # AI가 유저 성향을 분석해 추천 리스트 반환
    return [
        {"id": 1, "title": "추천 작품: 사이버펑크 서울", "reason": "회원님의 'Cyberpunk' 선호도 90% 일치"},
        {"id": 2, "title": "추천 작품: 네온의 밤", "reason": "최근 관람한 작품과 유사"}
    ]

# [명세서 추가 요청 3] 전시 기획 제안 (Proposal Creation Agent)
# 명세서의 POST /api/proposal/create 구현
@app.post("/api/proposal/create", summary="(선택) 전시 기획 제안 (AI Agent)")
def propose_exhibition_agent(intent: str):
    # Agent: Proposal Creation Agent
    # 사용자의 의도(intent)를 받아 AI가 기획서를 써주는 기능 (studio/draft와 유사)
    time.sleep(1)
    return {
        "proposal_text": f"AI가 제안하는 기획서:\n주제: {intent}\n\n[기획 의도]\n관람객에게 새로운 경험을...",
        "suggested_title": f"{intent} - 미지의 세계"
    }

# (기존 스튜디오 기능 유지)
@app.post("/api/studio/draft")
def generate_draft(req: schemas.StudioDraftRequest):
    time.sleep(1)
    return {"draft_text": f"AI 기획서 초안: {req.intent}..."}

@app.post("/api/studio/image")
def generate_studio_image(req: schemas.StudioImageRequest):
    time.sleep(2)
    return {"image_url": "https://via.placeholder.com/500x500"}

@app.get("/api/studio/check")
def check_similarity(topic: str):
    return {"similarity_score": 10, "message": "통과"}