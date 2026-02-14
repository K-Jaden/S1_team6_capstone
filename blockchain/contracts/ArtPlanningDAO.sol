// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
}

contract ArtPlanningDAO {
    enum ProposalStatus { IN_PROGRESS, ACCEPTED, REJECTED }

    struct Proposal {
        uint256 id;
        string title;
        string description;
        string imageUrl;
        uint256 voteCount;    // 찬성 표
        uint256 againstCount; // 반대 표
        address proposer;
        ProposalStatus status;
        uint256 voteType; 
        uint256 deadline;     // [NEW] 종료 시간 (Unix Timestamp)
        uint256 quorum;       // [NEW] 목표 정족수
    }

    IERC20 public governanceToken;
    Proposal[] public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    // 이벤트에도 마감일과 정족수 정보 추가
    event ProposalCreated(uint256 id, string title, uint256 voteType, uint256 deadline, uint256 quorum);
    event Voted(uint256 id, address voter, uint256 votingPower, bool support);
    event StatusChanged(uint256 id, ProposalStatus newStatus);

    constructor(address _tokenAddress) {
        governanceToken = IERC20(_tokenAddress);
    }

    // [수정] 인자에 _duration(기간), _quorum(정족수) 추가
    function createProposal(
        string memory _title, 
        string memory _description, 
        string memory _imageUrl, 
        uint256 _voteType,
        uint256 _durationDays, // 며칠 동안 투표할지 (예: 3일)
        uint256 _quorum        // 목표 표수 (Wei 단위)
    ) public {
        uint256 newId = proposals.length;
        
        // 현재 블록 시간 + (일수 * 1일 초단위) = 종료 시간 계산
        uint256 deadlineDate = block.timestamp + (_durationDays * 1 days);

        proposals.push(Proposal({
            id: newId,
            title: _title,
            description: _description,
            imageUrl: _imageUrl,
            voteCount: 0,
            againstCount: 0,
            proposer: msg.sender,
            status: ProposalStatus.IN_PROGRESS,
            voteType: _voteType,
            deadline: deadlineDate, // 저장
            quorum: _quorum         // 저장
        }));
        
        emit ProposalCreated(newId, _title, _voteType, deadlineDate, _quorum);
    }

    function vote(uint256 _id, bool _support, uint256 _tokenAmount) public {
        require(_id < proposals.length, "Invalid Proposal ID");
        require(!hasVoted[_id][msg.sender], "Already voted");
        require(proposals[_id].status == ProposalStatus.IN_PROGRESS, "Voting ended");
        
        // [NEW] 기한 체크: 현재 시간이 마감일보다 전이어야 함
        require(block.timestamp < proposals[_id].deadline, "Voting period has expired");

        require(_tokenAmount > 0, "Amount must be greater than 0");

        uint256 balance = governanceToken.balanceOf(msg.sender);
        require(balance >= _tokenAmount, "Insufficient token balance");

        uint256 votingPower;
        // 0: 가중치(비례), 1: 제곱근
        if (proposals[_id].voteType == 1) { 
            votingPower = sqrt(_tokenAmount); 
        } else {
            votingPower = _tokenAmount;
        }

        require(votingPower > 0, "Power is too low");

        if (_support) {
             proposals[_id].voteCount += votingPower;
        } else {
             proposals[_id].againstCount += votingPower;
        }
        
        hasVoted[_id][msg.sender] = true;
        
        emit Voted(_id, msg.sender, votingPower, _support);

        // [NEW] 정족수 체크 (찬성표가 목표치 이상이면 즉시 통과)
        if (proposals[_id].voteCount >= proposals[_id].quorum) { 
            proposals[_id].status = ProposalStatus.ACCEPTED;
            emit StatusChanged(_id, ProposalStatus.ACCEPTED);
        }
    }

    function getAllProposals() public view returns (Proposal[] memory) {
        return proposals;
    }

    function sqrt(uint y) internal pure returns (uint z) {
        if (y > 3) {
            z = y;
            uint x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
