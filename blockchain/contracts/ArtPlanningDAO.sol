// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    //트레저리에서 토큰을 보내기 위한 transfer 함수
    function transfer(address to, uint256 amount) external returns (bool);
}

contract ArtPlanningDAO {
    enum ProposalStatus { IN_PROGRESS, ACCEPTED, REJECTED, EXECUTED }

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
        uint256 deadline;     // 종료 시간 (Unix Timestamp)
        uint256 quorum;       // 목표 정족수
        uint256 fundingAmount;// 안건 가결 시 지급할 요청 지원금
    }

    IERC20 public governanceToken;
    Proposal[] public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event ProposalCreated(uint256 id, string title, uint256 voteType, uint256 deadline, uint256 quorum, uint256 fundingAmount);
    event Voted(uint256 id, address voter, uint256 votingPower, bool support);
    event StatusChanged(uint256 id, ProposalStatus newStatus);
    event ProposalExecuted(uint256 id, uint256 amount); // 자금 집행 완료 이벤트

    constructor(address _tokenAddress) {
        governanceToken = IERC20(_tokenAddress);
    }

    function createProposal(
        string memory _title, string memory _description, string memory _imageUrl, 
        uint256 _voteType, uint256 _durationDays, uint256 _quorum, uint256 _fundingAmount
    ) public {
        uint256 newId = proposals.length;
        
        uint256 deadlineDate = block.timestamp + (_durationDays * 1 days);

        proposals.push(Proposal({
            id: newId, title: _title, description: _description, imageUrl: _imageUrl,
            voteCount: 0, againstCount: 0, proposer: msg.sender,
            status: ProposalStatus.IN_PROGRESS, voteType: _voteType,
            deadline: deadlineDate, quorum: _quorum, fundingAmount: _fundingAmount
        }));

        emit ProposalCreated(newId, _title, _voteType, deadlineDate, _quorum, _fundingAmount);
    }

    function vote(uint256 _id, bool _support, uint256 _tokenAmount) public {
        require(_id < proposals.length, "Invalid Proposal ID");
        require(!hasVoted[_id][msg.sender], "Already voted");
        require(proposals[_id].status == ProposalStatus.IN_PROGRESS, "Voting ended");
        require(block.timestamp < proposals[_id].deadline, "Voting period has expired");
        require(_tokenAmount > 0, "Amount must be greater than 0");

        uint256 balance = governanceToken.balanceOf(msg.sender);
        require(balance >= _tokenAmount, "Insufficient token balance");

        uint256 votingPower = (proposals[_id].voteType == 1) ? sqrt(_tokenAmount) : _tokenAmount;
        require(votingPower > 0, "Power is too low");

        if (_support) {
             proposals[_id].voteCount += votingPower;
        } else {
             proposals[_id].againstCount += votingPower;
        }
        
        hasVoted[_id][msg.sender] = true;
        emit Voted(_id, msg.sender, votingPower, _support);

    }

    //  마감일 이후에 누군가 호출하여 결과를 확정하고 자금을 집행하는 함수
    function executeProposal(uint256 _id) public {
        require(_id < proposals.length, "Invalid Proposal ID");
        Proposal storage p = proposals[_id];

        // 1. 상태 및 마감일 체크 (반드시 마감일이 지나야만 실행 가능)
        require(p.status == ProposalStatus.IN_PROGRESS, "Proposal is already finalized");
        require(block.timestamp >= p.deadline, "Voting period has not ended yet");

        uint256 totalVotes = p.voteCount + p.againstCount;

        // 2. 정족수 미달 OR 반대가 더 많으면 부결(REJECTED) 처리 후 종료
        if (totalVotes < p.quorum || p.voteCount <= p.againstCount) {
            p.status = ProposalStatus.REJECTED;
            emit StatusChanged(_id, ProposalStatus.REJECTED);
            return;
        }

        // 3. 조건 통과 시 상태를 집행 완료(EXECUTED)로 변경
        p.status = ProposalStatus.EXECUTED;
        emit StatusChanged(_id, ProposalStatus.EXECUTED);

        // 4. 작성자에게 자금 전송
        uint256 contractBalance = governanceToken.balanceOf(address(this));
        require(contractBalance >= p.fundingAmount, "Insufficient treasury funds");

        bool success = governanceToken.transfer(p.proposer, p.fundingAmount);
        require(success, "Token transfer failed");

        emit ProposalExecuted(_id, p.fundingAmount);
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