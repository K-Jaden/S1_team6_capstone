from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from langchain_core.prompts import PromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
import requests
import os
import traceback
from dotenv import load_dotenv # ✅ 추가: .env 파일을 읽기 위한 라이브러리

# .env 파일에 적힌 GOOGLE_API_KEY를 시스템으로 가져옵니다.
load_dotenv()

app = FastAPI(title="S1-6 AI Orchestrator", version="2.0-Ultimate")

# 🔥 환경 변수에서 키 가져오기
MY_GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

# [모델 초기화] 전역 변수로 선언하여 어디서든 쓸 수 있게 합니다.
# 만약 키가 없다면 여기서 명확하게 에러를 출력합니다.
if not MY_GOOGLE_API_KEY:
    print("❌ [경고] GOOGLE_API_KEY를 찾을 수 없습니다. .env 파일을 확인하세요!")

try:
    llm = ChatGoogleGenerativeAI(
        model="models/gemini-flash-latest", # models/gemini-flash-latest는 2.5-flash 이상
        google_api_key=MY_GOOGLE_API_KEY,
        temperature=0.7,
        convert_system_message_to_human=True
    )
    print("✅ Gemini 2.0 Flash 모델 로드 성공!")
except Exception as e:
    print(f"🔥 모델 초기화 중 치명적 에러: {e}")
    llm = None # 초기화 실패 시 None으로 설정

# 도커 네트워크 안에서 백엔드를 찾기 위한 주소
BACKEND_URL = "http://art_backend:8000"

# --- 데이터 모델 ---
class PlanRequest(BaseModel):
    intent: str

class WorkRequest(BaseModel):
    wallet_address: str = "0xTest"
    topic: str
    style: str

class ReviewRequest(BaseModel):
    art_info: str

class PromoRequest(BaseModel): # ✅ 마케터용 모델 복구
    exhibition_title: str
    target_audience: str

class DocentRequest(BaseModel):
    art_info: str          # 설명할 작품 정보 (화가가 만든 프롬프트나 비평가의 글)
    audience_type: str = "일반 관람객"  # 예: "어린이", "미술 전공자", "VIP 투자자" 등    

class AuctionRequest(BaseModel):
    art_info: str       # 화가가 만든 프롬프트 내용
    critic_review: str  # 비평가가 쓴 비평문 (이게 가격 결정의 핵심!)

@app.get("/")
def read_root():
    return {"status": "AI Squad Ready", "model": "Gemini 2.0 Flash"}

