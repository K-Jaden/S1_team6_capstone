# DECISIONS.md

이 문서는 ArtPlanningDAO 프로젝트에서 내린 문제-해결/설계 결정을 기록한다 (팀 공용, git 커밋 대상).

## 2026-07-20: 배당금(Claim) 수령 시 "라운드가 종료되지 않았다"는 오류가 계속 반복되는 문제 해결

**문제**: 갤러리에서 배당금을 수령하려 하면 온체인 상으로 라운드가 종료되지 않았다는 이유로
계속 실패한다는 리포트. `/api/admin/finalize`를 다시 실행해도(DB는 `status=ENDED`,
`onchain_status=confirmed`로 표시됨) 증상이 반복됨.

실제로 재현해서 확인한 결과: **DB의 `Round.id`(또는 `round_number`)를 온체인 컨트랙트의
`currentRoundId`와 동일한 값이라고 그냥 가정하고 재사용**하고 있었던 게 근본 원인.
- 블록체인(Hardhat) 컨테이너는 `npx hardhat node`로 뜨는 완전 휘발성 인메모리 체인이라,
  컨테이너가 재시작될 때마다 `currentRoundId`가 0으로 리셋되고 그 전에 있던 온체인 라운드는
  전부 사라짐. 반면 MySQL DB는 영속적이라 `Round.id`는 계속 증가함.
- `startNewRound()`/`finalizeRound()` 트랜잭션을 `send_raw_transaction()`으로 쏘기만 하고
  영수증(receipt)을 한 번도 확인하지 않아, 트랜잭션이 revert되거나 아예 마이닝되지 않아도
  무조건 성공(`onchain_ok = True`)으로 간주하고 있었음.
- 프론트엔드는 DB가 내려주는 `round_id`를 그대로 `contract.rounds(round_id)`/
  `contract.claimReward(round_id)` 인자로 사용하는데, 위 두 문제가 겹치면 그 ID는 체인에
  존재하지 않거나 완전히 다른 라운드를 가리키게 되어 `isFinalized`가 영원히 `false`로 나옴.

직접 검증: 컨테이너 재시작 후 DB에는 `round.id=2`가 `ENDED`/`confirmed`로 남아있었지만,
체인의 `currentRoundId()`는 `0` - 즉 그 라운드는 체인에 존재조차 하지 않았음.

**해결**: DB의 `round.id`/`round_number`를 온체인 라운드 번호로 암묵적으로 재사용하지 않고,
`Round.onchain_round_id`(nullable) 컬럼을 신설해 실제 온체인 상태만 별도로 추적하도록 구조 변경.
- `phase2-generate`: `startNewRound()` 전송 후 `wait_for_transaction_receipt()`로 실제
  마이닝 여부를 확인하고, 성공한 경우에만 그 시점의 `currentRoundId()`를 읽어
  `Round.onchain_round_id`에 저장. 실패하면 `None`으로 남겨 "이 라운드는 체인에 없음"을 명시.
- `finalize`: `finalizeRound()`는 인자로 라운드 번호를 받지 않고 컨트랙트 내부의
  `currentRoundId`를 그대로 마감시키는 함수라서, 호출 전에 `target_round.onchain_round_id`가
  존재하는지 + 실제 온체인 `currentRoundId`와 일치하는지부터 확인. 둘 중 하나라도 아니면
  온체인 호출 자체를 건너뛰고 `onchain_status="no_onchain_round"`로 정직하게 기록 (엉뚱한
  라운드를 마감시키는 사고 방지). 일치할 때만 트랜잭션을 보내고, 이번에도 영수증을 확인해
  실제 성공(`receipt.status == 1`) 여부로만 `confirmed`를 기록.
- `/api/gallery/items`, `/api/rounds/ended`: 프론트에 내려주는 `round_id` 필드를
  `winner.round_id`/`round_number`가 아니라 `Round.onchain_round_id`로 교체. 온체인에
  존재하지 않는(=`None`인) 라운드는 배당 목록에서 아예 제외 (다시 실패할 게 뻔한 클레임을
  보여주지 않음). 프론트엔드 코드는 필드명이 그대로라 수정 불필요.

**결과**: 실제로 컨테이너를 재시작해 체인을 리셋한 뒤(재현 조건과 동일), 새 라운드를
phase1→phase2→투표→phase3→finalize까지 전체 파이프라인으로 실행해 검증.
`Round.onchain_round_id`가 실제 체인의 `currentRoundId`(1)와 정확히 일치하게 기록됐고,
`finalize`가 `onchain: True`(영수증 확인된 진짜 성공)를 반환했으며, 체인에 직접 질의한
`rounds(1).isFinalized`도 `True`로 확인됨. `/api/rounds/ended`와 `/api/gallery/items`
모두 올바른 온체인 라운드 번호(1)를 반환했고, 체인 리셋으로 고아가 된 이전 라운드들
(`onchain_round_id=None`)은 배당 목록에서 자연스럽게 제외됨을 확인.

