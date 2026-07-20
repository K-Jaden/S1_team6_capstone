const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const addressPath = path.join(__dirname, "../../frontend/src/contracts/address.js");
  if (!fs.existsSync(addressPath)) {
    console.error("address.js를 찾을 수 없습니다.");
    return;
  }
  
  const content = fs.readFileSync(addressPath, "utf8");
  const match = content.match(/DAO_CONTRACT_ADDRESS = "(0x[a-fA-F0-9]+)"/);
  if (!match) {
    console.error("DAO_CONTRACT_ADDRESS를 찾을 수 없습니다.");
    return;
  }
  
  const daoAddress = match[1];
  console.log("🏛️ DAO Contract Address:", daoAddress);

  const ArtPlanningDAO = await hre.ethers.getContractFactory("ArtPlanningDAO");
  const dao = ArtPlanningDAO.attach(daoAddress);

  const currentRoundId = await dao.currentRoundId();
  console.log("🔹 Current Round ID:", currentRoundId.toString());

  if (currentRoundId > 0n) {
    const round = await dao.rounds(currentRoundId);
    console.log("🔸 Round Details:");
    console.log("   - ID:", round.id.toString());
    console.log("   - startTime:", new Date(Number(round.startTime) * 1000).toLocaleString());
    console.log("   - endTime:", new Date(Number(round.endTime) * 1000).toLocaleString());
    console.log("   - isFinalized:", round.isFinalized);
    console.log("   - winningCandidateId:", round.winningCandidateId.toString());
    
    try {
      const candidates = await dao.getCandidates(currentRoundId);
      console.log(`   - Candidates Count: ${candidates.length}`);
      candidates.forEach((c, idx) => {
        console.log(`     [${idx}] ID: ${c.id}, Total Votes: ${hre.ethers.formatEther(c.totalVotes)} TUK, URI: ${c.metadataURI}`);
      });
    } catch (e) {
      console.log("   - Candidates query failed:", e.message);
    }
  } else {
    console.log("🔸 No rounds started yet in the contract.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
