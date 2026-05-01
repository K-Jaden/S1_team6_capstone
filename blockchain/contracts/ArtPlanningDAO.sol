// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/governance/utils/IVotes.sol";

// [NEW] TukToken과 ArtNFT 인터페이스
interface ITukToken is IERC20, IVotes {
    function mint(address to, uint256 amount) external;
}

interface IArtNFT {
    function mint(address to, string memory uri) external returns (uint256);
}

contract ArtPlanningDAO {
    ITukToken public governanceToken;
    IArtNFT public artNFT;

    struct Round {
        uint256 id;
        uint256 snapshotBlock; // 투표력 측정을 위한 스냅샷 블록 (어뷰징 방지)
        uint256 startTime;     // 시작 시간 (Timestamp)
        uint256 endTime;       // 종료 시간 (Timestamp)
        bool isFinalized;      // 결과 확정 여부
        uint256 winningCandidateId; // 우승 후보작 ID
        uint256 auctionPrice;  // [NEW] 우승작의 가상 매각 대금 (AI 산정가)
        uint256 rewardPool;    // [NEW] 배당에 쓰일 풀 (auctionPrice 의 70%)
    }

    struct Candidate {
        uint256 id;
        uint256 roundId;
        string metadataURI; // IPFS 메타데이터 또는 이미지 주소
        uint256 totalVotes; // 누적 투표(VP) 수
    }

    uint256 public currentRoundId;
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => Candidate[]) public roundCandidates;
    
    // roundId => user => 사용한 VP
    mapping(uint256 => mapping(address => uint256)) public usedVotingPower;
    
    // roundId => candidateId => user => 행사한 VP (추후 배당 시 지분율 계산용)
    mapping(uint256 => mapping(uint256 => mapping(address => uint256))) public userVoteWeight;

    // [NEW] roundId => user => 보상 수령 여부
    mapping(uint256 => mapping(address => bool)) public hasClaimedReward;

    event RoundStarted(uint256 indexed roundId, uint256 startTime, uint256 endTime, uint256 snapshotBlock);
    event Voted(uint256 indexed roundId, uint256 indexed candidateId, address indexed voter, uint256 vpAmount);
    event RoundFinalized(uint256 indexed roundId, uint256 winningCandidateId, uint256 auctionPrice, uint256 nftTokenId);
    event RewardClaimed(uint256 indexed roundId, address indexed user, uint256 rewardAmount);

    constructor(address _tokenAddress) {
        governanceToken = ITukToken(_tokenAddress);
    }

    // [NEW] ArtNFT 주소 설정
    function setArtNFT(address _artNFTAddress) public {
        artNFT = IArtNFT(_artNFTAddress);
    }

    // 새로운 투표 라운드 시작 (매주 자동화 스크립트에서 호출됨)
    function startNewRound(uint256 _durationDays, string[] memory _candidateURIs) public {
        require(_candidateURIs.length > 0, "No candidates provided");
        
        currentRoundId++;
        
        uint256 snapshotBlock = block.number > 0 ? block.number - 1 : 0;
        uint256 startTime = block.timestamp;
        uint256 endTime = startTime + (_durationDays * 1 days);

        rounds[currentRoundId] = Round({
            id: currentRoundId,
            snapshotBlock: snapshotBlock,
            startTime: startTime,
            endTime: endTime,
            isFinalized: false,
            winningCandidateId: 0,
            auctionPrice: 0,
            rewardPool: 0
        });

        for(uint256 i = 0; i < _candidateURIs.length; i++) {
            roundCandidates[currentRoundId].push(Candidate({
                id: i,
                roundId: currentRoundId,
                metadataURI: _candidateURIs[i],
                totalVotes: 0
            }));
        }

        emit RoundStarted(currentRoundId, startTime, endTime, snapshotBlock);
    }

    // 특정 라운드의 후보작에 분산 투표
    function vote(uint256 _candidateId, uint256 _vpAmount) public {
        Round storage r = rounds[currentRoundId];
        require(!r.isFinalized, "Round is already finalized");
        require(block.timestamp <= r.endTime, "Voting period has ended");
        require(_candidateId < roundCandidates[currentRoundId].length, "Invalid candidate ID");
        require(_vpAmount > 0, "VP amount must be greater than 0");

        uint256 totalVpAtStart = governanceToken.getPastVotes(msg.sender, r.snapshotBlock);
        
        require(usedVotingPower[currentRoundId][msg.sender] + _vpAmount <= totalVpAtStart, "Exceeds available Voting Power");

        usedVotingPower[currentRoundId][msg.sender] += _vpAmount;
        userVoteWeight[currentRoundId][_candidateId][msg.sender] += _vpAmount;
        roundCandidates[currentRoundId][_candidateId].totalVotes += _vpAmount;

        emit Voted(currentRoundId, _candidateId, msg.sender, _vpAmount);
    }

    function finalizeRound(uint256 _auctionPriceWei, string memory _winnerIpfsURI) public {
        Round storage r = rounds[currentRoundId];
        require(!r.isFinalized, "Round is already finalized");
        // require(block.timestamp > r.endTime, "Voting period has not ended yet"); // 🚨 데모 시연을 위해 시간 제한 조건 해제

        uint256 winningId = 0;
        uint256 highestVotes = 0;

        Candidate[] storage candidates = roundCandidates[currentRoundId];
        for(uint256 i = 0; i < candidates.length; i++) {
            if(candidates[i].totalVotes > highestVotes) {
                highestVotes = candidates[i].totalVotes;
                winningId = i;
            }
        }

        r.isFinalized = true;
        r.winningCandidateId = winningId;
        r.auctionPrice = _auctionPriceWei;
        r.rewardPool = (_auctionPriceWei * 70) / 100; // 70%를 배당 풀로 할당

        // 우승 후보작 메타데이터 업데이트 (로컬주소 -> IPFS주소)
        candidates[winningId].metadataURI = _winnerIpfsURI;

        // NFT 자동 민팅 (DAO 소유로 발행)
        uint256 tokenId = artNFT.mint(address(this), _winnerIpfsURI);

        emit RoundFinalized(currentRoundId, winningId, _auctionPriceWei, tokenId);
    }
    
    // [NEW] 배당금(Claim) 수령 함수 (하이브리드 재원 마련 방식 적용)
    function claimReward(uint256 _roundId) public {
        Round memory r = rounds[_roundId];
        require(r.isFinalized, "Round not finalized yet");
        require(!hasClaimedReward[_roundId][msg.sender], "Already claimed");

        uint256 myVotes = userVoteWeight[_roundId][r.winningCandidateId][msg.sender];
        require(myVotes > 0, "No votes for the winning candidate");

        uint256 totalWinningVotes = roundCandidates[_roundId][r.winningCandidateId].totalVotes;
        
        // 내 지분율에 따른 보상액 계산: (내 득표수 * 보상풀) / 전체 득표수
        uint256 myReward = (r.rewardPool * myVotes) / totalWinningVotes;
        require(myReward > 0, "Reward is zero");

        hasClaimedReward[_roundId][msg.sender] = true;

        // Treasury(DAO 잔액)에서 지급 시도, 부족하면 자동 Mint
        uint256 daoBalance = governanceToken.balanceOf(address(this));
        if (daoBalance < myReward) {
            governanceToken.mint(address(this), myReward - daoBalance);
        }

        governanceToken.transfer(msg.sender, myReward);

        emit RewardClaimed(_roundId, msg.sender, myReward);
    }

    function getCandidates(uint256 _roundId) public view returns (Candidate[] memory) {
        return roundCandidates[_roundId];
    }

    function getRemainingVP(address _user) public view returns (uint256) {
        if(currentRoundId == 0) return 0;
        Round memory r = rounds[currentRoundId];
        uint256 totalVpAtStart = governanceToken.getPastVotes(_user, r.snapshotBlock);
        return totalVpAtStart - usedVotingPower[currentRoundId][_user];
    }
}