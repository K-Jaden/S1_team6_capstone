import React, { useState, useEffect } from "react";
import axios from "axios";
import { ethers } from "ethers";
import "./App.css";

// LIM. 블록체인 연결 정보 가져오기
import { DAO_CONTRACT_ADDRESS as CONTRACT_ADDRESS, TUK_TOKEN_ADDRESS } from './contracts/address';
import ArtPlanningDAO from './contracts/ArtPlanningDAO.json';

const API_URL = "http://localhost:8000";

// ✅ [설정] 관리자 지갑 주소
const ADMIN_WALLETS = [
    "0xa06e02093A85F32b2707f4f7ec646f6D606D0F4C", 
];

function App() {
  // ==========================================
  // 1. 상태 관리 (State)
  // ==========================================
  const [activeTab, setActiveTab] = useState("main"); 
  const [walletAddress, setWalletAddress] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  
  // 회원 목록
  const [users, setUsers] = useState([]);

  // 데이터 상태
  const [proposals, setProposals] = useState([]);
  const [galleryItems, setGalleryItems] = useState([]);
  
  // 상세 보기 모달 상태
  const [selectedProposal, setSelectedProposal] = useState(null); 
  const [voteAmount, setVoteAmount] = useState(""); // 투표할 수량 입력

  const closeModal = () => {
    setSelectedProposal(null);
    setVoteAmount("");
  };

  // 마이페이지 데이터
  const [myInfo, setMyInfo] = useState({ 
    balance: 0, membership: "", rewards: 0, delegation: {},
    activity: [], badge: "", referral: {}, myProposals: [], recommendation: null
  });
  
  // AI 스튜디오 상태
  const [studioData, setStudioData] = useState({ intent: "", draft: "", image: "", similarity: "" });
  const [isLoading, setIsLoading] = useState(false);

  // A2A 채팅 상태
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([
    { sender: "bot", text: "안녕하세요! AI 큐레이터입니다. 취향에 맞는 작품을 추천해드릴까요?" }
  ]);

  // 안건 작성 폼 (기간, 정족수 추가됨)
  const [proposalForm, setProposalForm] = useState({ 
    title: "", description: "", style: "General", image_url: "", meta_hash: "",
    voteType: 0, // 0: Weighted, 1: Quadratic
    duration: 3, // 기본 3일
    quorum: 10   // 기본 10표
  });

  // 에이전트 센터 상태
  const [agentInput, setAgentInput] = useState({
    criticArtInfo: "", marketerTitle: "", marketerTarget: "", auctionArtInfo: "", auctionReview: ""
  });
  const [agentResult, setAgentResult] = useState({ critic: "", marketer: "", auction: "" });

  // 스마트 컨트랙트 객체
  const [contract, setContract] = useState(null);

  // ==========================================
  // 2. 초기화 및 지갑 연동
  // ==========================================
  
  useEffect(() => {
    const storedAddress = localStorage.getItem("walletAddress");
    
    if (storedAddress) {
      setWalletAddress(storedAddress);
      setIsLoggedIn(true);

      if (window.ethereum) {
        const restoreContract = async () => {
          try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const daoContract = new ethers.Contract(CONTRACT_ADDRESS, ArtPlanningDAO.abi, signer);
            setContract(daoContract); 
            console.log("♻️ 스마트 컨트랙트 재연결 완료!");
          } catch (err) {
            console.error("재연결 실패:", err);
          }
        };
        restoreContract();
      }
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn && walletAddress) {
      fetchMyPageData();
    }
    fetchProposals(); 
    fetchGallery();   
  }, [isLoggedIn, walletAddress]);

  const connectWallet = async () => {
    if (!window.ethereum) return alert("메타마스크를 설치해주세요!");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
    
      const daoContract = new ethers.Contract(CONTRACT_ADDRESS, ArtPlanningDAO.abi, signer);
      setContract(daoContract); 
      console.log("블록체인 계약 연결 완료:", daoContract);
      
      await axios.post(`${API_URL}/api/auth/wallet-login`, { wallet_address: address, signature: "dummy_sig" });
      
      localStorage.setItem("walletAddress", address); 
      setWalletAddress(address);
      setIsLoggedIn(true);
      alert("지갑 연결 및 로그인 성공!");
    } catch (err) { alert("지갑 연결 실패"); console.error(err); }
  };
  
  const handleLogout = async () => {
    try {
      if (walletAddress) {
        await axios.post(`${API_URL}/api/auth/logout`, null, { params: { wallet_address: walletAddress } });
      }
    } catch (err) { console.error("Logout error", err); } 
    finally {
      localStorage.removeItem("walletAddress");
      setWalletAddress("");
      setIsLoggedIn(false);
      setMyInfo({ balance: 0, membership: "", rewards: 0, delegation: {}, activity: [], badge: "", referral: {}, myProposals: [], recommendation: null });
      setActiveTab("main");
      alert("로그아웃 되었습니다.");
    }
  };

  // ==========================================
  // 3. 데이터 조회 및 액션 함수
  // ==========================================
  
  // ✅ [수정 완료] 모든 데이터를 '번호(Index)'로 강제 매핑
  const fetchProposals = async (status = null) => {
    try {
      const params = status ? { status } : {};
      const res = await axios.get(`${API_URL}/api/proposals`, { params });
      let dbProposals = res.data;

      if (contract) {
        try {
            const chainProposals = await contract.getAllProposals();
            console.log("🔥 블록체인 원본 데이터:", chainProposals);

            dbProposals = dbProposals.map(p => {
                // DB ID(1부터) -> Chain ID(0부터) 매칭
                const chainP = chainProposals[Number(p.id) - 1];
                
                if (chainP) {
                    // 🚨 Ethers.js가 이름을 못 찾을 땐 무조건 '순서'로 꺼내야 합니다.
                    // Struct 구조: 
                    // [0]id, [1]title, [2]desc, [3]img, 
                    // [4]voteCount, [5]againstCount, [6]proposer, 
                    // [7]status, [8]voteType, [9]deadline, [10]quorum
                    
                    return {
                        ...p,
                        // ✅ 투표 수도 번호로 지정 (4번, 5번)
                        voteCount: parseFloat(ethers.formatUnits(chainP[4], 18)),     
                        againstCount: parseFloat(ethers.formatUnits(chainP[5], 18)),  
                        
                        // ✅ 마감일과 정족수도 번호로 지정 (9번, 10번)
                        deadline: Number(chainP[9]),   
                        quorum: parseFloat(ethers.formatUnits(chainP[10], 18))       
                    };
                }
                return p;
            });
        } catch (e) {
            console.error("블록체인 데이터 동기화 실패:", e);
        }
      }
      setProposals(dbProposals);
    } catch (err) { console.error(err); }
  };
  
  const fetchMyPageData = async () => {
    if (!walletAddress) return;
    try {
      const [resBal, resMem, resRew, resDel, resAct, resRef, resMyProp, resRec] = await Promise.all([
        axios.get(`${API_URL}/api/wallet/balance`, { params: { wallet_address: walletAddress } }),
        axios.get(`${API_URL}/api/user/membership`, { params: { wallet_address: walletAddress } }),
        axios.get(`${API_URL}/api/wallet/rewards`, { params: { wallet_address: walletAddress } }),
        axios.get(`${API_URL}/api/dao/delegation`, { params: { wallet_address: walletAddress } }),
        axios.get(`${API_URL}/api/user/activity`, { params: { wallet_address: walletAddress } }),
        axios.get(`${API_URL}/api/user/referral`, { params: { wallet_address: walletAddress } }),
        axios.get(`${API_URL}/api/user/proposals`, { params: { wallet_address: walletAddress } }),
        axios.get(`${API_URL}/api/user/recommend`, { params: { wallet_address: walletAddress } }).catch(() => ({ data: null }))
      ]);
      setMyInfo({
        balance: resBal.data.balance,
        membership: resMem.data.grade,
        rewards: resRew.data.pending_amount,
        delegation: resDel.data,
        activity: resAct.data,
        referral: resRef.data,
        myProposals: resMyProp.data,
        recommendation: resRec ? resRec.data : null
      });
    } catch (err) { console.error("내 정보 로드 실패", err); }
  };

  const fetchGallery = async () => {
    const res = await axios.get(`${API_URL}/api/gallery/items`);
    setGalleryItems(res.data);
  };

  const handleBadgeUpdate = async () => {
    try {
        const res = await axios.patch(`${API_URL}/api/user/badge`, null, { params: { wallet_address: walletAddress } });
        alert(`뱃지 상태 업데이트: ${res.data.status}`);
        fetchMyPageData();
    } catch (err) { alert("뱃지 업데이트 실패"); }
  };

