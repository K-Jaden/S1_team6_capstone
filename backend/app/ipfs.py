import logging
import requests
import os
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("backend.ipfs")

# .env 파일에서 키 가져오기
PINATA_API_KEY = os.getenv("PINATA_API_KEY")
PINATA_SECRET_API_KEY = os.getenv("PINATA_SECRET_API_KEY")

# 1. 이미지 파일 업로드
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
    else:
        logger.error(f"❌ [IPFS 에러] 그림 업로드 실패: {response.status_code} - {response.text}")
        return None

# 2. 메타데이터(JSON) 업로드
def upload_json_to_ipfs(json_data):
    url = "https://api.pinata.cloud/pinning/pinJSONToIPFS"
    headers = {
        'pinata_api_key': PINATA_API_KEY,
        'pinata_secret_api_key': PINATA_SECRET_API_KEY,
        'Content-Type': 'application/json'
    }
    response = requests.post(url, json=json_data, headers=headers)
    
    if response.status_code == 200:
        return response.json()['IpfsHash']
    else:
        logger.error(f"❌ [IPFS 에러] JSON 업로드 실패: {response.status_code} - {response.text}")
        return None