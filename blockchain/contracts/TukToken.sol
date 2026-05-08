// SPDX-License-Identifier: MIT
/**
* @title TukToken - Art Planning DAO Governance Token
* @author S1-6
* @notice Art Planning DAO 내에서 안건 생성 및 투표권 행사를 위한 거버넌스 토큰 (TUK)
* * @dev 주요 특징
* - ERC-20 표준 규격 준수(OpenZeppelin 라이브러리 기반)
* - 배포 시 초기 공급량(1,000,000 TUK)자동 발행
* - ownable 인터페이스를 통한 관리자(Owner) 권한 제어 및 민팅 기능 제공
* - 배포 스크립트를 통한 초기 테스트 계정 대상 자동 분배 최적화
* - ERC20Votes를 통한 스냅샷(투표력) 기능 추가
* * @custom:version v1.1.0
* @custom:created 2026-02-12
* @custom:modified 2026-04-28 - ERC20Votes 상속으로 스냅샷 기능 추가
*/
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TukToken is ERC20, ERC20Permit, ERC20Votes, Ownable {
    constructor(address initialOwner) 
        ERC20("TukToken", "TUK") 
        ERC20Permit("TukToken")
        Ownable(initialOwner) 
    {
        _mint(initialOwner, 1000000 * 10 ** decimals());
    }

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    // The following functions are overrides required by Solidity.
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
    }

    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }
}
