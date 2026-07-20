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
