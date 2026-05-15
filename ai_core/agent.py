import os
import json
import asyncio
from queue import Queue, Empty
from datetime import datetime
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from crewai import Agent, Task, Crew, Process, LLM
from dotenv import load_dotenv
from crewai_tools import SerperDevTool

load_dotenv()

app = FastAPI(title="ArtDAO CrewAI A2A Server", version="7.0-Streaming-A2A")

# ==================================================================
# 1. CORS 설정
# ==================================================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# ==================================================================
# 🔥 [NEW] 실시간 토론 스트리밍을 위한 글로벌 큐 매니저
# ==================================================================
# session_id → Queue 매핑. 프론트가 SSE로 연결하면 이 큐를 구독함
discussion_queues = {}

def push_log(session_id: str, agent_role: str, log_type: str, content: str):
    """토론 로그를 해당 세션 큐에 밀어넣는다."""
    if session_id and session_id in discussion_queues:
        log_entry = {
            "agent": agent_role,
            "type": log_type,  # "thought" | "action" | "output" | "final" | "error"
            "content": content,
            "timestamp": datetime.now().strftime("%H:%M:%S")
        }
        discussion_queues[session_id].put(log_entry)
        print(f"📡 [Stream:{session_id}] {agent_role} ({log_type}): {content[:80]}...")

def make_step_callback(session_id: str, agent_role: str = "에이전트"):
    """CrewAI의 매 단계마다 호출되는 콜백 생성기.
    🔥 [수정] agent_role을 클로저로 캡처해서 정확히 표시한다.
    각 에이전트의 thought/action/output을 큐로 흘려보낸다."""
    def callback(step_output):
        try:
            content = ""
            log_type = "thought"

            # AgentAction 케이스 (도구 사용)
            if hasattr(step_output, 'tool') and step_output.tool:
                log_type = "action"
                tool_name = step_output.tool
                tool_input = getattr(step_output, 'tool_input', '')
                content = f"🔧 도구 사용: {tool_name}({tool_input})"
            # AgentFinish 케이스 (최종 출력)
            elif hasattr(step_output, 'output'):
                log_type = "output"
                content = str(step_output.output)[:500]
            # ToolResult 등 기타 — 스킵 (중복 노이즈 방지)
            elif 'ToolResult' in str(type(step_output)) or str(step_output).startswith('ToolResult'):
                return  # 이미 action으로 표시됐으므로 결과는 스킵
            # 일반 thought
            else:
                content_raw = str(step_output)
                # ToolResult가 문자열로 들어오는 경우도 스킵
                if content_raw.startswith('ToolResult'):
                    return
                content = content_raw[:500]

            push_log(session_id, agent_role, log_type, content)
        except Exception as e:
            print(f"🔥 step_callback 에러: {e}")
    return callback

def make_task_callback(session_id: str, agent_role: str = "에이전트"):
    """각 Task가 끝날 때마다 호출되는 콜백.
    🔥 [수정] agent_role을 클로저로 캡처해서 정확히 표시한다."""
    def callback(task_output):
        try:
            content = ""
            if hasattr(task_output, 'raw'):
                content = str(task_output.raw)[:800]
            else:
                content = str(task_output)[:800]
            
            push_log(session_id, agent_role, "task_complete", f"✅ 작업 완료\n{content}")
        except Exception as e:
            print(f"🔥 task_callback 에러: {e}")
    return callback

