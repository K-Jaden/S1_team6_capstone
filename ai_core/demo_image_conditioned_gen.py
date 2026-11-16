"""이미지 조건부 생성(image-conditioned generation) 실험/데모 스크립트.

텍스트 설명만으로는 커스텀 캐릭터(예: 학교 마스코트)의 시각적 디테일이 정확히 재현되지
않는 문제를, 실제 레퍼런스 이미지를 입력으로 함께 주는 방식(OpenAI images.edit)으로
어느 정도 개선할 수 있는지 검증하기 위한 스크립트.

Cloudflare flux-1-schnell은 이미지 입력 기능 자체가 없어(공식 문서 확인 완료) 별도로
구현했다. 기존 프로덕션 파이프라인(backend의 Cloudflare 호출)은 건드리지 않는 순수
실험/데모용 - LLM_PROVIDER=openai + OPENAI_API_KEY가 개인 .env에 설정된 사람만 쓸 수 있다.

실행:
    docker compose exec ai_core python demo_image_conditioned_gen.py <참조이미지경로> "<프롬프트>" [출력경로]

예시:
    docker compose exec ai_core python demo_image_conditioned_gen.py /tmp/tino_ref.png \
        "Tino the dinosaur mascot playing tennis on a sunny outdoor court, keep the exact same character design" \
        /tmp/tino_tennis.png
"""
import base64
import logging
import sys

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger("ai_core.demo_image_conditioned_gen")

import config


def generate_with_reference(
    reference_image_path: str,
    prompt: str,
    output_path: str = "output.png",
    input_fidelity: str = "high",
    size: str = "1024x1024",
) -> str:
    """레퍼런스 이미지 + 프롬프트를 gpt-image-1 편집 API에 넣어 캐릭터 정체성을 유지한 채
    새 장면을 생성한다. input_fidelity="high"가 원본 디테일 보존에 핵심적이다."""
    if config.LLM_PROVIDER != "openai" or not config.OPENAI_API_KEY:
        raise RuntimeError(
            "이 기능은 OpenAI 전용입니다. 로컬 .env에 LLM_PROVIDER=openai와 OPENAI_API_KEY를 설정하세요."
        )

    from openai import OpenAI

    client = OpenAI(api_key=config.OPENAI_API_KEY)
    with open(reference_image_path, "rb") as f:
        result = client.images.edit(
            model="gpt-image-1",
            image=f,
            prompt=prompt,
            input_fidelity=input_fidelity,
            size=size,
        )

    img_bytes = base64.b64decode(result.data[0].b64_json)
    with open(output_path, "wb") as f:
        f.write(img_bytes)
    logger.info(f"저장 완료: {output_path} ({len(img_bytes)} bytes)")
    return output_path


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print('사용법: python demo_image_conditioned_gen.py <참조이미지경로> "<프롬프트>" [출력경로]')
        sys.exit(1)

    ref_path = sys.argv[1]
    prompt_arg = sys.argv[2]
    out_path = sys.argv[3] if len(sys.argv) > 3 else "output.png"

    generate_with_reference(ref_path, prompt_arg, out_path)
