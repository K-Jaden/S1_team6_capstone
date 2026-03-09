import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from crewai import Agent, Task, Crew, Process, LLM 
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="ArtDAO CrewAI A2A Server", version="5.0-True-A2A")

MY_GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if not MY_GOOGLE_API_KEY:
    print("❌ [경고] GOOGLE_API_KEY가 없습니다!")

# 🚨 [수정 완료] model= 중복 제거 & 검증된 이름(gemini-flash-latest) 사용
try:
    llm = LLM(
        model="gemini/gemini-flash-latest", # 👈 이렇게 딱 적어주시면 됩니다!
        api_key=MY_GOOGLE_API_KEY,
        temperature=0.7
    )
    print("✅ [AI] Gemini & CrewAI 엔진 로드 완료")
except Exception as e:
    print(f"🔥 모델 초기화 실패: {e}")
    llm = None

# ==================================================================
# 🤖 1. 에이전트(Agent) 정의: 각자의 자아와 목표 (진짜 AI 팀원들)
# ==================================================================
planner = Agent(
    role='수석 전시 기획자',
    goal='대중성과 예술성을 모두 갖춘 완벽한 전시 기획서 작성',
    backstory='당신은 20년 경력의 베테랑 큐레이터입니다. 단순한 아이디어도 거시적인 예술 비전으로 확장시킵니다.',
    llm=llm,
    verbose=True
)

painter = Agent(
    role='수석 디지털 아티스트',
    goal='기획서를 완벽하게 시각화할 수 있는 디테일한 영문 프롬프트 작성',
    backstory='당신은 빛, 질감, 구도를 완벽하게 이해하는 디지털 아티스트입니다. 그림 프롬프트를 짤 때 한자, 중국어, 일본어가 나오지 않도록 철저히 통제합니다.',
    llm=llm,
    verbose=True
)

critic = Agent(
    role='수석 미술 비평가',
    goal='작품을 미술사적 맥락에서 심층적으로 분석하고 비평',
    backstory='당신은 뉴욕 MoMA 출신의 식견 높고 까칠한 비평가입니다. 색채와 구도를 날카롭게 분석합니다.',
    llm=llm,
    verbose=True
)

marketer = Agent(
    role='MZ세대 바이럴 마케터',
    goal='전시회를 SNS에서 화제성 1위로 만들 매력적인 카피라이팅 작성',
    backstory='당신은 트렌드에 극도로 민감한 마케터입니다. 이모지와 해시태그를 적극 활용합니다.',
    llm=llm,
    verbose=True
)

auctioneer = Agent(
    role='소더비 수석 경매사',
    goal='비평을 바탕으로 작품의 가치를 극대화하는 경매 리포트 작성',
    backstory='당신은 세계 최고의 경매사입니다. 긴장감을 조성하고 희소성을 어필합니다.',
    llm=llm,
    verbose=True
)

docent = Agent(
    role='친절한 국립현대미술관 도슨트',
    goal='어려운 미술 용어 없이 누구나 쉽게 이해할 수 있는 스토리텔링 해설 작성',
    backstory='당신은 따뜻한 말투(존댓말)로 관람객과 소통하는 해설사입니다.',
    llm=llm,
    verbose=True
)


# ==================================================================
# 📦 2. Pydantic 모델 (프론트/백엔드 호환성 유지용)
# ==================================================================
class PlanRequest(BaseModel): intent: str
class WorkRequest(BaseModel): topic: str; style: str
class ReviewRequest(BaseModel): art_info: str
class PromoRequest(BaseModel): exhibition_title: str; target_audience: str
class AuctionRequest(BaseModel): art_info: str; critic_review: str
class DocentRequest(BaseModel): art_info: str; audience_type: str = "일반 관람객"


# ==================================================================
# 🚀 3. API 엔드포인트 (CrewAI Task 할당 및 실행)
# ==================================================================

@app.post("/propose")
def create_proposal(request: PlanRequest):
    task = Task(
        description=f"클라이언트의 요청: '{request.intent}'. 이 내용을 바탕으로 차별화된 전시 기획안을 불렛포인트와 소제목을 활용하여 작성하세요.",
        expected_output="명확하고 구조화된 한국어 전시 기획서",
        agent=planner
    )
    crew = Crew(agents=[planner], tasks=[task])
    return {"draft_text": str(crew.kickoff())}

@app.post("/generate")
def start_work(request: WorkRequest):
    task = Task(
        description=f"주제: '{request.topic}', 스타일: '{request.style}'. 이 주제를 시각화할 수 있는 디테일한 영어 프롬프트를 작성하세요. (No Chinese/Japanese characters)",
        expected_output="AI 이미지 생성을 위한 단 1줄의 상세한 영어 프롬프트",
        agent=painter
    )
    crew = Crew(agents=[painter], tasks=[task])
    return {"final_prompt": str(crew.kickoff())}

