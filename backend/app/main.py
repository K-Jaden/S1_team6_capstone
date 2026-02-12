from fastapi import FastAPI, Depends, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app import models, schemas, database
from typing import List, Optional
import time
import requests
import json
import urllib.parse # ✅ URL 인코딩을 위해 추가 필요
import random
from .ipfs import upload_bytes_to_ipfs, upload_json_to_ipfs # 👈 추가
from pydantic import BaseModel # 👈 이것도 없으면 추가


# AI 에이전트 서버 주소 (도커 서비스 이름 사용)
AI_AGENT_URL = "http://127.0.0.1:8002"


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

@app.post("/api/auth/logout")
def logout(wallet_address: str):
    # 실제 세션/쿠키 방식이라면 response.delete_cookie("session_id") 등이 들어갑니다.
    # 현재는 stateless 방식이므로 로그만 남기거나 성공 메시지만 반환합니다.
    print(f"[Logout] Wallet: {wallet_address}") 
    return {"status": "success", "message": "Logged out successfully"}

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

# ==========================================
# [추가] 도슨트 기능 (작품 설명 생성)
# ==========================================
@app.post("/api/gallery/docent")
def generate_docent_script(item_id: int = 0):
    print(f"📡 [Backend] 도슨트 요청 (ID: {item_id})")
    
    # 1. DB에서 작품 찾기 (없으면 임시 데이터 사용)
    # (실제로는 DB에서 조회해야 하지만, 여기선 예시로 처리)
    art_info = "신비로운 사이버펑크 도시의 밤 풍경" # 기본값
    
    # 2. AI 에이전트(도슨트)에게 대본 요청
    try:
        payload = {
            "art_info": art_info,
            "audience_type": "일반 관람객"
        }
        # agent.py의 /docent 엔드포인트 호출
        response = requests.post(f"{AI_AGENT_URL}/docent", json=payload, timeout=10)
        
        if response.status_code == 200:
            script = response.json().get("commentary", "작품 설명을 불러오지 못했습니다.")
            return {"text_script": script}
        else:
            return {"text_script": "AI 도슨트가 현재 바쁩니다."}
            
    except Exception as e:
        print(f"🔥 도슨트 에러: {str(e)}")
        return {"text_script": "잠시 후 다시 시도해주세요."}


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
# ==========================================
# [수정 3] 채팅/피드백 (A2A) - 비평가 연결
# ==========================================
@app.post("/api/a2a/chat", response_model=schemas.A2AChatResponse)
def chat_with_curator(message: str, wallet_address: str):
    print(f"📡 [Backend] AI에게 질문: {message}")
    
    try:
        # 1. AI 요원(비평가/챗봇)에게 전화 걸기 (POST /review 사용)
        # agent.py에 채팅 전용(/chat)이 없으므로 비평가(/review)를 대리인으로 씀
        response = requests.post(
            f"{AI_AGENT_URL}/review", 
            json={"art_info": message}
        )
        
        if response.status_code == 200:
            result = response.json()
            return {"reply": result.get("review_text", "답변을 생성하지 못했습니다.")}
        else:
            return {"reply": "AI 큐레이터가 지금 바쁩니다. (에러)"}
            
    except Exception as e:
        return {"reply": "AI 서버와 연결이 끊겼습니다."}

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
# ==========================================
# [수정 1] 기획서 생성 (Draft) - 진짜 AI 연결
# ==========================================
@app.post("/api/studio/draft", response_model=schemas.StudioDraftResponse)
def create_draft(request: schemas.StudioDraftRequest):
    print(f"📡 [Backend] AI에게 기획서 요청: {request.intent}")
    
    try:
        # 1. AI 요원(기획자)에게 전화 걸기 (POST /propose)
        response = requests.post(
            f"{AI_AGENT_URL}/propose", 
            json={"intent": request.intent}
        )
        
        # 2. 응답 확인
        if response.status_code == 200:
            result = response.json()
            # agent.py가 주는 키("draft_text")를 그대로 프론트로 전달
            return {"draft_text": result.get("draft_text", "내용 없음")}
        else:
            print(f"🔥 AI 에러: {response.text}")
            return {"draft_text": "AI가 기획하다가 잠들었습니다. (에러 발생)"}
            
    except Exception as e:
        print(f"🔥 통신 에러: {str(e)}")
        return {"draft_text": "AI 에이전트와 연결할 수 없습니다."}


# ==========================================
# [수정] 이미지 생성 (Image) - 텍스트를 받아서 그림 URL로 변환
# ==========================================
@app.post("/api/studio/image", response_model=schemas.StudioImageResponse)
def create_art_image(request: schemas.StudioImageRequest):
    print(f"📡 [Backend] AI에게 그림 요청: {request.keywords}")
    
    try:
        # 1. AI 요원(화가)에게 "그림 묘사 프롬프트" 부탁하기
        payload = {
            "topic": request.keywords,
            "style": "Digital Art", 
            "wallet_address": "0xSystem"
        }
        
        response = requests.post(f"{AI_AGENT_URL}/generate", json=payload)
        
        if response.status_code == 200:
            result = response.json()
            # AI가 만든 영어 프롬프트 가져오기
            final_prompt = result.get("final_prompt", "Abstract Art")
            
            print(f"🎨 [Backend] 생성된 프롬프트: {final_prompt[:30]}...")

            # 2. [핵심] 프롬프트를 가지고 실제 이미지 URL 만들기 (Pollinations AI 사용 - 무료/키 없음)
            # URL에 특수문자가 들어가면 안되니까 인코딩 처리
            encoded_prompt = urllib.parse.quote(final_prompt)
            seed = random.randint(1, 99999)
            timestamp = int(time.time()) # ✅ 현재 시간 (매번 바뀜)

            
            # 실제 이미지가 나오는 마법의 링크
            real_image_url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?seed={seed}&width=1024&height=768&nologo=true&model=flux"
            
            return {"image_url": real_image_url}
        else:
            print("🔥 AI 에이전트 응답 실패")
            return {"image_url": "https://via.placeholder.com/600x400?text=AI+Error"}
            
    except Exception as e:
        print(f"🔥 통신 에러: {str(e)}")
        return {"image_url": "https://via.placeholder.com/600x400?text=Connection+Failed"}

