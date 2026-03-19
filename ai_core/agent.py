import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware # 👈 [핵심 1] CORS 모듈 임포트!
from pydantic import BaseModel
from crewai import Agent, Task, Crew, Process, LLM 
from dotenv import load_dotenv
from datetime import datetime
from crewai_tools import SerperDevTool, PDFSearchTool

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
    
# ==========================================================
# 🔍 [추가 2] 에이전트들에게 쥐여줄 RAG 도구(무기) 생성
# ==========================================================
# 1. 실시간 인터넷 웹 검색 도구 (최신 미술 트렌드, 경매 낙찰가 검색용)
search_tool = SerperDevTool()

# 2. 로컬 PDF 문서 검색 도구 (예: 프로젝트 폴더에 'art_history.pdf'를 넣어두면 알아서 읽고 학습함)
# pdf_tool = PDFSearchTool(pdf='art_history.pdf') 
# (현재 PDF 파일이 없다면 이건 주석 처리해두고 나중에 쓰시면 됩니다)

# ==================================================================
# 🤖 1. 에이전트(Agent) 정의 (allow_delegation=True 로 소통 허용)
# ==================================================================
planner = Agent(
    role='수석 전시 기획자',
    goal='대중성과 예술성을 모두 갖춘 완벽한 전시 기획서 작성',
    backstory='당신은 20년 경력의 베테랑 큐레이터입니다. 단순한 아이디어도 거시적인 예술 비전으로 확장시킵니다.',
    tools=[search_tool],
    llm=llm,
    allow_delegation=True, 
    verbose=True
)

painter = Agent(
    role='수석 디지털 아티스트',
    goal='기획서를 완벽하게 시각화할 수 있는 디테일한 영문 프롬프트 작성',
    backstory='당신은 빛, 질감, 구도를 완벽하게 이해하는 디지털 아티스트입니다. 그림 프롬프트를 짤 때 한자, 중국어, 일본어가 나오지 않도록 철저히 통제합니다.',
    tools=[search_tool],
    llm=llm,
    allow_delegation=True,
    verbose=True
)

critic = Agent(
    role='수석 미술 비평가',
    goal='작품을 미술사적 맥락에서 심층적으로 분석하고 비평',
    backstory='당신은 뉴욕 MoMA 출신의 식견 높고 까칠한 비평가입니다. '
        '비평을 작성하기 전, 반드시 search_tool을 사용하여 "최근 미술 트렌드 및 해당 스타일의 역사적 배경"을 검색(Retrieve)하고, ' # 👈 RAG 강제 지시
        '그 객관적인 사실을 바탕으로 날카롭게 분석합니다.',
    tools=[search_tool],
    llm=llm,
    allow_delegation=True,
    verbose=True
)

marketer = Agent(
    role='MZ세대 바이럴 마케터',
    goal='전시회를 SNS에서 화제성 1위로 만들 매력적인 카피라이팅 작성',
    backstory='당신은 트렌드에 극도로 민감한 마케터입니다. 이모지와 해시태그를 적극 활용합니다.',
    tools=[search_tool],
    llm=llm,
    verbose=True
)

