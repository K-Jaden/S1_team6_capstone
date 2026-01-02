# image_gen.py
import requests
import time
import os

def generate_image_file(prompt, filename="result_image.jpg"):
    """
    프롬프트를 받아서 이미지를 생성하고 파일로 저장하는 함수
    (무료 Pollinations AI 사용 - API 키 필요 없음)
    """
    print(f"🎨 [System] 이미지를 생성 중입니다... (약 5~10초 소요)")
    
    # URL에 프롬프트를 넣으면 이미지를 줍니다.
    # 공백을 %20으로 바꾸는 등 간단한 전처리
    safe_prompt = prompt.replace(" ", "%20")
    image_url = f"https://image.pollinations.ai/prompt/{safe_prompt}"
    
    try:
        response = requests.get(image_url)
        if response.status_code == 200:
            # 파일로 저장
            with open(filename, 'wb') as f:
                f.write(response.content)
            print(f"✅ 이미지 저장 완료: {os.path.abspath(filename)}")
            return filename
        else:
            print("❌ 이미지 생성 실패")
            return None
    except Exception as e:
        print(f"❌ 에러 발생: {e}")
        return None