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

    # 🔧 [RAG 고도화] 1순위: 20가지 프롬프트 엔지니어링 문법 규칙 시딩
    logger.info("🔧 프롬프트 문법 규칙 시딩 시작...")
    prompt_rules = [
        ("bracket_weight", "가중치 괄호 문법: 강조하고 싶은 특정 피사체나 키워드가 있다면 반드시 (keyword:weight) 소괄호 형식을 취하라. 예: (cyberpunk street:1.4), (traditional building:1.2). 소괄호와 가중치 수치는 AI가 가중치에 맞춰 픽셀을 강하게 형성하도록 돕는다."),
        ("style_first", "화풍 최우선 규칙: 지정된 스타일과 기법에 맞춰 렌더링되게 하려면, 프롬프트의 맨 앞에 화풍 지시어를 삽입하라. 뒤에 밀리면 무시된다. 예: (watercolor illustration:1.3), a landscape..."),
        ("break_split", "BREAK 키워드: 상반된 개념이나 복수의 캐릭터를 묘사할 때 서로 섞이지 않게 하려면, BREAK 대문자 키워드로 프롬프트의 의미적 단락을 나누어라. 예: a warrior in medieval armor BREAK a neon glowing alley."),
        ("double_colon", "이중 콜론 가중치 분리(::): 각 컨셉간의 분리와 강제 가중치 인지를 위해 :: 구분자를 활용하여 의미 블록을 구분하라. 예: cybernetic implants::1.3 Chosun general::1.5"),
        ("genre_fusion_general", "이종 장르 시각적 융합(Fusion) 규칙: 서로 충돌하거나 상이한 장르/시대 키워드(예: 동양 수묵화와 SF, 중세 기사와 공학 케이블)가 만났을 때, 한쪽 장르의 핵심 형태 구조(예: 처마선, 판금 형태)를 뼈대로 잡은 채 다른 장르의 대표적 디테일(예: 네온 발광 회로, 크롬 금속판)을 표면에 매끄럽게 결합하여 어색하지 않은 시각적 융합을 이루어내라."),
        ("contrast_ambient", "대비와 앰비언트 연출: 어두운 그림자와 핵심 피사체를 비추는 시네마틱 광원의 강렬한 대비(high contrast chiaroscuro)를 활용하여 주제를 극적으로 묘사하고 깊이감을 부여하라."),
        ("texture_impasto", "임파스토(Impasto) 두꺼운 질감: 화풍이 회화풍일 때, 나이프로 거칠게 덧칠한 유화 물감의 물리적 입체감และ 덩어리 질감을 표현하라. (thick impasto texture, heavy palette knife paint strokes:1.25)"),
        ("contrast_neon", "어두운 저채도와 네온 대비: 전체 배경의 무게는 어두운 그늘(저채도)로 묵직하게 잡고, 강조하고 싶은 핵심 광원만 높은 채도의 네온 빛으로 산란시켜 대비를 극대화하라."),
        ("depth_segment", "공간 분할 레이어: 전경(foreground)에는 세부 소품을 가깝게 배치하고, 중경(midground)에는 주요 피사체, 원경(background)에는 안개나 산란광을 배치해 공간의 깊이감을 확보하라."),
        ("particle_glow", "발광 입자 연출: 신비롭고 초현실적인 묘사를 위해 공기 중에 떠다니는 먼지 크기의 미세한 발광 파티클(floating embers, luminous dust particles)을 가미하라."),
        ("oil_matte", "클래식 무광 페인팅: 유화의 번들거림을 줄이고 차분하고 부드러운 느낌을 유도하기 위해 매트한 회화 질감(matte paint finish, canvas grain texture)을 프롬프트에 추가하라."),
        ("glitch_distortion", "디지털 글리치 왜곡: 미래지향적인 충돌을 묘사할 때, 이미지의 가장자리나 특정 빛의 경계에 픽셀 분절(digital glitch artifacts, chromatic aberration)을 살짝 가미하라."),
        ("ink_wash_split", "수묵 먹 번짐과 여백: 전통 동양화의 느낌을 위해 먹의 농담 변화(ink wash gradient)와 과감한 여백(negative space)을 살려 기획하라."),
        ("clay_stop_motion", "클레이 스톱모션 렌더링: 찰흙 화풍의 경우, 스톱모션 애니메이션 세트장 같은 부드러운 스튜디오 조명과 미세한 지문 자국(fingerprint details on plasticine clay)을 묘사하라."),
        ("voxel_pixel_grid", "복셀 3D 그리드: 3D 복셀의 경우, 모든 사물이 격자 큐브 단위로 쪼개진 느낌을 명확히 하고, 부드러운 텍스처를 배제하여 칼 같은 각진 입체감을 유도하라."),
        ("vintage_film_grain", "빈티지 노이즈 입자: 사진이나 레트로 느낌의 경우, 아날로그 필름 알갱이(heavy film grain, analog color shift)를 가미하여 따뜻한 빛 바랜 감성을 묘사하라."),
        ("contrast_silhouette", "역광 실루엣 효과: 강렬한 분위기를 위해 등 뒤에서 쏟아지는 역광(rim lighting, backlighting)을 배치하여 피사체의 실루엣을 부각하고 미스터리함을 살려라."),
        ("watercolor_bleeding", "수채화 번짐(Bleeding): 맑고 투명한 수채화 화풍을 위해 물감이 젖은 종이 위에 자연스럽게 번진 경계(watercolor bleeding, wet-on-wet technique)를 연출하라."),
        ("sketch_cross_hatch", "스케치 교차 선 기법: 정교한 펜화의 경우, 그림자를 단순한 명암이 아니라 무수히 교차하는 얇은 펜 선(cross-hatching lines, ink sketch lines)으로 채워라."),
        ("minimal_negative_space", "미니멀리즘 극대화: 단순한 구도를 위해 캔버스의 80% 이상을 단일 톤의 여백(minimalist design, vast negative space)으로 유지하고 핵심 주체만 가운데 배치하라.")
    ]
    for r_id, r_text in prompt_rules:
        rag.archive_prompt_rule(r_id, r_text)
    logger.info(f"✅ 프롬프트 문법 규칙 시딩 완료. prompt_guide 컬렉션 총 문서 수: {rag.count('prompt_guide')}")

    # 🎨 [RAG 고도화] 2순위: 화풍별 시각 특징/트리거 단어 시딩
    logger.info("🎨 화풍 가이드라인 시딩 시작...")
    style_guides = [
        ("전통 수묵화", "전통 수묵화 화풍 가이드: 프롬프트 맨 앞에 (oriental ink wash painting sumi-e:1.3)을 삽입하세요. 추가 트리거 단어: calligraphic black ink brush strokes, negative space, rough rice paper texture, ink splatters, monochromatic, minimal colors. 절대 현대식 디지털 광택을 허용하지 마세요."),
        ("디즈니 3D 애니메이션 풍", "디즈니 3D 애니메이션 풍 화풍 가이드: 프롬프트 맨 앞에 (3D Pixar style digital art character:1.35)을 삽입하세요. 추가 트리거 단어: rounded smooth shapes, clay-like skin, soft volumetric lighting, big expressive eyes, high-fidelity subsurface scattering, vibrant stylized colors."),
        ("8비트 도트", "8비트 도트 화풍 가이드: 프롬프트 맨 앞에 (8-bit pixel art style, retro-game pixelated:1.4)을 삽입하세요. 추가 트리거 단어: visible square pixels, low resolution grid, limited color palette, retrogaming aesthetic, aliased edges. 절대 부드러운 스무딩 필터를 배제하세요."),
        ("몽환적인 수채화", "몽환적인 수채화 화풍 가이드: 프롬프트 맨 앞에 (dreamy watercolor painting illustration:1.3)을 삽입하세요. 추가 트리거 단어: wet-on-wet watercolor bleeding, translucent pastel colors, soft edges, ink pen outlines, splatters of water paint, artistic canvas texture."),
        ("말랑한 점토 클레이아트", "말랑한 점토 클레이아트 화풍 가이드: 프롬프트 맨 앞에 (claymation stop-motion model, plasticine clay art:1.4)을 삽입하세요. 추가 트리거 단어: fingerprint marks, soft clay material, studio clay lighting, miniature set, macro photography, cute tactile toys."),
        ("거친 질감의 목판화", "거친 질감의 목판화 화풍 가이드: 프롬프트 맨 앞에 (linocut block print, rough woodcut style:1.3)을 삽입하세요. 추가 트리거 단어: heavy hand-carved textures, blocky shadows, bold black ink lines, high-contrast block printing, rustic handmade paper."),
        ("클래식 유화 풍", "클래식 유화 풍 화풍 가이드: 프롬프트 맨 앞에 (classic oil painting style:1.3)을 삽입하세요. 추가 트리거 단어: visible thick brushstrokes, textured canvas, impasto paint build-up, chiaroscuro dramatic lighting, rich color pigments, classical art museum quality."),
        ("정교한 펜화 스케치", "정교한 펜화 스케치 화풍 가이드: 프롬프트 맨 앞에 (intricate pen and ink sketch:1.3)을 삽입하세요. 추가 트리거 단어: fine cross-hatching lines, hand-drawn detailing, black gel pen on old parchment, detailed engraving look, high-contrast monochrome."),
        ("미니멀리즘 디자인", "미니멀리즘 디자인 화풍 가이드: 프롬프트 맨 앞에 (clean minimalist design illustration:1.3)을 삽입하세요. 추가 트리거 단어: flat vector geometry, limited color palette, vast negative space, simple icons, lack of texture, crisp lines, modern art poster."),
        ("초현실주의 회화", "초현실주의 회화 화풍 가이드: 프롬프트 맨 앞에 (surrealist oil painting Salvador Dali style:1.3)을 삽입하세요. 추가 트리거 단어: logic-defying dreamscape, melting objects, strange juxtapositions, deep dream perspective, smooth bizarre textures, atmospheric mist."),
        ("인상주의 회화 풍", "인상주의 회화 풍 화풍 가이드: 프롬프트 맨 앞에 (impressionist painting Claude Monet style:1.3)을 삽입하세요. 추가 트리거 단어: short dabbed brushstrokes, dappled sunlight, pastel hues, blending colors on canvas, outdoor atmosphere, soft painterly impression."),
        ("아르누보 일러스트", "아르누보 일러스트 화풍 가이드: 프롬프트 맨 앞에 (Art Nouveau illustration Alphonse Mucha style:1.35)을 삽입하세요. 추가 트리거 단어: intricate flowing organic curves, decorative floral borders, elegant thin black outlines, muted warm gold tones, stylized mosaic pattern."),
        ("팝아트 포스터 스타일", "팝아트 포스터 스타일 화풍 가이드: 프롬프트 맨 앞에 (bold Pop Art screenprint style:1.3)을 삽입하세요. 추가 트리거 단어: Halftone dot pattern, Ben-day dots, thick black outlines, oversaturated flat primary colors, Andy Warhol silk-screen aesthetic."),
        ("2D 플랫 벡터 일러스트", "2D 플랫 벡터 일러스트 화풍 가이드: 프롬프트 맨 앞에 (2D flat vector art, clean illustration:1.3)을 삽입하세요. 추가 트리거 단어: solid flat colors, sharp crisp vector lines, no gradients, minimal shadow layers, corporate memphis look, modern editorial design."),
        ("사이버네틱 SF 화풍", "사이버네틱 SF 화풍 가이드: 프롬프트 맨 앞에 (futuristic cybernetic digital concept art:1.3)을 삽입하세요. 추가 트리거 단어: neon glowing fiber optics, metallic chrome finishes, holographic overlays, dark techwear aesthetic, volumetric laser rays, highly detailed futuristic rendering."),
        ("지브리 애니메이션 풍", "지브리 애니메이션 풍 화풍 가이드: 프롬프트 맨 앞에 (dreamy Ghibli anime style, warm hand-drawn:1.35)을 삽입하세요. 추가 트리거 단어: soft watercolor background, nostalgic warm lighting, clean line art, charming hand-painted aesthetic, whimsical cloud shapes, peaceful environment."),
        ("우키요에 동양화", "우키요에 동양화 화풍 가이드: 프롬프트 맨 앞에 (traditional Japanese ukiyo-e woodblock print:1.3)을 삽입하세요. 추가 트리거 단어: flat decorative color blocks, outline drawing, dynamic wave shapes, historical aesthetic, vintage paper texture, classic asian art look."),
        ("스테인드 글라스", "스테인드 글라스 화풍 가이드: 프롬프트 맨 앞에 (decorative stained glass window art, glowing mosaic:1.35)을 삽입하세요. 추가 트리거 단어: segmented colored glass panels, bold black lead came outlines, light shining through colored glass, glowing gothic cathedral window pattern, vibrant translucent colors."),
        ("고딕 판타지", "고딕 판타지 화풍 가이드: 프롬프트 맨 앞에 (dark gothic fantasy oil painting:1.3)을 삽입하세요. 추가 트리거 단어: ornate medieval architecture, pointed arches, stone gargoyles, dramatic cinematic shadows, mysterious dark romance, high contrast chiaroscuro, haunted ambient fog."),
        ("샌드 아트", "샌드 아트 화풍 가이드: 프롬프트 맨 앞에 (sand animation drawing, sand art:1.4)을 삽입하세요. 추가 트리거 단어: textured grains of sand, high contrast warm backlight, organic silhouettes created by shifting sand, monochrome earthy sepia tones, gritty texture."),
        ("신스웨이브/레트로퓨처", "신스웨이브/레트로퓨처 화풍 가이드: 프롬프트 맨 앞에 (80s synthwave vaporwave style:1.3)을 삽입하세요. 추가 트리거 단어: neon pink and purple wireframe grid landscape, glowing grid lines, sunset retro sun, VHS tape grain, outrun aesthetic, cyberpunk neon glow."),
        ("아크릴 페인팅", "아크릴 페인팅 화풍 가이드: 프롬프트 맨 앞에 (modern acrylic canvas painting, textured palette knife:1.3)을 삽입하세요. 추가 트리거 단어: bold rich colors, slightly shiny textured paint surface, expressive modern color blocks, clean edge definitions, painterly look.")
    ]
    for s_name, s_text in style_guides:
        rag.archive_style_guide(s_name, s_text)
    logger.info(f"✅ 화풍 가이드라인 시딩 완료. style_guide 컬렉션 총 문서 수: {rag.count('style_guide')}")

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

    # 데모 확인용 - 신규 가이드북 및 스타일 RAG가 제대로 매칭되는지 테스트
    logger.info("--- RAG 고도화 성능 검증 ---")
    style_test = rag.search_style_guide("말랑한 점토 클레이아트", k=1)
    if style_test:
        logger.info(f"  [화풍검색성공] '말랑한 점토 클레이아트' → {style_test[0][:100]}...")
    else:
        logger.error("  ❌ 화풍 가이드북 검색 실패!")

    rule_test = rag.search_prompt_guide("조선시대와 사이버펑크 융합 시 공간 분할이나 괄호 가중치", k=2)
    for idx, r in enumerate(rule_test):
        logger.info(f"  [규칙검색성공 {idx+1}] → {r[:90]}...")


if __name__ == "__main__":
    run()
