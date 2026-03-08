from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from langchain_core.prompts import PromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
import os
import traceback
from dotenv import load_dotenv

# .env 파일 로드
load_dotenv()

app = FastAPI(title="S1-6 AI Orchestrator", version="4.0-Persona-Enhanced")

# 환경 변수 체크
MY_GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if not MY_GOOGLE_API_KEY:
    print("❌ [경고] GOOGLE_API_KEY가 없습니다!")

try:
    llm = ChatGoogleGenerativeAI(
        model="models/gemini-flash-latest",
        google_api_key=MY_GOOGLE_API_KEY,
        temperature=0.8  # 창의성을 위해 0.7 -> 0.8로 약간 상향
    )
    print("✅ [AI] Gemini 모델 로드 완료 (Persona Mode: ON)")
except Exception as e:
    print(f"🔥 모델 초기화 실패: {e}")
    llm = None

# ==================================================================
# 🎭 [핵심] 페르소나(Persona) & 스타일 가이드 정의
# ==================================================================

# 1. 출력 형식 (가독성)
FORMAT_INSTRUCTION = """
[출력 스타일 가이드]
1. **구조화**: 긴 줄글 대신 **불렛 포인트(-)**와 **소제목**을 적극 활용하세요.
2. **여백**: 문단 사이에는 반드시 **빈 줄**을 넣어 가독성을 높이세요.
3. **길이**: 너무 짧게 끝내지 말고, 전문가로서 충분한 통찰을 제공하세요.
"""

# 2. 각 전문가의 자아(System Prompts)
PERSONA_PLANNER = """
당신은 **20년 경력의 베테랑 전시 기획자(Chief Curator)**입니다.
단순한 아이디어가 아니라, 예술적 가치와 대중성을 동시에 고려한 **거시적인 비전**을 제시해야 합니다.
어조: 논리적이고, 비전 제시적이며, 확신에 찬 어조.
"""

PERSONA_PAINTER = """
당신은 **전위적인 디지털 아티스트**입니다.
기술적인 용어(Lighting, Texture, Style)를 사용하여 AI가 그림을 잘 그릴 수 있도록 **매우 구체적이고 묘사적인 영어 프롬프트**를 작성해야 합니다.
"""

PERSONA_CRITIC = """
당신은 **뉴욕 MoMA 출신의 까칠하지만 식견 높은 미술 비평가**입니다.
단순히 "좋다/나쁘다"가 아니라, 색채의 상징성, 구도의 안정성, 미술사적 맥락을 짚어가며 **심층적으로 분석**해야 합니다.
어조: 날카롭고, 지적이며, 분석적인 어조. (예: "이 작품의 붓터치는 고흐의 고뇌를 연상시키며...")
"""

PERSONA_MARKETER = """
당신은 **트렌드를 이끄는 MZ세대 마케팅 전문가**입니다.
사람들의 감성을 자극하는 **감성적인 카피라이팅**과 **적절한 해시태그**, **이모지**를 사용하여 클릭을 유도하세요.
어조: 활기차고, 감각적이며, 친근한 어조. (이모지 필수! 🎨✨🔥)
"""

PERSONA_AUCTIONEER = """
당신은 **세계적인 경매 회사 소더비(Sotheby's)의 수석 경매사**입니다.
작품의 희소성과 미래 가치를 강조하여 **구매 욕구를 자극**해야 합니다.
어조: 정중하지만 긴박감을 조성하고, 신뢰감을 주는 어조.
"""

PERSONA_DOCENT = """
당신은 **국립현대미술관의 친절한 도슨트(해설사)**입니다.
어려운 미술 용어를 쓰지 않고, 관람객에게 **이야기를 들려주듯이** 편안하게 설명해야 합니다.
어조: 따뜻하고, 친절하며, 대화하듯 자연스러운 어조. (존댓말 사용)
"""

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

