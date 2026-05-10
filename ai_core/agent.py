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
        model="gemini/gemini-2.5-flash-lite",
        api_key=MY_GOOGLE_API_KEY,
        temperature=0.9
    )
    llm_factual = LLM(
        model="gemini/gemini-2.5-flash-lite",
        api_key=MY_GOOGLE_API_KEY,
        temperature=0.2
    )
    llm_chat = LLM(
        model="gemini/gemini-2.5-flash-lite",
        api_key=MY_GOOGLE_API_KEY,
        temperature=0.6
    )
    print("✅ [AI] Gemini 1.5 Flash LLM 3종 세트 로드 완료 (creative / factual / chat)")
except Exception as e:
    print(f"🔥 모델 초기화 실패: {e}")
    llm_creative = llm_factual = llm_chat = None

search_tool = SerperDevTool()

# ==================================================================
# 3. 에이전트 정의 (기존 그대로 유지)
# ==================================================================
planner = Agent(
    role='수석 전시 기획자',
    goal='오늘의 글로벌 뉴스와 Market Insights 트렌드를 융합하여, 날카로운 시대적 통찰이 담긴 디지털 아트 컨셉 2가지를 기획한다. 반드시 한국어 제목과 한국어 설명을 포함한다.',
    backstory='당신은 20년 경력의 베테랑 큐레이터입니다. 단순한 아이디어도 거시적인 예술 비전으로 확장시킵니다. 기획할 때는 반드시 search_tool로 오늘의 실제 뉴스를 먼저 검색한 뒤 작업을 시작합니다.',
    tools=[search_tool],
    llm=llm_creative,
    allow_delegation=False,
    max_iter=4,
    max_rpm=5,
    verbose=True
)

painter = Agent(
    role='수석 디지털 아티스트',
    goal='기획자의 컨셉을 받아 각기 다른 화풍의 고품질 영문 image_prompt 2개를 작성하고, 반드시 순수 JSON 배열로만 출력한다.',
    backstory='당신은 빛, 질감, 구도를 완벽하게 이해하는 디지털 아티스트입니다. 프롬프트에 한자, 중국어, 일본어가 절대 포함되지 않도록 철저히 통제합니다. 출력은 항상 JSON 배열만 작성하며 마크다운 코드블록(```json)을 절대 사용하지 않습니다.',
    tools=[search_tool],
    llm=llm_creative,
    allow_delegation=False,
    max_iter=4,
    max_rpm=5,
    verbose=True
)

critic = Agent(
    role='수석 미술 비평가',
    goal='작품을 미술사적 맥락과 객관적 데이터를 바탕으로 심층 분석하고 비평한다. 반드시 search_tool을 사용하여 실제 사례를 검색한 뒤 비평문을 작성한다.',
    backstory='당신은 식견 높고 까칠한 비평가입니다. 주관적 감상이 아닌 검색된 객관적 사실을 근거로만 작품의 가치를 평가합니다. 할루시네이션은 절대 용납하지 않습니다.',
    tools=[search_tool],
    llm=llm_factual,
    allow_delegation=False,
    max_iter=4,
    max_rpm=5,
    verbose=True
)

auctioneer = Agent(
    role='소더비 수석 경매사',
    goal='비평가의 보고서와 득표수를 종합하여 최종 경매가를 산정한다. 반드시 search_tool로 유사 NFT 실제 낙찰가를 검색한 뒤 가격을 책정하며, 출력은 반드시 {"auction_price": 숫자, "report": "문자열"} 형태의 순수 JSON만 작성한다.',
    backstory='당신은 세계 최고의 경매사입니다. 가격을 절대 임의로 지어내지 않습니다. 1 VP당 10~50 TUK 기준으로 시장 데이터와 곱하여 합리적인 가격을 책정합니다. 출력에 마크다운 코드블록(```json)을 절대 사용하지 않습니다.',
    tools=[search_tool],
    llm=llm_factual,
    max_iter=4,
    verbose=True,
    max_rpm=5
)

ai_curator = Agent(
    role='따뜻한 감성을 지닌 AI 큐레이터',
    goal='관람객의 질문 유형을 파악하여 플랫폼 가이드, 미술 추천, 작품 해설 중 가장 적합한 답변을 제공한다. 세부 작품 해설이 필요하면 도슨트에게 위임한다.',
    backstory='당신은 ArtDAO 전시관의 메인 AI 큐레이터입니다. 질문이 (1)플랫폼 사용법이면 직접 안내, (2)전반적 미술 추천이면 직접 답변, (3)특정 작가/기법 세부 해설이면 반드시 도슨트에게 위임합니다.',
    tools=[],
    llm=llm_chat,
    allow_delegation=True,
    max_iter=3,
    max_rpm=5,
    verbose=True
)