auctioneer = Agent(
    role='소더비 수석 경매사',
    goal='비평을 바탕으로 작품의 가치를 극대화하는 경매 리포트 작성',
    backstory='당신은 세계 최고의 경매사입니다. 가격을 마음대로 지어내지 않습니다. '
        '반드시 search_tool을 사용하여 "최근 유사한 스타일의 예술품 실제 경매 낙찰가"를 검색하여 외부 데이터(Context)를 수집하고, ' # 👈 RAG 강제 지시
        '이를 근거로 합리적인 시작가를 책정합니다.',
    tools=[search_tool],
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
    tools=[search_tool],
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
    tools=[search_tool],
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

# agent.py의 3번 항목 중 /auction 엔드포인트를 이렇게 수정하세요
@app.post("/auction")
def open_auction(request: AuctionRequest):
    task = Task(
        description=(
            f"다음 비평문을 바탕으로 '{request.art_info}'에 대한 경매 리포트를 작성하세요.\n"
            f"[비평문]: {request.critic_review}\n\n"
            "🚨 [필수 지시사항]: 반드시 인터넷을 검색하여 최근 유사 작품의 실제 가격 동향을 리포트에 포함시키세요." # 👈 한 줄 추가!
        ),
        expected_output="데이터에 기반한 객관적인 경매 리포트",
        agent=auctioneer
    )
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
# 🔥 4. [최종] 기획자-비평가 난상토론 루프 (백엔드 조립 방식)
# ==================================================================
@app.post("/studio/a2a-full")
def a2a_full_studio(request: A2AStudioRequest):
    print(f"🚀 [A2A 난상토론 시작] 주제: {request.intent}")
    today = datetime.now().strftime("%Y-%m-%d")

    task_draft = Task(
        description=f"오늘 날짜({today})를 기준으로 '{request.intent}'를 주제로 전시 기획서 초안을 작성하세요.",
        expected_output="마크다운 형식의 전시 기획서 초안",
        agent=planner
    )
    
    task_review = Task(
        description="초안을 읽고 가차없이 비판하며 예술성을 높일 3가지 수정 지시를 내리세요.",
        expected_output="신랄한 비평문 및 수정 지시서",
        agent=critic,
        context=[task_draft]
    )

    task_revise = Task(
        description="비평가의 지시를 수용하여 기획서를 고치세요. 대화형 멘트는 절대 배제하고, 비평이 완벽히 반영된 **'새로운 최종 전시 기획서 전문'을 마크다운 풀버전으로 다시 작성**하세요.",
        expected_output="완벽히 재작성된 최종 전시 기획서 전문",
        agent=planner,
        context=[task_draft, task_review]
    )

    try:
        studio_crew = Crew(
            agents=[planner, critic, planner], 
            tasks=[task_draft, task_review, task_revise],
            process=Process.sequential, 
            verbose=True
        )
        
        studio_crew.kickoff()
        
        def get_output(task):
            return getattr(task.output, 'raw', str(task.output))

        print("✅ [A2A 토론 완료] 화면 출력을 위해 최종본만 깔끔하게 전송합니다!")
        
        # 🚨 [수정됨] 초안과 비평은 버리고, 오직 3단계(task_revise)의 '최종 기획서'만 변수에 담습니다!
        final_clean_text = get_output(task_revise)

        # 프론트가 찾고 있는 "draft_text"라는 이름표에 최종본만 딱 넣어서 보냅니다.
        return {"draft_text": final_clean_text}

    except Exception as e:
        error_msg = f"🔥 AI 토론 중 서버 에러가 발생했습니다: {str(e)}"
        print(error_msg)
        return {"draft_text": error_msg}
    
# ==================================================================
# 💬 5. AI 큐레이터 & 도슨트 채팅 API (동시 접속 완벽 지원!)
# ==================================================================
class DocentRequest(BaseModel):
    message: str
    wallet_address: str = ""

@app.post("/chat")
def combined_chat(request: DocentRequest):
    print(f"💬 [AI 어시스턴트] 사용자 질문 수신: {request.message}")
    
    # 🚨 AI의 정체성을 '만능 가이드'로 확장합니다.
    ai_curator = Agent(
        role="ArtDAO 총괄 가이드 AI",
        goal="사용자의 미술 관련 질문에 우아하게 답변할 뿐만 아니라, ArtDAO 플랫폼의 이용 방법(안건 등록, 투표, 블록체인 위임 등)에 대해서도 완벽하게 안내한다.",
        backstory="당신은 ArtDAO 플랫폼의 모든 것을 알고 있는 만능 어시스턴트입니다. 미술사적 지식은 물론, DAO(탈중앙화 자율조직)의 투표 시스템 원리까지 친절하게 설명할 수 있습니다. 특정 미술 작품에 대한 매우 깊은 해설이 필요할 때만 '전문 도슨트'에게 위임합니다.",
        allow_delegation=True, 
        llm=llm,
        verbose=True
    )

    ai_docent = Agent(
        role="전문 도슨트",
        goal="수석 큐레이터가 넘겨준 질문(작가 추천, 기법, 작품 해설 등)에 대해, 관람객의 눈높이에 맞춰 아주 상세하게 설명한다.",
        backstory="어려운 예술의 세계를 가장 쉽고 재미있게 스토리텔링해 주는 미술관 최고 인기 도슨트입니다.",
        allow_delegation=False, 
        llm=llm,
        verbose=True
    )

    # 🚨 지시사항(Prompt)에 플랫폼 안내 기능을 명시합니다.
    task_chat = Task(
        description=f"""사용자의 다음 질문에 대해 가장 완벽한 답변을 제공하세요: '{request.message}'
        [지시사항]
        1. 질문이 'ArtDAO 플랫폼 이용 방법(투표 방법, 안건 작성, 위임 등)'이라면, 시스템의 원리를 초보자도 이해하기 쉽게 설명하세요.
        2. 질문이 '전반적인 미술 추천, 예술사'라면 총괄 큐레이터의 지식으로 직접 답변하세요.
        3. 질문이 '특정 작가 추천, 기법, 작품 해설' 등 세부적인 미술 지식이라면, 반드시 '전문 도슨트'에게 위임(Ask question to coworker)하여 그 결과를 바탕으로 답변하세요.
        4. 최종 답변은 마크다운 포맷으로 깔끔하게 정리하여 한국어로 출력하세요.""",
        expected_output="플랫폼 가이드 혹은 미술관 전문가의 친절하고 완벽한 답변",
        agent=ai_curator 
    )
    
    try:
        chat_crew = Crew(
            agents=[ai_curator, ai_docent], 
            tasks=[task_chat],
            verbose=True,
            max_rpm=10
        )
        
        chat_crew.kickoff()
        
        final_reply = getattr(task_chat.output, 'raw', str(task_chat.output))
        
        print("✅ [AI 어시스턴트 팀] 답변 전송 완료!")
        return {"reply": final_reply}
        
    except Exception as e:
        print(f"🔥 AI 챗 에러: {str(e)}")
        return {"reply": "앗, 큐레이터와 도슨트가 지금 다른 관람객을 응대 중입니다. 잠시 후 다시 질문해 주세요!"}