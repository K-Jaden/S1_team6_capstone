import os
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from crewai import Agent, Task, Crew, Process, LLM 
from dotenv import load_dotenv
from datetime import datetime
from crewai_tools import SerperDevTool

load_dotenv()

app = FastAPI(title="ArtDAO CrewAI A2A Server", version="5.0-True-A2A")

# ==================================================================
# 1. CORS 설정 (프론트엔드 통신 허용)
# ==================================================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==================================================================
# 2. LLM 엔진 및 RAG 도구 세팅
# ==================================================================
MY_GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if not MY_GOOGLE_API_KEY:
    print("❌ [경고] GOOGLE_API_KEY가 없습니다!")

os.environ["GEMINI_API_KEY"] = MY_GOOGLE_API_KEY 

try:
    llm = LLM(
        model="gemini/gemini-3.1-flash-lite-preview", 
        api_key=MY_GOOGLE_API_KEY,
        temperature=0.7
    )
    print("✅ [AI] Gemini 3.1 & CrewAI 엔진 로드 완료")
except Exception as e:
    print(f"🔥 모델 초기화 실패: {e}")
    llm = None
    
# 실시간 인터넷 웹 검색 도구 (RAG: 할루시네이션 방지용 팩트 체크 무기)
search_tool = SerperDevTool()

# ==================================================================
# 3. 에이전트(Agent) 정의
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
    goal='작품을 미술사적 맥락과 객관적 데이터를 바탕으로 심층 분석하고 비평',
    backstory='당신은 식견 높고 까칠한 비평가입니다. AI의 환각(할루시네션)을 방지하기 위해 비평을 작성하기 전, 반드시 search_tool을 사용하여 "해당 작품과 유사한 미술사적 사조나 최근 디지털 아트 트렌드"를 검색하고, 검색된 객관적 사실을 근거로 작품의 가치를 분석합니다.',
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
    backstory='당신은 세계 최고의 경매사입니다. 가격을 임의로 지어내지 않습니다(No Hallucination). 반드시 search_tool을 사용하여 "최근 유사한 스타일의 디지털 아트 실제 경매 낙찰가"를 검색하여 객관적인 시장 데이터를 수집하고, 이를 근거로 합리적인 시작가를 책정합니다.',
    tools=[search_tool],
    llm=llm,
    verbose=True
)

ai_curator = Agent(
    role='따뜻한 감성을 지닌 AI 큐레이터',
    goal='관람객의 질문에 공감하며, 미술의 즐거움을 일깨워주는 친절한 가이드 제공',
    backstory='당신은 ArtDAO 전시관의 메인 AI 큐레이터입니다. 플랫폼 이용 방법과 미술 추천을 담당하며 세부 해설은 도슨트에게 위임합니다.',
    tools=[search_tool],
    llm=llm,
    allow_delegation=True,
    verbose=True
)

ai_docent = Agent(
    role='작품의 숨결을 전하는 AI 도슨트',
    goal='특정 작품의 세부 묘사와 창작 배경을 생생하게 전달',
    backstory='당신은 작품 해설 전문 도슨트입니다. 캔버스의 질감, 색채의 대비를 친절하게 설명합니다.',
    tools=[search_tool],
    llm=llm,
    allow_delegation=False,
    verbose=True
)

# ==================================================================
# 4. Pydantic 모델
# ==================================================================
class PlanRequest(BaseModel): intent: str
class WorkRequest(BaseModel): topic: str; style: str
class ReviewRequest(BaseModel): art_info: str
class PromoRequest(BaseModel): exhibition_title: str; target_audience: str
class AuctionRequest(BaseModel): art_info: str; critic_review: str
class DocentRequest(BaseModel): message: str; wallet_address: str = ""
class A2AStudioRequest(BaseModel): intent: str
class WinnerData(BaseModel): title: str; description: str; vp_votes: int

# ==================================================================
# 5. Botto DAO 시나리오: 4개 후보작 RAG 생성 루프
# ==================================================================
@app.post("/api/agent/generate-candidates")
def generate_candidates():
    print("🚀 [Agent] 팩트 기반(RAG) 10개 후보작 생성 파이프라인 가동...")

    task_plan = Task(
        description="반드시 search_tool을 사용하여 '현재 글로벌 디지털 아트 트렌드'를 검색하세요. 검색 결과를 바탕으로 서로 완전히 다른 테마의 미술 작품 컨셉 10가지를 기획하세요. '수석 미술 비평가'와 토론하여 아이디어를 검증받으세요. 각 컨셉은 '한국어 제목'과 '한국어 작품 설명'을 포함해야 합니다.",
        expected_output="검색된 최신 트렌드가 반영된 10가지 컨셉 초안",
        agent=planner
    )

    task_critique = Task(
        description="기획자의 10가지 컨셉을 넘겨받아, search_tool을 이용해 각 컨셉과 유사한 실제 미술사적 사례나 최신 트렌드를 검색하세요. 진부한 요소는 비판하고, 객관적 레퍼런스를 더해 최종 10가지 컨셉을 완성하세요.",
        expected_output="객관적 검증과 수정이 완료된 10가지 컨셉",
        agent=critic
    )

    task_format = Task(
        description='''
        최종 4가지 컨셉을 바탕으로 이미지 생성용 데이터를 작성하세요.
        반드시 아래와 같은 구조의 'JSON 객체 배열' 형식으로만 출력해야 합니다.
        마크다운(```json)이나 다른 설명은 절대 포함하지 마세요.

        [
            {
                "title": "작품 제목 (한국어)",
                "description": "작품 세계관 설명 (한국어)",
                "image_prompt": "상세한 영문 이미지 생성 프롬프트"
            },
            ... (총 10개)
        ]
        ''',
        expected_output="순수 JSON 객체 배열 (List of Dicts)",
        agent=painter
    )

    crew = Crew(agents=[planner, critic, painter], tasks=[task_plan, task_critique, task_format], process=Process.sequential)

    try:
        result = crew.kickoff()
        result_text = str(result).replace("```json", "").replace("```", "").strip()
        candidates_data = json.loads(result_text)
        return {"candidates": candidates_data}
    except Exception as e:
        print(f"🔥 [Agent] 후보작 생성 실패: {e}")
        raise HTTPException(status_code=500, detail="AI 토론 중 오류 발생")