ai_docent = Agent(
    role='작품의 숨결을 전하는 AI 도슨트',
    goal='특정 작품의 세부 묘사, 창작 배경, 예술사적 맥락을 생생하고 친절하게 전달한다.',
    backstory='당신은 작품 해설 전문 도슨트입니다. 캔버스의 질감, 색채의 대비, 작가의 의도를 쉽고 감동적으로 설명합니다.',
    tools=[],
    llm=llm_chat,
    allow_delegation=False,
    max_iter=3,
    verbose=True,
    max_rpm=5
)

# ==================================================================
# 4. Pydantic 모델 (기존 그대로 + session_id 추가)
# ==================================================================
class PlanRequest(BaseModel): intent: str
class WorkRequest(BaseModel): topic: str; style: str
class ReviewRequest(BaseModel): art_info: str
class PromoRequest(BaseModel): exhibition_title: str; target_audience: str
class AuctionRequest(BaseModel): art_info: str; critic_review: str
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
# 5. Botto DAO: 후보작 2개 생성 (🔥 스트리밍 콜백 적용)
# ==================================================================
@app.post("/api/agent/generate-candidates")
def generate_candidates(req: CandidateGenRequest = None):
    session_id = req.session_id if req and req.session_id else ""
    print(f"🚀 [Agent] Market Insights 연동 2개 후보작 기획 가동... (session: {session_id})")

    # 🔥 세션 큐 준비
    if session_id and session_id not in discussion_queues:
        discussion_queues[session_id] = Queue()

    push_log(session_id, "시스템", "system", "🎨 새 라운드 후보작 기획 토론을 시작합니다!")

    trend_keywords = ", ".join(req.insights.get("keywords", [])) if req and req.insights else "최신 기술 트렌드"
    trend_styles_raw = req.insights.get("styles", []) if req and req.insights else []
    trend_styles = ", ".join([s["name"] for s in trend_styles_raw]) if trend_styles_raw else "디지털 아트"

    style_1 = trend_styles_raw[0]["name"] if len(trend_styles_raw) > 0 else "Surrealism, classic oil painting texture, Salvador Dali style, highly detailed masterpiece"
    style_2 = trend_styles_raw[1]["name"] if len(trend_styles_raw) > 1 else "Geometric abstraction, highly detailed 3D render, architectural elements, sleek and modern"

    push_log(session_id, "시스템", "system", f"📊 트렌드 데이터 로드 완료\n- 키워드: {trend_keywords}\n- 스타일: {trend_styles}")

    task_plan = Task(
        description=f"""
        당신은 '현실의 이슈'를 디지털 예술로 승화시키는 천재 기획자입니다.
        현재 ArtDAO 플랫폼의 Market Insights 데이터는 다음과 같습니다:
        - 🔥 유행 키워드: {trend_keywords}
        - 🎨 선호 스타일: {trend_styles}

        다음 순서대로 작업하세요:
        1. 반드시 search_tool을 사용하여 '오늘의 주요 글로벌 과학/IT 뉴스' 혹은 '사회적 논란' 중 하나를 검색하세요.
        2. 검색한 실제 뉴스/이슈를 위의 유행 키워드와 선호 스타일에 완벽하게 융합하여 미술 작품 컨셉 2가지를 기획하세요.
        3. 각 컨셉은 반드시 '한국어 제목'과 '한국어 작품 설명'을 포함해야 합니다.
        """,
        expected_output="Market Insights 트렌드와 오늘 뉴스가 융합된 2가지 컨셉 초안 (한국어 제목 + 한국어 설명 포함)",
        agent=planner,
        callback=make_task_callback(session_id, "수석 전시 기획자")  # 🔥 역할명 명시
    )

    task_format = Task(
        description=f"""
        기획자의 2가지 컨셉을 바탕으로 이미지 생성용 JSON 데이터를 작성하세요.
        반드시 아래 구조의 순수 JSON 배열만 출력하세요. 마크다운(```json) 절대 금지.
        설명, 사고 과정, 영어 분석 등 다른 텍스트는 절대 포함하지 마세요.
        오직 [ 로 시작해서 ] 로 끝나는 JSON 배열만 출력하세요.

        [아트 스타일 지침: 2개 작품의 화풍을 반드시 다르게!]
        - 1번 작품 스타일: {style_1}
        - 2번 작품 스타일: {style_2}

        [출력 형식 - 이 형식 외 다른 텍스트 일절 금지]
        [
            {{
                "title": "작품 제목 (한국어)",
                "description": "작품 세계관 설명 (한국어)",
                "image_prompt": "상세한 영문 이미지 생성 프롬프트"
            }},
            {{
                "title": "작품 제목 (한국어)",
                "description": "작품 세계관 설명 (한국어)",
                "image_prompt": "상세한 영문 이미지 생성 프롬프트"
            }}
        ]
        """,
        expected_output='마크다운 없는 순수 JSON 배열만 출력. [ 로 시작해 ] 로 끝나는 형태. 사고 과정/설명문 절대 포함 금지.',
        agent=painter,
        context=[task_plan],
        callback=make_task_callback(session_id, "수석 디지털 아티스트")  # 🔥 역할명 명시
    )

    crew = Crew(
        agents=[planner, painter],
        tasks=[task_plan, task_format],
        process=Process.sequential,
        verbose=True,
        max_rpm=5,
        step_callback=make_step_callback(session_id, "AI 에이전트")  # 🔥 step은 통합명
    )

    try:
        result = crew.kickoff()
        result_text = str(result).replace("```json", "").replace("```", "").strip()
        
        # 🔥 [강화v2] 텍스트에서 첫 번째 유효한 JSON 배열만 정확히 추출
        candidates_data = None
        decoder = json.JSONDecoder()
        
        # 첫 '[' 위치부터 시작해서 raw_decode로 정확히 한 개의 JSON만 파싱
        for idx, ch in enumerate(result_text):
            if ch == '[':
                try:
                    parsed, _ = decoder.raw_decode(result_text[idx:])
                    if isinstance(parsed, list) and len(parsed) > 0:
                        candidates_data = parsed
                        print(f"📝 [Agent] JSON 배열 추출 성공 (위치: {idx}, 항목수: {len(parsed)})")
                        break
                except json.JSONDecodeError:
                    continue  # 다음 '['에서 다시 시도
        
        if candidates_data is None:
            # 폴백: 그래도 안 되면 원본 그대로 한번 더 시도
            candidates_data = json.loads(result_text)
        
        if not isinstance(candidates_data, list) or len(candidates_data) == 0:
            raise ValueError("유효한 후보작 배열이 아닙니다.")
        
        push_log(session_id, "시스템", "final", "🎉 토론 완료! 후보작 2개가 생성되었습니다.")
        return {"candidates": candidates_data}
    except (json.JSONDecodeError, ValueError) as e:
        print(f"🔥 [Agent] JSON 파싱 실패, 폴백 데이터 사용: {e}")
        push_log(session_id, "시스템", "error", f"⚠️ JSON 파싱 실패, 폴백 사용: {e}")
        push_log(session_id, "시스템", "final", "🔄 폴백 데이터로 마무리합니다.")
        return {
            "candidates": [
                {"title": "AI 기본 작품 1", "description": "AI가 생성한 기본 작품입니다.", "image_prompt": "surrealism digital art masterpiece, highly detailed"},
                {"title": "AI 기본 작품 2", "description": "AI가 생성한 기본 작품입니다.", "image_prompt": "geometric 3D abstraction, sleek modern architecture render"}
            ]
        }
    except Exception as e:
        print(f"🔥 [Agent] 후보작 생성 실패: {e}")
        push_log(session_id, "시스템", "error", f"🔥 치명적 에러: {e}")
        push_log(session_id, "시스템", "final", "❌ 토론 중단")
        raise HTTPException(status_code=500, detail="AI 후보작 생성 중 오류 발생")