**참고**: 검증 과정에서 이 로컬 DB가 이미 스키마가 오래돼 있었음을 추가로 발견
(`gallery_items.auction_price` 컬럼이 최근 커밋(`b0d2dbae`) 이후로 없었음) - 이번 컬럼
추가와 함께 로컬 DB에 `ALTER TABLE`로 직접 반영함. 프로젝트에 Alembic이 없어 스키마
변경 시 팀원 각자 로컬 DB를 수동으로 맞추거나 리셋해야 하는 기존 관행이 이어지고 있음.

## 2026-07-20: 키워드 반영 불균일 + 결산 시 랜덤 우승작 선정 문제 해결

**문제**: 팀원 피드백 - (1) 유저가 투표한 피사체 키워드(예: "마법사")가 생성된 5개 후보작 중
1개에만 반영되고 나머지 4개엔 아예 등장하지 않는 경우가 있음. (2) 결산(phase3-valuation) 시
투표 1등작이 아니라 랜덤해 보이는 작품이 우승작으로 선정됨.

**원인 (1)**: `ai_core/graphs/candidates.py`의 프롬프트 설계가 시대/장소/화풍은 전부
"무조건 반영"으로 강제하면서, 정작 유저가 투표한 핵심 피사체 키워드만 강제 문구 없이
정보로만 전달하고 있었음. `plan_node`의 "5개 후보작을 차별화하라"는 지시도 피사체 자체를
바꾸지 말라는 제약이 없어, LLM이 창의성을 발휘할 때 화풍의 질감이 아니라 피사체 자체를
다양화해버리는 경우가 있었음.

**원인 (2)**: `phase3-valuation`이 온체인 투표 결과를 한 번도 조회하지 않고 DB
`Candidate.vp_votes`만으로 우승자를 결정하고 있었음. `handleVote()`는 (approve + vote)
메타마스크 트랜잭션 2개가 전부 성공해야만 `/api/vote`를 호출해 DB `vp_votes`를 올리는
구조라, 유저가 팝업 하나라도 취소/실패/타임아웃하면 그 표는 온체인엔 기록됐어도 DB
집계에서는 조용히 누락됨. 실제 커뮤니티의 온체인 선택과 DB가 계산한 "1등"이 어긋날 수 있는
구조였음 (배당금 버그와 같은 계열 - "DB가 온체인 실제 상태를 확인 안 함").

**해결**:
- `candidates.py`: `plan_node`의 두 프롬프트(초안/수정)와 `format_node`의 "필수 반영 요소"
  목록 모두에 핵심 테마 키워드를 "무조건 5개 전부에 등장, 차별화는 피사체가 아니라 질감·
  구도·행동으로만" 하도록 명시적으로 강제하는 문구를 추가.
- `phase3-valuation`: 우승자를 정하기 전에 `Round.onchain_round_id`(지난 배당금 버그 수정
  때 추가한 컬럼)로 온체인 `getCandidates()`를 조회해, 실제 온체인 `totalVotes`로 DB
  `vp_votes`를 먼저 보정한 뒤 그 값으로 우승자를 결정하도록 변경. 온체인 데이터가 없으면
  (체인 리셋 등) 기존 DB 값으로 안전하게 폴백.

**결과**: 실제 파이프라인으로 검증.
- (1) "마법사" 키워드로 5개 후보를 생성한 결과, 수정 전에는 일부만 반영되던 것이 수정 후
  5개 전부의 image_prompt에 sorcerer/wizard 계열 키워드가 빠짐없이 포함됨을 확인.
- (2) 의도적으로 DB `vp_votes`를 전부 0으로 둔 채(=/api/vote가 한 번도 안 불린 상황을
  재현) 온체인에만 투표(후보 4번에 100 TUK, 후보 1번에 50 TUK)를 기록한 뒤 결산을
  실행 - 수정 전이었다면 전부 동률(0표)이라 임의의 후보가 뽑혔겠지만, 수정 후에는
  정확히 온체인 1등(후보 4번, "Pixelated Serenity")이 우승작으로 선정되고 DB
  `vp_votes`도 50/0/0/100/0으로 온체인과 정확히 일치하게 보정됨을 확인.
