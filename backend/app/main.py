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
        response = requests.post(f"{AI_AGENT_URL}/docent", json=payload, timeout=20)
        
        if response.status_code == 200:
            script = response.json().get("commentary", "작품 설명을 불러오지 못했습니다.")
            return {"text_script": script}
        else:
            return {"text_script": "AI 도슨트가 현재 바쁩니다."}
            
    except Exception as e:
        print(f"🔥 도슨트 에러: {str(e)}")
        return {"text_script": "잠시 후 다시 시도해주세요."}
# =========================================================
# 🚨 [수정완료] Botto DAO 라운드 & 후보작 시스템 API
# =========================================================

@app.post("/api/admin/generate-round", summary="새 라운드 생성 및 A2A 그림 5장 뽑기")
def generate_new_round(db: Session = Depends(get_db)):
    # 1. 기존 라운드 종료 처리
    active_round = db.query(models.Round).filter(models.Round.status == "ACTIVE").first()
    if active_round:
        active_round.status = "ENDED"
        active_round.end_time = datetime.utcnow()
        db.commit()

    # 2. 새 라운드 번호 채번
    last_round = db.query(models.Round).order_by(models.Round.round_number.desc()).first()
    next_round_num = (last_round.round_number + 1) if last_round else 1

    new_round = models.Round(round_number=next_round_num, status="ACTIVE")
    db.add(new_round)
    db.commit()
    db.refresh(new_round)
    
    # ✨ [추가] 1. 가장 최신 Market Insights 데이터를 가져옵니다.
    current_insights = get_market_insights()

    # 3. 🚨 AI 에이전트(agent.py)에게 2개의 컨셉 JSON 받아오기
    # (2개를 기획하고 그림을 그리려면 시간이 꽤 걸리므로 timeout을 넉넉히 줍니다)
    print(f"📡 AI 요원들에게 {next_round_num}주차 후보작 2개 기획 지시 중... (약 1분 소요)")
    
    try:
        # ✨ [핵심 변경] 2. AI를 호출할 때 json 바디에 insights 데이터를 꽉 채워서 보냅니다!
        payload = {"insights": current_insights}
        
        # [기존 AI 호출 코드 - 주석 처리]
        # agent_res = requests.post(f"{AI_AGENT_URL}/api/agent/generate-candidates", json=payload, timeout=300)
        # if agent_res.status_code != 200:
        #     raise Exception(f"AI Core 서버 응답 에러: {agent_res.text}")
        # ai_data = agent_res.json().get("candidates", [])

        # [임시 테스트용] AI API 오류 회피를 위한 고정 더미 데이터 (2개)
        ai_data = [
            {"title": "AI Masterpiece - 사이버펑크 2077", "description": "네온사인이 빛나는 근미래 도시를 표현한 3D 렌더링 작품입니다.", "image_prompt": "cyberpunk neon city 3d render"},
            {"title": "AI Masterpiece - 수채화풍 서울", "description": "따뜻한 감성이 묻어나는 수채화 스타일의 고요한 서울 풍경입니다.", "image_prompt": "watercolor seoul landscape calm"}
        ]
    except Exception as e:
        print(f"🔥 AI 통신 에러: {e}")
        raise HTTPException(status_code=500, detail="AI 기획자 호출에 실패했습니다.")

    # 4. 🎨 받아온 영문 프롬프트로 Cloudflare 그림 10장 그리고 IPFS 올리기
    CF_ACCOUNT_ID = os.getenv("CF_ACCOUNT_ID")
    CF_API_TOKEN = os.getenv("CF_API_TOKEN")

    candidate_uris = []

    for index, c_data in enumerate(ai_data, start=1):
        # ✨ [핵심] 에러 방지 로직 적용
        if isinstance(c_data, str):
            title = f"AI Masterpiece {next_round_num}-{index}"
            desc_text = "AI가 생성한 예술 작품입니다."
            prompt = c_data
        else:
            title = c_data.get("title", f"제목 없음 {index}")
            desc_text = c_data.get("description", "설명 없음")
            prompt = c_data.get("image_prompt", "digital art masterpiece")
            # AI가 만든 원본 프롬프트
            base_prompt = c_data.get("image_prompt", "digital art")
            prompt = f"Masterpiece, extremely high quality digital art, trending on artstation, vivid colors, cyberpunk and synthwave vibes, glowing neon lights, holographic, highly detailed 3D digital illustration, Unreal Engine 5 render. Concept: {base_prompt}"

        print(f"🖌️ [{index}/5] '{title}' 이미지 렌더링 중...")
        
        # Cloudflare FLUX에 이미지 요청
        cf_url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell"
        headers = {"Authorization": f"Bearer {CF_API_TOKEN}"}
        
        try:
            img_res = requests.post(cf_url, headers=headers, json={"prompt": prompt}, timeout=60)
            
            # 🚨 IPFS 해시를 PENDING(대기중)으로 설정! (우승하면 채워짐)
            ipfs_hash = "PENDING"
            image_url = "https://dummyimage.com/600x400/000/fff&text=CF+Error"

            if img_res.status_code == 200:
                res_json = img_res.json()
                if "result" in res_json and "image" in res_json["result"]:
                    b64_encoded = res_json["result"]["image"]
                    image_bytes = base64.b64decode(b64_encoded)
                    
                    # 🚨 [핵심 변경] IPFS가 아니라 로컬(오프체인)에 파일로 저장!
                    filename = f"round{next_round_num}_candidate_{index}.png"
                    filepath = f"static/images/{filename}"
                    
                    with open(filepath, "wb") as f:
                        f.write(image_bytes)
                    
                    # 프론트엔드가 접근할 수 있도록 로컬 서버 URL 부여
                    BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")
                    image_url = f"{BASE_URL}/{filepath}"

            # DB에 10개 각각 저장 (image_url은 로컬 주소, ipfs_hash는 PENDING)
            candidate = models.Candidate(
                round_id=new_round.id,
                title=title,
                description=desc_text,
                image_url=image_url,
                ipfs_hash=ipfs_hash
            )
            db.add(candidate)
            candidate_uris.append(image_url)
            
        except Exception as img_e:
            print(f"🔥 [{index}/5] 이미지 생성 실패: {img_e}")
            continue # 실패해도 다음 그림으로 넘어감

    db.commit()
    print("🎉 새 라운드 5개 후보작 DB 세팅 완벽 성공!")

    # 5. [Web3] 블록체인 상에 라운드 시작 (startNewRound)
    try:
        if ADMIN_ACCOUNT:
            dao_contract = get_dao_contract()
            if dao_contract:
                nonce = w3.eth.get_transaction_count(ADMIN_ACCOUNT.address)
                # 라운드 기간을 7일로, 후보작들의 URI 리스트를 전달
                tx = dao_contract.functions.startNewRound(7, candidate_uris).build_transaction({
                    'chainId': 31337,
                    'gas': 3000000,
                    'gasPrice': w3.to_wei('1', 'gwei'),
                    'nonce': nonce,
                })
                signed_tx = w3.eth.account.sign_transaction(tx, private_key=ADMIN_PRIVATE_KEY)
                tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
                w3.eth.wait_for_transaction_receipt(tx_hash)
                print(f"✅ 온체인 라운드 시작 완료: {tx_hash.hex()}")
    except Exception as e:
        print(f"🔥 온체인 라운드 시작 실패: {e}")

    return {"status": "success", "message": f"Round {next_round_num} 5개 후보작 세팅 완료!", "round_id": new_round.id}


