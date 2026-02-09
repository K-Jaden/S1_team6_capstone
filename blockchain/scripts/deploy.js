// blockchain/scripts/deploy.js
const hre = require("hardhat");
async function main() {
  const ArtPlanningDAO = await hre.ethers.getContractFactory("ArtPlanningDAO");
  const dao = await ArtPlanningDAO.deploy();
  await dao.waitForDeployment();
  console.log("CONTRACT_ADDRESS:", await dao.getAddress()); // 이 로그가 중요!
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