# ==================================================================
# 🔥 [NEW] SSE 스트리밍 엔드포인트
# ==================================================================
@app.get("/api/agent/stream/{session_id}")
async def stream_discussion(session_id: str):
    """프론트엔드가 EventSource로 연결하는 SSE 엔드포인트.
    이 세션의 큐에 들어오는 토론 로그를 실시간으로 흘려보낸다."""
    
    # 큐가 없으면 새로 만들어 준다 (프론트가 먼저 연결되는 경우 대비)
    if session_id not in discussion_queues:
        discussion_queues[session_id] = Queue()
    
    async def event_generator():
        q = discussion_queues[session_id]
        # 연결 즉시 인사 메시지 1회 발사
        hello = {
            "agent": "시스템",
            "type": "system",
            "content": "🎬 AI 에이전트 난상토론 스트림 연결 완료. 곧 토론이 시작됩니다...",
            "timestamp": datetime.now().strftime("%H:%M:%S")
        }
        yield f"data: {json.dumps(hello, ensure_ascii=False)}\n\n"

        try:
            while True:
                try:
                    # 0.5초마다 큐 체크 (논블로킹)
                    log = q.get(timeout=0.5)
                    yield f"data: {json.dumps(log, ensure_ascii=False)}\n\n"
                    
                    # FINAL 신호가 오면 스트림 정상 종료
                    if log.get("type") == "final":
                        break
                except Empty:
                    # heartbeat: 30초 idle 시 keepalive ping
                    yield f": keepalive\n\n"
                    await asyncio.sleep(0.1)
        finally:
            # 연결 종료 시 큐 정리
            if session_id in discussion_queues:
                del discussion_queues[session_id]
                print(f"🧹 [Stream:{session_id}] 세션 정리 완료")
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"  # nginx buffering 비활성화
        }
    )

# ==================================================================
# 2. LLM 엔진 세팅 — 역할별 temperature 분리
# ==================================================================
MY_GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if not MY_GOOGLE_API_KEY:
    print("❌ [경고] GOOGLE_API_KEY가 없습니다!")

os.environ["GEMINI_API_KEY"] = MY_GOOGLE_API_KEY

try:
    llm_creative = LLM(
        model="gemini/gemini-3.1-flash-lite",
        api_key=MY_GOOGLE_API_KEY,
        temperature=0.9
    )
    llm_factual = LLM(
        model="gemini/gemini-3.1-flash-lite",
        api_key=MY_GOOGLE_API_KEY,
        temperature=0.2
    )
    llm_chat = LLM(
        model="gemini/gemini-3.1-flash-lite",
        api_key=MY_GOOGLE_API_KEY,
        temperature=0.6
    )
    print("✅ [AI] Gemini 3.1 Flash LLM 3종 세트 로드 완료 (creative / factual / chat)")
except Exception as e:
    print(f"🔥 모델 초기화 실패: {e}")
    llm_creative = llm_factual = llm_chat = None

search_tool = SerperDevTool()

# ==================================================================
# 3. 에이전트 정의 (기존 그대로 유지)
# ==================================================================
# ==================================================================
# 3. 에이전트 정의 (Co-creation 구조로 완벽 개편)
# ==================================================================
trends_agent = Agent(
    role='트렌드 수집가',
    goal='최신 글로벌 아트 뉴스 및 웹 트렌드를 스크래핑하여, 대중이 열광할 만한 예술 키워드를 수집한다.',
    backstory='당신은 전 세계의 예술 트렌드와 밈(Meme)을 가장 빠르게 파악하는 트렌드 헌터입니다.',
    tools=[search_tool], llm=llm_factual, max_iter=3, verbose=True
)

planner = Agent(
    role='키워드 스토리텔러 (전시 기획자)',
    goal='유저들이 투표한 Top 5 키워드와 가중치를 바탕으로, 이를 완벽하게 융합한 하나의 기가 막힌 스토리라인/컨셉을 기획한다.',
    backstory='당신은 단순한 단어의 나열을 넘어, 가중치가 높은 키워드를 메인 테마로 삼아 시대를 관통하는 철학적 서사를 만들어내는 천재 기획자입니다.',
    tools=[], llm=llm_creative, max_iter=3, verbose=True
)

painter = Agent(
    role='가중치 프롬프터 (디지털 아티스트)',
    goal='기획안을 바탕으로, 유저가 선택한 키워드의 투표율(가중치)이 실제 이미지에 정확히 반영되도록 정교한 5개의 영문 프롬프트를 작성한다.',
    backstory='당신은 Midjourney 등 이미지 생성 AI의 가중치 문법(예: cyberpunk::4, neon::2)을 완벽하게 이해하고 있는 프롬프트 엔지니어입니다. 반드시 5개의 각기 다른 구도를 가진 프롬프트를 JSON 배열로 출력합니다.',
    tools=[], llm=llm_creative, max_iter=3, verbose=True
)

