# 🎨 ArtPlanningDAO (S1 Team 6 Capstone)

이 프로젝트는 **React(Frontend)**, **FastAPI(Backend)**, **Hardhat(Blockchain)**으로 구성된 탈중앙화 예술 기획 플랫폼입니다.
로컬 개발 환경 세팅을 위해 아래 가이드를 **순서대로** 따라해주세요.

---

## 🚀 1. 설치 및 실행 가이드 (Quick Start)

터미널 3개(블록체인, 백엔드, 프론트엔드)를 열어서 순서대로 실행합니다.

### 🟢 Step 1: 블록체인 네트워크 실행 (터미널 1)
가상의 이더리움 로컬 네트워크를 실행합니다. **(이 터미널은 절대 끄면 안 됩니다!)**

```bash
cd blockchain
npm install
npx hardhat node
```
성공 확인: Account 20개가 출력되면 성공
### 🟡 Step 2: 스마트 컨트랙트 배포 (터미널 2)
블록체인 네트워크가 켜진 상태에서 새 터미널을 열고 실행합니다.
```bash
cd blockchain
npx hardhat run scripts/deploy.js --network localhost
```
**중요: 배포 후 주소 업데이트**
- 배포가 완료되면 터미널에 출력된 Contract Address(예: 0x5FbDB...)를 복사해서 frontend/src/contracts/address.js 파일의 CONTRACT_ADDRESS 값을 수정해주세요.
### 🔵 Step 3: 백엔드 서버 실행 (터미널 3)
**사전 준비**: MySQL 데이터베이스가 실행 중이어야 합니다.(Backend 디렉터리에서 docker compose up db)
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
### 4: 프론트엔드 실행 (터미널 4)
```bash
cd frontend
npm install
npm start
```
## 🦊 2. 메타마스크(MetaMask) 연결 설정
로컬 블록체인과 통신하기 위해 메타마스크 설정이 필수입니다.
### 1. 네트워크 수동 추가
메타마스크 우측 상단 햄버거버튼 클릭 -> 네트워크 -> 네트워크 추가
- 네트워크 이름: Hardhat Local (달라도 상관없음)
- 새 RPC URL: http://127.0.0.1:8545
- 체인 ID: 31337
- 통화 기호: GO
### 2. 관리자 계정 가져오기
터미널 1에 출력된 Account #0의 **Private Key(비공개 키)**를 복사하여 메타마크스에 '계정 가져오기로' 등록. (10,000GO나 9.999.xxGO가 보이면 성공)
## 🛠 3. 트러블슈팅 (자주 발생하는 오류)
Q1. "Nonce too high" 또는 트랜잭션 오류
블록체인 노드를 껐다 켜면 메타마스크의 이전 거래 기록과 충돌이 발생합니다.

- 해결: 메타마스크 우측 상단 점 3개(...) → 설정 → 고급 → [활동 탭 데이터 지우기] 클릭.

Q2. "계약이 아닌 주소 (Non-contract address)"
프론트엔드가 바라보는 주소에 컨트랙트가 없을 때 발생합니다. (노드 재실행 시 컨트랙트가 사라지기 때문)

- 해결:

1. Step 2의 배포 명령어를 다시 실행.

2. 생성된 새 주소를 frontend/src/contracts/address.js에 업데이트.

3. 브라우저 강력 새로고침 (Ctrl + Shift + R).

Q3. "Invalid Chain ID"
- 해결: 메타마스크 네트워크 설정에서 체인 ID가 31337인지 확인하세요.

Q4. 백엔드 "Connection Refused"
- 해결: MySQL 데이터베이스가 켜져 있는지 확인하세요. (3306 포트)