class FullCourseRequest(BaseModel):
    topic: str
    style: str = "Digital Art"

# 헬퍼 함수
def parse_response(content):
    try:
        if isinstance(content, list):
            return "".join([c.get('text', '') for c in content if c.get('type') == 'text'])
        return str(content)
    except Exception as e:
        return str(content)

@app.get("/")
def read_root():
    return {"status": "AI Personas Loaded", "mode": "Expert"}

# ==================================================================
# 🚀 [Full-Course] 페르소나 적용된 풀코스
# ==================================================================
@app.post("/full-course")
def run_full_course(request: FullCourseRequest):
    if not llm: raise HTTPException(500, "AI 로드 실패")
    print(f"🔥 [풀코스] 전문가 팀 소집: {request.topic}")
    
    results = {}
    
    try:
        # 1. 화가 (영어 프롬프트)
        painter_chain = PromptTemplate.from_template(
            f"{PERSONA_PAINTER}\n"
            "주제: '{topic}', 스타일: '{style}'. \n"
            "Generate a highly detailed English prompt for image generation."
        ) | llm
        img_prompt = parse_response(painter_chain.invoke({"topic": request.topic, "style": request.style}).content)
        results["image_prompt"] = img_prompt

        # 2. 비평가 (전문가 비평)
        critic_chain = PromptTemplate.from_template(
            f"{PERSONA_CRITIC}\n{FORMAT_INSTRUCTION}\n"
            "작품 주제: '{topic}', 스타일: '{style}'. \n"
            "이 작품이 완성되었다고 가정하고, 미술사적 맥락을 포함한 심도 있는 비평문을 작성하시오."
        ) | llm
        review_text = parse_response(critic_chain.invoke({"topic": request.topic, "style": request.style}).content)
        results["critic_review"] = review_text

        # 3. 도슨트 (스토리텔링)
        docent_chain = PromptTemplate.from_template(
            f"{PERSONA_DOCENT}\n{FORMAT_INSTRUCTION}\n"
            "작품 주제: '{topic}', 비평 요약: '{review}'. \n"
            "관람객들에게 말을 걸듯이 재미있게 작품을 해설해주세요."
        ) | llm
        docent_text = parse_response(docent_chain.invoke({"topic": request.topic, "review": review_text}).content)
        results["docent_script"] = docent_text

        # 4. 경매사 (가치 평가)
        auction_chain = PromptTemplate.from_template(
            f"{PERSONA_AUCTIONEER}\n{FORMAT_INSTRUCTION}\n"
            "작품: '{topic}', 비평: '{review}'. \n"
            "이 작품의 소장 가치를 강력하게 어필하고, 경매 시작가(ETH)와 오프닝 멘트를 작성하시오."
        ) | llm
        auction_text = parse_response(auction_chain.invoke({"topic": request.topic, "review": review_text}).content)
        results["auction_report"] = auction_text

        return results

    except Exception as e:
        print(traceback.format_exc())
        return {"error": str(e)}

# ==================================================================
# 개별 에이전트 (페르소나 적용 완료)
# ==================================================================

# 1. 기획자
@app.post("/propose")
def create_proposal(request: PlanRequest):
    if not llm: raise HTTPException(500, "AI 로드 실패")
    try:
        chain = PromptTemplate.from_template(
            f"{PERSONA_PLANNER}\n{FORMAT_INSTRUCTION}\n"
            "클라이언트 요청: '{intent}'. \n"
            "위 요청을 바탕으로 차별화된 전시 기획안을 작성하시오."
        ) | llm
        return {"draft_text": parse_response(chain.invoke({"intent": request.intent}).content)}
    except Exception:
        return {"draft_text": "AI 에러"}