# 2. [NEW] 투표 종료, 1등 확정 및 AI 경매 가치 산정
@app.post("/api/admin/end-round", summary="투표 종료 및 AI 경매 가치 산정")
def end_round_and_evaluate(db: Session = Depends(get_db)):
    # 1. 현재 라운드 찾기 & 2. 최고 득표 1등 찾기
    active_round = db.query(models.Round).filter(models.Round.status == "ACTIVE").first()
    if not active_round:
        raise HTTPException(status_code=400, detail="진행 중인 라운드가 없습니다.")

    winner = db.query(models.Candidate).filter(models.Candidate.round_id == active_round.id)\
               .order_by(desc(models.Candidate.vp_votes)).first()
    if not winner:
        raise HTTPException(status_code=400, detail="후보작이 존재하지 않습니다.")

    # 3. 우승 처리
    winner.is_winner = True
    active_round.status = "ENDED"
    active_round.end_time = datetime.utcnow()

    # 4. AI 경매사 호출 (가치 산정)
    try:
        payload = {"title": winner.title, "description": winner.description, "vp_votes": winner.vp_votes}
        res = requests.post(f"{AI_AGENT_URL}/api/agent/evaluate-winner", json=payload, timeout=60)
        winner.auction_price = res.json().get("auction_price", winner.vp_votes * 10) if res.status_code == 200 else winner.vp_votes * 10
    except Exception as e:
        winner.auction_price = winner.vp_votes * 10

    # =========================================================
    # 🚨 5. [핵심] 우승작 단 1개만 IPFS에 업로드하여 NFT 박제 준비!
    # =========================================================
    if winner.ipfs_hash == "PENDING" and "/static/images/" in winner.image_url:
        try:
            import urllib.parse
            # image_url에서 파일 경로만 쏙 빼냅니다. (예: static/images/xxx.png)
            parsed_url = urllib.parse.urlparse(winner.image_url)
            filepath = parsed_url.path.lstrip("/") 
            
            if os.path.exists(filepath):
                print(f"🚀 우승작 발견! IPFS 영구 박제 업로드 중... ({filepath})")
                with open(filepath, "rb") as f:
                    image_bytes = f.read()
                
                # ipfs.py의 함수를 호출해서 IPFS로 전송!
                uploaded_cid = upload_bytes_to_ipfs(image_bytes, filename=f"winner_round{active_round.id}.png")
                
                if uploaded_cid:
                    winner.ipfs_hash = f"ipfs://{uploaded_cid}"
                    # 명예의 전당(Gallery) 전시를 위해 URL도 IPFS 주소로 교체해 줍니다.
                    winner.image_url = f"https://gateway.pinata.cloud/ipfs/{uploaded_cid}"
                    print(f"✅ 우승작 IPFS 박제 완료! (CID: {uploaded_cid})")
        except Exception as e:
            print(f"🔥 우승작 IPFS 업로드 실패: {e}")
    
    # 6. 명예의 전당(GalleryItem) 테이블에 우승작 영구 등록!
    new_gallery_item = models.GalleryItem(
        title=winner.title,
        artist_address="ArtDAO Core AI", # AI가 창작했으므로 작가명을 고정해줍니다
        image_url=winner.image_url,      # IPFS 주소로 업데이트된 이미지 URL
        description=winner.description
    )
    db.add(new_gallery_item)

    db.commit()

    # 7. [Web3] 블록체인 상에 투표 마감 (finalizeRound)
    try:
        if ADMIN_ACCOUNT:
            dao_contract = get_dao_contract()
            if dao_contract:
                nonce = w3.eth.get_transaction_count(ADMIN_ACCOUNT.address)
                auction_price_wei = w3.to_wei(winner.auction_price, 'ether')
                ipfs_uri = winner.ipfs_hash if winner.ipfs_hash != "PENDING" else winner.image_url

                tx = dao_contract.functions.finalizeRound(auction_price_wei, ipfs_uri).build_transaction({
                    'chainId': 31337,
                    'gas': 3000000,
                    'gasPrice': w3.to_wei('1', 'gwei'),
                    'nonce': nonce,
                })
                signed_tx = w3.eth.account.sign_transaction(tx, private_key=ADMIN_PRIVATE_KEY)
                tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
                w3.eth.wait_for_transaction_receipt(tx_hash)
                print(f"✅ 온체인 라운드 마감 완료: {tx_hash.hex()}")
    except Exception as e:
        print(f"🔥 온체인 라운드 마감 실패: {e}")

    return {
        "status": "success", 
        "winner_title": winner.title, 
        "auction_price": winner.auction_price,
        "message": "오프체인 결산 및 우승작 IPFS 업로드 완료!"
    }
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

