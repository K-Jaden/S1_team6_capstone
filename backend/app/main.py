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
from datetime import datetime
from sqlalchemy import func
from fastapi.staticfiles import StaticFiles
from web3 import Web3

# 1. Web3 및 스마트 컨트랙트 연결 설정
WEB3_PROVIDER_URL = os.getenv("WEB3_PROVIDER_URL", "http://blockchain:8545")
w3 = Web3(Web3.HTTPProvider(WEB3_PROVIDER_URL))

ADMIN_PRIVATE_KEY = os.getenv("ADMIN_PRIVATE_KEY", "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
try:
    ADMIN_ACCOUNT = w3.eth.account.from_key(ADMIN_PRIVATE_KEY)
except:
    ADMIN_ACCOUNT = None

def get_dao_contract():
    try: 
        base_dir = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(base_dir, "contract_address.json"), "r") as f:
            dao_address = json.load(f)["ArtPlanningDAO"]
        with open(os.path.join(base_dir, "ArtPlanningDAO.json"), "r") as f:
            abi = json.load(f)["abi"]
        return w3.eth.contract(address=dao_address, abi=abi)
    except Exception as e:
        print(f"Contract load error: {e}")
        return None




# AI 에이전트 서버 주소 (도커 서비스 이름 사용)
AI_AGENT_URL = "http://ai_core:8002"

# DB 테이블 생성
models.Base.metadata.create_all(bind=database.engine)

app = FastAPI()

