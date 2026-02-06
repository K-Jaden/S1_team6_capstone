// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20; // 팀 설정(0.8.20)에 맞춤

contract ArtPlanningDAO {
    enum ProposalStatus { IN_PROGRESS, ACCEPTED, REJECTED }

    struct Proposal {
        uint256 id;
        string title;
        string description;
        string imageUrl;
        uint256 voteCount;
        address proposer;
        ProposalStatus status;
    }

    Proposal[] public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event ProposalCreated(uint256 id, string title, address proposer);
    event Voted(uint256 id, address voter, uint256 currentVotes);
    event StatusChanged(uint256 id, ProposalStatus newStatus);

    function createProposal(string memory _title, string memory _description, string memory _imageUrl) public {
        uint256 newId = proposals.length;
        proposals.push(Proposal({
            id: newId,
            title: _title,
            description: _description,
            imageUrl: _imageUrl,
            voteCount: 0,
            proposer: msg.sender,
            status: ProposalStatus.IN_PROGRESS
        }));
        emit ProposalCreated(newId, _title, msg.sender);
    }

    function vote(uint256 _id) public {
        require(_id < proposals.length, "Invalid Proposal ID");
        require(!hasVoted[_id][msg.sender], "Already voted");
        require(proposals[_id].status == ProposalStatus.IN_PROGRESS, "Voting ended");

        proposals[_id].voteCount += 1;
        hasVoted[_id][msg.sender] = true;

        emit Voted(_id, msg.sender, proposals[_id].voteCount);
        
        if (proposals[_id].voteCount >= 5) {
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
}
