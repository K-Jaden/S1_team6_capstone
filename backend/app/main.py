from fastapi import FastAPI, Depends, Query, HTTPException, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import desc, func, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app import models, schemas, database
from app.models import RoundPhase
from typing import List, Optional
import base64
import json
import logging
import os
import random
import time
import urllib.parse
import requests
from datetime import datetime
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from web3 import Web3
from .ipfs import upload_bytes_to_ipfs, upload_json_to_ipfs

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger("backend")

# 1. Web3 및 스마트 컨트랙트 연결 설정
WEB3_PROVIDER_URL = os.getenv("WEB3_PROVIDER_URL", "http://blockchain:8545")
w3 = Web3(Web3.HTTPProvider(WEB3_PROVIDER_URL))

# 관리자 키는 반드시 환경변수로 주입 (미설정 시 온체인 기능만 비활성화되고 서버는 정상 동작)
ADMIN_PRIVATE_KEY = os.getenv("ADMIN_PRIVATE_KEY")
ADMIN_ACCOUNT = None
if ADMIN_PRIVATE_KEY:
    try:
        ADMIN_ACCOUNT = w3.eth.account.from_key(ADMIN_PRIVATE_KEY)
    except Exception as e:
        logger.warning(f"⚠️ ADMIN_PRIVATE_KEY 로드 실패 - 온체인 기능 비활성화: {e}")
else:
    logger.warning("⚠️ ADMIN_PRIVATE_KEY 미설정 - 온체인 기능 비활성화")

def get_dao_contract():
    try: 
        base_dir = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(base_dir, "contract_address.json"), "r") as f:
            dao_address = json.load(f)["ArtPlanningDAO"]
        with open(os.path.join(base_dir, "ArtPlanningDAO.json"), "r") as f:
            abi = json.load(f)["abi"]
        return w3.eth.contract(address=dao_address, abi=abi)
    except Exception as e:
        logger.error(f"Contract load error: {e}")
        return None




# AI 에이전트 서버 주소 (도커 서비스 이름 사용)
AI_AGENT_URL = "http://ai_core:8002"

# DB 테이블 생성
models.Base.metadata.create_all(bind=database.engine)

def seed_initial_gallery_items():
    try:
        db = database.SessionLocal()
        seed_dir = os.path.join(os.path.dirname(__file__), "static", "images", "seed")
        os.makedirs(seed_dir, exist_ok=True)
        json_path = os.path.join(seed_dir, "seed_items.json")

        items_data = []
        if os.path.exists(json_path):
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    items_data = json.load(f)
            except Exception as je:
                logger.error(f"⚠️ [Seed] seed_items.json 읽기 실패: {je}")

        if items_data:
            for item in items_data:
                img_url = f"/static/images/seed/{item['filename']}"
                exists = db.query(models.GalleryItem).filter(models.GalleryItem.image_url == img_url).first()
                if not exists:
                    db.add(models.GalleryItem(
                        title=item.get("title", "ArtDAO Seed Masterpiece"),
                        artist_address=item.get("artist_address", "ArtDAO Genesis Collection"),
                        image_url=img_url,
                        description=item.get("description", "ArtDAO 시작 시 기본으로 제공되는 명예의 전당 보존작입니다.")
                    ))
            db.commit()
            logger.info(f"✅ [Seed] json 기반 {len(items_data)}개 시드 갤러리 작품 등록 동기화 완료!")
        else:
            valid_exts = {".png", ".jpg", ".jpeg", ".webp"}
            files = [f for f in os.listdir(seed_dir) if os.path.splitext(f)[1].lower() in valid_exts]
            for idx, fname in enumerate(sorted(files), 1):
                img_url = f"/static/images/seed/{fname}"
                exists = db.query(models.GalleryItem).filter(models.GalleryItem.image_url == img_url).first()
                if not exists:
                    db.add(models.GalleryItem(
                        title=f"ArtDAO 컬렉션 #{idx}",
                        artist_address="ArtDAO Genesis Collection",
                        image_url=img_url,
                        description="ArtDAO 시작 시 기본으로 제공되는 명예의 전당 보존작입니다."
                    ))
            db.commit()
            logger.info(f"✅ [Seed] 이미지 파일 자동 감지 {len(files)}개 시드 등록 완료!")
        db.close()
    except Exception as e:
        logger.error(f"⚠️ [Seed] 초기 갤러리 데이터 주입 에러: {e}")

seed_initial_gallery_items()

app = FastAPI()

