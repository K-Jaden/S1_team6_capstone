# DECISIONS.md

문제 해결 과정과 설계 결정을 기록하는 문서. 원인 파악에 시간이 걸린 버그, 여러 방법 중 선택한 설계 결정, 성능/비용/정확도 트레이드오프를 다룰 때 항목을 추가한다.

기록 형식:

```
## YYYY-MM-DD: 제목 (문제 → 해결 한 줄 요약)
**문제**: 어떤 상황에서 무엇이 문제였는지
**시도한 것**: (선택) 시도했지만 안 통했던 방법
**해결**: 최종적으로 어떻게 해결했는지
**결과**: 해결 후 효과
```

---

*아래 항목들은 2026-07-04 문서 도입 시점에 코드 주석과 README에서 역추적해 백필한 것으로, 실제 해결 날짜와 다를 수 있음.*

## 2026-07-04 (백필): 컨트랙트 재배포 시 주소 불일치 (노드 재시작 → 자동 배포로 해결)
**문제**: hardhat node를 재시작하면 배포된 컨트랙트가 사라져, 프론트/백엔드가 바라보는 주소에 컨트랙트가 없다는 "Non-contract address" 오류가 반복 발생.
**해결**: docker-compose의 blockchain 서비스가 노드 실행 → 헬스체크 대기 → deploy.js 자동 실행까지 한 번에 처리하도록 구성. 다른 서비스들이 이 서비스에 depends_on으로 의존해 주소 파일이 먼저 생성되도록 함. 수동 실행 시에는 재배포 후 `frontend/src/contracts/address.js` 갱신 필요 (README 트러블슈팅에 문서화).
**결과**: docker compose 환경에서는 주소 불일치 문제 없이 한 번에 기동.

## 2026-07-04 (백필): Windows에서 React 핫리로드 미동작 (파일 감시 방식 → 폴링으로 해결)
**문제**: Windows + Docker 볼륨 마운트 환경에서 파일 변경이 감지되지 않아 React 개발 서버의 핫리로드가 동작하지 않음.
**해결**: frontend 컨테이너에 `CHOKIDAR_USEPOLLING=true`(구형), `WATCHPACK_POLLING=true`(Webpack 5+) 환경변수를 설정해 폴링 기반 파일 감시로 전환. `WDS_SOCKET_PORT=0`으로 웹소켓 포트 충돌도 방지. 또한 호스트의 node_modules가 컨테이너를 덮어쓰지 않도록 익명 볼륨(`/app/node_modules`) 처리.
**결과**: Windows에서도 도커 컨테이너 내 핫리로드 정상 동작.