# =========================================================
# (이 아래로는 기존에 있던 @app.get("/api/rounds/current") 등 코드를 유지하시면 됩니다)

# 2. 🖼️ 프론트엔드 갤러리/투표창에 뿌려줄 현재 라운드 정보 가져오기
@app.get("/api/rounds/current", response_model=schemas.RoundResponse, summary="현재 진행중인 라운드 조회")
def get_current_round(db: Session = Depends(get_db)):
    active_round = db.query(models.Round).filter(models.Round.status == "ACTIVE").first()
    
    if not active_round:
        raise HTTPException(status_code=404, detail="현재 진행 중인 투표 라운드가 없습니다.")
    
    return active_round

# [NEW] 3. 💰 종료된 라운드 목록 가져오기 (배당금 청구용)
@app.get("/api/rounds/ended", summary="종료된 라운드 목록 조회")
def get_ended_rounds(db: Session = Depends(get_db)):
    from sqlalchemy import desc
    rounds = db.query(models.Round).filter(models.Round.status == "ENDED").order_by(desc(models.Round.id)).all()
    res = []
    for r in rounds:
        winner = db.query(models.Candidate).filter(models.Candidate.round_id == r.id, models.Candidate.is_winner == True).first()
        res.append({
            "round_id": r.id,
            "end_time": r.end_time,
            "auction_price": winner.auction_price if winner else 0,
            "winner_title": winner.title if winner else "알 수 없음"
        })
    return res


