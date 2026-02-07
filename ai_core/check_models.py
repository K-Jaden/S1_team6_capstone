import google.generativeai as genai

# --- 주영 님의 API 키를 여기에 넣으세요 ---
MY_API_KEY = "AIzaSyC52mDKtEQgM7KRoxpKUbTRZYImPOxHFuc" 
# ---------------------------------------

genai.configure(api_key=MY_API_KEY)

print("---------------------------------------")
print("🔍 구글 서버에 모델 명단 요청 중...")
print("---------------------------------------")

try:
    found = False
    for m in genai.list_models():
        if 'generateContent' in m.supported_generation_methods:
            print(f"✅ 사용 가능: {m.name}")
            found = True
    
    if not found:
        print("❌ 사용 가능한 모델이 하나도 안 뜹니다. API 키가 잘못되었거나 권한 문제일 수 있습니다.")

except Exception as e:
    print(f"🔥 에러 발생: {e}")