# ==========================================
# 📝 Agent 1: 수석 큐레이터 (Curator) 
# ==========================================
@app.post("/propose")
def create_proposal(request: PlanRequest):
    if not llm:
        raise HTTPException(status_code=500, detail="AI 모델이 초기화되지 않았습니다.")
    
    print(f"✅ [기획자] 작업 시작: {request.intent}")
    try:
        template = PromptTemplate.from_template(
            "너는 DAO 기반 미술관의 수석 큐레이터야. '{intent}'라는 주제를 바탕으로 "
            "투자자들을 매료시킬 수 있는 아주 전문적이고 예술적인 전시 기획서를 한글로 작성해줘.\n"
            "포함할 내용: 1.전시 제목 2.기획 의도 3.스토리라인 4.기대 효과"
        )
        chain = template | llm
        result = chain.invoke({"intent": request.intent})
        return {"draft_text": result.content}
    except Exception as e:
        print(f"🔥 [기획자] 에러:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 🎨 Agent 2: 화가 (Artist) 
# ==========================================
@app.post("/generate")
def start_work(request: WorkRequest):
    if not llm:
        raise HTTPException(status_code=500, detail="AI 모델이 초기화되지 않았습니다.")

    print(f"✅ [화가] 프롬프트 생성: {request.topic}")
    try:
        template = PromptTemplate.from_template(
            "너는 세계적인 아방가르드 아티스트야. '{topic}' 주제를 '{style}' 스타일로 "
            "그리기 위한 아주 정교하고 묘사적인 영어 프롬프트를 3문장으로 작성해줘. (오직 영어만 출력)"
        )
        chain = template | llm
        result = chain.invoke({"topic": request.topic, "style": request.style})
        
        # 백엔드로 전송 (A2A 연동)
        try:
            requests.post(f"{BACKEND_URL}/api/studio/image", json={
                "keywords": result.content, 
                "style": request.style
            }, timeout=5)
        except:
            print("⚠️ 백엔드 전송 실패 (서버가 꺼져있을 수 있음)")

        return {"final_prompt": result.content}
    except Exception as e:
        print(f"🔥 [화가] 에러:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 🧐 Agent 3: 비평가 (Critic) 
# ==========================================
@app.post("/review")
def create_review(request: ReviewRequest):
    if not llm:
        raise HTTPException(status_code=500, detail="AI 모델이 초기화되지 않았습니다.")

    print(f"✅ [비평가] 비평 작성 시작")
    try:
        template = PromptTemplate.from_template(
            "너는 날카로운 통찰력을 가진 미술 비평가야. 작품 정보('{art_info}')를 읽고 "
            "관람객들의 지적 호기심을 자극할 우아한 비평 해설을 300자 내외로 작성해줘."
        )
        chain = template | llm
        result = chain.invoke({"art_info": request.art_info})
        return {"review_text": result.content}
    except Exception as e:
        print(f"🔥 [비평가] 에러:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 📢 Agent 4: 마케터 (Marketer) 
# ==========================================
@app.post("/promote")
def create_promo(request: PromoRequest):
    if not llm:
        raise HTTPException(status_code=500, detail="AI 모델이 초기화되지 않았습니다.")

    print(f"✅ [마케터] SNS 카피라이팅 시작: {request.exhibition_title}")
    try:
        template = PromptTemplate.from_template(
            "너는 바이럴 마케팅 전문가야. '{exhibition_title}' 전시회를 '{target_audience}'에게 "
            "홍보하기 위한 인스타그램 감성 문구를 이모지와 해시태그를 포함해서 작성해줘."
        )
        chain = template | llm
        result = chain.invoke({
            "exhibition_title": request.exhibition_title,
            "target_audience": request.target_audience
        })
        return {"promo_text": result.content}
    except Exception as e:
        print(f"🔥 [마케터] 에러:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))
    
    # ==========================================
# 🗣️ Agent 5: 도슨트 (Docent) - 관람객 가이드
# ==========================================
@app.post("/docent")
def start_tour(request: DocentRequest):
    if not llm:
        raise HTTPException(status_code=500, detail="AI 모델이 초기화되지 않았습니다.")

    print(f"✅ [도슨트] 투어 시작: 대상({request.audience_type})")
    try:
        # 💡 핵심: 대상(audience_type)에 따라 톤앤매너를 바꾸는 페르소나 부여
        template = PromptTemplate.from_template(
            "너는 미술관의 친절하고 재치 있는 전문 도슨트야. "
            "지금 네 앞에는 '{audience_type}'들이 설명을 듣기 위해 모여있어. "
            "이 작품 정보('{art_info}')를 바탕으로, 대상의 눈높이에 딱 맞춰서 "
            "아주 흥미롭고 생동감 넘치는 작품 해설 대본을 작성해줘.\n"
            "조건: 1. 구어체(대화체) 사용 2. 관람객에게 질문을 던지며 상호작용 유도 3. 어려운 용어는 쉽게 풀어서 설명"
        )
        
        chain = template | llm
        result = chain.invoke({
            "art_info": request.art_info,
            "audience_type": request.audience_type
        })
        
        return {"commentary": result.content}

    except Exception as e:
        print(f"🔥 [도슨트] 에러:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))
    
# ==========================================
# 🔨 Agent 6: 경매사 (Auctioneer) - 가격 산정 및 진행
# ==========================================
@app.post("/auction")
def open_auction(request: AuctionRequest):
    if not llm:
        raise HTTPException(status_code=500, detail="AI 모델이 초기화되지 않았습니다.")

    print(f"✅ [경매사] 가치 평가 및 경매 개시 준비 중...")
    try:
        # 💡 핵심: 비평가의 평가(critic_review)에 따라 가격을 동적으로 책정하는 논리
        template = PromptTemplate.from_template(
            "너는 최고의 안목을 가진 DAO 아트 마켓의 베테랑 경매사야. "
            "방금 도착한 작품 정보('{art_info}')와 이에 대한 비평가의 평가('{critic_review}')를 분석해라.\n"
            "비평가가 극찬했다면 시작가를 높게, 혹평했다면 낮게 책정해야 해.\n"
            "다음 3가지 내용을 포함해서 경매 개시 리포트를 작성해줘.\n"
            "1. 경매 시작가 (단위: ETH, 소수점 2자리까지)\n"
            "2. 가격 책정 이유 (비평가의 멘트를 인용해서 설득력 있게)\n"
            "3. 투자자들의 심장을 뛰게 만들 긴박하고 화려한 경매 오프닝 멘트 (쇼맨십 발휘)"
        )
        
        chain = template | llm
        result = chain.invoke({
            "art_info": request.art_info,
            "critic_review": request.critic_review
        })
        
        return {"auction_report": result.content}

    except Exception as e:
        print(f"🔥 [경매사] 에러:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))