critic = Agent(
    role='가치 증명자 (미술 비평가)',
    goal='우승작의 미학적, 상업적 가치(밈 가능성 포함)를 극대화하여 유저들이 가격을 높게 책정하도록 뽐뿌(?)를 넣는 비평문을 작성한다.',
    backstory='당신은 시장의 흐름을 읽고 대중의 투심을 자극하는 최고의 비평가입니다. 절대 직접 가격을 책정하지 않으며, 오직 작품의 폭발적인 가치만을 증명합니다.',
    tools=[search_tool], llm=llm_creative, max_iter=3, verbose=True
)

ai_curator = Agent(
    role='따뜻한 감성을 지닌 AI 큐레이터',
    goal='관람객의 질문에 대해 플랫폼 이용법 안내 및 전반적인 미술 추천을 단독으로 전담한다.',
    backstory='ArtDAO의 유일한 안내자입니다. 도슨트가 사라졌으므로 당신이 모든 해설과 안내를 책임집니다.',
    tools=[], llm=llm_chat, allow_delegation=False, max_iter=3, verbose=True
)
# ==================================================================
# 4. Pydantic 모델 (기존 그대로 + session_id 추가)
# ==================================================================
class PlanRequest(BaseModel): intent: str
class WorkRequest(BaseModel): topic: str; style: str
class ReviewRequest(BaseModel): art_info: str
class PromoRequest(BaseModel): exhibition_title: str; target_audience: str
class DocentRequest(BaseModel): message: str; wallet_address: str = ""
class A2AStudioRequest(BaseModel): intent: str; session_id: str = ""
class WinnerData(BaseModel):
    title: str
    description: str
    vp_votes: int
    session_id: str = ""  # 🔥 [NEW]
class CandidateGenRequest(BaseModel):
    insights: dict = None
    session_id: str = ""  # 🔥 [NEW]
# ==================================================================
# 7. 실시간 마켓 인사이트 분석 (기존 그대로 유지)
# ==================================================================
@app.get("/api/agent/insights")
def analyze_trends():
    print("🚀 [Agent] 실시간 글로벌 아트 트렌드 분석 가동...")

    task_trend = Task(
        description="""
        반드시 search_tool을 사용하여 '오늘의 글로벌 디지털 아트 트렌드와 기술적 이슈'를 검색하세요.
        검색 결과를 바탕으로 현재 가장 뜨거운 키워드 7개와 유행하는 시각적 스타일 3가지를 추출하세요.

        출력은 반드시 아래 구조의 순수 JSON 객체만 작성하세요. 마크다운(```json) 절대 금지.
        {"keywords": ["#키워드1", ...7개], "styles": [{"name": "스타일명", "percent": 숫자}, ...3개]}
        """,
        expected_output='순수 JSON 객체. keywords(7개 리스트)와 styles(name+percent 객체 3개 리스트) 키 필수.',
        agent=critic
    )

    crew = Crew(agents=[critic], max_rpm=5, tasks=[task_trend], verbose=True)

    try:
        result = crew.kickoff()
        result_text = str(result).replace("```json", "").replace("```", "").strip()
        parsed = json.loads(result_text)
        if "keywords" not in parsed or "styles" not in parsed:
            raise ValueError("필수 키 누락")
        return parsed
    except (json.JSONDecodeError, ValueError) as e:
        print(f"🔥 [Agent] JSON 파싱 실패, 폴백 사용: {e}")
        return {
            "keywords": ["#Generative_AI", "#Neo_Cyberpunk", "#Eco_Activism", "#Hyper_Realism", "#Web3_Art", "#Algorithmic", "#Surrealism"],
            "styles": [
                {"name": "Unreal Engine 5 Render", "percent": 50},
                {"name": "Oil Painting Texture", "percent": 30},
                {"name": "Retro 8-bit Pixel", "percent": 20}
            ]
        }
    except Exception as e:
        print(f"🔥 [Agent] 인사이트 분석 실패: {e}")
        return {
            "keywords": ["#Generative_AI", "#Neo_Cyberpunk", "#Eco_Activism", "#Hyper_Realism", "#Web3_Art", "#Algorithmic", "#Surrealism"],
            "styles": [
                {"name": "Unreal Engine 5 Render", "percent": 50},
                {"name": "Oil Painting Texture", "percent": 30},
                {"name": "Retro 8-bit Pixel", "percent": 20}
            ]
        }

