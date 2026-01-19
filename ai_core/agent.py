from fastapi import FastAPI
from pydantic import BaseModel
from langchain_core.prompts import PromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
import requests
import os

app = FastAPI()

# -----------------------------------------------------------
# 🔥 여기에 본인 API 키를 넣어주세요!
MY_GOOGLE_API_KEY = "AIzaSyC52mDKtEQgM7KRoxpKUbTRZYImPOxHFuc" 
# -----------------------------------------------------------

# Gemini Flash Latest (무료 티어용)
llm = ChatGoogleGenerativeAI(
    model="models/gemini-flash-latest", 
    google_api_key=MY_GOOGLE_API_KEY,
    temperature=0.7
)

# 백엔드 주소 (도커 8000번)
BACKEND_URL = "http://localhost:8000"

class WorkRequest(BaseModel):
    wallet_address: str
    topic: str
    style: str

@app.get("/")
def read_root():
    return {"status": "Agent Server (Port 8002) Ready"}

@app.post("/generate")
def start_work(request: WorkRequest):
    print(f"✅ [1. 요청] {request.topic} / {request.style}")
    
    # 1. Gemini 프롬프트 생성
    final_prompt = ""
    try:
        prompt_template = PromptTemplate.from_template(
            "너는 창의적인 AI 화가야. 사용자가 '{topic}' 주제를 '{style}' 화풍으로 그려달라고 했어. "
            "이 그림을 그리기 위한 상세하고 묘사적인 영어 프롬프트를 3문장으로 작성해줘. "
            "(다른 말 없이 오직 영어 텍스트만 출력해)"
        )
        chain = prompt_template | llm
        ai_response = chain.invoke({"topic": request.topic, "style": request.style})
        final_prompt = ai_response.content
        print(f"🧠 [2. 영어 프롬프트] {final_prompt}")
    except Exception as e:
        return {"error": f"Gemini Error: {str(e)}"}

    # 2. 백엔드 전송
    image_url = "생성 실패"
    try:
        res = requests.post(f"{BACKEND_URL}/api/studio/image", json={"keywords": final_prompt})
        if res.status_code == 200:
            image_url = res.json().get("image_url")
            print(f"🎨 [3. 이미지 완료] {image_url}")
        else:
            image_url = f"백엔드 에러: {res.text}"
    except Exception as e:
        image_url = f"연결 실패: {str(e)}"

    return {"message": "Success", "final_prompt": final_prompt, "image_url": image_url}