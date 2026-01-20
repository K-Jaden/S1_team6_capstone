import google.generativeai as genai

# 팀장님 API 키
MY_API_KEY = "AIzaSyD6ntuUF1UA2vB5hcOLgxVMJh8xWVn48ZE"

print("🔄 구글 AI 서버에 접속 시도 중...")

try:
    # 1. 설정
    genai.configure(api_key=MY_API_KEY)
    
    # 2. 모델 불러오기 (가장 기본 모델)
    model = genai.GenerativeModel('gemini-2.0-flash')
    
    # 3. 질문 던지기
    response = model.generate_content("야, 너 작동 하는 거 맞아? 짧게 대답해.")
    
    # 4. 결과 출력
    print("\n✅ [성공] AI의 답변:")
    print("------------------------------------------------")
    print(response.text)
    print("------------------------------------------------")
    print("결론: 코드는 멀쩡함. 도커 설정만 문제였음.")

except Exception as e:
    print(f"\n🔥 [실패] 에러 발생: {e}")
    print("결론: API 키가 막혔거나, 구글 서버 문제임.")