# ==================================================================
# 8. 개별 API 엔드포인트 (기존 그대로 유지)
# ==================================================================
@app.post("/propose")
def create_proposal(request: PlanRequest):
    task = Task(
        description=f"'{request.intent}' 전시 기획안을 작성하세요.",
        expected_output="마크다운 형식의 전시 기획서",
        agent=planner
    )
    return {"draft_text": str(Crew(agents=[planner], tasks=[task]).kickoff())}

@app.post("/generate")
def start_work(request: WorkRequest):
    task = Task(
        description=f"'{request.topic}' 주제의 '{request.style}' 스타일 영문 이미지 프롬프트를 작성하세요.",
        expected_output="상세한 영문 이미지 생성 프롬프트",
        agent=painter
    )
    return {"final_prompt": str(Crew(agents=[painter], tasks=[task]).kickoff())}

@app.post("/review")
def create_review(request: ReviewRequest):
    task = Task(
        description=f"다음 작품을 search_tool로 검색한 실제 사례를 바탕으로 비평하세요: '{request.art_info}'",
        expected_output="미술사적 레퍼런스가 포함된 비평문",
        agent=critic
    )
    return {"review_text": str(Crew(agents=[critic], tasks=[task]).kickoff())}

@app.post("/promote")
def create_promo(request: PromoRequest):
    task = Task(
        description=f"'{request.exhibition_title}' 전시의 '{request.target_audience}' 대상 홍보 문구를 작성하세요.",
        expected_output="SNS용 바이럴 홍보 문구",
        agent=ai_curator
    )
    return {"promo_text": str(Crew(agents=[ai_curator], tasks=[task]).kickoff())}


@app.post("/studio/a2a-full")
def a2a_full_studio(request: A2AStudioRequest):
    session_id = request.session_id or ""
    today = datetime.now().strftime("%Y-%m-%d")

    if session_id and session_id not in discussion_queues:
        discussion_queues[session_id] = Queue()

    push_log(session_id, "시스템", "system", f"📝 전시 기획서 작성 토론 시작! (주제: {request.intent})")

    task_draft = Task(
        description=f"오늘 날짜({today}) 기준 '{request.intent}' 전시 기획서 초안을 마크다운으로 작성하세요.",
        expected_output="마크다운 형식의 전시 기획서 초안",
        agent=planner,
        callback=make_task_callback(session_id, "수석 전시 기획자")
    )
    task_review = Task(
        description="기획서 초안을 읽고 예술성을 높일 수 있는 구체적인 수정 지시를 작성하세요.",
        expected_output="초안의 약점과 구체적인 개선 방향이 담긴 비평문",
        agent=critic,
        context=[task_draft],
        callback=make_task_callback(session_id, "수석 미술 비평가")
    )
    task_revise = Task(
        description="초안과 비평을 모두 반영하여 최종 전시 기획서를 마크다운으로 완성하세요.",
        expected_output="비평이 반영된 최종 전시 기획서 마크다운",
        agent=planner,
        context=[task_draft, task_review],
        callback=make_task_callback(session_id, "수석 전시 기획자")
    )

    try:
        studio_crew = Crew(
            agents=[planner, critic],
            tasks=[task_draft, task_review, task_revise],
            process=Process.sequential,
            verbose=True,
            max_rpm=5,
            step_callback=make_step_callback(session_id, "AI 에이전트")
        )
        studio_crew.kickoff()
        push_log(session_id, "시스템", "final", "🎉 기획서 작성 토론 완료!")
        return {"draft_text": getattr(task_revise.output, 'raw', str(task_revise.output))}
    except Exception as e:
        push_log(session_id, "시스템", "error", f"🔥 서버 에러: {e}")
        push_log(session_id, "시스템", "final", "❌ 토론 중단")
        return {"draft_text": f"🔥 서버 에러 발생: {str(e)}"}

