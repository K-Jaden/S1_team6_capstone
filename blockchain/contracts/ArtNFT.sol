// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ArtNFT is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    // DAO 컨트랙트 주소를 저장하여 DAO만 민팅할 수 있도록 제한
    address public daoContract;

    event NFTMinted(address indexed to, uint256 indexed tokenId, string tokenURI);

    constructor(address initialOwner) ERC721("ArtDAO NFT", "ART") Ownable(initialOwner) {}

    // DAO 컨트랙트 주소 설정
    function setDaoContract(address _dao) external onlyOwner {
        daoContract = _dao;
    }

    modifier onlyDAO() {
        require(msg.sender == daoContract, "Only DAO can mint");
        _;
    }

    // DAO 컨트랙트가 호출하는 민팅 함수
    function mint(address to, string memory uri) external onlyDAO returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _mint(to, tokenId);
        _setTokenURI(tokenId, uri);
        
        emit NFTMinted(to, tokenId, uri);
        
        return tokenId;
    }
}
