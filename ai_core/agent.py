import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware # 👈 [핵심 1] CORS 모듈 임포트!
from pydantic import BaseModel
from crewai import Agent, Task, Crew, Process, LLM 
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

app = FastAPI(title="ArtDAO CrewAI A2A Server", version="5.0-True-A2A")

# ==================================================================
# 🚨 2. 프론트엔드의 접근을 허락하는 문지기 (이 블록이 없으면 405 에러가 납니다)
# ==================================================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # 개발 중이므로 일단 모두 허용
    allow_credentials=True,
    allow_methods=["*"], # OPTIONS, POST 등 모두 허용
    allow_headers=["*"],
)
# ==================================================================

MY_GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if not MY_GOOGLE_API_KEY:
    print("❌ [경고] GOOGLE_API_KEY가 없습니다!")

# 🚨 CrewAI가 Vertex AI로 착각하지 못하도록 환경변수를 강제로 한 번 더 세팅해 줍니다.
os.environ["GEMINI_API_KEY"] = MY_GOOGLE_API_KEY 

try:
    llm = LLM(
        # 🚨 끝에 반드시 '-preview'를 붙여야 합니다!
        model="gemini/gemini-3.1-flash-lite-preview", 
        api_key=MY_GOOGLE_API_KEY,
        temperature=0.7
    )
    print("✅ [AI] Gemini & CrewAI 엔진 로드 완료")
except Exception as e:
    print(f"🔥 모델 초기화 실패: {e}")
    llm = None

# ==================================================================
# 🤖 1. 에이전트(Agent) 정의 (allow_delegation=True 로 소통 허용)
# ==================================================================
planner = Agent(
    role='수석 전시 기획자',
    goal='대중성과 예술성을 모두 갖춘 완벽한 전시 기획서 작성',
    backstory='당신은 20년 경력의 베테랑 큐레이터입니다. 단순한 아이디어도 거시적인 예술 비전으로 확장시킵니다.',
    llm=llm,
    allow_delegation=True, 
    verbose=True
)

painter = Agent(
    role='수석 디지털 아티스트',
    goal='기획서를 완벽하게 시각화할 수 있는 디테일한 영문 프롬프트 작성',
    backstory='당신은 빛, 질감, 구도를 완벽하게 이해하는 디지털 아티스트입니다. 그림 프롬프트를 짤 때 한자, 중국어, 일본어가 나오지 않도록 철저히 통제합니다.',
    llm=llm,
    allow_delegation=True,
    verbose=True
)