@app.post("/chat")
def combined_chat(request: DocentRequest):
    task_chat = Task(
        description=f"""
        사용자의 질문에 답변하세요: '{request.message}'

        질문 유형에 따라 아래 규칙을 따르세요:
        1. 플랫폼 이용 방법 질문 → 직접 쉽게 안내
        2. 전반적인 미술 추천 질문 → 직접 답변
        3. 특정 작가/기법/작품 세부 해설 요청 → 반드시 도슨트에게 위임(delegate)
        """,
        expected_output="플랫폼 가이드 또는 미술 추천 또는 도슨트 해설 (마크다운)",
        agent=ai_curator
    )
    try:
        chat_crew = Crew(
            agents=[ai_curator],
            tasks=[task_chat],
            process=Process.sequential,
            verbose=True,
            max_rpm=5
        )
        chat_crew.kickoff()
        return {"reply": getattr(task_chat.output, 'raw', str(task_chat.output))}
    except Exception as e:
        print(f"🔥 [Chat] 에러: {e}")
        return {"reply": "앗, 큐레이터가 다른 관람객을 응대 중입니다. 잠시 후 다시 질문해 주세요!"}

# ==================================================================
# 🔥 [NEW] Co-Creation 3단계 전용 엔드포인트
# ==================================================================

# 🟢 [Phase 1] 트렌드 키워드 리스트 추출
@app.get("/api/agent/trends-keywords")
def get_trends_keywords():
    try:
        task_trend = Task(
            description="현재 가장 뜨거운 디지털 아트, 기술 트렌드 키워드 15개를 1차원 JSON 배열로 추출하세요. (예: [\"사이버펑크\", \"입체파\"])",
            expected_output='["키워드1", "키워드2", ...]',
            agent=trends_agent # 🔥 트렌드 수집가 에이전트 투입!
        )
        crew = Crew(agents=[trends_agent], tasks=[task_trend])
        res = str(crew.kickoff()).replace("```json", "").replace("```", "").strip()
        return {"keywords": json.loads(res)}
    except:
        return {"keywords": ["Cyberpunk", "Minimalism", "Neon", "Space", "AI", "Dystopia", "Retro", "Surrealism"]}

# 🟢 [Phase 2] 가중치 기반 후보작 5개 생성 (1등 40%, 2등 30%, 3등 20%, 4등 7%, 5등 3% 비율 반영)
class WeightedCandidateRequest(BaseModel):
    weights: dict  # { "Cyberpunk": 0.4, "Neon": 0.3, "Space": 0.2, ... } 형태의 비율로 들어옴
    session_id: str = ""

