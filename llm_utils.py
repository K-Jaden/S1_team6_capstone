# llm_utils.py
import google.generativeai as genai
import os

# API 키 설정 (직접 넣거나 .env 파일 사용)
GOOGLE_API_KEY = "api 키 입력"
genai.configure(api_key=GOOGLE_API_KEY)

# gemini-1.5-flash 가 현재 무료 등급에서 가장 빠르고 안정적입니다.
model = genai.GenerativeModel('gemini-2.0-flash')

def call_llm(system_prompt, user_input):
    """
    LLM에게 역할을 부여하고 질문을 던지는 함수
    """
    try:
        # 시스템 프롬프트(역할)와 사용자 입력(내용)을 합칩니다.
        full_prompt = f"""
        [System Role]: {system_prompt}
        
        [User Input]: {user_input}
        
        [Instruction]: 위 역할에 맞춰서 답변해줘.
        """
        response = model.generate_content(full_prompt)
        return response.text
    except Exception as e:
        return f"Error: {str(e)}"