# ==================================================================
# 6. Botto DAO: 우승작 가치 산정 (🔥 스트리밍 콜백 적용)
# ==================================================================
@app.post("/api/agent/evaluate-winner")
def evaluate_winner(data: WinnerData):
    session_id = data.session_id or ""
    print(f"🚀 [Agent] 우승작 시장 가치 산정 토론 가동: {data.title} (득표: {data.vp_votes} VP) (session: {session_id})")

    if session_id and session_id not in discussion_queues:
        discussion_queues[session_id] = Queue()

    push_log(session_id, "시스템", "system", f"🏆 우승작 가치 산정 토론 시작!\n- 작품: {data.title}\n- 득표: {data.vp_votes} VP")

    task_eval_art = Task(
        description=f"""
        아래 작품을 분석하여 경매사에게 브리핑하세요.
        - 제목: {data.title}
        - 설명: {data.description}

        반드시 search_tool을 사용하여 이 작품과 유사한 스타일의 실제 미술 평가나 대중적 반응을 검색하고,
        검색된 객관적 사실을 근거로 미학적 가치를 평가하세요.
        """,
        expected_output="검색된 실제 레퍼런스가 포함된 작품 미학 평가 보고서",
        agent=critic,
        callback=make_task_callback(session_id, "수석 미술 비평가")  # 🔥
    )

    task_eval_price = Task(
        description=f"""
        비평가의 평가 보고서와 대중 투표수({data.vp_votes} VP)를 종합하여 최종 경매가를 산정하세요.

        반드시 search_tool을 사용하여 '최근 유사한 NFT 또는 디지털 아트 실제 경매 낙찰가'를 검색하세요.
        1 VP당 10~50 TUK 기준으로 시장 데이터와 결합하여 최종 가격을 계산하세요.

        출력은 반드시 아래 형식의 순수 JSON만 작성하세요. 사고 과정, 영어 분석, 다른 텍스트 일절 금지.
        오직 {{ 로 시작해서 }} 로 끝나는 JSON 객체만 출력하세요.
        {{"auction_price": 숫자(정수), "report": "가격 산정 근거 요약 문자열"}}
        """,
        expected_output='순수 JSON 객체만 출력. {{ 로 시작해 }} 로 끝나는 형태. 다른 설명/사고 과정 절대 금지.',
        agent=auctioneer,
        context=[task_eval_art],
        callback=make_task_callback(session_id, "소더비 수석 경매사")  # 🔥
    )

    crew = Crew(
        agents=[critic, auctioneer],
        tasks=[task_eval_art, task_eval_price],
        process=Process.sequential,
        verbose=True,
        maxrpm=5,
        step_callback=make_step_callback(session_id, "AI 에이전트")  # 🔥
    )

    try:
        result = crew.kickoff()
        result_text = str(result).replace("```json", "").replace("```", "").strip()
        
        # 🔥 [강화v2] 첫 번째 유효한 JSON 객체만 정확히 추출
        evaluation_data = None
        decoder = json.JSONDecoder()
        
        for idx, ch in enumerate(result_text):
            if ch == '{':
                try:
                    parsed, _ = decoder.raw_decode(result_text[idx:])
                    if isinstance(parsed, dict) and "auction_price" in parsed:
                        evaluation_data = parsed
                        print(f"📝 [Agent] 경매 JSON 추출 성공 (위치: {idx})")
                        break
                except json.JSONDecodeError:
                    continue
        
        if evaluation_data is None:
            evaluation_data = json.loads(result_text)
        if "auction_price" not in evaluation_data:
            evaluation_data["auction_price"] = data.vp_votes * 10
        if "report" not in evaluation_data:
            evaluation_data["report"] = "AI 보고서 파싱 실패로 기본가 책정"
        
        push_log(session_id, "시스템", "final", f"💰 최종 경매가 확정: {evaluation_data['auction_price']} TUK")
        return evaluation_data
    except (json.JSONDecodeError, ValueError) as e:
        print(f"🔥 [Agent] JSON 파싱 실패, 폴백 사용: {e}")
        push_log(session_id, "시스템", "final", f"⚠️ 파싱 오류, 기본가({data.vp_votes * 10} TUK) 적용")
        return {"auction_price": data.vp_votes * 10, "report": "AI 파싱 오류로 기본가 책정"}
    except Exception as e:
        print(f"🔥 [Agent] 가치 산정 실패: {e}")
        push_log(session_id, "시스템", "error", f"🔥 가치 산정 실패: {e}")
        push_log(session_id, "시스템", "final", "❌ 토론 중단")
        return {"auction_price": data.vp_votes * 10, "report": "AI 토론 오류로 기본가 책정"}

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

@app.post("/auction")
def open_auction(request: AuctionRequest):
    task = Task(
        description=f"다음 비평문을 바탕으로 '{request.art_info}' 경매 리포트를 작성하세요.\n[비평문]: {request.critic_review}\nsearch_tool로 최근 실제 가격 동향을 검색하여 리포트에 포함하세요.",
        expected_output="시장 데이터 기반 경매 리포트",
        agent=auctioneer
    )
    return {"auction_report": str(Crew(agents=[auctioneer], tasks=[task]).kickoff())}

@app.post("/docent")
def start_tour(request: DocentRequest):
    task = Task(
        description=f"다음 작품에 대한 깊이 있는 해설을 작성하세요: '{request.message}'",
        expected_output="관람객이 이해하기 쉬운 친절한 작품 해설",
        agent=ai_docent
    )
    return {"commentary": str(Crew(agents=[ai_docent], tasks=[task]).kickoff())}

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
            agents=[ai_curator, ai_docent],
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
