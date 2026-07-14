"""RAG 콜드스타트 방지용 시드 데이터 생성 스크립트.

실제 게임 플레이가 쌓이기 전에도 데모에서 RAG(과거 라운드 참조) 효과를 보여줄 수 있도록,
가상의 "지난 라운드" 기록을 LLM으로 생성해 ChromaDB에 미리 아카이브한다.

실행: docker compose run --rm ai_core python seed_rag.py
재실행해도 안전 (doc_id가 고정되어 있어 새로 추가되지 않고 덮어써짐).
"""
import logging

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger("ai_core.seed_rag")

import random

import llm
import rag
from graphs.critique import refresh_digest_now
from schemas import SeedRoundBatch

# 실제 게임의 pool_subjects/pool_styles(backend/app/main.py) 어휘와 맞춘 테마 클러스터.
# 클러스터별로 나눠 요청해야 (1) 한 번에 너무 많이 시켜서 구조화 출력이 깨지는 걸 피하고
# (2) 테마별 커버리지가 골고루 보장되어 검색 데모 시 어떤 키워드를 입력해도 그럴듯한 결과가 나온다.
THEME_CLUSTERS = [
    ("cyberpunk", "사이버펑크, 네온사인, 도시, 로봇, 홀로그램 등 미래도시 테마"),
    ("nature", "자연, 생태계, 심해, 오로라, 벚꽃 등 유기적·자연 테마"),
    ("surreal", "초현실주의, 몽환적 분위기, 글리치, 꿈같은 왜곡 테마"),
    ("minimal", "미니멀리즘, 기하학적 디자인, 무채색, 정제된 형태 테마"),
    ("retro", "레트로 신스웨이브, 빈티지 사진, 8비트 도트, 클래식 화풍 테마"),
]

ROUNDS_PER_CLUSTER = 6
SEED_ROUND_ID_START = -1000  # 실제 게임 round_id(양수, 1부터 증가)와 절대 겹치지 않도록 음수 사용


def generate_cluster(cluster_slug: str, cluster_desc: str) -> SeedRoundBatch:
    structured_llm = llm.get_structured_llm(SeedRoundBatch, temperature=0.9)
    prompt = f"""당신은 가상의 ArtDAO 전시 플랫폼에서 지난 라운드 기록을 정리하는 아카이비스트입니다.
'{cluster_desc}' 계열로 서로 다른 {ROUNDS_PER_CLUSTER}개의 지난 라운드 우승작 기록을 만들어주세요.

각 라운드는:
1. keywords: 이 라운드에서 실제 유저 투표로 뽑혔을 법한 핵심 키워드 2~3개 (한국어)
2. title: 우승작 제목 (한국어)
3. description: 작품 설명 2~3문장 (한국어)
4. report: 미술 비평가가 쓴 것 같은 비평 요지 2~3문단 (한국어, 실제 서비스에서 쓰는 진지하고 문예체적인 톤)

같은 대분류 테마라도 라운드마다 구체적 소재/구도/서사가 겹치지 않게 다양화하세요."""

    result: SeedRoundBatch = structured_llm.invoke(prompt)
    return result


def run():
    total_archived = 0
    seed_id = SEED_ROUND_ID_START

    for cluster_slug, cluster_desc in THEME_CLUSTERS:
        logger.info(f"[{cluster_slug}] 생성 중... ({cluster_desc})")
        try:
            batch = generate_cluster(cluster_slug, cluster_desc)
        except Exception as e:
            logger.error(f"[{cluster_slug}] 생성 실패, 건너뜀: {e}")
            continue

        for idx, item in enumerate(batch.rounds):
            doc_id = f"seed-{cluster_slug}-{idx}"
            # "역대 인기작" 채널 데모용 - 실제 투표처럼 보이도록 편차 있는 득표수를 부여
            fake_vp_votes = random.randint(10, 500)
            rag.archive_round(
                round_id=seed_id,
                keywords=item.keywords,
                title=item.title,
                description=item.description,
                report=item.report,
                doc_id=doc_id,
                vp_votes=fake_vp_votes,
            )
            logger.info(f"  archived [{doc_id}] '{item.title}' ({', '.join(item.keywords)}, vp={fake_vp_votes})")
            seed_id -= 1
            total_archived += 1

    logger.info(f"완료: {total_archived}건 아카이브 시도. 컬렉션 총 문서 수: {rag.count()}")

    logger.info("커뮤니티 방향성 요약본 생성 중...")
    digest = refresh_digest_now()
    if digest:
        logger.info(f"방향성 요약본: {digest}")
    else:
        logger.warning("방향성 요약본 생성 실패 또는 데이터 부족")

    top_rounds = rag.get_top_rounds(limit=3)
    logger.info(f"--- 역대 인기작 top {len(top_rounds)} ---")
    for t in top_rounds:
        logger.info(f"  {t[:80]}...")

    # 데모 확인용 - 시드 데이터가 실제로 검색되는지 샘플 쿼리로 바로 증명
    sample_queries = ["사이버펑크 로봇", "몽환적인 자연", "미니멀 기하학"]
    for q in sample_queries:
        logger.info(f"--- 샘플 검색: '{q}' ---")
        results = rag.search_similar_debug(q, k=3)
        if not results:
            logger.warning("  (검색 결과 없음 - Chroma 연결/임베딩 상태를 확인하세요)")
        for r in results:
            logger.info(f"  [distance={r['distance']:.3f}] {r['content'][:80]}...")


if __name__ == "__main__":
    run()
