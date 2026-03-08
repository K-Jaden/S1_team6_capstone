from fastapi import APIRouter
import requests
import time
from ipfs import upload_bytes_to_ipfs, upload_json_to_ipfs # 위에서 만든거 import

router = APIRouter()
AI_URL = "http://host.docker.internal:8002/generate"

@router.post("/api/studio/generate_hybrid")
async def generate_hybrid_art(prompt: str, wallet_address: str):
    print(f"🎨 [1] AI에게 그림 요청: {prompt}")
    
    # 1. AI 그림 생성 요청
    # 1. AI 그림 생성 요청 (agent.py의 WorkRequest 규격에 맞춤)
    payload = {
        "topic": prompt,       # 사용자가 입력한 prompt를 topic에 매핑
        "style": "Digital Art", # 스타일은 기본값 설정 (혹은 입력받은 걸로)
        "wallet_address": wallet_address
    }
    ai_res = requests.post(AI_URL, json=payload)
    if ai_res.status_code != 200: return {"error": "AI Error"}
    
    temp_url = ai_res.json().get("url") # AI가 준 임시 URL
    
    # 2. 백엔드가 이미지를 다운로드 (메모리에 저장)
    print("📥 [2] 이미지 다운로드 중...")
    img_res = requests.get(temp_url)
    if img_res.status_code != 200: return {"error": "Download Failed"}
    image_bytes = img_res.content

    # 3. 이미지를 IPFS에 업로드
    print("🚀 [3] 이미지 -> IPFS 업로드 중...")
    image_cid = upload_bytes_to_ipfs(image_bytes)
    if not image_cid: return {"error": "Image Upload Failed"}
    
    image_ipfs_url = f"https://gateway.pinata.cloud/ipfs/{image_cid}"

    # 4. [핵심] 메타데이터(JSON) 생성
    # 이것이 NFT 표준 규격(ERC-721)과 비슷합니다.
    metadata = {
        "name": f"ArtDAO Proposal: {prompt[:20]}...",
        "description": f"Created by ArtDAO AI. Prompt: {prompt}",
        "image": f"ipfs://{image_cid}", # 이미지는 ipfs:// 주소로 기록
        "external_url": image_ipfs_url,  # 웹에서 볼 수 있는 주소
        "attributes": [
            {"trait_type": "Creator", "value": wallet_address},
            {"trait_type": "Date", "value": str(time.time())}
        ]
    }

    # 5. 메타데이터를 IPFS에 업로드
    print("📝 [4] 메타데이터(JSON) -> IPFS 업로드 중...")
    meta_cid = upload_json_to_ipfs(metadata)
    
    if not meta_cid: return {"error": "Metadata Upload Failed"}

    print(f"✅ [완료] Image CID: {image_cid} / Meta CID: {meta_cid}")

    # 프론트엔드에게 줄 최종 데이터
    return {
        "status": "success",
        "image_url": image_ipfs_url, # <img src="...">에 넣을 주소
        "meta_cid": meta_cid,        # 블록체인/DB에 저장할 핵심 키 (CID)
        "image_cid": image_cid
    }