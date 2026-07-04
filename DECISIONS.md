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
