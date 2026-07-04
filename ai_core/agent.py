import os
import json
import asyncio
import logging
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

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger("ai_core")

app = FastAPI(title="ArtDAO CrewAI A2A Server", version="8.0-Streaming-A2A")

# ==================================================================
# 1. CORS 및 SSE 큐 매니저 설정
# ==================================================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

discussion_queues = {}

@app.get("/health")
def health():
    # Gemini 실호출은 쿼터 낭비라 하지 않고, 키 존재 + LLM 로드 성공 여부만 확인
    llm_ready = bool(os.getenv("GOOGLE_API_KEY")) and llm_creative is not None
    return {"status": "ok" if llm_ready else "degraded", "llm_ready": llm_ready, "active_sessions": len(discussion_queues)}

def push_log(session_id: str, agent_role: str, log_type: str, content: str):
    if session_id and session_id in discussion_queues:
        log_entry = {
            "agent": agent_role,
            "type": log_type,
            "content": content,
            "timestamp": datetime.now().strftime("%H:%M:%S")
        }
        discussion_queues[session_id].put(log_entry)

def make_step_callback(session_id: str, agent_role: str = "에이전트"):
    def callback(step_output):
        try:
            content = ""
            log_type = "thought"
            if hasattr(step_output, 'tool') and step_output.tool:
                log_type = "action"
                tool_name = step_output.tool
                tool_input = getattr(step_output, 'tool_input', '')
                content = f"🔧 도구 사용: {tool_name}({tool_input})"
            elif hasattr(step_output, 'output'):
                log_type = "output"
                content = str(step_output.output)
            elif 'ToolResult' in str(type(step_output)) or str(step_output).startswith('ToolResult'):
                return
            else:
                content_raw = str(step_output)
                if content_raw.startswith('ToolResult'):
                    return
                content = content_raw

            push_log(session_id, agent_role, log_type, content)
        except Exception: pass
    return callback

def make_task_callback(session_id: str, agent_role: str = "에이전트"):
    def callback(task_output):
        try:
            content = str(getattr(task_output, 'raw', task_output))
            push_log(session_id, agent_role, "task_complete", f"✅ 작업 완료\n{content}")
        except Exception: pass
    return callback

@app.get("/api/agent/stream/{session_id}")
async def stream_discussion(session_id: str):
    if session_id not in discussion_queues:
        discussion_queues[session_id] = Queue()
    
    async def event_generator():
        q = discussion_queues[session_id]
        hello = {
            "agent": "시스템", "type": "system",
            "content": "🎬 AI 에이전트 난상토론 스트림 연결 완료. 곧 토론이 시작됩니다...",
            "timestamp": datetime.now().strftime("%H:%M:%S")
        }
        yield f"data: {json.dumps(hello, ensure_ascii=False)}\n\n"

        try:
            while True:
                try:
                    log = q.get(timeout=0.5)
                    yield f"data: {json.dumps(log, ensure_ascii=False)}\n\n"
                    if log.get("type") == "final": break
                except Empty:
                    yield f": keepalive\n\n"
                    await asyncio.sleep(0.1)
        finally:
            if session_id in discussion_queues:
                del discussion_queues[session_id]
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"}
    )

# ==================================================================
# 2. LLM 엔진 세팅 (안전장치 완벽 적용)
# ==================================================================
MY_GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
os.environ["GEMINI_API_KEY"] = MY_GOOGLE_API_KEY or ""

def get_safe_llm(temp=0.7):
    return LLM(
        model="gemini/gemini-3.1-flash-lite", # 1순위: 최신 모델 시도
        api_key=MY_GOOGLE_API_KEY,
        temperature=temp,
        max_retries=3, # 🚨 서버가 바쁘다고 튕겨내면 3번까지 끈질기게 다시 요청!
        fallbacks=["gemini/gemini-1.5-flash"] # 🚨 그래도 안 되면 구형이지만 안정적인 1.5 모델로 우회!
    )

try:
    # 🚨 쌩으로 호출하지 않고, 위에서 만든 안전장치(get_safe_llm)를 거쳐서 세팅!
    llm_creative = get_safe_llm(0.9)
    llm_factual = get_safe_llm(0.2)
    llm_chat = get_safe_llm(0.6)
except Exception as e:
    logger.error(f"LLM 로드 실패: {e}")
    llm_creative = llm_factual = llm_chat = None

search_tool = SerperDevTool()

# ==================================================================
# 3. 에이전트 정의
# ==================================================================
trends_agent = Agent(role='트렌드 수집가', goal='트렌드 수집', backstory='...', tools=[search_tool], llm=llm_factual, max_iter=3)
planner = Agent(role='키워드 스토리텔러 (전시 기획자)', goal='기획안 작성', backstory='...', tools=[], llm=llm_creative, max_iter=3)
painter = Agent(role='가중치 프롬프터 (디지털 아티스트)', goal='프롬프트 작성', backstory='...', tools=[], llm=llm_creative, max_iter=3)
critic = Agent(role='가치 증명자 (미술 비평가)', goal='비평문 작성', backstory='...', tools=[], llm=llm_creative, max_iter=3)
ai_curator = Agent(role='따뜻한 감성을 지닌 AI 큐레이터', goal='도슨트', backstory='...', tools=[], llm=llm_chat, allow_delegation=False, max_iter=3)

