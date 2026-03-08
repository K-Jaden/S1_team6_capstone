import os
import json
from web3 import Web3
from dotenv import load_dotenv

load_dotenv()

class BlockchainService:
    def __init__(self):
        # 1. 연결: 도커 내부에서 호스트의 하드햇 노드에 접속
        rpc_url = os.getenv("BLOCKCHAIN_URL", "http://host.docker.internal:8545")
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))
        
        self.contract_address = os.getenv("CONTRACT_ADDRESS")
        self.private_key = os.getenv("PRIVATE_KEY")
        
        if not self.private_key:
            raise ValueError("PRIVATE_KEY가 .env에 설정되지 않았습니다.")
            
        self.account = self.w3.eth.account.from_key(self.private_key)

        # 2. ABI 로드: 로컬 하드햇에서 컴파일된 JSON 파일을 읽어옴
        # 주의: 이 파일이 ai_core 컨테이너 내부에서 접근 가능한 경로에 있어야 함
        try:
            # 하드햇 컴파일 결과물 경로 (배포 후 생성됨)
            with open("./ArtPlanningDAO.json", "r") as f: 
                artifact = json.load(f)
                self.abi = artifact["abi"]
        except FileNotFoundError:
            print("❌ ABI 파일을 찾을 수 없습니다. artifacts에서 ArtPlanningDAO.json을 ai_core 폴더로 복사하세요.")
            self.abi = []

        self.contract = self.w3.eth.contract(address=self.contract_address, abi=self.abi)

    # ai_core/blockchain.py

    def submit_proposal(self, title: str, description: str, ipfs_hash: str, funding_goal: int, min_contribution: int, duration_days: int):
        # 파이썬에서 호출할 메서드 이름: submit_to_blockchain
        def submit_to_blockchain(self, title, description, ipfs_hash, goal, min_c, duration):
            try:
                nonce = self.w3.eth.get_transaction_count(self.account.address)
                
                # 컨트랙트의 실제 함수 이름: createProposal (인자 6개)
                tx = self.contract.functions.createProposal(
                    title, 
                    description, 
                    ipfs_hash, 
                    goal, 
                    min_c, 
                    duration
                ).build_transaction({
                    'from': self.account.address,
                    'nonce': nonce,
                    'gas': 1000000,
                    'gasPrice': self.w3.eth.gas_price
                })

                signed_tx = self.w3.eth.account.sign_transaction(tx, self.private_key)
                tx_hash = self.w3.eth.send_raw_transaction(signed_tx.rawTransaction)
                
                receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
                return {"status": "success", "tx_hash": tx_hash.hex()}
            except Exception as e:
                return {"status": "error", "message": str(e)}