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
* * @custom:version v1.0.0
* @custom:created 2026-02-12
* @custom:modified 2026-02-12 - 초기 배포 및 자동 분배 로직 구현
*/
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TukToken is ERC20, Ownable {
    // 생성자: 토큰 이름(TukToken), 심볼(TUK)
    // initialOwner는 토큰의 관리자(보통 배포자)가 됩니다.
    constructor(address initialOwner) 
        ERC20("TukToken", "TUK") 
        Ownable(initialOwner) 
    {
        // 최초 배포 시 1,000,000개를 발행하여 관리자에게 줍니다.
        // 10 ** decimals()는 소수점 18자리를 의미합니다.
        _mint(initialOwner, 1000000 * 10 ** decimals());
    }

    // 필요 시 추가 발행을 위한 함수 (선택 사항)
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}