critic = Agent(
    role='수석 미술 비평가',
    goal='작품을 미술사적 맥락에서 심층적으로 분석하고 비평',
    backstory='당신은 뉴욕 MoMA 출신의 식견 높고 까칠한 비평가입니다. 색채와 구도를 날카롭게 분석합니다.',
    llm=llm,
    allow_delegation=True,
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

# 🤖 1. AI 큐레이터 (전반적인 안내 및 작가 추천)
ai_curator = Agent(
    role='따뜻한 감성을 지닌 AI 큐레이터',
    goal='관람객의 질문에 공감하며, 미술의 즐거움을 일깨워주는 친절한 가이드 제공',
    backstory=(
        '당신은 ArtDAO 전시관의 메인 AI 큐레이터입니다. '
        '작품 추천이나 전시의 전반적인 안내를 담당합니다. '
        '만약 관람객이 특정 작품의 아주 세부적인 기법이나 숨겨진 뒷이야기를 묻는다면, '
        '작품 해설 전문가인 "도슨트"에게 내용을 확인하여 답변하세요.' # 👈 협업 지시
    ),
    llm=llm,
    allow_delegation=True, # 👈 도슨트에게 일을 넘길 수 있게 허용
    verbose=True
)

# 🤖 2. AI 도슨트 (작품 세부 해설 전문)
ai_docent = Agent(
    role='작품의 숨결을 전하는 AI 도슨트',
    goal='특정 작품의 세부 묘사와 창작 배경을 생생하게 전달',
    backstory=(
        '당신은 작품 해설 전문 도슨트입니다. '
        '캔버스의 질감, 색채의 대비, 작가의 비하인드 스토리를 '
        '마치 옆에서 속삭여주듯 친절하게 설명하는 것이 당신의 임무입니다.'
    ),
    llm=llm,
    allow_delegation=False, # 도슨트는 해설만 하면 되므로 위임 불필요
    verbose=True
)

# ==================================================================
# 📦 2. Pydantic 모델
# ==================================================================
class PlanRequest(BaseModel): intent: str
class WorkRequest(BaseModel): topic: str; style: str
class ReviewRequest(BaseModel): art_info: str
class PromoRequest(BaseModel): exhibition_title: str; target_audience: str
class AuctionRequest(BaseModel): art_info: str; critic_review: str
class DocentRequest(BaseModel): art_info: str; audience_type: str = "일반 관람객"
class A2AStudioRequest(BaseModel): intent: str

# ==================================================================
# 🚀 3. 개별 API 엔드포인트 (기존 프론트엔드 호환용)
# ==================================================================
@app.post("/propose")
def create_proposal(request: PlanRequest):
    task = Task(description=f"'{request.intent}' 전시 기획안 작성", expected_output="기획서", agent=planner)
    return {"draft_text": str(Crew(agents=[planner], tasks=[task]).kickoff())}

@app.post("/generate")
def start_work(request: WorkRequest):
    task = Task(description=f"'{request.topic}' 영어 프롬프트 작성", expected_output="프롬프트", agent=painter)
    return {"final_prompt": str(Crew(agents=[painter], tasks=[task]).kickoff())}

@app.post("/review")
def create_review(request: ReviewRequest):
    task = Task(description=f"'{request.art_info}' 비평문 작성", expected_output="비평문", agent=critic)
    return {"review_text": str(Crew(agents=[critic], tasks=[task]).kickoff())}

@app.post("/promote")
def create_promo(request: PromoRequest):
    task = Task(description=f"'{request.exhibition_title}' 홍보 문구 작성", expected_output="홍보문", agent=marketer)
    return {"promo_text": str(Crew(agents=[marketer], tasks=[task]).kickoff())}

@app.post("/auction")
def open_auction(request: AuctionRequest):
    task = Task(description=f"'{request.art_info}' 경매 리포트 작성", expected_output="리포트", agent=auctioneer)
    return {"auction_report": str(Crew(agents=[auctioneer], tasks=[task]).kickoff())}

# agent.py 하단 수정
@app.post("/docent")
def start_tour(request: DocentRequest):
    # 🚨 docent -> ai_docent로 변경하여 빨간 줄 해결
    task = Task(
        description=f"'{request.art_info}'에 대한 깊이 있는 해설 작성", 
        expected_output="해설", 
        agent=ai_docent 
    )
    # Crew 실행 시에도 ai_docent 사용
    return {"commentary": str(Crew(agents=[ai_docent], tasks=[task]).kickoff())}


# ==================================================================
# 🔥 4. [최종] 기획자-비평가 명시적 피드백 루프 + 화가 체이닝
# ==================================================================
@app.post("/studio/a2a-full")
def a2a_full_studio(request: A2AStudioRequest):
    today = datetime.now().strftime("%Y-%m-%d")

    # [루프 1단계] 기획자: 기획서 초안 작성
    task_draft = Task(
        description=f"오늘 날짜({today})를 기준으로 '{request.intent}'를 주제로 전시 기획서 초안을 작성하세요.",
        expected_output="전시 기획서 초안",
        agent=planner
    )
    
    # [루프 2단계] 비평가: 초안에 대한 피드백 및 수정 지시
    task_review = Task(
        description="기획자가 작성한 초안을 날카롭게 분석하고, 예술성을 높이기 위한 구체적인 '수정 지시사항'을 작성하세요.",
        expected_output="기획서 초안에 대한 비평 및 구체적인 수정 지시서",
        agent=critic,
        context=[task_draft]
    )

    # [루프 3단계] 기획자: 피드백을 반영한 최종 기획서 완성 (토론의 결실)
    task_revise = Task(
        description="비평가의 수정 지시사항을 100% 반영하여, 전시 기획서를 최종적으로 수정하고 완벽한 결과물을 도출하세요.",
        expected_output="비평가의 피드백이 반영된 완벽한 최종 전시 기획서",
        agent=planner,
        context=[task_draft, task_review] # 초안과 비평가의 피드백을 모두 읽음
    )

    # [체이닝] 화가: 최종 기획서를 보고 프롬프트만 단순 추출 (외부 API용)
    task_prompt = Task(
        description="최종 완성된 기획서를 바탕으로, 외부 이미지 생성 API에 넣을 1줄짜리 완벽한 영문 프롬프트만 추출하세요.",
        expected_output="단 1줄의 영문 이미지 프롬프트",
        agent=painter,
        context=[task_revise] # 최종 기획서만 넘겨받음
    )

    # Sequential로 실행하여 500 에러 방지 (순서대로 핑퐁 진행)
    studio_crew = Crew(
        agents=[planner, critic, planner, painter], # 기획자가 2번 등판!
        tasks=[task_draft, task_review, task_revise, task_prompt],
        process=Process.sequential, 
        verbose=True,
        max_rpm=10 
    )
    
    result = studio_crew.kickoff()
    
    return {
        "status": "A2A Mission Complete",
        "planner_draft": str(task_draft.output),       # 기획자의 첫 생각
        "critic_feedback": str(task_review.output),    # 비평가의 매서운 피드백
        "final_conclusion": str(task_revise.output),   # 피드백이 반영된 최종안
        "painter_prompt": str(task_prompt.output)      # 화가의 1줄 프롬프트
    }

# [agent.py 맨 밑에 추가]
@app.post("/chat")
def combined_chat(request: DocentRequest):
    # 큐레이터(ai_curator)와 도슨트(ai_docent)가 한 팀으로 묶입니다.
    # 큐레이터는 위임(allow_delegation=True)이 켜져 있어 필요시 도슨트에게 물어봅니다.
    chat_task = Task(
        description=(
            f"관람객의 질문: {request.art_info}. "
            "질문에 대해 큐레이터로서 친절하게 답변하세요. "
            "만약 특정 작품의 세부 기법이나 비하인드 스토리에 대한 질문이라면 "
            "반드시 도슨트에게 물어보고 그 내용을 포함해서 답변하세요."
        ),
        expected_output="관람객을 위한 통합된 친절한 답변 (존댓말)",
        agent=ai_curator # 팀장은 큐레이터
    )

    # Crew가 내부적으로 협업을 처리합니다.
    chat_crew = Crew(
        agents=[ai_curator, ai_docent], 
        tasks=[chat_task], 
        verbose=True
    )
    
    return {"reply": str(chat_crew.kickoff())}