@app.post("/api/agent/generate-weighted-candidates")
def generate_weighted_candidates(req: WeightedCandidateRequest):
    session_id = req.session_id
    if session_id and session_id not in discussion_queues:
        discussion_queues[session_id] = Queue()
    
    # weights 딕셔너리에는 키워드별 '생성 개수'가 들어있음
    dist_str = ", ".join([f"'{k}' 테마 {v}개" for k, v in req.weights.items()])
    total_count = sum(req.weights.values()) # 총 10개

    push_log(session_id, "시스템", "system", f"🎨 유저 투표 반영 기획 시작: {dist_str} (총 {total_count}개)")
    
    task_plan = Task(
    description=f"""유저 투표 결과 키워드 가중치: {dist_str}
    
    총 5개의 후보작을 기획하세요. 아래 규칙을 따르세요.
    - 작품 1~3: 가중치 높은 상위 키워드를 강하게 반영한 컨셉
    - 작품 4~5: 모든 키워드를 가중치 비율대로 골고루 섞은 컨셉
    
    각 작품의 컨셉 스토리라인을 한국어로 작성하세요.""",
    expected_output="5개의 컨셉 초안 (한국어)",
    agent=planner, callback=make_task_callback(session_id, "키워드 스토리텔러")
)
    
    task_format = Task(
    description=f"""기획안을 바탕으로 총 5개의 고해상도 영문 이미지 프롬프트를 작성하세요.
    키워드와 가중치: {dist_str}
    
    작품 1~3: 가중치 높은 키워드를 강하게 반영
    예시) "cyberpunk city::4, neon lights::3, surrealism::2, masterpiece, ultra detailed"
    
    작품 4~5: 모든 키워드를 가중치 비율대로 골고루 반영
    예시) "cyberpunk::4, neon::3, surrealism::2, space::0.7, minimalism::0.3, masterpiece"
    
    출력은 무조건 순수 JSON 배열:
    [
      {{"title": "한국어 제목", "description": "한국어 설명", "image_prompt": "영문 프롬프트"}},
      ... (총 5개)
    ]""",
    expected_output="후보작 5개가 담긴 순수 JSON 배열",
    agent=painter, context=[task_plan], callback=make_task_callback(session_id, "가중치 프롬프터")
)

    crew = Crew(agents=[planner, painter], tasks=[task_plan, task_format], process=Process.sequential)
    try:
        result_text = str(crew.kickoff()).replace("```json", "").replace("```", "").strip()
        start_idx = result_text.find('[')
        end_idx = result_text.rfind(']') + 1
        candidates = json.loads(result_text[start_idx:end_idx])
        push_log(session_id, "시스템", "final", f"🎉 토론 완료! 후보작 {len(candidates)}개 생성 완료.")
        return {"candidates": candidates}
    except Exception:
        push_log(session_id, "시스템", "final", "⚠️ 파싱 에러 발생")
        return {"candidates": [{"title": f"임시 아트 {i}", "description": "에러 복구됨", "image_prompt": "masterpiece, digital art"} for i in range(1, total_count + 1)]}

# 🟢 [Phase 3] 우승작 가치 증명 (가격 책정 X)
class WinnerEvalOnlyRequest(BaseModel):
    title: str
    description: str
    session_id: str = ""

@app.post("/api/agent/evaluate-winner-only")
def evaluate_winner_only(req: WinnerEvalOnlyRequest):
    session_id = req.session_id
    if session_id and session_id not in discussion_queues:
        discussion_queues[session_id] = Queue()
    
    push_log(session_id, "시스템", "system", f"🏆 우승작 가치 증명 시작: {req.title}")

    task_eval = Task(
        description=f"우승작 '{req.title}'({req.description})의 미학적, 상업적 가치(밈 잠재력 포함)를 극대화하는 강력한 비평문을 작성하세요. 유저가 가격을 높게 책정하도록 설득해야 합니다. **절대 당신이 직접 가격(숫자)을 책정하지 마세요.**",
        expected_output="설득력 있는 비평문",
        agent=critic, callback=make_task_callback(session_id, "가치 증명자")
    )

    crew = Crew(agents=[critic], tasks=[task_eval])
    report = str(crew.kickoff())
    push_log(session_id, "시스템", "final", "✅ 가치 증명 비평 완료")
    
    return {"report": report}

# 🟢 [Chat 수정] 도슨트 삭제로 인한 큐레이터 단독 처리
class ChatRequest(BaseModel): message: str; wallet_address: str = ""
@app.post("/chat")
def combined_chat(request: ChatRequest):
    task_chat = Task(
        description=f"사용자 질문: '{request.message}'\n관람객에게 따뜻하고 유용하게 안내 및 해설을 제공하세요.",
        expected_output="친절한 답변 텍스트",
        agent=ai_curator
    )
    res = str(Crew(agents=[ai_curator], tasks=[task_chat]).kickoff())
    return {"reply": res}