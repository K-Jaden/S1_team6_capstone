from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from langchain_core.prompts import PromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
import requests
import os

# [설정] 앱 정보 (버전 업그레이드)
app = FastAPI(title="S1-6 AI Orchestrator Squad", version="Final-High-Performance")

# -----------------------------------------------------------
# 🔥 API 키 (본인 키 유지)
MY_GOOGLE_API_KEY = "AIzaSyC52mDKtEQgM7KRoxpKUbTRZYImPOxHFuc" 
# -----------------------------------------------------------

# [모델] Gemini Flash Latest
# temperature를 0.7로 두어 창의성을 유지하되, 프롬프트로 제어합니다.
llm = ChatGoogleGenerativeAI(
    model="models/gemini-flash-latest", 
    google_api_key=MY_GOOGLE_API_KEY,
    temperature=0.7
)

# 백엔드 주소 (Docker 내부 통신용)
BACKEND_URL = "http://localhost:8000"

# ==========================================
# [데이터 모델] 요청 양식 정의
# ==========================================
class WorkRequest(BaseModel):
    wallet_address: str
    topic: str
    style: str

class PlanRequest(BaseModel):
    intent: str

class ReviewRequest(BaseModel):
    art_info: str

class PromoRequest(BaseModel):
    exhibition_title: str
    target_audience: str

@app.get("/")
def read_root():
    return {"status": "AI Squad Ready (High Performance Mode)"}

# ==========================================
# 🎨 Agent 1: 화가 (Artist) - 디테일 강화
# ==========================================
@app.post("/generate", summary="이미지 생성 프롬프트 작성")
def start_work(request: WorkRequest):
    print(f"✅ [화가] 작업 시작: 주제 '{request.topic}' / 스타일 '{request.style}'")
    
    final_prompt = ""
    try:
        # [성능 UP] 화가에게 구체적인 묘사 방법과 조명, 구도까지 지시함
        template = PromptTemplate.from_template(
            "너는 세계적인 디지털 아티스트야. 사용자가 '{topic}' 주제를 '{style}' 스타일로 그려달라고 요청했어.\n"
            "DALL-E 3와 같은 이미지 생성 AI가 최고의 퀄리티를 낼 수 있도록, 다음 요소들을 포함해서 영어 프롬프트를 작성해줘:\n"
            "1. 주제의 핵심 피사체에 대한 정밀한 묘사\n"
            "2. 배경, 조명(Lighting), 분위기(Mood), 질감(Texture)\n"
            "3. 카메라 구도(Camera Angle) 및 렌즈 효과\n"
            "조건: 서론/결론 없이 오직 3~4문장의 영어 묘사 텍스트만 출력할 것."
        )
        chain = template | llm
        result = chain.invoke({"topic": request.topic, "style": request.style})
        final_prompt = result.content
        print(f"🧠 [화가] 고해상도 프롬프트 설계 완료")
    except Exception as e:
        print(f"🔥 [화가] Gemini 에러: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI Error: {str(e)}")

    # 백엔드 전송
    image_url = "생성 실패"
    try:
        res = requests.post(f"{BACKEND_URL}/api/studio/image", json={"keywords": final_prompt})
        if res.status_code == 200:
            image_url = res.json().get("image_url")
            print(f"📤 [화가] 백엔드 전송 성공")
        else:
            image_url = f"Error: {res.text}"
            print(f"⚠️ [화가] 백엔드 거부: {res.status_code}")
    except Exception as e:
        print(f"🔥 [화가] 통신 에러: {str(e)}")
        image_url = "Backend Connection Failed"

    return {"message": "Success", "final_prompt": final_prompt, "image_url": image_url}

# ==========================================
# 📝 Agent 2: 기획자 (Chief Curator) - 성능 대폭 강화
# ==========================================
@app.post("/propose", summary="전시 기획서 작성")
def create_proposal(request: PlanRequest):
    print(f"✅ [기획자] 기획 시작: 의도 '{request.intent}'")
    try:
        # [성능 UP] DAO, 투자 가치, 스토리텔링을 강조하도록 지시
        template = PromptTemplate.from_template(
            "너는 DAO 기반 미술관의 수석 큐레이터(Chief Curator)야.\n"
            "사용자가 제안한 거칠고 추상적인 아이디어인 '{intent}'를 바탕으로, "
            "미술관 DAO 멤버들과 투자자들이 투표하고 싶어지도록 설득력 있고 전문적인 전시 기획서를 작성해줘.\n\n"
            "반드시 아래 소제목을 포함하여 마크다운이나 줄글 형식으로 상세히 작성해줘:\n"
            "1. [전시 제목]: 관람객의 호기심을 자극하는 매력적인 제목\n"
            "2. [기획 의도]: 왜 지금 이 전시가 필요한가? 사회적/예술적 의의 (3문장 이상)\n"
            "3. [전시 스토리라인]: 기승전결이 있는 전시의 흐름 구성\n"
            "4. [핵심 관람 타겟]: 이 전시를 좋아할 구체적인 관람객층과 기대 효과\n"
            "\n(톤앤매너: 예술적이면서도 논리적인 전문 큐레이터의 말투)"
        )
        chain = template | llm
        result = chain.invoke({"intent": request.intent})
        print(f"🧠 [기획자] 기획서 작성 완료 (길이: {len(result.content)}자)")
        return {"draft_text": result.content}
    except Exception as e:
        print(f"🔥 [기획자] 에러 발생: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 🧐 Agent 3: 비평가 (Art Critic) - 깊이 추가
# ==========================================
@app.post("/review", summary="작품 비평 작성")
def create_review(request: ReviewRequest):
    print(f"✅ [비평가] 비평 시작")
    try:
        # [성능 UP] 단순 칭찬이 아니라 예술적 맥락을 분석하도록 지시
        template = PromptTemplate.from_template(
            "너는 날카로운 통찰력을 가진 저명한 미술 비평가야.\n"
            "이 작품에 대한 정보('{art_info}')를 분석하고, 관람객들이 작품의 이면에 담긴 의미를 이해할 수 있도록 해설을 작성해줘.\n"
            "단순한 묘사가 아니라, 작품이 주는 감정, 색채의 상징성, 그리고 예술적 가치를 중심으로 300자 내외로 서술해줘."
        )
        chain = template | llm
        result = chain.invoke({"art_info": request.art_info})
        print(f"🧠 [비평가] 비평 작성 완료")
        return {"review_text": result.content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 📢 Agent 4: 마케터 (Viral Marketer) - 바이럴 요소 추가
# ==========================================
@app.post("/promote", summary="홍보 문구 작성")
def create_promo(request: PromoRequest):
    print(f"✅ [마케터] 마케팅 전략 수립")
    try:
        # [성능 UP] 플랫폼별 특성과 이모지, 해시태그 전략 추가
        template = PromptTemplate.from_template(
            "너는 인스타그램과 트위터에서 활동하는 바이럴 마케팅 전문가야.\n"
            "'{exhibition_title}' 전시회를 '{target_audience}'에게 홍보해야 해.\n"
            "MZ세대의 트렌드에 맞는 감성적인 문구와 이모지를 적절히 섞어서, 당장이라도 예매하고 싶게 만드는 홍보글을 작성해줘.\n"
            "마지막에는 유입을 늘릴 수 있는 관련 해시태그 5개를 반드시 포함해줘."
        )
        chain = template | llm
        result = chain.invoke({
            "exhibition_title": request.exhibition_title, 
            "target_audience": request.target_audience
        })
        print(f"🧠 [마케터] 카피라이팅 완료")
        return {"promo_text": result.content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))