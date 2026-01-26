from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from langchain_core.prompts import PromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
import requests
import os
import traceback
from dotenv import load_dotenv

# .env 파일 로드
load_dotenv()

app = FastAPI(title="S1-6 AI Orchestrator", version="2.1-Fixed")

# 환경 변수 체크
MY_GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if not MY_GOOGLE_API_KEY:
    print("❌ [경고] GOOGLE_API_KEY가 없습니다!")

try:
    llm = ChatGoogleGenerativeAI(
        model="models/gemini-flash-latest",
        google_api_key=MY_GOOGLE_API_KEY,
        temperature=0.7
    )
    print("✅ [AI] Gemini 모델 로드 완료")
except Exception as e:
    print(f"🔥 모델 초기화 실패: {e}")
    llm = None

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

class PromoRequest(BaseModel):
    exhibition_title: str
    target_audience: str

class DocentRequest(BaseModel):
    art_info: str
    audience_type: str = "일반 관람객"

class AuctionRequest(BaseModel):
    art_info: str
    critic_review: str

# ✅ [핵심 함수] AI 응답이 리스트로 올 때 텍스트만 추출하는 헬퍼 함수
def parse_response(content):
    try:
        # 만약 내용이 리스트라면 (이번 에러의 원인!)
        if isinstance(content, list):
            # [{'text': '내용...'}] 형태에서 텍스트만 합침
            return "".join([c.get('text', '') for c in content if c.get('type') == 'text'])
        return str(content)
    except Exception as e:
        print(f"⚠️ 파싱 에러 (원본 반환): {e}")
        return str(content)

@app.get("/")
def read_root():
    return {"status": "AI Alive", "model": "Gemini-Flash-Latest"}

# 1. 기획자
@app.post("/propose")
def create_proposal(request: PlanRequest):
    if not llm: raise HTTPException(500, "AI 로드 실패")
    print(f"✅ [기획자] 요청: {request.intent}")
    try:
        chain = PromptTemplate.from_template("'{intent}' 주제로 전문적인 전시 기획서를 작성해줘.") | llm
        result = chain.invoke({"intent": request.intent})
        # ✅ 여기서 파싱 함수 사용!
        return {"draft_text": parse_response(result.content)}
    except Exception as e:
        print(traceback.format_exc())
        return {"draft_text": "AI 에러 발생"}

# 2. 화가
@app.post("/generate")
def start_work(request: WorkRequest):
    if not llm: raise HTTPException(500, "AI 로드 실패")
    print(f"✅ [화가] 요청: {request.topic}")
    try:
        chain = PromptTemplate.from_template("'{topic}' 주제, '{style}' 스타일의 그림을 그리기 위한 영어 프롬프트만 작성해.") | llm
        result = chain.invoke({"topic": request.topic, "style": request.style})
        final_text = parse_response(result.content)
        
        return {"final_prompt": final_text}
    except Exception as e:
        return {"final_prompt": "Error"}

# 3. 비평가
@app.post("/review")
def create_review(request: ReviewRequest):
    if not llm: raise HTTPException(500, "AI 로드 실패")
    print(f"✅ [비평가] 요청")
    try:
        safe_info = request.art_info if request.art_info else "작품 정보 없음"
        chain = PromptTemplate.from_template("작품 정보: '{art_info}'. 이에 대한 심도 있는 미술 비평을 작성해줘.") | llm
        result = chain.invoke({"art_info": safe_info})
        return {"review_text": parse_response(result.content)}
    except Exception as e:
        return {"review_text": "비평 생성 실패"}

# 4. 마케터
@app.post("/promote")
def create_promo(request: PromoRequest):
    if not llm: raise HTTPException(500, "AI 로드 실패")
    try:
        chain = PromptTemplate.from_template("'{title}' 전시를 '{target}'에게 홍보할 인스타그램 문구를 작성해줘.") | llm
        result = chain.invoke({"title": request.exhibition_title, "target": request.target_audience})
        return {"promo_text": parse_response(result.content)}
    except Exception as e:
        return {"promo_text": "마케팅 문구 실패"}

# 5. 경매사
@app.post("/auction")
def open_auction(request: AuctionRequest):
    if not llm: raise HTTPException(500, "AI 로드 실패")
    print(f"✅ [경매사] 요청")
    try:
        safe_info = request.art_info if request.art_info else "미상 작품"
        safe_review = request.critic_review if request.critic_review else "평가 없음"
        
        template = PromptTemplate.from_template(
            "작품: {art_info}, 비평: {critic_review}. \n"
            "이 정보를 바탕으로 경매 시작가(ETH), 책정 이유, 오프닝 멘트가 포함된 경매 리포트를 작성해줘."
        )
        chain = template | llm
        result = chain.invoke({"art_info": safe_info, "critic_review": safe_review})
        return {"auction_report": parse_response(result.content)}
    except Exception as e:
        print(traceback.format_exc())
        return {"auction_report": "경매 리포트 생성 실패"}

# 6. 도슨트
@app.post("/docent")
def start_tour(request: DocentRequest):
    if not llm: raise HTTPException(500, "AI 로드 실패")
    try:
        chain = PromptTemplate.from_template("작품: {art_info}. 관람객({aud})에게 설명할 도슨트 대본을 작성해줘.") | llm
        result = chain.invoke({"art_info": request.art_info, "aud": request.audience_type})
        return {"commentary": parse_response(result.content)}
    except Exception as e:
        return {"commentary": "해설 생성 실패"}