os.makedirs("static/images", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

# 배포 환경 origin은 CORS_ORIGINS 환경변수(콤마 구분)로 추가
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

get_db = database.get_db


def get_negative_prompt_for_style(style_name: str) -> str:
    """화풍에 맞춰 번들거림(glossy), 네온(neon), 3D 렌더 등을 적절히 억제하는 네거티브 프롬프트를 동적으로 만듭니다."""
    neg_parts = ["deformed", "bad anatomy", "disfigured", "poorly drawn face", "mutated", "extra limbs", "ugly", "blurry", "low quality"]
    if not style_name:
        return ", ".join(neg_parts)
    style_lower = style_name.lower()
    if "수묵화" in style_lower or "화강암" in style_lower or "펜화" in style_lower or "ink" in style_lower or "sketch" in style_lower:
        neg_parts.extend(["digital gloss", "shiny", "plastic texture", "3d render", "photorealistic", "vibrant colors", "modern neon lights", "realistic render"])
    elif "도트" in style_lower or "픽셀" in style_lower or "pixel" in style_lower:
        neg_parts.extend(["smooth gradients", "blur", "photorealistic", "highly detailed skin", "3d rendering", "oil painting"])
    elif "미니멀리즘" in style_lower or "2d" in style_lower or "벡터" in style_lower or "minimal" in style_lower or "vector" in style_lower:
        neg_parts.extend(["realistic texture", "3d render", "shadow gradients", "photorealistic", "oil painting"])
    elif "점토" in style_lower or "클레이" in style_lower or "clay" in style_lower:
        neg_parts.extend(["digital rendering", "realistic skin", "glossy metal", "watercolors", "flat vector"])
    elif "유화" in style_lower or "유채" in style_lower or "oil" in style_lower or "회화" in style_lower or "painting" in style_lower:
        # 유화/회화 특유의 AI 디지털 광택, 3D 렌더링 느낌 억제
        neg_parts.extend(["smooth 3d render", "digital art", "plastic glossy skin", "neon colors", "anime style", "flat illustration", "vector art", "perfectly clean"])
    return ", ".join(neg_parts)


@app.get("/health")
def health():
    db_ok = False
    try:
        with database.engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception as e:
        logger.error(f"헬스체크 DB 연결 실패: {e}")

    web3_ok = False
    try:
        web3_ok = w3.is_connected()
    except Exception as e:
        logger.warning(f"헬스체크 web3 연결 확인 실패: {e}")

    # DB는 필수 의존성, web3(온체인)는 없어도 오프체인 기능은 정상 동작하므로 degraded 정보로만 표시
    status_code = 200 if db_ok else 503
    return JSONResponse(
        {"status": "ok" if db_ok else "degraded", "db": db_ok, "web3": web3_ok},
        status_code=status_code,
    )

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
        try:
            db.commit()
            db.refresh(user)
        except IntegrityError:
            # 동시 요청으로 이미 가입된 경우 - 기존 유저를 다시 조회
            db.rollback()
            user = db.query(models.User).filter(models.User.wallet_address == req.wallet_address).first()
    
    return {"status": "success", "wallet_address": user.wallet_address}

@app.post("/api/auth/logout")
def logout(wallet_address: str):
    # 실제 세션/쿠키 방식이라면 response.delete_cookie("session_id") 등이 들어갑니다.
    # 현재는 stateless 방식이므로 로그만 남기거나 성공 메시지만 반환합니다.
    logger.info(f"[Logout] Wallet: {wallet_address}")
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
# 👤 [NEW] 프로필 조회 / 저장 / 이미지 업로드
# =========================================================
@app.get("/api/user/profile")
def get_user_profile(wallet_address: str, db: Session = Depends(get_db)):
    """유저 프로필(닉네임, 프로필픽) 조회"""
    user = get_user_or_404(wallet_address, db)
    return {
        "wallet_address": user.wallet_address,
        "nickname": user.nickname or "",
        "profile_pic": user.profile_pic or "🔮"
    }

@app.post("/api/user/profile")
def save_user_profile(req: schemas.ProfileUpdateReq, wallet_address: str, db: Session = Depends(get_db)):
    """유저 프로필(닉네임, 프로필픽) 저장"""
    user = get_user_or_404(wallet_address, db)
    user.nickname = req.nickname
    user.profile_pic = req.profile_pic
    db.commit()
    return {"status": "ok", "nickname": user.nickname, "profile_pic": user.profile_pic}

@app.post("/api/user/upload-profile-pic")
async def upload_profile_pic(wallet_address: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """프로필 사진 이미지 파일 업로드 후 /static/images/profile_*.jpg 경로로 저장"""
    user = get_user_or_404(wallet_address, db)
    ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"
    # 지갑 주소 기반으로 고유 파일명 생성
    save_path = f"static/images/profile_{wallet_address}.{ext}"
    os.makedirs("static/images", exist_ok=True)
    contents = await file.read()
    with open(save_path, "wb") as f:
        f.write(contents)
    url_path = f"/{save_path}"
    user.profile_pic = url_path
    db.commit()
    return {"profile_pic": url_path}



@app.get("/api/gallery/items")
def get_gallery_items(wallet_address: Optional[str] = None, db: Session = Depends(get_db)):
    items = db.query(models.GalleryItem).all()
    res = []
    for item in items:
        winner = db.query(models.Candidate).filter(models.Candidate.title == item.title, models.Candidate.is_winner == True).first()
        auction_price = winner.auction_price if winner else 1000
        
        # 유저별 실시간 지분 및 배당금 계산 장치 가동
        stake_ratio = 0.0
        my_profit = 0.0
        total_user_vp = 0
        
        if winner and wallet_address:
            total_user_vp = db.query(func.sum(models.VoteLog.vp_used)).filter(
                models.VoteLog.candidate_id == winner.id,
                models.VoteLog.voter_wallet == wallet_address
            ).scalar() or 0

            total_votes = winner.vp_votes if winner.vp_votes > 0 else 1
            stake_ratio = float(total_user_vp) / float(total_votes)
            # 🟢 유저 요청 반영: 수수료 30% 제외한 '70% 분배금' 기준 계산 공식 적용!
            my_profit = (auction_price * 0.7) * stake_ratio
            
        res.append({
            "id": item.id,
            "title": item.title,
            "artist_address": item.artist_address,
            "image_url": item.image_url,
            "description": item.description,
            "is_sold": item.is_sold,
            "auction_price": auction_price,
            "stake_ratio": stake_ratio * 100,
            "my_profit": my_profit,
            "my_vp": total_user_vp
        })
    return res

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
    logger.info(f"📡 [Backend] AI 협업 팀에게 질문 전달: {request.message}")
    
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
            logger.error(f"🔥 AI 서버 에러 ({response.status_code}): {response.text}")
            return {"reply": "AI 팀이 응답하지 않습니다. 잠시 후 다시 시도해주세요."}
            
    except Exception:
        logger.exception("🔥 AI 채팅 통신 에러")
        return {"reply": "AI 큐레이터와 연결할 수 없습니다. 잠시 후 다시 시도해주세요."}

@app.post("/api/gallery/docent")
def gallery_docent(request: ChatRequest):
    # 도슨트 해설도 큐레이터 채팅과 동일한 AI 엔드포인트를 사용 (요청/응답 규격 동일)
    return a2a_chat(request)

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
    logger.info(f"📡 [Backend] AI 난상토론 기획서 요청: {request.intent}")
    
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
            logger.error(f"🔥 AI 에러: {response.text}")
            return {"draft_text": "AI가 토론하다가 잠들었습니다. (에러 발생)"}
            
    except Exception:
        logger.exception("🔥 AI 기획서 통신 에러")
        return {"draft_text": "AI 에이전트와 연결할 수 없습니다."}
# ==========================================
# 1. 비평가 (Critic) 연결 (🚀 방금 추가한 코드)
# ==========================================
class CriticReviewRequest(BaseModel):
    art_info: str

@app.post("/api/agent/review")
def agent_review(req: CriticReviewRequest):
    logger.info(f"📡 [Backend] 비평가 호출: {req.art_info}")
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
    logger.info(f"📡 [Backend] 마케터 호출: {req.exhibition_title}")
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
@app.post("/api/studio/image", response_model=schemas.StudioImageResponse)
def create_art_image(request: schemas.StudioImageRequest):
    logger.info(f"📡 [Backend] AI에게 그림 요청 (원본 키워드): {request.keywords}")
    
    CF_ACCOUNT_ID = os.getenv("CF_ACCOUNT_ID")
    CF_API_TOKEN = os.getenv("CF_API_TOKEN")

    if not CF_ACCOUNT_ID or not CF_API_TOKEN:
        logger.error("🔥 Cloudflare API 키가 없습니다! .env 파일을 확인하세요.")
        return {"image_url": "https://dummyimage.com/600x400/ff0000/fff&text=CF+Key+Missing"}

    enhanced_english_prompt = "A masterpiece, highly detailed digital art of " + request.keywords

    # 1. 화가 에이전트에게 프롬프트 부탁 (A2A)
    try:
        logger.info("🧠 화가 에이전트에게 프롬프트 엔지니어링 의뢰 중...")
        payload = {"topic": request.keywords, "style": "Digital Art", "wallet_address": "0xSystem"}
        response = requests.post(f"{AI_AGENT_URL}/generate", json=payload, timeout=30)
        
        if response.status_code == 200:
            enhanced_english_prompt = response.json().get("final_prompt", enhanced_english_prompt)
            logger.info(f"✨ [화가 프롬프트 완성] ➔ {enhanced_english_prompt[:50]}...")
    except Exception as e:
        logger.warning(f"⚠️ 화가 에이전트 에러, 원본 키워드 사용: {e}")

    # 2. Cloudflare FLUX 서버 호출
    try:
        logger.info("📥 [Cloudflare FLUX] 고퀄리티 이미지 렌더링 중...")
        cf_url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/@cf/stabilityai/stable-diffusion-xl-base-1.0"
        
        headers = {
            "Authorization": f"Bearer {CF_API_TOKEN}",
            "Content-Type": "application/json"
        }
        
        # 유저가 고른 키워드를 통해 어울리는 네거티브 프롬프트 도출
        negative_prompt = get_negative_prompt_for_style(request.keywords)
        
        data = {
            "prompt": enhanced_english_prompt[:1000],  # 프롬프트 길이 제한
            "negative_prompt": negative_prompt,
            "num_steps": 20
        }

        img_res = requests.post(cf_url, headers=headers, json=data, timeout=60)

        if img_res.status_code == 200:
            # 🚨 [핵심 수정] Cloudflare가 주는 JSON 껍데기를 벗겨서 진짜 이미지 데이터만 추출!
            content_type = img_res.headers.get("Content-Type", "")
            
            if "application/json" in content_type:
                res_json = img_res.json()
                if "result" in res_json and "image" in res_json["result"]:
                    b64_encoded = res_json["result"]["image"]
                    data_url = f"data:image/jpeg;base64,{b64_encoded}"
                    logger.info("✅ Cloudflare FLUX 그림 생성 성공! (JSON 파싱 완벽)")
                    return {"image_url": data_url}
                else:
                    logger.error(f"🔥 예상치 못한 JSON 구조: {res_json}")
                    return {"image_url": "https://dummyimage.com/600x400/ff0000/fff&text=CF+JSON+Structure+Error"}
            else:
                # SDXL 등 raw binary 이미지를 돌려주는 경우 base64 인코딩하여 data URL로 변환합니다.
                b64_encoded = base64.b64encode(img_res.content).decode("utf-8")
                data_url = f"data:image/jpeg;base64,{b64_encoded}"
                logger.info("✅ Cloudflare SDXL 그림 생성 성공! (raw binary ➔ base64 인코딩)")
                return {"image_url": data_url}
        else:
            logger.error(f"🔥 Cloudflare API 에러: {img_res.status_code} - {img_res.text}")
            return {"image_url": "https://dummyimage.com/600x400/ff0000/fff&text=CF+API+Error"}
            
    except Exception:
        logger.exception("🔥 이미지 서버 통신 실패")
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
    logger.info(f"🚀 [최종 제출] 메모리 그림 데이터 -> IPFS 영구 저장 시작 (안건: {req.title})")
    try:
        # 1. Base64 형태의 이미지가 제대로 왔는지 확인
        if not req.image_url or not req.image_url.startswith("data:image"):
            return {"error": "Invalid image data"}
            
        logger.info("📥 프론트엔드 이미지를 복원하여 IPFS에 업로드 중...")
        header, encoded = req.image_url.split(",", 1)
        image_bytes = base64.b64decode(encoded)
        
        # 🚨 여기서 ipfs.py의 이미지 업로드 함수만 호출합니다!
        image_cid = upload_bytes_to_ipfs(image_bytes)
        
        if not image_cid:
            return {"error": "Image Upload Failed"}
            
        image_ipfs_url = f"ipfs://{image_cid}"
        logger.info(f"✅ 그림 IPFS 업로드 완료! CID: {image_cid}")
        
        # 🚨 메타데이터(JSON) 업로드 로직은 삭제! 스마트 컨트랙트에는 그림 주소만 들어갑니다.
        
        return {
            "status": "success",
            "image_ipfs_url": f"https://gateway.pinata.cloud/ipfs/{image_cid}", # 브라우저 표시용
            "token_uri": image_ipfs_url # 스마트 컨트랙트에 들어갈 최종 그림 주소
        }
    except Exception:
        logger.exception("🔥 IPFS 업로드 에러")
        return {"error": "이미지 업로드 중 오류가 발생했습니다."}
    
    
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
# 🌟 [복구/수정] 프론트엔드 화면 표시 및 투표용 필수 API
# =========================================================
@app.get("/api/rounds/current")
def get_current_round(db: Session = Depends(get_db)):
    active = db.query(models.Round).filter(models.Round.status != RoundPhase.ENDED).order_by(desc(models.Round.id)).first()
    if not active: 
        raise HTTPException(status_code=404, detail="진행 중인 라운드가 없습니다.")
    
    keywords = db.query(models.Keyword).filter(models.Keyword.round_id == active.id).all()
    return {
        "id": active.id,
        "round_number": active.round_number,
        "status": active.status,
        "candidates": active.candidates,
        "eras": [{"word": k.word, "vote_count": k.vote_count} for k in keywords if k.type == "era"],
        "subjects": [{"word": k.word, "vote_count": k.vote_count} for k in keywords if k.type == "subject"],
        "backgrounds": [{"word": k.word, "vote_count": k.vote_count} for k in keywords if k.type == "background"],
        "styles": [{"word": k.word, "vote_count": k.vote_count} for k in keywords if k.type == "style"],
        "moods": []
    }
@app.get("/api/rounds/ended")
def get_ended_rounds(db: Session = Depends(get_db)):
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
    vp_amount: int = Field(gt=0)

@app.post("/api/vote")
def cast_vote(req: VoteReq, db: Session = Depends(get_db)):
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
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        logger.exception("🔥 투표 저장 실패")
        raise HTTPException(status_code=500, detail="투표 저장 중 오류가 발생했습니다.")
    return {"status": "success"}

# =========================================================
# 🔥 [NEW] 차세대 ArtDAO Co-creation 2단 카테고리 파이프라인
# =========================================================

# 🟢 [Step 1] 트렌드 추출 & 키워드 투표 시작
@app.post("/api/admin/phase1-keywords")
def start_phase1_keywords(session_id: str = "", db: Session = Depends(get_db)):
    db.query(models.Round).filter(models.Round.status != RoundPhase.ENDED).update({"status": RoundPhase.ENDED})
    last_round = db.query(models.Round).order_by(models.Round.round_number.desc()).first()
    new_num = (last_round.round_number + 1) if last_round else 1
    new_round = models.Round(round_number=new_num, status=RoundPhase.KEYWORD_VOTING)
    db.add(new_round)
    db.commit()

    # 💡 4대 슬롯의 기본 단어 풀 정의 (5번 분위기 슬롯 영구 삭제 및 1, 3번 명확성 분리)
    pool_eras = [
        "조선 시대", "고대 이집트 시대", "로마 제국 시대", "서부 개척 시대",
        "사이버펑크 미래 시대", "중세 판타지 시대", "빅토리아 스팀펑크 시대",
        "포스트 아포칼립스 시대", "현대 시대", "우주 개척 시대"
    ]
    pool_subjects = [
        "공룡", "총", "로봇", "고양이", "기사", "마법사", "천사", "악마", "소나무", "네온사인", 
        "고층빌딩", "해골", "고래", "나비", "사막", "심해", "은하수", "성곽", "오로라", "벚꽃", 
        "가면", "사이보그", "크리스탈", "시계탑", "유령", "사람", "서울", "뉴욕", "지구", "아니메 소년", 
        "소년", "소녀", "자연", "웅장한"
    ]
    pool_backgrounds = [
        "골목길", "정원", "우주선 내부", "열대우림", "사원 마당", 
        "모래 언덕", "서재", "대성당 내부", "산 정상", "천공도시", 
        "공동묘지", "산호초", "연구소", "오두막", "도서관"
    ]
    pool_styles = [
        "전통 수묵화", "디즈니 3D 애니메이션 풍", "8비트 도트", "몽환적인 수채화", "말랑한 점토 클레이아트", 
        "거친 질감의 목판화", "클래식 유화 풍", "정교한 펜화 스케치", "미니멀리즘 디자인", "초현실주의 회화", 
        "인상주의 회화 풍", "아르누보 일러스트", "팝아트 포스터 스타일", "2D 플랫 벡터 일러스트", "사이버네틱 SF 화풍"
    ]

    # 💡 2. AI 트렌드 연동 (Reddit 크롤러 및 AI 자체 분석 데이터 수집)
    crawled_eras, ai_eras = [], []
    crawled_subjects, ai_subjects = [], []
    crawled_backgrounds, ai_backgrounds = [], []
    crawled_styles, ai_styles = [], []

    try:
        res = requests.get(f"{AI_AGENT_URL}/api/agent/trends-keywords", timeout=20)
        ai_data = res.json()
        
        if "eras" in ai_data: crawled_eras = [w.strip() for w in ai_data["eras"][:3] if w.strip()]
        if "ai_eras" in ai_data: ai_eras = [w.strip() for w in ai_data["ai_eras"][:3] if w.strip()]
        
        if "subjects" in ai_data: crawled_subjects = [w.strip() for w in ai_data["subjects"][:3] if w.strip()]
        if "ai_subjects" in ai_data: ai_subjects = [w.strip() for w in ai_data["ai_subjects"][:3] if w.strip()]
        
        if "backgrounds" in ai_data: crawled_backgrounds = [w.strip() for w in ai_data["backgrounds"][:3] if w.strip()]
        if "ai_backgrounds" in ai_data: ai_backgrounds = [w.strip() for w in ai_data["ai_backgrounds"][:3] if w.strip()]
        
        if "styles" in ai_data: crawled_styles = [w.strip() for w in ai_data["styles"][:3] if w.strip()]
        if "ai_styles" in ai_data: ai_styles = [w.strip() for w in ai_data["ai_styles"][:3] if w.strip()]
    except Exception as e:
        logger.warning(f"🔥 AI 트렌드 지연, 비상 트렌드 가동: {e}")
        ai_eras = ["조선 시대", "사이버펑크 미래 시대", "중세 판타지 시대"]
        ai_subjects = ["메타버스 가상현실", "초거대 AI", "포스트 아포칼립스"]
        ai_backgrounds = ["골목길", "정원", "우주선 내부"]
        ai_styles = ["전통 수묵화", "3D 복셀", "점토 클레이아트"]

    # 💡 3. 중복 방지 처리 및 베이스 풀 샘플링 결합
    trend_eras = set(crawled_eras + ai_eras)
    filtered_eras = [w for w in pool_eras if w not in trend_eras]
    selected_eras = random.sample(filtered_eras, min(10, len(filtered_eras)))
    selected_eras.extend([f"🔥{w}" for w in crawled_eras])
    selected_eras.extend([f"✨{w}" for w in ai_eras])

    trend_subjects = set(crawled_subjects + ai_subjects)
    filtered_subjects = [w for w in pool_subjects if w not in trend_subjects]
    selected_subjects = random.sample(filtered_subjects, min(12, len(filtered_subjects)))
    selected_subjects.extend([f"🔥{w}" for w in crawled_subjects])
    selected_subjects.extend([f"✨{w}" for w in ai_subjects])

    trend_backgrounds = set(crawled_backgrounds + ai_backgrounds)
    filtered_backgrounds = [w for w in pool_backgrounds if w not in trend_backgrounds]
    selected_backgrounds = random.sample(filtered_backgrounds, min(10, len(filtered_backgrounds)))
    selected_backgrounds.extend([f"🔥{w}" for w in crawled_backgrounds])
    selected_backgrounds.extend([f"✨{w}" for w in ai_backgrounds])

    trend_styles = set(crawled_styles + ai_styles)
    filtered_styles = [w for w in pool_styles if w not in trend_styles]
    selected_styles = random.sample(filtered_styles, min(10, len(filtered_styles)))
    selected_styles.extend([f"🔥{w}" for w in crawled_styles])
    selected_styles.extend([f"✨{w}" for w in ai_styles])

    random.shuffle(selected_eras)
    random.shuffle(selected_subjects)
    random.shuffle(selected_backgrounds)
    random.shuffle(selected_styles)

    for word in selected_eras:
        db.add(models.Keyword(round_id=new_round.id, word=word.replace("#", ""), type="era"))
    for word in selected_subjects:
        db.add(models.Keyword(round_id=new_round.id, word=word.replace("#", ""), type="subject"))
    for word in selected_backgrounds:
        db.add(models.Keyword(round_id=new_round.id, word=word.replace("#", ""), type="background"))
    for word in selected_styles:
        db.add(models.Keyword(round_id=new_round.id, word=word.replace("#", ""), type="style"))

    db.commit()
    return {
        "message": "✅ AI가 최신 웹 트렌드 분석을 완료했습니다!\n새로운 예술 창작을 위한 키워드 투표가 시작됩니다.", 
        "round_id": new_round.id
    }

# 🟢 [Step 1.5] 프론트에서 유저가 선택한 키워드 서버로 저장
class KeywordVoteReq(BaseModel):
    round_id: int
    selected_words: list[str]
    selected_era: str = ""
    selected_background: str = ""
    selected_style: str = ""
    selected_mood: str = ""
    wallet_address: str = "" # 🔥 중복 검증을 위한 지갑 주소 필드 추가

@app.post("/api/rounds/vote-keyword")
def vote_keywords(req: KeywordVoteReq, db: Session = Depends(get_db)):
    if not req.wallet_address:
        raise HTTPException(status_code=400, detail="지갑 연결이 필요합니다.")

    # 🔥 [핵심] 1인 1회 제한: 이미 해당 라운드에 투표한 지갑인지 검증
    already_voted = db.query(models.KeywordVoteLog).filter(
        models.KeywordVoteLog.round_id == req.round_id,
        models.KeywordVoteLog.wallet_address == req.wallet_address
    ).first()
    if already_voted:
        raise HTTPException(status_code=400, detail="이미 이 라운드의 키워드 설계 투표에 참여하셨습니다.")

    for word in req.selected_words:
        kw = db.query(models.Keyword).filter(models.Keyword.round_id == req.round_id, models.Keyword.word == word, models.Keyword.type == "subject").first()
        if kw: kw.vote_count += 1

    if req.selected_era:
        ek = db.query(models.Keyword).filter(models.Keyword.round_id == req.round_id, models.Keyword.word == req.selected_era, models.Keyword.type == "era").first()
        if ek: ek.vote_count += 1

    if req.selected_background:
        bk = db.query(models.Keyword).filter(models.Keyword.round_id == req.round_id, models.Keyword.word == req.selected_background, models.Keyword.type == "background").first()
        if bk: bk.vote_count += 1

    if req.selected_style:
        sk = db.query(models.Keyword).filter(models.Keyword.round_id == req.round_id, models.Keyword.word == req.selected_style, models.Keyword.type == "style").first()
        if sk: sk.vote_count += 1

    if req.selected_mood:
        mk = db.query(models.Keyword).filter(models.Keyword.round_id == req.round_id, models.Keyword.word == req.selected_mood, models.Keyword.type == "mood").first()
        if mk: mk.vote_count += 1

    db.add(models.KeywordVoteLog(round_id=req.round_id, wallet_address=req.wallet_address))

    # 🔥 동시 요청으로 인한 중복 투표는 unique 제약(round_id, wallet_address)이 최종 방어선
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="이미 이 라운드의 키워드 설계 투표에 참여하셨습니다.")
    return {"status": "success"}

class CustomKeywordReq(BaseModel):
    round_id: int
    word: str
    type: str
    wallet_address: str

@app.post("/api/rounds/custom-keyword")
def add_custom_keyword(req: CustomKeywordReq, db: Session = Depends(get_db)):
    if not req.wallet_address:
        raise HTTPException(status_code=400, detail="지갑 연결이 필요합니다.")

    clean_word = req.word.strip().replace("#", "")
    if len(clean_word) < 2 or len(clean_word) > 15:
        raise HTTPException(status_code=400, detail="키워드는 2자 이상, 15자 이하로 입력해주세요.")

    exist = db.query(models.Keyword).filter(
        models.Keyword.round_id == req.round_id,
        models.Keyword.word == clean_word,
        models.Keyword.type == req.type
    ).first()

    if exist:
        raise HTTPException(status_code=400, detail="이미 목록에 있는 키워드입니다.")

    new_kw = models.Keyword(
        round_id=req.round_id,
        word=clean_word,
        type=req.type,
        vote_count=0
    )
    db.add(new_kw)
    db.commit()

    return {"status": "success", "message": f"'{clean_word}' 키워드가 추가되었습니다!"}

# 🟢 [Step 2] 투표 결과로 그림 생성 & VP 투표 단계 전환
@app.post("/api/admin/phase2-generate")
def start_phase2_generate(round_id: int = 0, session_id: str = "", db: Session = Depends(get_db)):
    
    if round_id == 0:
        target_round = db.query(models.Round).order_by(desc(models.Round.id)).first()
        if not target_round: raise HTTPException(status_code=404, detail="진행할 라운드가 없습니다.")
        round_id = target_round.id
    else:
        target_round = db.query(models.Round).filter(models.Round.id == round_id).first()

    target_round.status = RoundPhase.IMAGE_GENERATING
    db.commit()

    # 🔥 [수정 1] 피사체(Subject)도 복수 선택 투표 결과 중 '1등(동점자 모두 포함)'만 선별하여 전달
    max_subject_votes = db.query(func.max(models.Keyword.vote_count)).filter(
        models.Keyword.round_id == round_id, 
        models.Keyword.type == "subject",
        models.Keyword.vote_count > 0
    ).scalar()

    keyword_distribution = {}
    if not max_subject_votes:
        # 투표가 아예 없었을 경우의 기본값
        keyword_distribution["Digital Art"] = 1.5
    else:
        # 1등 득표수를 가진 피사체들만 선택 (동점자 모두 포함)
        winning_subjects = db.query(models.Keyword).filter(
            models.Keyword.round_id == round_id,
            models.Keyword.type == "subject",
            models.Keyword.vote_count == max_subject_votes
        ).all()
        
        num_winners = len(winning_subjects)
        for kw in winning_subjects:
            # 1등 보너스 가중치(0.5)를 동점자 수만큼 균등하게 나눔
            ratio = 1.0 / num_winners
            weight = round(1.0 + (ratio * 0.5), 2)
            keyword_distribution[kw.word] = weight

    def get_winning_keywords(kw_type: str, default_val: str) -> str:
        max_votes = db.query(func.max(models.Keyword.vote_count)).filter(
            models.Keyword.round_id == round_id,
            models.Keyword.type == kw_type,
            models.Keyword.vote_count > 0
        ).scalar()
        if not max_votes:
            return default_val
        kws = db.query(models.Keyword).filter(
            models.Keyword.round_id == round_id,
            models.Keyword.type == kw_type,
            models.Keyword.vote_count == max_votes
        ).all()
        return ", ".join(k.word for k in kws)

    selected_era = get_winning_keywords("era", "modern era")
    selected_background = get_winning_keywords("background", "simple background")
    selected_style = get_winning_keywords("style", "digital art style")

    try:
        # 🚨 4대 슬롯 매개변수 전송 (분위기 제거)
        res = requests.post(f"{AI_AGENT_URL}/api/agent/generate-weighted-candidates",
            json={
                "weights": keyword_distribution, 
                "era": selected_era,
                "background": selected_background,
                "style": selected_style,
                "session_id": session_id
            }, timeout=300)
        ai_data = res.json().get("candidates", [])
    except Exception as e:
        logger.warning(f"AI 통신 장애 대응 폴백 가동: {e}")
        ai_data = [
            {
                "title": f"임시 아트 {i}", 
                "description": "복구본", 
                "image_prompt": f"masterpiece, {selected_style}, set in {selected_background}, {selected_era} era"
            }
            for i in range(1, 6)
        ]

    CF_ACCOUNT_ID = os.getenv("CF_ACCOUNT_ID")
    CF_API_TOKEN = os.getenv("CF_API_TOKEN")
    cf_url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/@cf/stabilityai/stable-diffusion-xl-base-1.0"
    headers = {"Authorization": f"Bearer {CF_API_TOKEN}"}

    candidate_uris = []
    
    # 화풍에 맞는 네거티브 프롬프트 준비
    negative_prompt = get_negative_prompt_for_style(selected_style)

    for idx, c_data in enumerate(ai_data, 1):
        raw_prompt = str(c_data.get("image_prompt", "digital art"))[:900]
        prompt = raw_prompt
        image_url = ""

        try:
            logger.info(f"🚀 [{idx}번 그림] CF API 요청 시작...")
            time.sleep(6)
            # 후보작별로 각기 다른 화면 비율 부여 (가로형/세로형/정사각형)
            if idx == 1:
                width, height = 1024, 1024  # 1:1 정사각형
            elif idx in [2, 4]:
                width, height = 1024, 576   # 16:9 가로형
            else:
                width, height = 576, 1024   # 9:16 세로형
            data = {
                "prompt": prompt,
                "negative_prompt": negative_prompt,
                "num_steps": 20,
                "width": width,
                "height": height
            }
            img_res = requests.post(cf_url, headers=headers, json=data, timeout=60)
            logger.info(f"📥 [{idx}번 그림] CF API 응답 상태코드: {img_res.status_code}")
            
            if img_res.status_code == 200:
                content_type = img_res.headers.get("Content-Type", "")
                img_bytes = None
                
                if "application/json" in content_type:
                    res_json = img_res.json()
                    if "result" in res_json and "image" in res_json["result"]:
                        b64 = res_json["result"]["image"]
                        img_bytes = base64.b64decode(b64)
                else:
                    # SDXL은 raw binary bytes를 직접 리턴하므로 바로 저장합니다.
                    img_bytes = img_res.content
                    
                if img_bytes:
                    os.makedirs("static/images", exist_ok=True)
                    filename = f"round{round_id}_c{idx}.png"
                    
                    with open(f"static/images/{filename}", "wb") as f: 
                        f.write(img_bytes)
                    
                    # 상대경로로 저장 - 프론트 getImageUrl()이 API_URL을 붙여줌 (서버 IP 변경에 무관)
                    image_url = f"/static/images/{filename}"
                    logger.info(f"✅ [{idx}번 그림] 저장 완벽 성공!")
                else:
                    logger.error(f"🔥 [데이터 에러] 그림 데이터 추출 실패 (컨텐츠 타입: {content_type})")
            else:
                logger.error(f"🔥 [CF API 거절] 상태코드: {img_res.status_code} / 내용: {img_res.text}")
                
        except Exception:
            logger.exception(f"🔥 [{idx}번 그림] 생성 중 예외 발생")

        if not image_url:
            image_url = f"https://dummyimage.com/600x400/1A1A1A/38BDF8&text=Artwork+{idx}+Delayed"

        db.add(models.Candidate(
            round_id=round_id, title=c_data.get("title", f"작품 {idx}"),
            description=c_data.get("description", "이미지 렌더링 지연으로 임시 썸네일이 표시됩니다."),
            image_url=image_url, image_prompt=prompt, ipfs_hash="PENDING"
        ))
        candidate_uris.append(image_url)

    target_round.status = RoundPhase.CANDIDATE_VOTING
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        logger.exception("🔥 후보작 저장 실패 (이미지 생성 결과 유실 위험)")
        raise HTTPException(status_code=500, detail="후보작 저장 중 오류가 발생했습니다.")

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
    except Exception as e:
        logger.error(f"온체인 시작 에러: {e}")

    return {"message": f"Phase 2: 총 {len(ai_data)}개 그림 생성 및 VP 투표 시작!"}

# 🟢 [Step 3] 가치 평가 (가격 책정 전, 비평문만 받기)
@app.post("/api/admin/phase3-valuation")
def start_phase3_valuation(round_id: int = 0, session_id: str = "", db: Session = Depends(get_db)):
    
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

    top_keywords = db.query(models.Keyword).filter(
        models.Keyword.round_id == round_id,
        models.Keyword.vote_count > 0
    ).order_by(desc(models.Keyword.vote_count)).limit(3).all()

    # =========================================================
    # 🟢 [품질 게이트] 우승작 이미지 축 A(실행 품질) 검증
    # 5개 후보 전부가 아니라 온체인에 영구 기록되는 우승작 1개에만 적용 (토큰 절약).
    # 자세한 설계 근거는 docs/quality_validation_framework.md 참고.
    # =========================================================
    quality_result = None
    if winner.image_prompt and winner.image_url.startswith("/static/images/"):
        try:
            filepath = winner.image_url.lstrip("/")
            if os.path.exists(filepath):
                with open(filepath, "rb") as f:
                    img_b64 = base64.b64encode(f.read()).decode()

                style_kw = db.query(models.Keyword).filter(
                    models.Keyword.round_id == round_id,
                    models.Keyword.type == "style",
                    models.Keyword.vote_count > 0
                ).order_by(desc(models.Keyword.vote_count)).first()
                selected_style = style_kw.word if style_kw else ""

                combined_style = selected_style

                qc_res = requests.post(f"{AI_AGENT_URL}/api/agent/quality-check", json={
                    "image_base64": img_b64,
                    "mime_type": "image/png",
                    "image_prompt": winner.image_prompt,
                    "title": winner.title,
                    "description": winner.description,
                    "style": combined_style,
                }, timeout=60)
                quality_result = qc_res.json()

                if not quality_result.get("passed", True):
                    logger.warning(f"🔍 품질 게이트 실패: {quality_result.get('failure_summary')}")
                    revised_prompt = quality_result.get("revised_prompt") or winner.image_prompt

                    # 재시도는 최대 1회 - 무료 API 티어 제약상 무한정 매달리지 않음
                    CF_ACCOUNT_ID = os.getenv("CF_ACCOUNT_ID")
                    CF_API_TOKEN = os.getenv("CF_API_TOKEN")
                    cf_url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/@cf/stabilityai/stable-diffusion-xl-base-1.0"
                    headers = {"Authorization": f"Bearer {CF_API_TOKEN}"}
                    negative_prompt = get_negative_prompt_for_style(selected_style)
                    retry_data = {
                        "prompt": revised_prompt[:1000],
                        "negative_prompt": negative_prompt,
                        "num_steps": 20
                    }
                    retry_res = requests.post(cf_url, headers=headers, json=retry_data, timeout=60)
                    if retry_res.status_code == 200:
                        content_type = retry_res.headers.get("Content-Type", "")
                        new_bytes = None
                        
                        if "application/json" in content_type:
                            retry_json = retry_res.json()
                            if "result" in retry_json and "image" in retry_json["result"]:
                                new_bytes = base64.b64decode(retry_json["result"]["image"])
                        else:
                            # SDXL은 raw binary bytes를 직접 리턴하므로 바로 저장합니다.
                            new_bytes = retry_res.content
                            
                        if new_bytes:
                            with open(filepath, "wb") as f:
                                f.write(new_bytes)
                            winner.image_prompt = revised_prompt
                            db.commit()
                            logger.info("✅ 품질 게이트 재수정 완료 - 이미지 교체됨")
                        else:
                            logger.warning("품질 게이트 재수정 실패 (그림 데이터 추출 실패) - 기존 이미지 유지")
                    else:
                        logger.warning(f"품질 게이트 재수정 실패 (CF 상태코드 {retry_res.status_code}) - 기존 이미지 유지")
        except Exception:
            logger.exception("품질 게이트 처리 중 오류 - 기존 이미지로 진행")

    try:
        res = requests.post(f"{AI_AGENT_URL}/api/agent/evaluate-winner-only", json={
            "title": winner.title,
            "description": winner.description,
            "session_id": session_id,
            "round_id": round_id,
            "keywords": [k.word for k in top_keywords],
            "vp_votes": winner.vp_votes,
        }, timeout=180)
        report = res.json().get("report", "훌륭한 작품입니다.")
    except Exception as e:
        logger.error(f"비평문 생성 실패: {e}")
        report = "비평문 에러"

    return {"message": "Phase 3: 가치 평가 완료", "report": report, "quality_check": quality_result}

# 🟢 [Step 4] 유저 결산 (IPFS 영구 박제 및 스마트 컨트랙트 등록)
class FinalizeReq(BaseModel):
    round_id: int
    price_tuk: int
    duration_days: int

@app.post("/api/admin/finalize")
def finalize_round_to_chain(req: FinalizeReq, db: Session = Depends(get_db)):
    target_round = db.query(models.Round).filter(models.Round.id == req.round_id).first()
    winner = db.query(models.Candidate).filter(models.Candidate.round_id == req.round_id, models.Candidate.is_winner == True).first()

    winner.auction_price = req.price_tuk
    target_round.duration_days = req.duration_days
    target_round.status = RoundPhase.ENDED
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        logger.exception("🔥 라운드 결산 저장 실패")
        raise HTTPException(status_code=500, detail="결산 저장 중 오류가 발생했습니다.")

    # =========================================================
    # 🚨 5. [핵심] 우승작 단 1개만 IPFS에 업로드하여 NFT 박제 준비!
    # =========================================================
    if winner.ipfs_hash == "PENDING" and "/static/images/" in winner.image_url:
        try:
            parsed_url = urllib.parse.urlparse(winner.image_url)
            filepath = parsed_url.path.lstrip("/") 
            if os.path.exists(filepath):
                with open(filepath, "rb") as f:
                    image_bytes = f.read()
                uploaded_cid = upload_bytes_to_ipfs(image_bytes, filename=f"winner_round{req.round_id}.png")
                if uploaded_cid:
                    winner.ipfs_hash = f"ipfs://{uploaded_cid}"
                    winner.image_url = f"https://gateway.pinata.cloud/ipfs/{uploaded_cid}"
        except Exception as e:
            logger.error(f"IPFS 업로드 실패: {e}")
    
    # 🌟 드디어 원래 자리를 찾은 명예의 전당 등록 코드!
    db.add(models.GalleryItem(
        title=winner.title, 
        artist_address="ArtDAO Core AI", 
        image_url=winner.image_url,
        description=winner.description
    ))
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        logger.exception("🔥 명예의 전당 등록 실패")
        raise HTTPException(status_code=500, detail="명예의 전당 등록 중 오류가 발생했습니다.")

    # =========================================================
    # 🚨 6. [핵심] 스마트 컨트랙트 마감 (블록체인 등록)
    # =========================================================
    onchain_ok = False
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
                onchain_ok = True
    except Exception as e:
        logger.error(f"온체인 라운드 마감 실패: {e}")

    # DB는 이미 ENDED로 확정되었으므로, 체인 tx 실패 시 상태만 기록해 불일치를 추적 가능하게 함
    target_round.onchain_status = "confirmed" if onchain_ok else "failed"
    db.commit()

    return {"message": "최종 결산 및 스마트 컨트랙트 등록 완료!", "onchain": onchain_ok}

# 🟢 [가상 판매 (배당금 수령)]
class VirtualSellReq(BaseModel):
    item_id: int
    wallet_address: str

@app.post("/api/gallery/virtual-sell")
def virtual_sell_item(req: VirtualSellReq, db: Session = Depends(get_db)):
    try:
        item = db.query(models.GalleryItem).filter(models.GalleryItem.id == req.item_id).first()
        if not item or getattr(item, 'is_sold', False):
            return {"error": "판매할 수 없는 작품입니다."}

        winner = db.query(models.Candidate).filter(models.Candidate.title == item.title, models.Candidate.is_winner == True).first()
        
        # 🚨 [방어막 1] 원본 후보작 데이터를 찾을 수 없는 경우 (DB 초기화 등으로 꼬였을 때)
        if not winner:
            return {"error": "데이터가 초기화되어 원본 투표 기록을 찾을 수 없습니다."}

        total_user_vp = db.query(func.sum(models.VoteLog.vp_used)).filter(
            models.VoteLog.candidate_id == winner.id, 
            models.VoteLog.voter_wallet == req.wallet_address
        ).scalar() or 0

        if total_user_vp == 0:
            return {"error": "해당 작품에 투자한 지분(VP)이 존재하지 않습니다."}

        # 🚨 [방어막 2] 전체 투표수가 0일 경우 '0 나누기 에러' 완벽 방지
        total_votes = winner.vp_votes if winner.vp_votes > 0 else 1
        
        # 지분 계산 및 수익 분배
        stake_ratio = float(total_user_vp) / float(total_votes)
        auction_price = float(getattr(winner, 'auction_price', 1000) or 1000)
        
        my_profit = (auction_price * 0.7) * stake_ratio
        # DB에 오프체인 가상 수익 저장
        user = db.query(models.User).filter(models.User.wallet_address == req.wallet_address).first()
        if user:
            user.token_balance += my_profit

        item.is_sold = True
        db.commit()

        return {"status": "success", "stake_ratio": stake_ratio * 100, "profit": my_profit, "total_price": auction_price}
        
    except Exception:
        logger.exception("🔥 가상 판매 에러 발생")
        return {"error": "판매 처리 중 오류가 발생했습니다."}


# =========================================================
# 💬 대시보드 통합 토론방 (Global Chat)
# =========================================================
class GlobalChatRequest(BaseModel):
    wallet_address: str
    text: str

@app.get("/api/chat/global")
def get_global_messages(limit: int = 50, db: Session = Depends(get_db)):
    """통합 토론방 메시지 최신 순으로 반환 (보낸 유저의 닉네임과 프로필 사진을 함께 제공)"""
    results = db.query(models.GlobalChatMessage, models.User).outerjoin(
        models.User, models.GlobalChatMessage.wallet_address == models.User.wallet_address
    ).order_by(
        models.GlobalChatMessage.created_at.asc()
    ).limit(limit).all()
    return [
        {
            "id": msg.id,
            "wallet_address": msg.wallet_address,
            "text": msg.text,
            "created_at": msg.created_at.isoformat() if msg.created_at else None,
            "nickname": user.nickname if user else "",
            "profile_pic": user.profile_pic if user else "🔮"
        }
        for msg, user in results
    ]

@app.post("/api/chat/global")
def post_global_message(req: GlobalChatRequest, db: Session = Depends(get_db)):
    """통합 토론방 메시지 저장"""
    msg = models.GlobalChatMessage(
        wallet_address=req.wallet_address,
        text=req.text[:500]  # 최대 500자 제한
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return {"id": msg.id, "status": "ok"}