# 2. 마케터 (Marketer) 연결
@app.post("/api/agent/promote", response_model=schemas.AgentPromoteResponse)
def agent_promote(req: schemas.AgentPromoteRequest):
    print(f"📡 [Backend] 마케터 호출: {req.exhibition_title}")
    try:
        # AI 컨테이너(8002)의 /promote 엔드포인트 호출
        payload = {
            "exhibition_title": req.exhibition_title, 
            "target_audience": req.target_audience
        }
        resp = requests.post(f"{AI_AGENT_URL}/promote", json=payload)
        
        if resp.status_code == 200:
            return resp.json() # {"promo_text": "..."} 반환
        else:
            return {"promo_text": "마케팅 문구 생성 실패"}
    except Exception as e:
        return {"promo_text": "통신 오류 발생"}

# 3. 경매사 (Auctioneer) 연결
@app.post("/api/agent/auction", response_model=schemas.AgentAuctionResponse)
def agent_auction(req: schemas.AgentAuctionRequest):
    print(f"📡 [Backend] 경매사 호출")
    try:
        # AI 컨테이너(8002)의 /auction 엔드포인트 호출
        payload = {
            "art_info": req.art_info,
            "critic_review": req.critic_review
        }
        resp = requests.post(f"{AI_AGENT_URL}/auction", json=payload)
        
        if resp.status_code == 200:
            return resp.json() # {"auction_report": "..."} 반환
        else:
            return {"auction_report": "경매 리포트 생성 실패"}
    except Exception as e:
        return {"auction_report": "통신 오류 발생"}
    
    # ==========================================
# [추가] 하이브리드 이미지 생성 (IPFS + DB)
# ==========================================

# 1. 데이터를 받을 그릇(Schema) 만들기
class HybridArtRequest(BaseModel):
    prompt: str
    wallet_address: str

# 2. API 함수 (라우터 대신 app 사용)
@app.post("/api/studio/generate_hybrid")
async def generate_hybrid_art(req: HybridArtRequest):
    print(f"🎨 [1] AI에게 그림 요청: {req.prompt}")
    
    try:
        # 1. AI 에이전트에게 "영어 프롬프트" 요청 (URL 아님!)
        ai_payload = {
            "topic": req.prompt,
            "style": "Cyberpunk",
            "wallet_address": req.wallet_address
        }
        
        ai_res = requests.post(f"{AI_AGENT_URL}/generate", json=ai_payload)
        
        if ai_res.status_code != 200: 
            print(f"🔥 AI 서버 에러! (상태코드: {ai_res.status_code})")
            return {"error": f"AI Error: {ai_res.text}"}
        
        # 2. AI가 준 "영어 설명(final_prompt)" 가져오기
        # (여기서 .get("url")이 아니라 .get("final_prompt")를 써야 함!)
        final_prompt = ai_res.json().get("final_prompt", "Abstract Art")
        print(f"📝 AI가 만든 프롬프트: {final_prompt[:30]}...")
        
        # 3. Pollinations AI를 사용해 진짜 이미지 URL 만들기
        # (URL 인코딩 및 랜덤 시드 적용)
        encoded_prompt = urllib.parse.quote(final_prompt)
        seed = random.randint(1, 99999)
        temp_url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?seed={seed}&width=1024&height=768&nologo=true&model=flux"
        
        print(f"📥 [2] 이미지 다운로드 주소 생성: {temp_url}")
        
        # 4. 백엔드가 이미지를 다운로드 (메모리에 저장)
        img_res = requests.get(temp_url)
        if img_res.status_code != 200: return {"error": "Download Failed"}
        image_bytes = img_res.content

        # 5. 이미지를 IPFS에 업로드
        print("🚀 [3] 이미지 -> IPFS 업로드 중...")
        image_cid = upload_bytes_to_ipfs(image_bytes)
        if not image_cid: return {"error": "Image Upload Failed"}
        
        image_ipfs_url = f"https://gateway.pinata.cloud/ipfs/{image_cid}"

        # 6. 메타데이터(JSON) 생성
        metadata = {
            "name": f"ArtDAO: {req.prompt}",
            "description": f"Created by ArtDAO AI.\nPrompt: {final_prompt}",
            "image": f"ipfs://{image_cid}", 
            "external_url": image_ipfs_url,
            "attributes": [
                {"trait_type": "Creator", "value": req.wallet_address},
                {"trait_type": "Date", "value": str(time.time())}
            ]
        }

        # 7. 메타데이터를 IPFS에 업로드
        print("📝 [4] 메타데이터 -> IPFS 업로드 중...")
        meta_cid = upload_json_to_ipfs(metadata)
        
        if not meta_cid: return {"error": "Metadata Upload Failed"}

        print(f"✅ [완료] Image CID: {image_cid} / Meta CID: {meta_cid}")

        return {
            "status": "success",
            "image_url": image_ipfs_url,
            "meta_cid": meta_cid,
            "image_cid": image_cid
        }
        
    except Exception as e:
        print(f"🔥 에러 발생: {str(e)}")
        return {"error": str(e)}