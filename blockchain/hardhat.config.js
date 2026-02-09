require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  // 1. 솔리디티 설정 (기존 설정 유지)
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris"
    },
  },
  // 2. 네트워크 설정 (여기가 핵심!)
  networks: {
    hardhat: {
      chainId: 31337, // 메타마스크 표준 체인 ID (이게 있어야 경고가 안 뜸)
      blockGasLimit: 30000000,
    },
    // 이 부분이 없어서 연결이 안 됐던 겁니다!
    localhost: {
      url: "http://127.0.0.1:8545", // 표준 포트 8545로 고정
      chainId: 31337,
    },
  },
};
