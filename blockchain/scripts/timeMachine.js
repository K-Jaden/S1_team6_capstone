
const { ethers } = require("hardhat");

async function main() {
    console.log("⏳ 타임머신을 가동합니다...");
    
    // 1. 3일(259200초) 앞당기기
    const daysToAdvance = 3;
    const seconds = daysToAdvance * 24 * 60 * 60;
    
    await ethers.provider.send("evm_increaseTime", [seconds]);
    
    // 2. 강제 채굴하여 시간 적용
    await ethers.provider.send("evm_mine", []);
    
    console.log(`✨ 성공! 블록체인 시간이 정확히 ${daysToAdvance}일 후로 이동했습니다.`);
    console.log("👉 이제 프론트엔드 화면을 새로고침 해보세요!");
}

main().catch((error) => {
    console.error("타임머신 작동 실패:", error);
    process.exitCode = 1;
});