// 1. AI 스튜디오 이미지 생성 (빠른 로딩 & 임시 저장)
  const handleGenerateWithIPFS = async () => {
    setIsLoading(true);
    try {
        const res = await axios.post(`${API_URL}/api/studio/generate_hybrid`, {
            prompt: studioData.intent,
            wallet_address: walletAddress
        });

        if (res.data.status === "success") {
            setStudioData(prev => ({
                ...prev,
                image: res.data.image_url,  // 빠른 렌더링을 위한 원본 URL
                meta_cid: "" // 👈 나중에 제출할 때 채움
            }));
            // ✅ 알림창 변경 완료!
            alert("🎨 포스터 이미지가 생성되었습니다! (영구 저장은 안건 제출 시 진행됩니다)"); 
        }
    } catch (err) {
        alert("생성 실패");
        console.error(err);
    }
    setIsLoading(false);
  };

  // 2. 안건 작성 탭으로 이동
  const sendToProposalWrite = () => {
    setProposalForm({
        title: studioData.intent || "AI 기획 안건",
        description: studioData.draft || "",
        image_url: studioData.image || "", // 👈 엑박 안 뜨게 임시 이미지 전달
        style: "AI Generated",
        meta_hash: "", // 👈 가짜 해시 제거 (비워둠)
        voteType: 0,
        duration: 3,
        quorum: 10
    });
    setActiveTab("write");
  };
  
  const handleStudioAction = async (type) => {
    if (type === 'draft') {
        setIsLoading(true);
        try {
            const res = await axios.post(`${API_URL}/api/studio/draft`, { intent: studioData.intent });
            setStudioData(prev => ({ ...prev, draft: res.data.draft_text }));
        } catch (err) { 
            alert("기획서 생성 실패"); 
        }
        setIsLoading(false);
    } 
    else if (type === 'image') {
        await handleGenerateWithIPFS(); 
    }
  };

  // ✅ [수정 완료] 안건 제출 시 IPFS 영구 저장 후 블록체인 기록
  const submitProposal = async () => {
    if (!walletAddress) return alert("지갑이 연결되지 않았습니다.");
    if (!contract) return alert("스마트 컨트랙트 연결 중... 잠시 후 시도해주세요.");
    if (!proposalForm.title || !proposalForm.description) return alert("제목과 내용을 모두 입력해주세요.");

    setIsLoading(true);
    try {
        let finalMetaHash = proposalForm.meta_hash;
        let finalImageUrl = proposalForm.image_url;

        // 1. [IPFS 영구 저장] 이미지 주소가 임시 URL(pollinations)인 경우 백엔드에 IPFS 박제 요청
        if (proposalForm.image_url && proposalForm.image_url.includes("pollinations")) {
            alert("☁️ 이미지를 IPFS에 영구 저장 중입니다... (약 5~10초 소요)");
            const ipfsRes = await axios.post(`${API_URL}/api/ipfs/finalize`, {
                wallet_address: walletAddress,
                title: proposalForm.title,
                description: proposalForm.description,
                image_url: proposalForm.image_url,
                prompt: studioData.intent || proposalForm.title
            });

            if (ipfsRes.data.status !== "success") {
                setIsLoading(false);
                return alert("IPFS 저장 실패: " + ipfsRes.data.error);
            }
            finalMetaHash = ipfsRes.data.meta_cid;
            finalImageUrl = ipfsRes.data.image_ipfs_url;
            console.log("✅ IPFS 저장 완료:", finalMetaHash);
        }

        // 2. [블록체인 저장]
        alert("🦊 지갑에서 트랜잭션을 승인해주세요.");
        const quorumWei = ethers.parseUnits(proposalForm.quorum.toString(), 18);
        
        // 여기에 IPFS에서 받아온 진짜 CID(finalMetaHash)를 넣습니다!
        const tx = await contract.createProposal(
            proposalForm.title, 
            proposalForm.description, 
            finalImageUrl || "",
            proposalForm.voteType,
            proposalForm.duration, 
            quorumWei
        );
    
        alert("⛓️ 블록체인에 기록 중입니다... (약 10~20초 소요)");
        const receipt = await tx.wait(); 
        
        // 3. [DB 저장]
        await axios.post(`${API_URL}/api/proposals`, { 
            wallet_address: walletAddress, 
            ...proposalForm,
            image_url: finalImageUrl,
            meta_hash: finalMetaHash // DB에도 진짜 CID 저장
        });

        alert("✅ 안건 등록 완료! (IPFS + Blockchain + DB)");
        setActiveTab("proposals");
        fetchProposals();

    } catch (err) {
        console.error(err);
        alert("등록 실패: " + (err.reason || err.message));
    }
    setIsLoading(false);
  };
  const deleteProposal = async (id, e) => {
    e.stopPropagation(); 
    if (!window.confirm("정말 삭제하시겠습니까?")) return;
    try {
        await axios.delete(`${API_URL}/api/proposals/${id}`);
        alert("🗑️ 삭제되었습니다.");
        fetchProposals(); 
        setSelectedProposal(null);
    } catch (err) { alert("삭제 실패"); }
  };
  
  const fetchUsers = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/user/list`);
      setUsers(res.data);
    } catch (err) { console.error("회원 목록 로드 실패:", err); }
  };

  const handleDelegate = async (targetAddress) => {
    if (!contract) return alert("컨트랙트 확인 필요");
    try {
      const tx = await contract.delegate(targetAddress);
      await tx.wait();
      await axios.post(`${API_URL}/api/dao/delegate`, { from_address: walletAddress, to_address: targetAddress });
      alert("✅ 위임 완료!");
      fetchMyPageData(); 
    } catch (err) { alert("위임 오류"); }
  };
  
  const sendMessage = async () => {
    if (!chatInput.trim()) return;
    const userMsg = { sender: "user", text: chatInput };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    try {
      const res = await axios.post(`${API_URL}/api/a2a/chat`, null, { params: { message: userMsg.text, wallet_address: walletAddress } });
      setChatMessages(prev => [...prev, { sender: "bot", text: res.data.reply }]);
    } catch (err) {
      setChatMessages(prev => [...prev, { sender: "bot", text: "오류가 발생했습니다." }]);
    }
  };
  
  // ✅ [수정] 투표 함수 (ID 보정 및 백틱 수정 완료)
  const handleVote = async (proposalId, support) => {
    if (!contract || !walletAddress) return alert("지갑 연결이 필요합니다.");
  
    const amountToUse = parseFloat(voteAmount);
    if (!amountToUse || amountToUse <= 0) return alert("수량을 입력해 주세요.");
    if (amountToUse > parseFloat(myInfo.balance)) return alert("잔액이 부족합니다.");

    try {
      alert("지갑에서 트랜잭션을 승인해주세요...");

      const tokenAmountWei = ethers.parseUnits(amountToUse.toString(), 18);
      // DB ID(1부터 시작) -> Chain ID(0부터 시작) 보정
      const blockchainId = Number(proposalId) - 1; 

      console.log(`투표 요청: DB ID=${proposalId} -> Blockchain ID=${blockchainId}`);

      const tx = await contract.vote(blockchainId, support, tokenAmountWei);
      alert("투표 처리 중... (블록체인 승인 대기)");
      await tx.wait();

      alert("✅ 투표 성공!");
      setVoteAmount(""); 
      fetchProposals(); 
      closeModal();
    } catch (err) {
      console.error("투표 실패:", err);
      if(err.message && err.message.includes("Insufficient token balance")) {
          alert("오류: 지갑 잔액 부족");
      } else if(err.message && err.message.includes("Voting period has expired")) {
          alert("오류: 투표 기간이 종료되었습니다.");
      } else {
          alert("투표 중 오류가 발생했습니다.");
      }
    }
  };

  const playDocent = async (id, title) => {
    try {
        const res = await axios.post(`${API_URL}/api/gallery/docent`, null, { params: { item_id: id } });
        const script = res.data.text_script;
        alert(`🎧 도슨트 시작: "${script}"`);
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel(); 
            const utterance = new SpeechSynthesisUtterance(script);
            utterance.lang = 'ko-KR'; 
            window.speechSynthesis.speak(utterance);
        }
    } catch(err) { alert("도슨트 실패"); }
  };

  const sendFeedback = async (id) => {
      const msg = prompt("관람평을 남겨주세요:");
      if(msg) {
        await axios.post(`${API_URL}/api/gallery/feedback`, null, { params: { item_id: id, content: msg, wallet_address: walletAddress } });
        alert("감사합니다!");
      }
  };

  const runCritic = async () => {
    if (!agentInput.criticArtInfo) return alert("입력 필요");
    setIsLoading(true);
    try {
      const res = await axios.post(`${API_URL}/api/agent/review`, { art_info: agentInput.criticArtInfo });
      setAgentResult(prev => ({ ...prev, critic: res.data.review_text }));
    } catch (err) { alert("실패"); }
    setIsLoading(false);
  };
  const runMarketer = async () => {
    if (!agentInput.marketerTitle) return alert("입력 필요");
    setIsLoading(true);
    try {
      const res = await axios.post(`${API_URL}/api/agent/promote`, { exhibition_title: agentInput.marketerTitle, target_audience: agentInput.marketerTarget });
      setAgentResult(prev => ({ ...prev, marketer: res.data.promo_text }));
    } catch (err) { alert("실패"); }
    setIsLoading(false);
  };
  const runAuction = async () => {
    if (!agentInput.auctionArtInfo) return alert("입력 필요");
    setIsLoading(true);
    try {
      const res = await axios.post(`${API_URL}/api/agent/auction`, { art_info: agentInput.auctionArtInfo, critic_review: agentInput.auctionReview });
      setAgentResult(prev => ({ ...prev, auction: res.data.auction_report }));
    } catch (err) { alert("실패"); }
    setIsLoading(false);
  };

  // ==========================================
  // 5. UI 렌더링
  // ==========================================
  return (
    <div className="App">
      <aside className="sidebar">
        <h1 className="logo">🎨 ArtDAO</h1>
        <div className="user-status">
            {isLoggedIn ? (
                <div className="logged-in-box">
                  <div className="badge-connected">🟢 {walletAddress.substring(0, 6)}...</div>
                  <button className="logout-btn" onClick={handleLogout}>로그아웃</button>
                </div>
            ) : (
                <button className="connect-btn" onClick={connectWallet}>🦊 Connect Wallet</button>
            )}
        </div>
        <nav>
          <button className={activeTab==="main"?"active":""} onClick={()=>setActiveTab("main")}>🏠 메인 (Hub)</button>
          <button className={activeTab==="proposals"?"active":""} onClick={()=>setActiveTab("proposals")}>🗳️ 안건 목록</button>
          <button className={activeTab==="delegates"?"active":""} onClick={()=>setActiveTab("delegates")}>🤝 위임하기 (Delegates)</button>
          <button className={activeTab==="studio"?"active":""} onClick={()=>setActiveTab("studio")}>🎨 AI 스튜디오</button>
          <button className={activeTab==="agents"?"active":""} onClick={()=>setActiveTab("agents")}>💼 AI 에이전트 센터</button>
          <button className={activeTab==="gallery"?"active":""} onClick={()=>setActiveTab("gallery")}>🖼️ 온라인 전시관</button>
          <button className={activeTab==="chat"?"active":""} onClick={()=>setActiveTab("chat")}>🤖 AI 큐레이터</button>
          <button className={activeTab==="mypage"?"active":""} onClick={()=>setActiveTab("mypage")}>👤 마이페이지</button>
        </nav>
      </aside>

      <main className="main-content">
        {activeTab === "main" && (
          <div className="page fade-in">
            <h2>🔥 Dashboard Summary</h2>
            <div className="dashboard-grid">
                <div className="card summary" onClick={()=>setActiveTab("proposals")}>
                    <h3>진행 중인 안건</h3>
                    <p className="highlight">{proposals.filter(p=>p.status==="OPEN").length} 건</p>
                    <span>바로가기 &rarr;</span>
                </div>
                <div className="card summary" onClick={()=>setActiveTab("gallery")}>
                    <h3>전시 작품</h3>
                    <p className="highlight">{galleryItems.length} 점</p>
                    <span>관람하기 &rarr;</span>
                </div>
                {isLoggedIn && (
                <div className="card summary" onClick={()=>setActiveTab("mypage")}>
                    <h3>내 토큰 잔액</h3>
                    <p className="highlight">{myInfo.balance} ART</p>
                    <span>관리하기 &rarr;</span>
                </div>
                )}
            </div>
          </div>
        )}

        {/* ✅ 안건 목록 */}
        {activeTab === "proposals" && (
          <div className="page fade-in">
            <div className="page-header">
                <h2>🗳️ Governance Proposals</h2>
                <div className="filters">
                    <button onClick={()=>fetchProposals("OPEN")}>🔵 진행중</button>
                    <button onClick={()=>fetchProposals(null)}>⚪ 전체</button>
                </div>
            </div>
            
            <div className="list">
                {proposals.map(p => (
                    <div key={p.id} className="card proposal-item clickable" onClick={() => setSelectedProposal(p)}>
                        <div className="p-left">
                            <span className={`status-badge ${p.status}`}>{p.status}</span>
                            <h3>{p.title}</h3>
                            <p className="preview-text">{p.description ? p.description.substring(0, 100) + "..." : "내용 없음"}</p>
                            <span className="read-more">👉 자세히 보기</span>
                        </div>
                        <div className="p-right">
                            {p.image_url && <img src={p.image_url} alt="art" className="thumb"/>}
                            {isLoggedIn && ADMIN_WALLETS.map(w => w.toLowerCase()).includes(walletAddress.toLowerCase()) && (
                                <button className="delete-icon-btn" onClick={(e) => deleteProposal(p.id, e)}>🗑️</button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            <button className="floating-btn" onClick={()=>{
                setProposalForm({ title: "", description: "", style: "General", image_url: "", meta_hash: "", voteType: 0, duration: 3, quorum: 10 });
                setActiveTab("write");
            }}>
                <span>+</span> 새 안건 작성
            </button>
          </div>
        )}

        {/* ✅ 상세 보기 모달 */}
        {selectedProposal && (
            <div className="modal-overlay" onClick={() => setSelectedProposal(null)}>
                <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                    <button className="close-btn" onClick={() => setSelectedProposal(null)}>✖</button>
                    
                    {/* 모달 헤더 (게이지 + 마감일 + 정족수 표시) */}
                    <div className="modal-header">
                        <div style={{ background: "#f0f9ff", padding: "10px", borderRadius: "8px", marginBottom: "15px", border: "1px solid #bae6fd", fontSize: "0.9em", color: "#0369a1" }}>
                            <strong>🔗 Blockchain Verified</strong>
                            <div style={{ marginTop: "4px", fontFamily: "monospace", wordBreak: "break-all" }}>
                                Tx Hash: {selectedProposal.meta_hash || "처리 중..."}
                            </div>
                        </div>
                        
                        <span className={`status-badge ${selectedProposal.status}`}>{selectedProposal.status}</span>
                        <h2>{selectedProposal.title}</h2>
                        
                        {/* 📅 마감일 & 정족수 표시 */}
			<div style={{ fontSize: "0.9rem", color: "#666", marginTop: "10px" }}>
    			    📅 마감: {selectedProposal.deadline && selectedProposal.deadline > 0 
			        ? new Date(selectedProposal.deadline * 1000).toLocaleString() 
			        : "데이터 로딩 중..."} | 
    			    🎯 목표: {selectedProposal.quorum || 0}표
			</div>
                        {/* 📊 투표 현황 게이지 바 */}
                        <div className="vote-gauge-container" style={{ marginTop: "15px", background: "#eee", borderRadius: "10px", overflow: "hidden", height: "25px", position: "relative" }}>
                            {/* 찬성 바 (파란색) */}
                            <div style={{
                                width: `${(selectedProposal.voteCount / (selectedProposal.voteCount + selectedProposal.againstCount || 1)) * 100}%`,
                                background: "#3b82f6",
                                height: "100%",
                                float: "left",
                                transition: "width 0.5s"
                            }}></div>
                            {/* 반대 바 (빨간색) */}
                            <div style={{
                                width: `${(selectedProposal.againstCount / (selectedProposal.voteCount + selectedProposal.againstCount || 1)) * 100}%`,
                                background: "#ef4444",
                                height: "100%",
                                float: "left",
                                transition: "width 0.5s"
                            }}></div>
                        </div>
                        
                        {/* 텍스트 정보 */}
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "5px", fontSize: "0.9rem", fontWeight: "bold" }}>
                            <span style={{ color: "#3b82f6" }}>👍 찬성: {selectedProposal.voteCount ? selectedProposal.voteCount.toFixed(2) : 0}표</span>
                            <span style={{ color: "#ef4444" }}>👎 반대: {selectedProposal.againstCount ? selectedProposal.againstCount.toFixed(2) : 0}표</span>
                        </div>

                        <p className="meta" style={{marginTop: "15px"}}>작성자: {selectedProposal.wallet_address}</p>
                    </div>

                    <div className="modal-body">
                        {selectedProposal.image_url && (
                            <div className="modal-image-section">
                                <img src={selectedProposal.image_url} alt="Proposal Art" />
                                <a href={selectedProposal.image_url} target="_blank" rel="noreferrer" className="download-link">원본 이미지 보기</a>
                            </div>
                        )}
                        <div className="modal-text-section">
                            <h3>📜 기획서 상세</h3>
                            <div className="markdown-content">{selectedProposal.description}</div>
                        </div>
                    </div>
                    
                    <div className="modal-footer" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                        <div className="vote-input-box" style={{ marginBottom: '15px', padding: '15px', background: '#f8fafc', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <label style={{ fontWeight: 'bold' }}>투표할 토큰 수량 (TUK)</label>
                                <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>보유: {myInfo.balance} TUK</span>
                            </div>
                            <input 
                                type="number" 
                                value={voteAmount} 
                                onChange={(e) => setVoteAmount(e.target.value)}
                                placeholder="사용할 토큰 수량을 입력하세요"
                                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #d1d5db' }}
                            />
                            <div style={{ marginTop: '8px', fontSize: '0.9rem', color: '#3b82f6', fontWeight: 'bold' }}>
                                예상 행사 표수: {
                                    voteAmount > 0 
                                    ? (selectedProposal.voteType === 1 ? Math.sqrt(voteAmount).toFixed(2) : voteAmount) 
                                    : 0
                                } 표
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                            <button className="vote-btn yes" onClick={() => handleVote(selectedProposal.id, true)}>👍 찬성 투표</button>
                            <button className="vote-btn no" onClick={() => handleVote(selectedProposal.id, false)}>👎 반대 투표</button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* 안건 작성 */}
        {activeTab === "write" && (
            <div className="page fade-in">
                <h2>📝 Create Proposal</h2>
                <div className="card form-card">
                    <label>안건 제목 (Title)</label>
                    <input type="text" value={proposalForm.title} onChange={(e)=>setProposalForm({...proposalForm, title: e.target.value})} placeholder="제목 입력"/>
            
                    <label>상세 내용</label>
                    <textarea rows="5" value={proposalForm.description} onChange={(e)=>setProposalForm({...proposalForm, description: e.target.value})} placeholder="내용 입력"/>
            
                    <label>스타일 (Style)</label>
                    <select value={proposalForm.style} onChange={(e)=>setProposalForm({...proposalForm, style: e.target.value})}>
                        <option value="General">General</option>
                        <option value="Cyberpunk">Cyberpunk</option>
                        <option value="Abstract">Abstract</option>
                        <option value="Realistic">Realistic</option>
                    </select>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '20px' }}>
                        투표 방식 설정
                    </label>
                    <select
                        value={proposalForm.voteType}
                        onChange={(e) => setProposalForm({...proposalForm, voteType: parseInt(e.target.value)})}
                    >
                        <option value={0}>가중치 투표 (Weighted)</option>
                        <option value={1}>제곱근 투표 (Quadratic)</option>
                    </select>

                    {/* ✅ [추가] 기간 및 정족수 입력 */}
                    <div style={{ display: "flex", gap: "20px", marginTop: "15px" }}>
                        <div style={{ flex: 1 }}>
                            <label>투표 기간 (일)</label>
                            <input 
                                type="number" 
                                value={proposalForm.duration} 
                                onChange={(e) => setProposalForm({...proposalForm, duration: e.target.value})} 
                                placeholder="예: 3일" 
                            />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label>목표 정족수 (Quorum)</label>
                            <input 
                                type="number" 
                                value={proposalForm.quorum} 
                                onChange={(e) => setProposalForm({...proposalForm, quorum: e.target.value})} 
                                placeholder="예: 100표" 
                            />
                        </div>
                    </div>

                    {proposalForm.image_url && (
                        <div className="img-preview">
                            <p>첨부된 이미지:</p>
                            <img src={proposalForm.image_url} alt="attached" />
                        </div>
                    )}
            
                    <div className="btn-group">
                        <button className="cancel" onClick={()=>setActiveTab("proposals")}>취소</button>
                        <button className="primary" onClick={submitProposal}>제출하기</button>
                    </div>
                </div>
            </div>
        )}

        {/* AI 스튜디오, 에이전트 등 나머지 탭은 기존과 동일... (아래 생략하지 않고 모두 포함) */}
        {activeTab === "studio" && (
            <div className="page fade-in">
                <h2>🎨 AI Art Studio</h2>
                <div className="studio-layout">
                    <div className="card studio-input">
                        <h3>1. 기획 의도 입력</h3>
                        <input type="text" placeholder="예: 우울한 사이버펑크 도시" value={studioData.intent} onChange={(e)=>setStudioData({...studioData, intent: e.target.value})}/>
                        <div className="studio-btns">
                            <button onClick={()=>handleStudioAction('draft')} disabled={isLoading}>📜 기획서 생성</button>
                        </div>
                    </div>
                    <div className="card studio-result">
                        <h3>2. 결과물 확인</h3>
                        {studioData.draft && (
                            <>
                                <textarea value={studioData.draft} readOnly />
                                <button className="action-btn" onClick={()=>handleStudioAction('image')} disabled={isLoading}>
                                    {isLoading ? "생성 중..." : "🎨 포스터 이미지 생성"}
                                </button>
                            </>
                        )}
                        {studioData.image && (
                            <div className="final-result">
                                <img src={studioData.image} alt="Generated" />
                               <button className="primary full-width" onClick={sendToProposalWrite}>👉 안건 작성 페이지로 이동해서 적용하기 (기간/정족수 설정)</button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}

        {activeTab === "agents" && (
            <div className="page fade-in">
                <h2>💼 AI Agent Squad (전문가 팀)</h2>
                <div className="agent-grid">
                    <div className="card agent-card">
                        <div className="agent-header"><span className="icon">🧐</span><h3>Art Critic (비평가)</h3></div>
                        <p className="role-desc">작품을 분석하여 심도 있는 비평문을 작성합니다.</p>
                        <div className="input-group">
                            <label>작품 정보</label>
                            <textarea placeholder="예: 사이버펑크 스타일..." value={agentInput.criticArtInfo} onChange={(e) => setAgentInput({...agentInput, criticArtInfo: e.target.value})}/>
                        </div>
                        <button className="primary full-width" onClick={runCritic} disabled={isLoading}>{isLoading ? "분석 중..." : "비평 작성 요청"}</button>
                        {agentResult.critic && (
                            <div className="result-box">
                                <h4>📜 비평문</h4><p>{agentResult.critic}</p>
                                <button className="sm-btn" onClick={() => setAgentInput({...agentInput, auctionReview: agentResult.critic})}>👉 경매사에게 전달</button>
                            </div>
                        )}
                    </div>
                    <div className="card agent-card">
                        <div className="agent-header"><span className="icon">📢</span><h3>Viral Marketer (마케터)</h3></div>
                        <p className="role-desc">전시회 홍보를 위한 SNS 바이럴 카피를 작성합니다.</p>
                        <div className="input-group">
                            <label>전시회 제목</label>
                            <input type="text" placeholder="예: 2050 서울의 밤" value={agentInput.marketerTitle} onChange={(e) => setAgentInput({...agentInput, marketerTitle: e.target.value})}/>
                            <label>타겟 관객</label>
                            <input type="text" placeholder="예: 20대 힙스터" value={agentInput.marketerTarget} onChange={(e) => setAgentInput({...agentInput, marketerTarget: e.target.value})}/>
                        </div>
                        <button className="primary full-width" onClick={runMarketer} disabled={isLoading}>{isLoading ? "생성 중..." : "홍보 문구 생성"}</button>
                        {agentResult.marketer && <div className="result-box"><h4>📱 인스타그램 카피</h4><p style={{whiteSpace: "pre-line"}}>{agentResult.marketer}</p></div>}
                    </div>
                    <div className="card agent-card">
                        <div className="agent-header"><span className="icon">🔨</span><h3>Auctioneer (경매사)</h3></div>
                        <p className="role-desc">비평을 바탕으로 경매 시작가를 책정하고 오프닝 멘트를 합니다.</p>
                        <div className="input-group">
                            <label>작품 정보</label>
                            <input type="text" placeholder="작품 설명 입력" value={agentInput.auctionArtInfo} onChange={(e) => setAgentInput({...agentInput, auctionArtInfo: e.target.value})}/>
                            <label>비평가 리뷰</label>
                            <textarea placeholder="비평가가 쓴 글을 입력하세요" value={agentInput.auctionReview} onChange={(e) => setAgentInput({...agentInput, auctionReview: e.target.value})}/>
                        </div>
                        <button className="primary full-width" onClick={runAuction} disabled={isLoading}>{isLoading ? "산정 중..." : "경매 리포트 생성"}</button>
                        {agentResult.auction && <div className="result-box"><h4>💰 경매 리포트</h4><p style={{whiteSpace: "pre-line"}}>{agentResult.auction}</p></div>}
                    </div>
                </div>
            </div>
        )}

        {activeTab === "gallery" && (
            <div className="page fade-in">
                <h2>🖼️ Online Gallery</h2>
                <div className="gallery-grid">
                    {galleryItems.map(item => (
                        <div key={item.id} className="gallery-card">
                            <div className="img-wrap">
                                <img src={item.image_url} alt={item.title}/>
                            </div>
                            <div className="info">
                                <h3>{item.title}</h3>
                                <p>Artist: {item.artist_address ? item.artist_address.substring(0,6) : "Unknown"}</p>
                                <div className="gallery-btns">
                                    <button onClick={()=>playDocent(item.id, item.title)}>🎧 도슨트 듣기</button>
                                    <button onClick={()=>sendFeedback(item.id)}>💬 방명록</button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {activeTab === "chat" && (
            <div className="page fade-in">
                <h2>🤖 AI Curator Chat</h2>
                <div className="chat-window">
                    <div className="messages">
                        {chatMessages.map((msg, idx) => (
                            <div key={idx} className={`msg ${msg.sender}`}>
                                <div className="bubble">{msg.text}</div>
                            </div>
                        ))}
                    </div>
                    <div className="chat-input">
                        <input type="text" value={chatInput} onChange={(e)=>setChatInput(e.target.value)} onKeyPress={(e)=>e.key==='Enter' && sendMessage()} placeholder="미술품 추천을 부탁해보세요..." />
                        <button onClick={sendMessage}>전송</button>
                    </div>
                </div>
            </div>
        )}

        {activeTab === "delegates" && (
          <div className="page fade-in">
            <div className="page-header">
              <h2>🤝 Delegate Your Vote</h2>
              <p>나를 대신해 투표권을 행사할 신뢰할 수 있는 대리인을 선택하세요.</p>
            </div>
            <div className="delegate-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px', marginTop: '20px' }}>
              {users.length > 0 ? users.map(user => (
                <div key={user.wallet_address} className="card user-card" style={{ padding: '20px', textAlign: 'center' }}>
                  <div style={{ fontSize: '40px', marginBottom: '10px' }}>👤</div>
                  <h3 style={{ fontSize: '1rem' }}>{user.wallet_address.substring(0, 6)}...</h3>
                  <p style={{ color: '#666', fontSize: '0.85em', marginBottom: '15px' }}>{user.membership_grade} Member</p>
                  <div className="user-stats" style={{ display: 'flex', justifyContent: 'space-around', margin: '15px 0', padding: '10px 0', borderTop: '1px solid #eee', borderBottom: '1px solid #eee', fontSize: '0.9em' }}>
                    <div style={{ flex: 1 }}><strong>잔액</strong><br/>{user.token_balance} TUK</div>
                    <div style={{ flex: 1 }}><strong>활동</strong><br/>{user.activity_count}회</div>
                  </div>
                  <button 
                    className="primary-btn full-width"
                    disabled={user.wallet_address.toLowerCase() === walletAddress.toLowerCase()}
                    onClick={() => handleDelegate(user.wallet_address)}
                    style={{ 
                        width: '100%', padding: '10px', borderRadius: '8px', 
                        cursor: user.wallet_address.toLowerCase() === walletAddress.toLowerCase() ? 'not-allowed' : 'pointer',
                        backgroundColor: user.wallet_address.toLowerCase() === walletAddress.toLowerCase() ? '#ccc' : ''
                    }}
                  >
                    {user.wallet_address.toLowerCase() === walletAddress.toLowerCase() ? "본인 (위임 불가)" : "투표권 위임하기"}
                  </button>
                </div>
              )) : (
                <div className="card" style={{ gridColumn: '1/-1', padding: '40px' }}>
                  <p>불러올 회원 정보가 없습니다.</p>
                </div>
              )}
            </div>
          </div>
        )}
        
        {activeTab === "mypage" && (
            <div className="page fade-in">
                <h2>👤 My Page</h2>
                {!isLoggedIn ? <p>지갑을 먼저 연결해주세요.</p> : (
                    <div className="mypage-grid">
                        <div className="card profile">
                            <h3>내 정보</h3>
                            <p><strong>주소:</strong> {walletAddress}</p>
                            <p><strong>등급:</strong> <span className="gold-text">{myInfo.membership}</span></p>
                            <p><strong>보유 토큰:</strong> {myInfo.balance} ART</p>
                        </div>
                        <div className="card recommend">
                            <h3>🎯 전시 추천</h3>
                            {myInfo.recommendation ? (
                                <div><p><strong>{myInfo.recommendation.title || "추천 전시"}</strong></p><p className="desc">{myInfo.recommendation.reason || "회원님의 활동을 바탕으로 선정된 전시입니다."}</p></div>
                            ) : <p>분석 중입니다...</p>}
                        </div>
                        <div className="card badge-section">
                            <h3>🏅 뱃지</h3>
                            <p>상태: <strong>{myInfo.badge || "심사 중"}</strong></p>
                            <button className="primary-btn sm" onClick={handleBadgeUpdate}>갱신/신청</button>
                        </div>
                        <div className="card rewards">
                            <h3>💰 보상</h3>
                            <p>미수령: <strong>{myInfo.rewards} ART</strong></p>
                            <button className="primary-btn sm">수령</button>
                        </div>
                        <div className="card delegation">
                            <h3>🤝 위임</h3>
                            <p>대상: {myInfo.delegation.delegated_to || "없음"}</p>
                            <p>수량: {myInfo.delegation.amount || 0} Vote</p>
                        </div>
                        <div className="card history">
                            <h3>📅 활동 내역</h3>
                            <ul>{myInfo.activity.map((act, i) => <li key={i}>{act.date}: {act.type}</li>)}</ul>
                        </div>
                        <div className="card my-proposals">
                            <h3>📝 내 안건 ({myInfo.myProposals.length})</h3>
                            {myInfo.myProposals.map(p => <div key={p.id} className="mini-item">#{p.id} {p.title}</div>)}
                        </div>
                    </div>
                )}
            </div>
        )}
      </main>
    </div>
  );
}

export default App;