# 2. 화가
@app.post("/generate")
def start_work(request: WorkRequest):
    if not llm: raise HTTPException(500, "AI 로드 실패")
    try:
        chain = PromptTemplate.from_template(
            f"{PERSONA_PAINTER}\n"
            "주제: '{topic}', 스타일: '{style}'. \n"
            "Generate a creative and detailed English prompt."
        ) | llm
        return {"final_prompt": parse_response(chain.invoke({"topic": request.topic, "style": request.style}).content)}
    except Exception:
        return {"final_prompt": "Error"}

# 3. 비평가
@app.post("/review")
def create_review(request: ReviewRequest):
    if not llm: raise HTTPException(500, "AI 로드 실패")
    try:
        safe_info = request.art_info if request.art_info else "작품 정보 없음"
        chain = PromptTemplate.from_template(
            f"{PERSONA_CRITIC}\n{FORMAT_INSTRUCTION}\n"
            "대상 작품: '{art_info}'. \n"
            "전문가의 시선으로 이 작품을 냉철하게 분석하고 평가하시오."
        ) | llm
        return {"review_text": parse_response(chain.invoke({"art_info": safe_info}).content)}
    except Exception:
        return {"review_text": "비평 실패"}

# 4. 마케터
@app.post("/promote")
def create_promo(request: PromoRequest):
    if not llm: raise HTTPException(500, "AI 로드 실패")
    try:
        chain = PromptTemplate.from_template(
            f"{PERSONA_MARKETER}\n{FORMAT_INSTRUCTION}\n"
            "전시 제목: '{title}'. 타겟: '{target}'. \n"
            "이 전시가 SNS에서 바이럴 될 수 있도록 매력적인 홍보 문구를 작성해줘."
        ) | llm
        return {"promo_text": parse_response(chain.invoke({"title": request.exhibition_title, "target": request.target_audience}).content)}
    except Exception:
        return {"promo_text": "마케팅 실패"}

# 5. 경매사
@app.post("/auction")
def open_auction(request: AuctionRequest):
    if not llm: raise HTTPException(500, "AI 로드 실패")
    try:
        safe_info = request.art_info if request.art_info else "미상 작품"
        safe_review = request.critic_review if request.critic_review else "평가 없음"
        chain = PromptTemplate.from_template(
            f"{PERSONA_AUCTIONEER}\n{FORMAT_INSTRUCTION}\n"
            "작품 정보: {art_info}, 비평 내용: {critic_review}. \n"
            "이 정보를 바탕으로 경매 리포트(시작가, 가치 평가, 오프닝 멘트)를 작성하시오."
        ) | llm
        return {"auction_report": parse_response(chain.invoke({"art_info": safe_info, "critic_review": safe_review}).content)}
    except Exception:
        return {"auction_report": "경매 실패"}

# 6. 도슨트
@app.post("/docent")
def start_tour(request: DocentRequest):
    if not llm: raise HTTPException(500, "AI 로드 실패")
    try:
        chain = PromptTemplate.from_template(
            f"{PERSONA_DOCENT}\n{FORMAT_INSTRUCTION}\n"
            "작품 정보: {art_info}. \n"
            "관람객({aud})이 흥미를 느낄 수 있도록 재미있는 해설 대본을 작성해줘."
        ) | llm
        return {"commentary": parse_response(chain.invoke({"art_info": request.art_info, "aud": request.audience_type}).content)}
    except Exception:
        return {"commentary": "해설 실패"}
    
# ai_core/agent.py 맨 아래에 붙여넣기

# ai_core/agent.py

@app.get("/test-blockchain")
def test_blockchain_connection():
    try:
        from blockchain import BlockchainService
        svc = BlockchainService()
        
        # 6개의 테스트용 더미 데이터 전달
        result = svc.submit_proposal(
            "테스트 전시회",           # title
            "AI가 생성한 테스트 설명",   # description
            "QmTest1234567890",       # ipfs_hash
            100,                      # funding_goal (예: 100 TUK)
            10,                       # min_contribution
            7                         # duration_days
        )
        return result
    except Exception as e:
        return {"status": "error", "message": str(e)}