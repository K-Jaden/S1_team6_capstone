import requests
import os
from dotenv import load_dotenv # 👈 이거 추가

# .env 파일 내용을 불러옵니다
load_dotenv()

# 이제 코드는 환경 변수에서 값을 가져옵니다 (깃허브에 안전함)
PINATA_API_KEY = os.getenv("PINATA_API_KEY")
PINATA_SECRET_API_KEY = os.getenv("PINATA_SECRET_API_KEY")

# 1. 이미지 파일 업로드 (기존과 동일)
def upload_bytes_to_ipfs(file_bytes, filename="image.png"):
    url = "https://api.pinata.cloud/pinning/pinFileToIPFS"
    files = {'file': (filename, file_bytes)}
    headers = {
        'pinata_api_key': PINATA_API_KEY,
        'pinata_secret_api_key': PINATA_SECRET_API_KEY
    }
    response = requests.post(url, files=files, headers=headers)
    if response.status_code == 200:
        return response.json()['IpfsHash']
    return None

# 2. [NEW] 메타데이터(JSON) 업로드 (새로 추가!)
def upload_json_to_ipfs(json_data):
    url = "https://api.pinata.cloud/pinning/pinJSONToIPFS"
    headers = {
        'pinata_api_key': PINATA_API_KEY,
        'pinata_secret_api_key': PINATA_SECRET_API_KEY,
        'Content-Type': 'application/json'
    }
    # 피나타는 JSON 본문을 그대로 보냅니다.
    response = requests.post(url, json=json_data, headers=headers)
    
    if response.status_code == 200:
        return response.json()['IpfsHash'] # 이게 바로 Metadata CID
    else:
        print(f"❌ JSON Upload Error: {response.text}")
        return None