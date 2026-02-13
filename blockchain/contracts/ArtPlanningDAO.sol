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
        uint256 voteCount;    // 찬성 표 (Yes)
        uint256 againstCount; // [추가] 반대 표 (No)
        address proposer;
        ProposalStatus status;
        uint256 voteType; 
    }

    IERC20 public governanceToken;
    Proposal[] public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event ProposalCreated(uint256 id, string title, uint256 voteType, address proposer);
    // [수정] 이벤트에 찬성/반대 여부(support)도 같이 기록
    event Voted(uint256 id, address voter, uint256 usedAmount, uint256 votingPower, bool support);
    event StatusChanged(uint256 id, ProposalStatus newStatus);

    constructor(address _tokenAddress) {
        governanceToken = IERC20(_tokenAddress);
    }

    function createProposal(
        string memory _title, 
        string memory _description, 
        string memory _imageUrl, 
        uint256 _voteType
    ) public {
        uint256 newId = proposals.length;
        proposals.push(Proposal({
            id: newId,
            title: _title,
            description: _description,
            imageUrl: _imageUrl,
            voteCount: 0,
            againstCount: 0, // 초기화
            proposer: msg.sender,
            status: ProposalStatus.IN_PROGRESS,
            voteType: _voteType
        }));
        
        emit ProposalCreated(newId, _title, _voteType, msg.sender);
    }

    function vote(uint256 _id, bool _support, uint256 _tokenAmount) public {
        require(_id < proposals.length, "Invalid Proposal ID");
        require(!hasVoted[_id][msg.sender], "Already voted");
        require(proposals[_id].status == ProposalStatus.IN_PROGRESS, "Voting ended");
        require(_tokenAmount > 0, "Amount must be greater than 0");

        uint256 balance = governanceToken.balanceOf(msg.sender);
        require(balance >= _tokenAmount, "Insufficient token balance");

        uint256 votingPower;
        if (proposals[_id].voteType == 1) { 
            votingPower = sqrt(_tokenAmount); 
        } else {
            votingPower = _tokenAmount;
        }

        require(votingPower > 0, "Calculated voting power is too low");

        // [핵심 수정] 찬성/반대 구분하여 저장
        if (_support) {
             proposals[_id].voteCount += votingPower;
        } else {
             proposals[_id].againstCount += votingPower;
        }
        
        hasVoted[_id][msg.sender] = true;
        
        emit Voted(_id, msg.sender, _tokenAmount, votingPower, _support);

        // 정족수 체크 (찬성이 5토큰 이상이면 통과)
        if (proposals[_id].voteCount >= 5 * 10**18) { 
            proposals[_id].status = ProposalStatus.ACCEPTED;
            emit StatusChanged(_id, ProposalStatus.ACCEPTED);
        }
    }

    function getAllProposals() public view returns (Proposal[] memory) {
        return proposals;
    }
    
    function getProposal(uint256 _id) public view returns (Proposal memory) {
        return proposals[_id];
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