@app.post("/review")
def create_review(request: ReviewRequest):
    task = Task(
        description=f"대상 작품/기획: '{request.art_info}'. 전문가의 시선으로 냉철하게 분석하고 비평문을 작성하세요.",
        expected_output="미술사적 맥락이 포함된 전문적인 비평문",
        agent=critic
    )
    crew = Crew(agents=[critic], tasks=[task])
    return {"review_text": str(crew.kickoff())}

@app.post("/promote")
def create_promo(request: PromoRequest):
    task = Task(
        description=f"전시 제목: '{request.exhibition_title}', 타겟 관객: '{request.target_audience}'. SNS(인스타그램)에서 바이럴 될 수 있는 홍보 문구를 작성하세요.",
        expected_output="이모지와 해시태그가 포함된 트렌디한 인스타그램 카피",
        agent=marketer
    )
    crew = Crew(agents=[marketer], tasks=[task])
    return {"promo_text": str(crew.kickoff())}

@app.post("/auction")
def open_auction(request: AuctionRequest):
    task = Task(
        description=f"작품 정보: '{request.art_info}', 비평: '{request.critic_review}'. 이 정보를 바탕으로 시작가(ETH)를 책정하고 매력적인 오프닝 멘트가 포함된 경매 리포트를 작성하세요.",
        expected_output="긴장감 있고 희소성을 강조하는 경매 오프닝 리포트",
        agent=auctioneer
    )
    crew = Crew(agents=[auctioneer], tasks=[task])
    return {"auction_report": str(crew.kickoff())}

@app.post("/docent")
def start_tour(request: DocentRequest):
    task = Task(
        description=f"작품 정보: '{request.art_info}'. 대상 관객: '{request.audience_type}'. 이들을 위해 친절하고 재미있는 해설 대본을 작성하세요.",
        expected_output="대화하듯 자연스럽고 따뜻한 존댓말 미술 해설 대본",
        agent=docent
    )
    crew = Crew(agents=[docent], tasks=[task])
    return {"commentary": str(crew.kickoff())}


# ==================================================================
# 🔥 [특급 추가] 진짜 A2A의 진수: 기획자 + 화가 + 비평가 3자 자율 협업 파이프라인
# ==================================================================
class A2AStudioRequest(BaseModel): intent: str

@app.post("/studio/a2a-full")
def a2a_full_studio(request: A2AStudioRequest):
    """
    이 엔드포인트가 바로 진짜 A2A입니다!
    단 한 번의 요청으로 3명의 에이전트가 순차적으로 작업물을 넘겨받으며 검토합니다.
    """
    # 1. 기획자가 기획서를 쓴다.
    task1 = Task(
        description=f"'{request.intent}'를 주제로 전시 기획서를 작성하세요.",
        expected_output="구조화된 전시 기획서",
        agent=planner
    )
    
    # 2. 화가가 기획서를 읽고(context) 그림 프롬프트를 짠다.
    task2 = Task(
        description="전달받은 기획서를 바탕으로, 이것을 완벽하게 표현할 수 있는 1줄짜리 영문 이미지 프롬프트를 작성하세요.",
        expected_output="1줄짜리 완벽한 영어 이미지 프롬프트",
        agent=painter,
        context=[task1] # 👈 진짜 A2A의 핵심! 앞 에이전트(기획자)의 작업물을 컨텍스트로 읽어 들임!
    )
    
    # 3. 비평가가 완성된 프롬프트와 기획서를 보고 최종 평가한다.
    task3 = Task(
        description="기획서와 화가의 프롬프트를 모두 검토하고, 이 전시가 대중적으로 성공할 수 있을지 전문가 관점에서 비평하세요.",
        expected_output="3~4문장 분량의 최종 비평 요약",
        agent=critic,
        context=[task1, task2] # 👈 기획자의 기획서와 화가의 프롬프트를 모두 넘겨받음!
    )

    # 팀(Crew) 결성 및 실행
    studio_crew = Crew(
        agents=[planner, painter, critic],
        tasks=[task1, task2, task3],
        process=Process.sequential # 릴레이 방식으로 결과물 전달
    )
    
    result = studio_crew.kickoff()
    
    return {
        "status": "A2A Mission Complete",
        "planner_draft": str(task1.output),
        "painter_prompt": str(task2.output),
        "critic_feedback": str(task3.output),
        "final_conclusion": str(result)
    }

# 헬스 체크용 엔드포인트
@app.get("/test-blockchain")
def test_blockchain_connection():
    return {"status": "success", "message": "Blockchain test bypassed in Agent."}