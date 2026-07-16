"""RAG 콜드스타트 방지용 커뮤니티 신호 시드 스크립트 (낙선 후보 + 관람평).

seed_rag.py는 "우승작"만 아카이브하는데, 지금까지 낙선한 4개 후보와 유저 관람평은
전부 버려지고 있었다. 이 스크립트는 그 두 가지를 가상으로 생성해 미리 채워둔다.
- 낙선 후보: "이 방향은 시도했지만 커뮤니티가 덜 선호했다"는 네거티브 신호
- 관람평: AI 비평문보다 직접적인 유저 취향 신호

seed_rag.py와 같은 5개 테마 클러스터를 재사용해 서로 다른 round_id 대역(-3000대)으로
아카이브한다 - 실제 우승작과 1:1로 정확히 대응시키기보다, 테마별 커버리지 확인이 목적.

실행: docker compose exec ai_core python seed_community_signals.py
재실행해도 안전 (doc_id 고정, upsert).
"""
import logging

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger("ai_core.seed_community_signals")

import llm
import rag
from schemas import SeedCommunitySignalBatch

# seed_rag.py와 동일한 테마 클러스터 재사용 (일관된 커버리지 유지)
THEME_CLUSTERS = [
    ("cyberpunk", "사이버펑크, 네온사인, 도시, 로봇, 홀로그램 등 미래도시 테마"),
    ("nature", "자연, 생태계, 심해, 오로라, 벚꽃 등 유기적·자연 테마"),
    ("surreal", "초현실주의, 몽환적 분위기, 글리치, 꿈같은 왜곡 테마"),
    ("minimal", "미니멀리즘, 기하학적 디자인, 무채색, 정제된 형태 테마"),
    ("retro", "레트로 신스웨이브, 빈티지 사진, 8비트 도트, 클래식 화풍 테마"),
]

SEED_ROUND_ID_START = -3000  # seed_rag.py(-1000대)와 겹치지 않는 별도 대역


def generate_cluster(cluster_desc: str) -> SeedCommunitySignalBatch:
    structured_llm = llm.get_structured_llm(SeedCommunitySignalBatch, temperature=0.9)
    prompt = f"""당신은 가상의 ArtDAO 전시 플랫폼의 지난 라운드 기록을 정리하는 아카이비스트입니다.
'{cluster_desc}' 계열 라운드에 대한 다음 두 가지를 만들어주세요.

1. losing_candidates (2개): 이 테마로 후보에 올랐지만 유저 투표에서 우승하지 못한 컨셉.
   실제로 시도됐을 법한 그럴듯한 컨셉이되, 우승작보다는 임팩트가 약하거나 애매했을 법한 방향으로.
   왜 덜 선호됐을지(reason)도 구체적으로 추정해서 함께 작성하세요 - 나중에 이 낙선 이유가
   비슷한 실수를 피하는 데 실제로 쓰이므로, "그냥 별로였다"가 아니라 임팩트 부족/화풍-테마
   불일치/진부함 등 구체적인 이유여야 합니다.
2. feedbacks (2개): 이 테마의 우승작을 본 유저가 남겼을 법한 자연스러운 관람평.
   AI 비평가 톤이 아니라 실제 커뮤니티 유저가 짧게 쓸 법한 솔직한 말투 (긍정/부정/중립 골고루)."""

    return structured_llm.invoke(prompt)


def run():
    total_archived = 0
    seed_id = SEED_ROUND_ID_START

    for cluster_slug, cluster_desc in THEME_CLUSTERS:
        logger.info(f"[{cluster_slug}] 생성 중... ({cluster_desc})")
        try:
            batch = generate_cluster(cluster_desc)
        except Exception as e:
            logger.error(f"[{cluster_slug}] 생성 실패, 건너뜀: {e}")
            continue

        for idx, item in enumerate(batch.losing_candidates):
            doc_id = f"seed-losing-{cluster_slug}-{idx}"
            rag.archive_losing_candidate(
                round_id=seed_id,
                keywords=item.keywords,
                title=item.title,
                description=item.description,
                vp_votes=item.vp_votes,
                reason=item.reason,
                doc_id=doc_id,
            )
            logger.info(f"  archived [{doc_id}] 낙선후보 '{item.title}' (vp={item.vp_votes}, 이유: {item.reason})")
            total_archived += 1

        for idx, item in enumerate(batch.feedbacks):
            doc_id = f"seed-feedback-{cluster_slug}-{idx}"
            rag.archive_feedback(
                round_id=seed_id,
                title=f"{cluster_slug} 라운드 우승작",
                comment=item.comment,
                sentiment=item.sentiment,
                doc_id=doc_id,
            )
            logger.info(f"  archived [{doc_id}] 관람평({item.sentiment}) '{item.comment[:40]}...'")
            total_archived += 1

        seed_id -= 1

    logger.info(f"완료: {total_archived}건 아카이브 시도. 컬렉션 총 문서 수: {rag.count()}")

    # 데모 확인용 - doc_type별로 실제 검색에 걸리는지 샘플 쿼리로 증명
    sample_queries = ["사이버펑크 로봇", "몽환적인 자연"]
    for q in sample_queries:
        logger.info(f"--- 샘플 검색: '{q}' ---")
        results = rag.search_similar_debug(q, k=5)
        for r in results:
            doc_type = r["metadata"].get("doc_type", "?")
            logger.info(f"  [{doc_type}] [distance={r['distance']:.3f}] {r['content'][:70]}...")


if __name__ == "__main__":
    run()
