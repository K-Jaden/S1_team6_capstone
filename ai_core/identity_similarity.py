"""레퍼런스 이미지 기반 정체성 유사도 검증 (DreamSim).

기존 alignment_score(VQAScore)는 "이미지가 프롬프트에 충실한가"만 재기 때문에, 프롬프트
자체가 부실했던 경우를 구조적으로 못 잡아낸다는 한계가 실측으로 확인됐다 (같은 이미지를
그 이미지를 만든 프롬프트로 채점하면 0.999, 실제 의도했던 묘사로 채점하면 0.0000284).

이 모듈은 텍스트가 아니라 "생성 이미지가 레퍼런스 이미지와 같은 시각적 정체성을
유지했는가"를 직접 비교한다 - subject-driven generation(DreamBooth 등) 분야에서
CLIP-I/DINO와 함께 표준으로 쓰이는 평가 방식이다. 로컬 임베딩 계산이라 API 호출이
필요 없고, LLM_PROVIDER(Gemini/OpenAI)와 무관하게 항상 동작한다.

우승작 이미지를 레퍼런스로 후속작을 생성하는 기능의 검증 도구로 쓰기 위해 만들었다.
"""
import logging
from typing import Optional

logger = logging.getLogger("ai_core.identity_similarity")

_model = None
_preprocess = None


def _load_model():
    """최초 호출 시에만 모델을 로드한다 (가중치 다운로드 + 초기화 비용이 있어 지연 로딩)."""
    global _model, _preprocess
    if _model is not None:
        return _model, _preprocess
    from dreamsim import dreamsim

    _model, _preprocess = dreamsim(pretrained=True, device="cpu", cache_dir="/app/.dreamsim_cache")
    return _model, _preprocess


def compute_identity_similarity(reference_image_path: str, generated_image_path: str) -> Optional[float]:
    """0~1 유사도로 정규화해 반환한다 (1에 가까울수록 레퍼런스와 동일한 정체성).
    DreamSim 자체는 거리(distance, 작을수록 유사)를 반환하므로 1 - distance로 뒤집는다.
    모델 로드/추론 실패 시 파이프라인을 막지 않도록 None을 반환한다."""
    try:
        from PIL import Image

        model, preprocess = _load_model()
        ref_img = preprocess(Image.open(reference_image_path).convert("RGB"))
        gen_img = preprocess(Image.open(generated_image_path).convert("RGB"))
        distance = model(ref_img, gen_img).item()
        return max(0.0, 1.0 - distance)
    except Exception as e:
        logger.warning(f"정체성 유사도 계산 실패: {e}")
        return None