# 3. 🗳️ 유저 VP 투표 처리 (오프체인 가스비 무료 투표!)
@app.post("/api/vote", summary="후보작에 VP 투표하기")
def cast_vote(req: schemas.VoteRequest, db: Session = Depends(get_db)):
    # 1. 지갑 정보 및 유저 확인
    user = get_user_or_404(req.wallet_address, db)
    
    # 2. 해당 후보작이 존재하는지, 현재 진행중인 라운드인지 확인
    candidate = db.query(models.Candidate).filter(models.Candidate.id == req.candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="존재하지 않는 후보작입니다.")
    
    current_round = db.query(models.Round).filter(models.Round.id == candidate.round_id).first()
    if current_round.status != "ACTIVE":
        raise HTTPException(status_code=400, detail="이미 종료된 라운드의 투표입니다.")

    # 3. 투표력(VP) 검증 (내 잔고 TUK보다 많이 썼는지 확인)
    # 현재 라운드에 이 유저가 지금까지 쓴 총 VP 계산
    used_vp_record = db.query(func.sum(models.VoteLog.vp_used)).filter(
        models.VoteLog.round_id == current_round.id,
        models.VoteLog.voter_wallet == req.wallet_address
    ).scalar() or 0

    if (used_vp_record + req.vp_amount) > user.token_balance:
        raise HTTPException(status_code=400, detail=f"VP가 부족합니다. (내 잔고: {user.token_balance}, 사용가능: {user.token_balance - used_vp_record})")

    # 4. 투표 기록(VoteLog) 남기기 & 후보작 총 득표수(vp_votes) 올리기
    new_vote = models.VoteLog(
        round_id=current_round.id,
        candidate_id=candidate.id,
        voter_wallet=req.wallet_address,
        vp_used=req.vp_amount
    )
    db.add(new_vote)
    
    candidate.vp_votes += req.vp_amount
    db.commit()

    return {"status": "success", "message": f"{candidate.title}에 {req.vp_amount} VP 투표 완료!"}
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