# ==================================================================
# 🔥 [NEW] Phase 1: 실시간 트렌드 키워드 추출 (카테고리별 3개씩)
# ==================================================================
@app.get("/api/agent/trends-keywords")
def get_trends_keywords():
    try:
        task_trend = Task(
            description="""현재 전 세계 디지털 아트 트렌드를 분석하여, 다음 2가지 카테고리의 트렌드 키워드를 한국어로 3개씩 추출하세요.
            1. subjects (기획 대상/테마): 예) 사이버펑크 닌자, 해저 도시 등
            2. styles (표현 방식/화풍/재질): 예) 베이퍼웨이브, 3D 언리얼 엔진, 글리치 왜곡 등
            
            반드시 아래 형식의 순수 JSON으로만 출력하세요:
            {"subjects": ["A", "B", "C"], "styles": ["D", "E", "F"]}""",
            expected_output='순수 JSON 객체',
            agent=trends_agent
        )
        crew = Crew(agents=[trends_agent], tasks=[task_trend])
        res = str(crew.kickoff()).replace("```json", "").replace("```", "").strip()
        return json.loads(res)
    except Exception as e:
        logger.warning(f"🔥 트렌드 추출 실패: {e}")
        return {
            "subjects": ["메타버스 공간", "우주 탐사선", "포스트 아포칼립스"],
            "styles": ["베이퍼웨이브", "3D 복셀", "글리치 아트"]
        }

# ==================================================================
# 4. Phase 2: 그림 생성 및 프롬프트 조립
# ==================================================================
class WeightedCandidateRequest(BaseModel):
    weights: dict  
    style: str = "digital art style"
    session_id: str = ""

@app.post("/api/agent/generate-weighted-candidates")
def generate_weighted_candidates(req: WeightedCandidateRequest):
    session_id = req.session_id
    if session_id and session_id not in discussion_queues:
        discussion_queues[session_id] = Queue()
    
    dist_str = ", ".join([f"'{k}' ({int(v*100)}% 비중)" for k, v in req.weights.items()])
    push_log(session_id, "시스템", "system", f"🎨 유저 투표 반영 기획 시작: {dist_str}")
    
    task_plan = Task(
        description=f"유저 투표 결과 키워드 비중: {dist_str}\n총 5개의 후보작 컨셉을 한국어로 기획하세요.",
        expected_output="5개의 컨셉 초안 (한국어)",
        agent=planner, callback=make_task_callback(session_id, "키워드 스토리텔러")
    )
    
    task_format = Task(
        description=f"""기획안을 바탕으로 총 5개의 고해상도 영문 이미지 프롬프트를 작성하세요.
        [필수 반영 요소]
        1. 핵심 테마와 비중: {dist_str}
        2. 고정 표현 방식(화풍 및 재질): 무조건 '{req.style}' 반영
        
        [프롬프트 작성 황금 공식]
        '[가중치가 반영된 테마들], in the style of [고정 표현 방식]'
        
        출력은 무조건 순수 JSON 배열만 작성하세요:
        [
          {{"title": "한국어 제목", "description": "한국어 설명", "image_prompt": "영문 프롬프트"}},
          ... (총 5개)
        ]""",
        expected_output="후보작 5개가 담긴 순수 JSON 배열",
        agent=painter, context=[task_plan], callback=make_task_callback(session_id, "가중치 프롬프터")
    )

    crew = Crew(
        agents=[planner, painter], tasks=[task_plan, task_format], 
        process=Process.sequential, verbose=True,
        step_callback=make_step_callback(session_id, "AI 창작팀")
    )
    
    try:
        result_text = str(crew.kickoff()).replace("```json", "").replace("```", "").strip()
        start_idx = result_text.find('[')
        end_idx = result_text.rfind(']') + 1
        candidates = json.loads(result_text[start_idx:end_idx])
        push_log(session_id, "시스템", "final", f"🎉 토론 완료! 후보작 {len(candidates)}개 생성 완료.")
        return {"candidates": candidates[:5]}
    except Exception as e:
        push_log(session_id, "시스템", "error", f"⚠️ AI 사고 회로 지연: {str(e)}")
        push_log(session_id, "시스템", "final", "⚠️ 안전 모드로 전환하여 렌더링을 진행합니다.")
        return {"candidates": [{"title": f"안전 렌더링 {i}", "description": "복구 처리됨", "image_prompt": f"masterpiece, {req.style}"} for i in range(1, 6)]}


# ==================================================================
# 5. Phase 3: 우승작 가치 평가
# ==================================================================
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
        description=f"우승작 '{req.title}'({req.description})의 미학적, 상업적 가치를 극대화하는 강력한 비평문을 작성하세요. 절대 직접 가격(숫자)을 책정하지 마세요.",
        expected_output="설득력 있는 비평문",
        agent=critic, callback=make_task_callback(session_id, "가치 증명자")
    )
    
    # 🚨 비평가에게도 중계 카메라 장착!
    crew = Crew(
        agents=[critic], tasks=[task_eval], verbose=True, 
        step_callback=make_step_callback(session_id, "미술 비평가")
    )
    
    try:
        report = str(crew.kickoff())
        push_log(session_id, "시스템", "final", "✅ 가치 증명 비평 완료")
        return {"report": report}
    except Exception as e:
        push_log(session_id, "시스템", "error", f"비평 에러: {e}")
        push_log(session_id, "시스템", "final", "✅ 비평 완료 (오류)")
        return {"report": "비평문 생성 중 오류가 발생했습니다."}
