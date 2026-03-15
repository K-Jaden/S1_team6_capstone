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
import urllib.parse
import random
import os
import base64  # 👈 추가 확인



# AI 에이전트 서버 주소 (도커 서비스 이름 사용)
AI_AGENT_URL = "http://host.docker.internal:8002"

# DB 테이블 생성
models.Base.metadata.create_all(bind=database.engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    # allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_origins=["*"], # 개발 편의를 위해 모든 도메인 허용 (배포 시에는 꼭 수정!)
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
    # --- 🚀 [추가] 외래키 에러 방지를 위한 사용자 체크 로직 ---
    user = db.query(models.User).filter(models.User.wallet_address == req.wallet_address).first()
    if not user:
        print(f"🆕 미등록 사용자 발견! 자동 가입 처리: {req.wallet_address}")
        new_user = models.User(
            wallet_address=req.wallet_address,
            membership_grade="Bronze",
            token_balance=0.0
        )
        db.add(new_user)
        db.commit() # 부모 데이터를 먼저 확정지어야 합니다.
    new_p = models.ArtRequest(
        wallet_address=req.wallet_address,
        title=req.title,
        meta_hash=req.meta_hash,
        description=req.description,
        style=req.style,
        image_url=req.image_url,
        voteType=req.voteType,
        duration=req.duration,
        quorum=req.quorum,
        funding_amount=req.fundingAmount,
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

# ==========================================
# [수정] AI 큐레이터/도슨트 채팅 연결 API (422 에러 해결)
# ==========================================
# 프론트엔드가 보낼 데이터 규격 정의
class ChatRequest(BaseModel):
    message: str
    wallet_address: str = ""

@app.post("/api/a2a/chat")
def a2a_chat(request: ChatRequest): # 🚨 query parameter가 아니라 body로 받습니다!
    print(f"📡 [Backend] AI 협업 팀에게 질문 전달: {request.message}")
    
    try:
        # AI 에이전트 서버로 데이터 전송 (주소줄이 아니라 json 바디에 담아서 보냅니다!)
        payload = {
            "message": request.message,
            "wallet_address": request.wallet_address
        }
        
        response = requests.post(f"{AI_AGENT_URL}/chat", json=payload, timeout=60)
        
        if response.status_code == 200:
            result = response.json()
            return {"reply": result.get("reply", "답변을 가져오지 못했습니다.")}
        else:
            print(f"🔥 AI 서버 에러 ({response.status_code}): {response.text}")
            return {"reply": "AI 팀이 응답하지 않습니다. 잠시 후 다시 시도해주세요."}
            
    except Exception as e:
        print(f"🔥 통신 에러: {str(e)}")
        return {"reply": "AI 서버와 연결할 수 없습니다."}
    
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

# ==========================================
# [수정 1] 기획서 생성 (Draft) - A2A 병목 해제!
# ==========================================
@app.post("/api/studio/draft") # 🚨 response_model=... 부분을 꼭 지워주세요!
def create_draft(request: schemas.StudioDraftRequest):
    print(f"📡 [Backend] AI 난상토론 기획서 요청: {request.intent}")
    
    try:
        response = requests.post(
            f"{AI_AGENT_URL}/studio/a2a-full", 
            json={"intent": request.intent},
            timeout=120 
        )
        
        if response.status_code == 200:
            # 🚨 agent.py가 주는 모든 데이터(초안, 비평, 최종본)를 
            # 자르지 않고 프론트엔드로 '그대로' 패스합니다!
            return response.json() 
        else:
            print(f"🔥 AI 에러: {response.text}")
            return {"draft_text": "AI가 토론하다가 잠들었습니다. (에러 발생)"}
            
    except Exception as e:
        print(f"🔥 통신 에러: {str(e)}")
        return {"draft_text": "AI 에이전트와 연결할 수 없습니다."}
# ==========================================
# 1. 비평가 (Critic) 연결 (🚀 방금 추가한 코드)
# ==========================================
class CriticReviewRequest(BaseModel):
    art_info: str

@app.post("/api/agent/review")
def agent_review(req: CriticReviewRequest):
    print(f"📡 [Backend] 비평가 호출: {req.art_info}")
    try:
        # AI 컨테이너(8002)의 /review 엔드포인트 호출
        payload = {"art_info": req.art_info}
        resp = requests.post(f"{AI_AGENT_URL}/review", json=payload)
        
        if resp.status_code == 200:
            return resp.json() # {"review_text": "..."} 반환
        else:
            return {"review_text": "비평문 생성 실패"}
    except Exception as e:
        return {"review_text": "통신 오류 발생"}
    
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
# 이미지 생성 (Image) - Cloudflare FLUX 엑박 완벽 해결
# ==========================================
import os
import requests
import base64

@app.post("/api/studio/image", response_model=schemas.StudioImageResponse)
def create_art_image(request: schemas.StudioImageRequest):
    print(f"📡 [Backend] AI에게 그림 요청 (원본 키워드): {request.keywords}")
    
    CF_ACCOUNT_ID = os.getenv("CF_ACCOUNT_ID")
    CF_API_TOKEN = os.getenv("CF_API_TOKEN")

    if not CF_ACCOUNT_ID or not CF_API_TOKEN:
        print("🔥 Cloudflare API 키가 없습니다! .env 파일을 확인하세요.")
        return {"image_url": "https://dummyimage.com/600x400/ff0000/fff&text=CF+Key+Missing"}

    enhanced_english_prompt = "A masterpiece, highly detailed digital art of " + request.keywords

    # 1. 화가 에이전트에게 프롬프트 부탁 (A2A)
    try:
        print("🧠 [CrewAI] 화가 에이전트에게 완벽한 프롬프트 엔지니어링 의뢰 중...")
        payload = {"topic": request.keywords, "style": "Digital Art", "wallet_address": "0xSystem"}
        response = requests.post(f"{AI_AGENT_URL}/generate", json=payload, timeout=15)
        
        if response.status_code == 200:
            enhanced_english_prompt = response.json().get("final_prompt", enhanced_english_prompt)
            print(f"✨ [화가 프롬프트 완성] ➔ {enhanced_english_prompt[:50]}...")
    except Exception as e:
        print(f"⚠️ 화가 에이전트 에러, 원본 키워드 사용: {e}")

    # 2. Cloudflare FLUX 서버 호출
    try:
        print("📥 [Cloudflare FLUX] 고퀄리티 이미지 렌더링 중...")
        cf_url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell"
        
        headers = {
            "Authorization": f"Bearer {CF_API_TOKEN}",
            "Content-Type": "application/json"
        }
        
        data = {
            "prompt": enhanced_english_prompt[:1000] # 프롬프트 길이 제한
        }

        img_res = requests.post(cf_url, headers=headers, json=data, timeout=30)

        if img_res.status_code == 200:
            # 🚨 [핵심 수정] Cloudflare가 주는 JSON 껍데기를 벗겨서 진짜 이미지 데이터만 추출!
            content_type = img_res.headers.get("Content-Type", "")
            
            if "application/json" in content_type:
                res_json = img_res.json()
                if "result" in res_json and "image" in res_json["result"]:
                    b64_encoded = res_json["result"]["image"]
                    # 클라우드플레어는 이미 Base64 텍스트로 주기 때문에 한 번 더 인코딩할 필요 없음!
                    data_url = f"data:image/jpeg;base64,{b64_encoded}"
                    print("✅ Cloudflare FLUX 그림 생성 성공! (JSON 파싱 완벽)")
                    return {"image_url": data_url}
                else:
                    print(f"🔥 예상치 못한 JSON 구조: {res_json}")
                    return {"image_url": "https://dummyimage.com/600x400/ff0000/fff&text=CF+JSON+Structure+Error"}
            else:
                # 만약 정말로 바이너리를 줬을 경우를 대비한 안전 장치
                image_bytes = img_res.content
                b64_encoded = base64.b64encode(image_bytes).decode('utf-8')
                data_url = f"data:image/jpeg;base64,{b64_encoded}"
                print("✅ Cloudflare FLUX 그림 생성 성공! (바이너리 인코딩 완벽)")
                return {"image_url": data_url}
        else:
            print(f"🔥 Cloudflare API 에러: {img_res.status_code} - {img_res.text}")
            return {"image_url": "https://dummyimage.com/600x400/ff0000/fff&text=CF+API+Error"}
            
    except Exception as e:
        print(f"🔥 이미지 서버 통신 실패: {str(e)}")
        return {"image_url": "https://dummyimage.com/600x400/000000/fff&text=Connection+Failed"}
    
# ==========================================
# 2. IPFS 영구 저장 (오직 그림 파일만 가볍게 업로드!)
# ==========================================
class FinalizeProposalRequest(BaseModel):
    image_url: str = ""
    wallet_address: str = ""
    title: str = ""
    description: str = ""
    prompt: str = ""

@app.post("/api/ipfs/finalize")
def finalize_proposal_ipfs(req: FinalizeProposalRequest):
    print(f"🚀 [최종 제출] 메모리 그림 데이터 -> IPFS 영구 저장 시작 (안건: {req.title})")
    try:
        import base64
        
        # 1. Base64 형태의 이미지가 제대로 왔는지 확인
        if not req.image_url or not req.image_url.startswith("data:image"):
            return {"error": "Invalid image data"}
            
        print("📥 프론트엔드 이미지를 복원하여 IPFS에 업로드 중...")
        header, encoded = req.image_url.split(",", 1)
        image_bytes = base64.b64decode(encoded)
        
        # 🚨 여기서 ipfs.py의 이미지 업로드 함수만 호출합니다!
        image_cid = upload_bytes_to_ipfs(image_bytes)
        
        if not image_cid:
            return {"error": "Image Upload Failed"}
            
        image_ipfs_url = f"ipfs://{image_cid}"
        print(f"✅ 그림 IPFS 업로드 완료! CID: {image_cid}")
        
        # 🚨 메타데이터(JSON) 업로드 로직은 삭제! 스마트 컨트랙트에는 그림 주소만 들어갑니다.
        
        return {
            "status": "success",
            "image_ipfs_url": f"https://gateway.pinata.cloud/ipfs/{image_cid}", # 브라우저 표시용
            "token_uri": image_ipfs_url # 스마트 컨트랙트에 들어갈 최종 그림 주소
        }
    except Exception as e:
        print(f"🔥 IPFS 파이썬 에러: {str(e)}")
        return {"error": str(e)}
    
    
# =======================================================================
# 사용자 목록을 불러오는 GET 요청과 위임 처리를 위한 POST 요청 추가(Lim)
# =======================================================================

# 1. 위임 가능한 전체 사용자 목록 조회
@app.get("/api/user/list", response_model=List[schemas.UserListResponse])
def get_user_list(db: Session = Depends(get_db)):
    users = db.query(models.User).all()
    # 실제 활동 점수는 각 테이블에서 count()를 해야 하지만, 
    # 일단은 전체 목록을 반환하는 기본 로직으로 작성합니다.
    result = []
    for user in users:
        activity_count = db.query(models.ArtRequest).filter(models.ArtRequest.wallet_address == user.wallet_address).count()
        result.append({
            "wallet_address": user.wallet_address,
            "membership_grade": user.membership_grade,
            "token_balance": user.token_balance,
            "badge": user.badge,
            "activity_count": activity_count
        })
    return result

# 2. 위임 정보 DB 업데이트 (블록체인 성공 후 호출용)
@app.post("/api/dao/delegate")
def update_delegation_db(req: schemas.DelegateRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.wallet_address == req.from_address).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.is_delegated = True
    user.delegated_to = req.to_address
    db.commit()
    return {"status": "success", "message": f"Delegated to {req.to_address}"}
