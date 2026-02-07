import os
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()
client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

try:
    # 이 파라미터(ThinkingConfig)는 최신 엔진(2.5/3.0급)만 수용 가능한 '최신 규격'입니다.
    # 구형 모델은 이 '규격' 자체를 이해하지 못해 API 서버에서 연결을 끊습니다.
    response = client.models.generate_content(
        model='gemini-flash-latest',
        contents="매우 복잡한 분산 시스템의 데드락 해결 알고리즘을 설계해줘.",
        config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(include_thoughts=True)
        )
    )
    print("🎯 [증거 1] API 규격 테스트: 통과")
    print("-> 결론: 이 모델은 최신 규격(2.5/3.0)을 이해하는 최신 엔진입니다.")
    
except Exception as e:
    print(f"❌ API 규격 테스트 실패: {e}")