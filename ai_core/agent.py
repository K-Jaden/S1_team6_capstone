from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from langchain_core.prompts import PromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
import requests
import os
import traceback # 👈 에러 추적용
import google.generativeai as genai

app = FastAPI(title="S1-6 AI Orchestrator", version="Final-Fix")

# -----------------------------------------------------------
# 🔥 API 키
MY_GOOGLE_API_KEY = 
# -----------------------------------------------------------

# [모델] Gemini 1.5 Flash (빠르고 똑똑함, 0.8.3 버전 호환)
try:
    llm = ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",  # 👈 다시 최신 모델 이름 사용!
        google_api_key=MY_GOOGLE_API_KEY,
        temperature=0.7,
        convert_system_message_to_human=True
    )
except Exception as e:
    print(f"🔥 모델 초기화 실패: {e}")

BACKEND_URL = "http://art_backend:8000"

class PlanRequest(BaseModel):
    intent: str

class WorkRequest(BaseModel):
    wallet_address: str = "0xTest"
    topic: str
    style: str

class ReviewRequest(BaseModel):
    art_info: str

@app.get("/")
def read_root():
    return {"status": "AI Alive"}

# === 기획자 ===
@app.post("/propose")
def create_proposal(request: PlanRequest):
    print(f"✅ [기획자] 요청 받음: {request.intent}")
    try:
        template = PromptTemplate.from_template(
            "당신은 큐레이터입니다. '{intent}' 주제로 전시 기획서를 한글로 작성해줘."
        )
        chain = template | llm
        result = chain.invoke({"intent": request.intent})
        print(f"🎉 [기획자] 성공!") 
        return {"draft_text": result.content}
    except Exception as e:
        # 🔥 여기서 에러를 터미널에 적나라하게 찍어줍니다
        error_msg = traceback.format_exc()
        print(f"🔥 [기획자] 치명적 에러:\n{error_msg}")
        raise HTTPException(status_code=500, detail=f"AI Error: {str(e)}")

# === 화가 ===
@app.post("/generate")
def start_work(request: WorkRequest):
    print(f"✅ [화가] 요청 받음: {request.topic}")
    try:
        template = PromptTemplate.from_template(
            "Create a prompt for DALL-E based on '{topic}' in '{style}' style. English only."
        )
        chain = template | llm
        result = chain.invoke({"topic": request.topic, "style": request.style})
        
        # 백엔드 전송
        requests.post(f"{BACKEND_URL}/api/studio/image", json={"keywords": result.content, "style": request.style})
        return {"final_prompt": result.content}
    except Exception as e:
        print(f"🔥 [화가] 에러:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

# === 비평가 ===
@app.post("/review")
def create_review(request: ReviewRequest):
    try:
        template = PromptTemplate.from_template("미술품 설명: {art_info}. 이에 대한 비평을 작성해줘.")
        chain = template | llm
        result = chain.invoke({"art_info": request.art_info})
        return {"review_text": result.content}
    except Exception as e:
        print(f"🔥 [비평가] 에러:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))