// blockchain/scripts/deploy.js

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
const [owner, voter1, voter2, voter3, voter4] = await hre.ethers.getSigners();

  console.log("🚀 배포 및 자동 주소/ABI 동기화를 시작합니다...");

  // 1. TukToken 배포
  const TukToken = await hre.ethers.getContractFactory("TukToken");
  const tukToken = await TukToken.deploy(owner.address);
  await tukToken.waitForDeployment();
  const tukAddress = await tukToken.getAddress();

  // 2. TUK 토큰 분배 및 스냅샷 투표력(VP) 활성화를 위한 위임(Delegate)
  const amount = hre.ethers.parseEther("10000");
  
  await tukToken.connect(owner).delegate(owner.address);

  await tukToken.transfer(voter1.address, amount);
  await tukToken.connect(voter1).delegate(voter1.address);

  await tukToken.transfer(voter2.address, amount);
  await tukToken.connect(voter2).delegate(voter2.address);

  await tukToken.transfer(voter3.address, amount);
  await tukToken.connect(voter3).delegate(voter3.address);

  await tukToken.transfer(voter4.address, amount);
  await tukToken.connect(voter4).delegate(voter4.address);
  console.log(`🪙 TukToken 배포 완료: ${tukAddress}`);

  // 3. ArtPlanningDAO 배포 (TUK 토큰 주소 주입)
  const ArtPlanningDAO = await hre.ethers.getContractFactory("ArtPlanningDAO");
  const dao = await ArtPlanningDAO.deploy(tukAddress);
  await dao.waitForDeployment();
  const daoAddress = await dao.getAddress();
  console.log(`🏛️ ArtPlanningDAO 배포 완료: ${daoAddress}`);

  // 4. ArtNFT 배포 및 설정
  const ArtNFT = await hre.ethers.getContractFactory("ArtNFT");
  const artNFT = await ArtNFT.deploy(owner.address);
  await artNFT.waitForDeployment();
  const nftAddress = await artNFT.getAddress();
  console.log(`🖼️ ArtNFT 배포 완료: ${nftAddress}`);

  // 5. 권한 연동 및 초기 자본(Treasury) 세팅
  // 5-1. NFT의 민팅 권한을 DAO에 위임
  await artNFT.setDaoContract(daoAddress);
  // 5-2. DAO에 ArtNFT 주소 등록
  await dao.setArtNFT(nftAddress);
  // 5-3. TUK 토큰의 발행(Mint) 권한을 DAO로 이전
  await tukToken.transferOwnership(daoAddress);
  
  // 5-4. 데모용 초기 자본: DAO 금고에 100,000 TUK 전송 (하이브리드 방식)
  const treasuryAmount = hre.ethers.parseEther("100000");
  await tukToken.transfer(daoAddress, treasuryAmount);
  console.log(`💰 DAO 금고에 초기 배당용 예산 100,000 TUK 전송 완료!`);

  // ====================================================
  // 📂 [핵심] 프론트엔드 파일 자동 업데이트 (주소 + ABI)
  // ====================================================
  
  const frontendDir = path.join(__dirname, "../../frontend/src/contracts");
  
  // 폴더가 없으면 생성
  if (!fs.existsSync(frontendDir)) {
    fs.mkdirSync(frontendDir, { recursive: true });
  }

  // 1️⃣ 주소 파일 업데이트 (address.js)
  const addressFilePath = path.join(frontendDir, "address.js");
  const content = `export const TUK_TOKEN_ADDRESS = "${tukAddress}";
export const DAO_CONTRACT_ADDRESS = "${daoAddress}";
export const NFT_CONTRACT_ADDRESS = "${nftAddress}";
`;
  fs.writeFileSync(addressFilePath, content, "utf8");
  console.log(`✅ 주소 파일 업데이트 완료: ${addressFilePath}`);

  // 2️⃣ ABI 파일 복사 (ArtPlanningDAO.json) - 여기가 중요합니다!
  // 하드햇이 컴파일한 최신 JSON 파일을 가져옵니다.
  const artifactPath = path.join(__dirname, "../artifacts/contracts/ArtPlanningDAO.sol/ArtPlanningDAO.json");
  const frontendArtifactPath = path.join(frontendDir, "ArtPlanningDAO.json");

  if (fs.existsSync(artifactPath)) {
      fs.copyFileSync(artifactPath, frontendArtifactPath);
      console.log(`✅ ABI(JSON) 파일 복사 완료: ${frontendArtifactPath}`);
  } else {
      console.error("❌ 컴파일된 아티팩트 파일을 찾을 수 없습니다. (npx hardhat compile을 먼저 확인하세요)");
  }

  // --- 추가된 AI 에이전트 동기화 로직 ---
  const AI_CORE_DIR = path.join(__dirname, "../../ai_core");
  
  // 1. ABI 복사 (ArtPlanningDAO.json)
  const abiPath = path.join(__dirname, "../artifacts/contracts/ArtPlanningDAO.sol/ArtPlanningDAO.json");
  const abiContent = fs.readFileSync(abiPath, "utf8");
  fs.writeFileSync(path.join(AI_CORE_DIR, "ArtPlanningDAO.json"), abiContent);
  console.log(`✅ AI Core ABI(JSON) 복사 완료: ${path.join(AI_CORE_DIR, "ArtPlanningDAO.json")}`);

  // 2. 주소 파일 생성 (계약 주소를 Python에서 쉽게 읽도록 JSON으로 저장)
  const addressData = {
    ArtPlanningDAO: daoAddress,
    network: "localhost",
    lastUpdated: new Date().toISOString()
  };
  fs.writeFileSync(
    path.join(AI_CORE_DIR, "contract_address.json"),
    JSON.stringify(addressData, null, 2)
  );
  console.log(`✅ AI Core 주소 파일 업데이트 완료: ${path.join(AI_CORE_DIR, "contract_address.json")}`);

  // --- 추가: 백엔드(FastAPI) 동기화 로직 ---
  const BACKEND_DIR = path.join(__dirname, "../../backend/app");
  if (!fs.existsSync(BACKEND_DIR)) {
    fs.mkdirSync(BACKEND_DIR, { recursive: true });
  }
  
  fs.writeFileSync(path.join(BACKEND_DIR, "ArtPlanningDAO.json"), abiContent);
  console.log(`✅ Backend ABI(JSON) 복사 완료: ${path.join(BACKEND_DIR, "ArtPlanningDAO.json")}`);
  
  fs.writeFileSync(
    path.join(BACKEND_DIR, "contract_address.json"),
    JSON.stringify(addressData, null, 2)
  );
  console.log(`✅ Backend 주소 파일 업데이트 완료: ${path.join(BACKEND_DIR, "contract_address.json")}`);

  console.log("--------------------------------------------------\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
