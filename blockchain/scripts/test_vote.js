// blockchain/scripts/test_vote.js
// Hardhat Account #1 (voter1)로 직접 vote 트랜잭션을 보내서 컨트랙트 정상 여부 확인
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [owner, voter1] = await hre.ethers.getSigners();
  
  const addressPath = path.join(__dirname, "../../frontend/src/contracts/address.js");
  const content = fs.readFileSync(addressPath, "utf8");
  const daoMatch = content.match(/DAO_CONTRACT_ADDRESS = "(0x[a-fA-F0-9]+)"/);
  const tukMatch = content.match(/TUK_TOKEN_ADDRESS = "(0x[a-fA-F0-9]+)"/);
  
  const daoAddress = daoMatch[1];
  const tukAddress = tukMatch[1];
  
  console.log("🏛️ DAO Address:", daoAddress);
  console.log("🪙 TUK Address:", tukAddress);
  console.log("🧑 Voter1 Address:", voter1.address);

  const ArtPlanningDAO = await hre.ethers.getContractFactory("ArtPlanningDAO");
  const dao = ArtPlanningDAO.attach(daoAddress);

  const tokenAbi = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)"
  ];
  const tukToken = new hre.ethers.Contract(tukAddress, tokenAbi, voter1);

  const balance = await tukToken.balanceOf(voter1.address);
  console.log("💰 Voter1 TUK Balance:", hre.ethers.formatEther(balance), "TUK");

  const currentRoundId = await dao.currentRoundId();
  console.log("🔹 Current Round ID:", currentRoundId.toString());
  
  const round = await dao.rounds(currentRoundId);
  console.log("🔸 isFinalized:", round.isFinalized);
  console.log("🔸 endTime:", new Date(Number(round.endTime) * 1000).toLocaleString());

  // 투표할 금액 (500 TUK)
  const vpAmount = hre.ethers.parseEther("500");
  const candidateId = 0; // 첫 번째 후보에 투표

  console.log("\n▶ Step 1: Approve 500 TUK to DAO contract...");
  const approveTx = await tukToken.approve(daoAddress, vpAmount);
  await approveTx.wait();
  console.log("✅ Approve 완료!");

  console.log("▶ Step 2: Vote on candidate 0...");
  try {
    const daoWithVoter = dao.connect(voter1);
    const voteTx = await daoWithVoter.vote(candidateId, vpAmount);
    await voteTx.wait();
    console.log("🎉 투표 성공! TX:", voteTx.hash);

    const candidates = await dao.getCandidates(currentRoundId);
    console.log("📊 Candidate 0 Total Votes:", hre.ethers.formatEther(candidates[0].totalVotes), "TUK");
  } catch (err) {
    console.error("❌ 투표 실패:", err.message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