# ==================================================================
# 6. Botto DAO 시나리오: 1등 우승작 가치 산정 (RAG 시장 데이터 기반 경매)
# ==================================================================
@app.post("/api/agent/evaluate-winner")
def evaluate_winner(data: WinnerData):
    print(f"🚀 [Agent] 우승작 시장 가치 산정 토론 가동: {data.title} (득표: {data.vp_votes} VP)")

    task_eval_art = Task(
        description=f"제목: {data.title}\n설명: {data.description}\nsearch_tool을 사용하여 이 작품과 유사한 스타일의 실제 미술 평가나 대중적 반응을 검색하고, 이 디지털 작품의 객관적인 미학적 가치를 경매사에게 브리핑하세요.",
        expected_output="미술사적 레퍼런스가 포함된 작품 평가 리포트",
        agent=critic
    )

    task_eval_price = Task(
        description=f"비평가의 평가와 대중 투표수({data.vp_votes} VP)를 종합합니다. AI가 가짜 가격을 지어내는 것을 막기 위해 반드시 search_tool을 이용해 '최근 유사한 NFT 실제 경매 낙찰가'를 검색하세요. 투표수 1 VP당 10~50 TUK 가치를 기반으로 시장 데이터와 곱해 최종 가격을 산정하세요. 반드시 순수 JSON 형식으로만 출력하세요.",
        expected_output='순수 JSON 객체 문자열 (예: {"auction_price": 1500, "report": "..."})',
        agent=auctioneer
    )

    crew = Crew(agents=[critic, auctioneer], tasks=[task_eval_art, task_eval_price], process=Process.sequential)
    
    try:
        result = crew.kickoff()
        result_text = str(result).replace("```json", "").replace("```", "").strip()
        evaluation_data = json.loads(result_text)
        return evaluation_data
    except Exception as e:
        print(f"🔥 [Agent] 가치 산정 실패: {e}")
        return {"auction_price": data.vp_votes * 10, "report": "AI 토론 오류로 기본가 책정"}

# ==================================================================
# 7. 개별 API 엔드포인트 (기존 프론트엔드 호환 유지)
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
    task = Task(
        description=f"다음 비평문을 바탕으로 '{request.art_info}' 경매 리포트 작성.\n[비평문]: {request.critic_review}\n인터넷을 검색해 최근 실제 가격 동향을 리포트에 포함하세요.",
        expected_output="데이터에 기반한 객관적인 경매 리포트",
        agent=auctioneer
    )
    return {"auction_report": str(Crew(agents=[auctioneer], tasks=[task]).kickoff())}

@app.post("/docent")
def start_tour(request: DocentRequest):
    task = Task(description=f"'{request.message}'에 대한 깊이 있는 해설 작성", expected_output="해설", agent=ai_docent)
    return {"commentary": str(Crew(agents=[ai_docent], tasks=[task]).kickoff())}

@app.post("/studio/a2a-full")
def a2a_full_studio(request: A2AStudioRequest):
    today = datetime.now().strftime("%Y-%m-%d")
    task_draft = Task(description=f"오늘 날짜({today}) 기준 '{request.intent}' 기획서 초안 작성", expected_output="마크다운 기획서", agent=planner)
    task_review = Task(description="초안을 읽고 가차없이 비판하며 예술성을 높일 수정 지시", expected_output="비평문", agent=critic, context=[task_draft])
    task_revise = Task(description="비평 반영하여 최종 전시 기획서 전문 마크다운 작성", expected_output="최종 마크다운", agent=planner, context=[task_draft, task_review])

    try:
        studio_crew = Crew(agents=[planner, critic, planner], tasks=[task_draft, task_review, task_revise], process=Process.sequential, verbose=True)
        studio_crew.kickoff()
        return {"draft_text": getattr(task_revise.output, 'raw', str(task_revise.output))}
    except Exception as e:
        return {"draft_text": f"🔥 서버 에러 발생: {str(e)}"}

@app.post("/chat")
def combined_chat(request: DocentRequest):
    task_chat = Task(
        description=f"사용자의 다음 질문에 답변하세요: '{request.message}'\n1. 플랫폼 이용 방법이면 쉽게 설명.\n2. 전반적 미술 추천이면 직접 답변.\n3. 세부 작가 추천이나 기법 해설이면 '전문 도슨트'에게 위임(Ask question to coworker)하여 답변.",
        expected_output="플랫폼 가이드 혹은 도슨트의 친절한 답변 (마크다운)",
        agent=ai_curator 
    )
    try:
        chat_crew = Crew(agents=[ai_curator, ai_docent], tasks=[task_chat], verbose=True, max_rpm=10)
        chat_crew.kickoff()
        return {"reply": getattr(task_chat.output, 'raw', str(task_chat.output))}
    except Exception as e:
        return {"reply": "앗, 큐레이터가 다른 관람객을 응대 중입니다. 잠시 후 다시 질문해 주세요!"}