## 2026-07-04: fix/stability 브랜치 - 안정성 개선 작업 (자잘한 오류 다수 → 커밋 단위로 순차 수정)
**문제**: 캡스톤 진행 중 누적된 안정성 문제들 - 실제 Google API 키 하드코딩(ai_core/check_models.py), ADMIN_PRIVATE_KEY 기본값 하드코딩, EC2 IP 하드코딩(main.py·App.js), bare except, 키워드 중복투표 race condition, 투표량 음수 미검증, DB 커넥션 풀 미설정, 내부 에러 메시지 사용자 노출, 헬스체크/재시작 정책 부재 등.
**시도한 것**: KeywordVoteLog 중복투표 방지를 위해 Alembic 마이그레이션 도입도 고려했으나, 데이터가 전부 데모/시연용이고 hardhat 로컬체인도 compose 재시작마다 리셋되어 DB만 영속화해봐야 온체인과 어차피 불일치하므로 과잉 투자로 판단.
**해결**: `fix/stability` 브랜치에서 커밋 단위로 분리 진행 - (S1) 시크릿 제거 및 미사용 파일 삭제, (S2) 하드코딩 URL을 env로 이동, (S3) print→logging 전환·중복 import 정리·bare except 제거, (S4) KeywordVoteLog에 UniqueConstraint(round_id, wallet_address) 추가 + commit 시 IntegrityError/SQLAlchemyError를 rollback으로 처리 + DB 커넥션 풀(pool_pre_ping/pool_recycle) 설정, (S5) 내부 에러 원문 노출 차단 + `/api/gallery/docent` 404 해소(a2a_chat 재사용 alias 추가). DB 마이그레이션은 Alembic 대신 "머지 후 팀 전원 `docker compose down -v` 1회" 방식 채택.
**결과**: 유출된 Google API 키는 재발급 필요(사용자 조치 남음). unique 제약 추가로 인해 기존 DB에 중복 투표 로그가 있으면 재기동이 실패하므로 리셋 필수.
**참고**: backend의 `/api/studio/draft`, `/api/agent/review`, `/api/agent/promote`는 ai_core에 대응 엔드포인트가 없는 죽은 프록시(항상 에러 폴백만 반환) - 다른 팀원 소유 코드일 가능성이 있어 이번 브랜치에서는 삭제하지 않고 그대로 둠. `/api/a2a/chat` 채팅 기능도 ai_core `/chat`이 없어 현재 항상 폴백 문구만 반환 - 기능 복구는 `feature/agent-upgrade` 브랜치에서 LangGraph로 `/chat`을 부활시키며 처리할 예정.

## 2026-07-05: feature/agent-upgrade 브랜치 - CrewAI → LangGraph 마이그레이션 (에이전트 고도화 → 구조화 출력·RAG 부활)
**문제**: `ai_core`가 CrewAI로 구현돼 있었는데, (1) 후보작 JSON을 `str(crew.kickoff())`에서 `find('[')/rfind(']')`로 잘라내는 방식이라 모델이 코드블록 서식을 조금만 바꿔도 파싱이 깨질 수 있었고, (2) docker-compose에 떠 있는 ChromaDB가 코드에서 전혀 쓰이지 않았으며, (3) backend가 호출하는 `ai_core /chat`이 애초에 존재하지 않아 AI 큐레이터 채팅이 항상 폴백 문구만 반환하는 상태였음.
**시도한 것**: `ChatGoogleGenerativeAI(...).with_fallbacks([...])`에 바로 `.with_structured_output()`을 걸려고 했으나, `with_fallbacks()`가 반환하는 `RunnableWithFallbacks`는 구조화 출력 메서드를 갖고 있지 않아 실패. → `get_structured_llm()`을 별도로 만들어 "구조화 출력 바인딩 → 그 결과에 폴백"의 순서로 재구성해 해결.
**해결**: `ai_core`를 `config/llm/schemas/streaming/tools/rag/chat.py` + `graphs/{trends,candidates,critique}.py`로 재편. CrewAI Task/Crew를 선형 LangGraph `StateGraph`(체크포인터·조건분기 없이 add_node+add_edge만 사용)로 대체하고, JSON 파싱은 `with_structured_output(Pydantic 스키마)`으로 교체. ChromaDB는 `langchain-chroma` + `GoogleGenerativeAIEmbeddings`로 연동해 라운드 종료 시 비평문을 아카이브하고, 다음 라운드 기획 시 유사 과거 사례를 검색해 프롬프트에 주입. `/chat`은 신규 구현. 기존 SSE 로그 형식(`{agent,type,content,timestamp}`)과 프론트가 참조하는 에이전트 이름 문자열은 그대로 유지해 프론트 무수정으로 마이그레이션.
**결과 (E2E 검증 중 실제로 잡은 버그 2건)**:
1. `ChatGoogleGenerativeAI`의 `AIMessage.content`가 항상 `str`이 아니라 `[{"type":"text","text":...,"extras":{...}}]` 형태의 블록 리스트로 오는 경우가 있어(Gemini 3 계열 특성으로 추정), 비평문에 파이썬 리스트가 그대로 노출되는 버그 발생 → `llm.to_text()` 정규화 헬퍼로 해결.
2. 초기 설정한 임베딩 모델 `models/text-embedding-004`가 Gemini API에서 404(제거됨) → `client.models.list()`로 실제 사용 가능한 모델을 조회해 `models/gemini-embedding-001`로 교체.
두 실제 스택(docker compose) 기동 후 trends/candidates/critique/chat 전 구간과 RAG 아카이브→검색 왕복, SSE 스트림, GOOGLE_API_KEY 누락 시 안전 폴백까지 확인 완료.
**참고**: `SERPER_API_KEY`가 `.env`에 애초에 설정된 적이 없어(마이그레이션과 무관한 기존 공백) 웹 검색은 항상 실패하지만, `search_node`가 실패를 흡수하고 Gemini가 자체 지식으로 트렌드를 생성하도록 설계해 문제없이 동작.

