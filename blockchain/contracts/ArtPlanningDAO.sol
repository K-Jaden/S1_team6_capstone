// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/governance/utils/IVotes.sol";

contract ArtPlanningDAO {
    IVotes public governanceToken;

    struct Round {
        uint256 id;
        uint256 snapshotBlock; // 투표력 측정을 위한 스냅샷 블록 (어뷰징 방지)
        uint256 startTime;     // 시작 시간 (Timestamp)
        uint256 endTime;       // 종료 시간 (Timestamp)
        bool isFinalized;      // 결과 확정 여부
        uint256 winningCandidateId; // 우승 후보작 ID
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

    event RoundStarted(uint256 indexed roundId, uint256 startTime, uint256 endTime, uint256 snapshotBlock);
    event Voted(uint256 indexed roundId, uint256 indexed candidateId, address indexed voter, uint256 vpAmount);
    event RoundFinalized(uint256 indexed roundId, uint256 winningCandidateId);

    constructor(address _tokenAddress) {
        governanceToken = IVotes(_tokenAddress);
    }

    // 새로운 투표 라운드 시작 (매주 자동화 스크립트에서 호출됨)
    function startNewRound(uint256 _durationDays, string[] memory _candidateURIs) public {
        require(_candidateURIs.length > 0, "No candidates provided");
        
        currentRoundId++;
        
        // 현재 블록의 이전 블록을 스냅샷으로 설정 (IVotes getPastVotes 조건 충족)
        uint256 snapshotBlock = block.number > 0 ? block.number - 1 : 0;
        uint256 startTime = block.timestamp;
        uint256 endTime = startTime + (_durationDays * 1 days);

        rounds[currentRoundId] = Round({
            id: currentRoundId,
            snapshotBlock: snapshotBlock,
            startTime: startTime,
            endTime: endTime,
            isFinalized: false,
            winningCandidateId: 0
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

        // 스냅샷 시점의 총 투표권 확인
        uint256 totalVpAtStart = governanceToken.getPastVotes(msg.sender, r.snapshotBlock);
        
        // 투표 한도 초과 확인
        require(usedVotingPower[currentRoundId][msg.sender] + _vpAmount <= totalVpAtStart, "Exceeds available Voting Power");

        // 투표력 소모 및 후보작 득표수 증가
        usedVotingPower[currentRoundId][msg.sender] += _vpAmount;
        userVoteWeight[currentRoundId][_candidateId][msg.sender] += _vpAmount;
        roundCandidates[currentRoundId][_candidateId].totalVotes += _vpAmount;

        emit Voted(currentRoundId, _candidateId, msg.sender, _vpAmount);
    }

    // 라운드 종료 및 우승작 선정
    function finalizeRound() public {
        Round storage r = rounds[currentRoundId];
        require(!r.isFinalized, "Round is already finalized");
        require(block.timestamp > r.endTime, "Voting period has not ended yet");

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

        emit RoundFinalized(currentRoundId, winningId);
    }
    
    // 특정 라운드의 모든 후보작 조회
    function getCandidates(uint256 _roundId) public view returns (Candidate[] memory) {
        return roundCandidates[_roundId];
    }

    // 유저의 현재 라운드 잔여 투표력(VP) 조회
    function getRemainingVP(address _user) public view returns (uint256) {
        if(currentRoundId == 0) return 0;
        Round memory r = rounds[currentRoundId];
        uint256 totalVpAtStart = governanceToken.getPastVotes(_user, r.snapshotBlock);
        return totalVpAtStart - usedVotingPower[currentRoundId][_user];
    }
}