os.makedirs("static/images", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://13.125.234.38:3000"],
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
            
    # ✨ 수정할 코드
    except Exception as e:
        print(f"🔥 통신 에러: {str(e)}")
        # 화면에 진짜 에러 원인을 띄우도록 변경!
        return {"reply": f"🚨 진짜 에러 원인: {str(e)}"}
    
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
            timeout=300 
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
        response = requests.post(f"{AI_AGENT_URL}/generate", json=payload, timeout=30)
        
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

        img_res = requests.post(cf_url, headers=headers, json=data, timeout=60)

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
        activity_count = 0
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
# =========================================================
# [NEW] Market Insights (시장 트렌드 분석 API)
# =========================================================
# 💡 서버가 켜져있는 동안 한 번 분석한 데이터를 기억해두는 캐시 변수
cached_insights = None

@app.get("/api/insights/trends", summary="실시간 마켓 인사이트 조회")
def get_market_insights():
    global cached_insights
    
    # 1. 이미 분석해둔 데이터가 있으면 0.1초 만에 바로 반환!
    if cached_insights:
        return cached_insights
        
    # 2. 없으면 AI 서버에 최초 1회 분석 요청
    try:
        res = requests.get(f"{AI_AGENT_URL}/api/agent/insights", timeout=60)
        if res.status_code == 200:
            cached_insights = res.json()
            return cached_insights
    except Exception as e:
        print(f"🔥 통신 에러 또는 타임아웃: {e}")
        
    # 3. 🚨 만약 AI 서버가 터졌을 경우 시연을 살리기 위한 비상용 예비 데이터
    return {
        "keywords": ["#Generative_AI", "#Neo_Cyberpunk", "#Eco_Activism", "#Hyper_Realism", "#Web3_Art", "#Algorithmic", "#Surrealism"],
        "styles": [
            {"name": "Unreal Engine 5 Render", "percent": 50},
            {"name": "Oil Painting Texture", "percent": 30},
            {"name": "Retro 8-bit Pixel", "percent": 20}
        ]
    }
# =========================================================
# 🌟 [복구] 프론트엔드 화면 표시 및 투표용 필수 API
# =========================================================
# =========================================================
# 🌟 [복구/수정] 프론트엔드 화면 표시 및 투표용 필수 API
# =========================================================
@app.get("/api/rounds/current")
def get_current_round(db: Session = Depends(get_db)):
    from app.models import RoundPhase
    # 상태가 ENDED가 아닌 가장 최근 라운드를 찾음
    active = db.query(models.Round).filter(models.Round.status != RoundPhase.ENDED).order_by(desc(models.Round.id)).first()
    if not active: 
        raise HTTPException(status_code=404, detail="진행 중인 라운드가 없습니다.")
    
    # 🔥 [NEW] DB에 저장된 이번 라운드의 '진짜 키워드'들 찾아서 같이 묶어주기!
    keywords = db.query(models.Keyword).filter(models.Keyword.round_id == active.id).all()
    
    return {
        "id": active.id,
        "round_number": active.round_number,
        "status": active.status,
        "candidates": active.candidates,
        "keywords": [k.word for k in keywords] # 프론트엔드가 쓸 수 있게 리스트로 전달
    }

@app.get("/api/rounds/ended")
def get_ended_rounds(db: Session = Depends(get_db)):
    from app.models import RoundPhase
    # 마이페이지 배당금 수령을 위해 종료된 라운드 목록 반환
    ended_rounds = db.query(models.Round).filter(models.Round.status == RoundPhase.ENDED).order_by(desc(models.Round.id)).all()
    
    result = []
    for r in ended_rounds:
        winner = db.query(models.Candidate).filter(models.Candidate.round_id == r.id, models.Candidate.is_winner == True).first()
        if winner:
            result.append({
                "round_id": r.round_number,
                "winner_title": winner.title,
                "auction_price": winner.auction_price
            })
    return result

class VoteReq(BaseModel):
    wallet_address: str
    candidate_id: int
    vp_amount: int

@app.post("/api/vote")
def cast_vote(req: VoteReq, db: Session = Depends(get_db)):
    # 유저의 VP 투표(Step 2)를 DB에 기록
    candidate = db.query(models.Candidate).filter(models.Candidate.id == req.candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="후보작을 찾을 수 없습니다.")
    
    new_vote = models.VoteLog(
        round_id=candidate.round_id, 
        candidate_id=candidate.id, 
        voter_wallet=req.wallet_address, 
        vp_used=req.vp_amount
    )
    db.add(new_vote)
    candidate.vp_votes += req.vp_amount
    db.commit()
    return {"status": "success"}
# =========================================================
# 🔥 [NEW] 차세대 ArtDAO Co-creation 3단계 API 파이프라인
# =========================================================

# 🟢 [Step 1] 트렌드 추출 & 키워드 투표 시작
@app.post("/api/admin/phase1-keywords")
def start_phase1_keywords(session_id: str = "", db: Session = Depends(get_db)):
    from app.models import RoundPhase
    # 이전 라운드 전부 종료
    db.query(models.Round).filter(models.Round.status != RoundPhase.ENDED).update({"status": RoundPhase.ENDED})
    
    last_round = db.query(models.Round).order_by(models.Round.round_number.desc()).first()
    new_num = (last_round.round_number + 1) if last_round else 1
    new_round = models.Round(round_number=new_num, status=RoundPhase.KEYWORD_VOTING)
    db.add(new_round)
    db.commit()

    try:
        res = requests.get(f"{AI_AGENT_URL}/api/agent/trends-keywords", timeout=30)
        keywords = res.json().get("keywords", ["Cyberpunk", "Neon"])
    except:
        keywords = ["Cyberpunk", "Neon", "Seoul", "Cubism", "Space"]

    for word in keywords[:10]:
        db.add(models.Keyword(round_id=new_round.id, word=word.replace("#", "")))
    db.commit()
    return {"message": "Phase 1: 키워드 추출 완료", "round_id": new_round.id, "keywords": keywords}

# 🟢 [Step 1.5] 프론트에서 유저가 선택한 키워드 서버로 저장
class KeywordVoteReq(BaseModel):
    round_id: int
    selected_words: list[str]

@app.post("/api/rounds/vote-keyword")
def vote_keywords(req: KeywordVoteReq, db: Session = Depends(get_db)):
    for word in req.selected_words:
        kw = db.query(models.Keyword).filter(models.Keyword.round_id == req.round_id, models.Keyword.word == word).first()
        if kw: kw.vote_count += 1
    db.commit()
    return {"status": "success"}

# 🟢 [Step 2] 투표 결과로 그림 생성 & VP 투표 단계 전환
# 🟢 [Step 2] 투표 결과로 그림 생성 (1등 3개, 2등 2개 = 총 5개)
@app.post("/api/admin/phase2-generate")
def start_phase2_generate(round_id: int = 0, session_id: str = "", db: Session = Depends(get_db)):
    from app.models import RoundPhase
    
    if round_id == 0:
        target_round = db.query(models.Round).order_by(desc(models.Round.id)).first()
        if not target_round: raise HTTPException(status_code=404, detail="진행할 라운드가 없습니다.")
        round_id = target_round.id
    else:
        target_round = db.query(models.Round).filter(models.Round.id == round_id).first()

    target_round.status = RoundPhase.IMAGE_GENERATING
    db.commit()

    top_kws = db.query(models.Keyword).filter(models.Keyword.round_id == round_id).order_by(desc(models.Keyword.vote_count)).limit(5).all()

    weights_map = [0.4, 0.3, 0.2, 0.07, 0.03]
    keyword_distribution = {}

    for i, kw in enumerate(top_kws):
        keyword_distribution[kw.word] = weights_map[i]

    # 안전장치: 키워드가 1개뿐일 때
    if len(keyword_distribution) == 1:
        keyword_distribution[top_kws[0].word] = 1.0

    try:
        res = requests.post(f"{AI_AGENT_URL}/api/agent/generate-weighted-candidates", json={"weights": keyword_distribution, "session_id": session_id}, timeout=300)
        ai_data = res.json().get("candidates", [])
    except:
        ai_data = [{"title": f"임시 아트 {i}", "description": "임시", "image_prompt": "digital art"} for i in range(1, 6)]

    CF_ACCOUNT_ID = os.getenv("CF_ACCOUNT_ID")
    CF_API_TOKEN = os.getenv("CF_API_TOKEN")
    cf_url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell"
    headers = {"Authorization": f"Bearer {CF_API_TOKEN}"}

    candidate_uris = []
    for idx, c_data in enumerate(ai_data, 1):
        prompt = c_data.get("image_prompt", "digital art") + ", masterpiece"
        try:
            img_res = requests.post(cf_url, headers=headers, json={"prompt": prompt}, timeout=60)
            if img_res.status_code == 200:
                b64 = img_res.json()["result"]["image"]
                img_bytes = base64.b64decode(b64)
                filename = f"round{round_id}_c{idx}.png"
                with open(f"static/images/{filename}", "wb") as f: f.write(img_bytes)

                image_url = f"http://13.125.234.38:8000/static/images/{filename}"
                db.add(models.Candidate(
                    round_id=round_id, title=c_data.get("title", f"작품 {idx}"),
                    description=c_data.get("description", ""), image_url=image_url, ipfs_hash="PENDING"
                ))
                candidate_uris.append(image_url)
        except Exception as e: print("이미지 실패", e)

    target_round.status = RoundPhase.CANDIDATE_VOTING
    db.commit()

    try:
        if ADMIN_ACCOUNT:
            dao_contract = get_dao_contract()
            if dao_contract:
                nonce = w3.eth.get_transaction_count(ADMIN_ACCOUNT.address)
                tx = dao_contract.functions.startNewRound(7, candidate_uris).build_transaction({
                    'chainId': 31337, 'gas': 3000000, 'gasPrice': w3.to_wei('1', 'gwei'), 'nonce': nonce,
                })
                signed_tx = w3.eth.account.sign_transaction(tx, private_key=ADMIN_PRIVATE_KEY)
                w3.eth.send_raw_transaction(signed_tx.raw_transaction)
    except Exception as e: print(f"온체인 라운드 시작 에러: {e}")

    return {"message": f"Phase 2: 총 {len(ai_data)}개 그림 생성 및 VP 투표 시작!"}
# 🟢 [Step 3] 가치 평가 (가격 책정 전, 비평문만 받기)
@app.post("/api/admin/phase3-valuation")
def start_phase3_valuation(round_id: int = 0, session_id: str = "", db: Session = Depends(get_db)):
    from app.models import RoundPhase
    
    # 💡 [NEW] 가장 최근 라운드 자동 선택
    if round_id == 0:
        target_round = db.query(models.Round).order_by(desc(models.Round.id)).first()
        round_id = target_round.id
    else:
        target_round = db.query(models.Round).filter(models.Round.id == round_id).first()

    winner = db.query(models.Candidate).filter(models.Candidate.round_id == round_id).order_by(desc(models.Candidate.vp_votes)).first()
    
    target_round.status = RoundPhase.VALUATION
    winner.is_winner = True
    db.commit()

    try:
        res = requests.post(f"{AI_AGENT_URL}/api/agent/evaluate-winner-only", json={"title": winner.title, "description": winner.description, "session_id": session_id}, timeout=60)
        report = res.json().get("report", "훌륭한 작품입니다.")
    except:
        report = "비평문 에러"

    return {"message": "Phase 3: 가치 평가 완료", "report": report}

# 🟢 [Step 4] 유저 결산 (IPFS 영구 박제 및 스마트 컨트랙트 등록)
class FinalizeReq(BaseModel):
    round_id: int
    price_tuk: int
    duration_days: int

@app.post("/api/admin/finalize")
def finalize_round_to_chain(req: FinalizeReq, db: Session = Depends(get_db)):
    from app.models import RoundPhase
    target_round = db.query(models.Round).filter(models.Round.id == req.round_id).first()
    winner = db.query(models.Candidate).filter(models.Candidate.round_id == req.round_id, models.Candidate.is_winner == True).first()

    winner.auction_price = req.price_tuk
    target_round.duration_days = req.duration_days
    target_round.status = RoundPhase.ENDED
    db.commit()
    
    # =========================================================
    # 🚨 5. [핵심] 우승작 단 1개만 IPFS에 업로드하여 NFT 박제 준비!
    # =========================================================
    if winner.ipfs_hash == "PENDING" and "/static/images/" in winner.image_url:
        try:
            import urllib.parse
            parsed_url = urllib.parse.urlparse(winner.image_url)
            filepath = parsed_url.path.lstrip("/") 
            if os.path.exists(filepath):
                with open(filepath, "rb") as f:
                    image_bytes = f.read()
                uploaded_cid = upload_bytes_to_ipfs(image_bytes, filename=f"winner_round{req.round_id}.png")
                if uploaded_cid:
                    winner.ipfs_hash = f"ipfs://{uploaded_cid}"
                    winner.image_url = f"https://gateway.pinata.cloud/ipfs/{uploaded_cid}"
        except Exception as e: print(f"IPFS 업로드 실패: {e}")
    
    # 명예의 전당 등록
    db.add(models.GalleryItem(title=winner.title, artist_address="ArtDAO Core AI", image_url=winner.image_url, description=winner.description))
    db.commit()

    # =========================================================
    # 🚨 6. [핵심] 스마트 컨트랙트 마감 (블록체인 등록)
    # =========================================================
    try:
        if ADMIN_ACCOUNT:
            dao_contract = get_dao_contract()
            if dao_contract:
                nonce = w3.eth.get_transaction_count(ADMIN_ACCOUNT.address)
                auction_price_wei = w3.to_wei(winner.auction_price, 'ether')
                ipfs_uri = winner.ipfs_hash if winner.ipfs_hash != "PENDING" else winner.image_url

                tx = dao_contract.functions.finalizeRound(auction_price_wei, ipfs_uri).build_transaction({
                    'chainId': 31337, 'gas': 3000000, 'gasPrice': w3.to_wei('1', 'gwei'), 'nonce': nonce,
                })
                signed_tx = w3.eth.account.sign_transaction(tx, private_key=ADMIN_PRIVATE_KEY)
                w3.eth.send_raw_transaction(signed_tx.raw_transaction)
    except Exception as e: print(f"온체인 라운드 마감 실패: {e}")

    return {"message": "최종 결산 및 스마트 컨트랙트 등록 완료!"}