## 2026-07-08: AI 생성 작품 품질 검증 기준 설계 (완성도 vs 커뮤니티 취향의 애매함 → 두 축 분리로 해결)
**문제**: "커뮤니티 방향성을 반영한 그림 생성"이 핵심 기능인데, 검증 기준이 애매했음 — 커뮤니티가 의도적으로 어린이 낙서 같은 순박한 화풍을 원했을 때, 미술적 완성도만 보면 저품질처럼 보여 검증 절차에서 걸러야 할지 판단이 안 섬. "품질"과 "커뮤니티 취향"을 하나의 점수로 합치려 하면 원천적으로 답이 안 나옴.
**시도한 것**: AI 생성 이미지 검증 알고리즘 4개 카테고리(VQA/논리분해, 임베딩 기반 전역 유사도, 인간 선호도 보상 모델, 객체탐지·기하학적 제약)를 비교 검토. 인간 선호도 보상 모델(PickScore, ImageReward류)은 "예쁘고 사실적인 이미지"에 편향된 리워드 모델이라, 커뮤니티가 일부러 고른 순박한 화풍을 감점시킬 위험이 있어 기각 — 이게 바로 애초의 "품질=취향" 오류를 다시 불러들이는 함정이었음. 객체탐지·기하학적 제약도 프롬프트 구조(단순 테마+화풍)에 안 맞고 GPU 인프라가 필요해 기각.
**해결**: **축 A(실행 품질 — 의도한 대로 구현됐는가)와 축 B(커뮤니티 적합성 — 방향성에 맞는가)를 분리**하고, 축 B는 AI가 판단하지 않고 100% VP 투표에 위임 (DAO 거버넌스 철학과의 충돌 방지). 축 A는 TIFA/DSG 방식(Gemini 멀티모달로 프롬프트를 원자적 요소로 쪼개 Yes/No 체크)으로 채택 - 이미 쓰는 Gemini로 새 인프라 없이 구현 가능. 무료 API 티어 제약을 명시적 설계 전제로 반영해: 병렬 Best-of-N 재시도는 기각, 재시도는 최대 1회, VQA 게이트는 5개 후보 전부가 아니라 우승작 1개에만 전체 적용(5개 단계는 비용 0인 예방책만). Cloudflare `flux-1-schnell`의 negative_prompt 지원 여부를 공식 문서로 직접 확인한 결과 미지원(`prompt`, `steps`만 존재) - 프롬프트 문자열에 회피 문구를 녹이는 우회 방법 + `steps` 4→8 상향으로 대체.
**결과**: `docs/quality_validation_framework.md`에 설계 문서로 정리·커밋 (`feature/agent-upgrade` 브랜치). critic이 현재 텍스트만 보고 이미지를 본 적이 없다는 구조적 빈틈도 발견 - backend가 저장된 이미지를 base64로 인코딩해 phase3(우승작 확정 후)에 전달하는 흐름으로 결론. 아직 실제 파이프라인 구현 전 단계, 다음 작업으로 `quality-check` 엔드포인트 구현 예정.
