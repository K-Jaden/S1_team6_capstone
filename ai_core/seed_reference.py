"""RAG 동작 검증용 참고 자료(학교 마스코트 등) 시드 스크립트.

게임 라운드가 아닌 외부 참고 자료를 RAG에 넣어, 관련 키워드로 라운드를 생성했을 때
실제로 반영되는지 확인하기 위한 용도. rag.archive_reference()는 doc_id가 고정이라
재실행해도 안전하다(upsert).

실행: docker compose exec ai_core python seed_reference.py
"""
import logging

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger("ai_core.seed_reference")

import rag

TINO_DESCRIPTION = """티노(TINO)는 대학교 마스코트 캐릭터로, 컨셉은 "모든 것이 새로워! 호기심 넘치는 개구쟁이 공룡"이다.

외형: 둥글고 통통한 흰색/크림색 몸체를 가진 귀엽고 순박한 만화풍 공룡. 배 부분에는 크고 둥근 타원형의 파란색(#0D57A7) 무늬가 몸통 대부분을 차지하고 있다. 머리 위부터 등을 따라 작은 삼각형 돌기(공룡 등뼈 스타일)가 옅은 페리윙클 블루(#3C63AE) 색으로 줄지어 나 있고, 정수리에는 둥근 뿔/혹 모양 돌기가 하나 더 있다. 얼굴은 아주 단순하게 표현되어, 작은 점 두 개로 된 눈, 이빨 2~3개가 보이는 작고 친근한 미소, 그리고 양쪽 볼에 동그란 파란색 홍조(블러셔) 표시가 있어 천진난만하고 쾌활한 인상을 준다. 팔다리는 짧고 통통하며 발끝에 작은 발톱이 표현되어 있다. 배색은 진한 네이비(#162B49), 파랑(#0D57A7), 페리윙클 블루(#3C63AE), 흰색(#FFFFFF)의 깔끔한 팔레트로 구성된 플랫 벡터 일러스트 스타일이며, 검은 아웃라인과 최소한의 음영만 사용한다.

성격/컨셉: 호기심 많고 장난기 넘치는(개구쟁이) 성격의 공룡으로, 감독(영화 촬영), 클라이밍, 마라톤, 테니스, 댄스(헤드폰 착용), 졸린 잠옷 차림, 트로피를 든 우승, 팝콘을 먹는 모습, 책 앞에서 공부하는 모습, 앞치마를 입고 아르바이트(바리스타)하는 모습 등 다양한 대학생활 관련 활동을 즐기는 모습으로 표현된다. 스포츠 의상에는 대학교를 상징하는 "TU" 로고가 새겨져 있다."""


def run():
    rag.archive_reference(
        name="tino_mascot",
        text=TINO_DESCRIPTION,
        tags=["티노", "TINO", "마스코트", "공룡", "대학교", "캐릭터"],
    )
    logger.info(f"티노 참고 자료 아카이브 완료. 컬렉션 총 문서 수: {rag.count()}")

    results = rag.search_similar_debug("공룡 마스코트 캐릭터", k=3)
    for r in results:
        logger.info(f"  [distance={r['distance']:.3f}] {r['content'][:80]}...")


if __name__ == "__main__":
    run()
