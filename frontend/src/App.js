import React, { useState, useEffect, useRef } from 'react';
import axios from "axios";
import { ethers } from "ethers";
import "./App.css";

import { DAO_CONTRACT_ADDRESS as CONTRACT_ADDRESS, TUK_TOKEN_ADDRESS } from './contracts/address';
import ArtPlanningDAO from './contracts/ArtPlanningDAO.json';


const API_URL = "http://localhost:8000";

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
  
  const [users, setUsers] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [galleryItems, setGalleryItems] = useState([]);
  
  const [selectedProposal, setSelectedProposal] = useState(null); 
  const [voteAmount, setVoteAmount] = useState(""); 

  const closeModal = () => {
    setSelectedProposal(null);
    setVoteAmount("");
  };

  const [myInfo, setMyInfo] = useState({ 
    balance: 0, membership: "", rewards: 0, delegation: {},
    activity: [], badge: "", referral: {}, myProposals: [], recommendation: null
  });
  
  const [studioData, setStudioData] = useState({ intent: "", draft: "", image: "", similarity: "" });
  const [isLoading, setIsLoading] = useState(false);
  const [activeAgentLoading, setActiveAgentLoading] = useState(null); 
  const [isChatLoading, setIsChatLoading] = useState(false); 
  
  // 👇 이거 한 줄 추가! (스튜디오에서 어떤 사고를 하고 있는지 텍스트 저장)
  const [studioLoadingStep, setStudioLoadingStep] = useState("");

  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([
    { sender: "bot", text: "안녕하세요! AI 큐레이터입니다. 취향에 맞는 작품을 추천해드릴까요?" }
  ]);

  const [proposalForm, setProposalForm] = useState({ 
    title: "", description: "", style: "General", image_url: "", meta_hash: "",
    voteType: 0, 
    duration: 3, 
    quorum: 10,   
    fundingAmount: 100 
  });

  // ✅ 블록체인의 진짜 시간을 담는 상태 변수
  const [currentBlockTime, setCurrentBlockTime] = useState(Math.floor(Date.now() / 1000));

  const [agentInput, setAgentInput] = useState({
    criticArtInfo: "", marketerTitle: "", marketerTarget: "", auctionArtInfo: "", auctionReview: ""
  });
  const [agentResult, setAgentResult] = useState({ critic: "", marketer: "", auction: "" });

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
  }, [isLoggedIn, walletAddress, contract]);

  const connectWallet = async () => {
    if (!window.ethereum) return alert("메타마스크를 설치해주세요!");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
    
      const daoContract = new ethers.Contract(CONTRACT_ADDRESS, ArtPlanningDAO.abi, signer);
      setContract(daoContract); 
      
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
  
  const fetchProposals = async (status = null) => {
    try {
      const params = status ? { status } : {};
      const res = await axios.get(`${API_URL}/api/proposals`, { params });
      let dbProposals = res.data;

      if (contract) {
        try {
            // ✅ 블록체인에서 현재 시간 가져오기
            const blockNum = await contract.runner.provider.getBlockNumber();
            const block = await contract.runner.provider.getBlock(blockNum);
            const nowBlockTime = Number(block.timestamp);
            setCurrentBlockTime(nowBlockTime);

            const chainProposals = await contract.getAllProposals();
            const statusMap = ["OPEN", "ACCEPTED", "REJECTED", "EXECUTED"];

            dbProposals = dbProposals.map(p => {
                const chainP = chainProposals[Number(p.id) - 1];
                
                if (chainP) {
                    let currentStatus = statusMap[Number(chainP[7])];
                    const deadlineTime = Number(chainP[9]);

                    // ✅ [추가] OPEN 상태인데 마감일이 지났다면 프론트엔드에서 'CLOSED(결산 대기)'로 상태 덮어쓰기
                    if (currentStatus === "OPEN" && deadlineTime < nowBlockTime) {
                        currentStatus = "CLOSED";
                    }

                    return {
                        ...p,
                        voteCount: parseFloat(ethers.formatUnits(chainP[4], 18)),     
                        againstCount: parseFloat(ethers.formatUnits(chainP[5], 18)),  
                        status: currentStatus,
                        deadline: deadlineTime,   
                        quorum: parseFloat(ethers.formatUnits(chainP[10], 18)),
                        fundingAmount: parseFloat(ethers.formatUnits(chainP[11], 18))
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
    setStudioLoadingStep("🎨 AI 화가 에이전트가 프롬프트를 시각화 및 렌더링 중..."); // 👈 상태 메시지 설정
    try {
        const res = await axios.post(`${API_URL}/api/studio/generate_hybrid`, {
            prompt: studioData.intent,
            wallet_address: walletAddress
        });

        if (res.data.status === "success") {
            setStudioData(prev => ({
                ...prev,
                image: res.data.image_url,  
                meta_cid: "" 
            }));
            alert("🎨 포스터 이미지가 생성되었습니다! (영구 저장은 안건 제출 시 진행됩니다)"); 
        }
    } catch (err) { alert("생성 실패"); }
    setIsLoading(false);
    setStudioLoadingStep(""); // 초기화
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
        quorum: 10,
        fundingAmount: 100
    });
    setActiveTab("write");
  };
  
  const handleStudioAction = async (type) => {
    if (type === 'draft') {
        setIsLoading(true);
        setStudioLoadingStep("📜 기획자 에이전트가 데이터를 수집하여 기획서를 작성 중..."); // 👈 상태 메시지 설정
        try {
            const res = await axios.post(`${API_URL}/api/studio/draft`, { intent: studioData.intent });
            setStudioData(prev => ({ ...prev, draft: res.data.draft_text }));
        } catch (err) { 
            alert("기획서 생성 실패"); 
        }
        setIsLoading(false);
        setStudioLoadingStep(""); // 초기화
    } 
    else if (type === 'image') {
        await handleGenerateWithIPFS(); 
    }
  };
  // ✅ 안건 제출 (스마트 컨트랙트 등록 + IPFS 이미지 저장 + DB 저장)
    const submitProposal = async () => {
        if (!proposalForm.title || !proposalForm.description) {
            alert("제목과 내용을 모두 입력해주세요!");
            return;
        }
        if (!contract) {
            alert("스마트 컨트랙트에 연결되지 않았습니다.");
            return;
        }

const submitProposal = async () => {
    if (!walletAddress) return alert("지갑이 연결되지 않았습니다.");
    if (!contract) return alert("스마트 컨트랙트 연결 중... 잠시 후 시도해주세요.");
    if (!proposalForm.title || !proposalForm.description) {
      return alert("제목과 내용을 모두 입력해주세요.");
    }

    // ✅ 1. 기간 강제 숫자 변환 (트레저리 로직)
    const durationNum = parseInt(proposalForm.duration, 10);
    if (!durationNum || durationNum <= 0) return alert("투표 기간을 1일 이상으로 입력해주세요.");

    setIsLoading(true);
    let finalImageIpfsUrl = ""; // 최종 안건에 들어갈 IPFS 주소

    try {
        // ✅ 2. 엑박 방지용 IPFS 업로드 (AI 스튜디오 로직)
        if (proposalForm.image_url && proposalForm.image_url.startsWith('data:image')) {
            console.log("🚀 안전한 이미지를 IPFS로 전송 중...");
            const ipfsRes = await axios.post(`${API_URL}/api/ipfs/finalize`, {
                image_url: proposalForm.image_url
            });

            if (ipfsRes.data.status === "success") {
                finalImageIpfsUrl = ipfsRes.data.image_ipfs_url;
                console.log("✅ IPFS 이미지 저장 완벽 성공! 주소:", finalImageIpfsUrl);
            }
        }

        alert("지갑에서 트랜잭션을 승인해주세요...");
        
        // ✅ 3. 트레저리 로직을 포함한 변수 변환 (fundingWei 추가)
        const quorumWei = ethers.parseUnits(proposalForm.quorum.toString(), 18);
        const fundingWei = ethers.parseUnits(proposalForm.fundingAmount.toString(), 18);

        console.log("🚀 스마트 컨트랙트에 트랜잭션 전송 중...");
        // ✅ 4. 컨트랙트 전송 (7개 인자 완벽 세팅)
        const tx = await contract.createProposal(
            proposalForm.title, 
            proposalForm.description, 
            finalImageIpfsUrl || proposalForm.image_url || "", // IPFS 주소 우선 적용
            proposalForm.voteType,
            durationNum, // 숫자형
            quorumWei,
            fundingWei   // 펀딩 금액
        );
    
        alert("⛓️ 블록체인에 기록 중입니다... (약 10~20초 소요)");
        const receipt = await tx.wait(); 
        
        // ✅ 5. DB 저장 (두 브랜치의 핵심 융합)
        await axios.post(`${API_URL}/api/proposals`, { 
            wallet_address: walletAddress, 
            ...proposalForm,
            duration: durationNum, 
            image_url: finalImageIpfsUrl || proposalForm.image_url || "", // 폭발 방지 IPFS 주소
            meta_hash: tx.hash 
        });

        const shortHash = `${tx.hash.substring(0,6)}...${tx.hash.substring(tx.hash.length - 4)}`;
        alert(`🎉 안건이 성공적으로 등록되었습니다!\nTx Hash: ${shortHash}`);
        
        // 입력 폼 초기화 및 목록으로 이동
        setProposalForm({ title: "", description: "", style: "General", image_url: "", meta_hash: "", voteType: 0, duration: 3, quorum: 10, fundingAmount: 100 });
        setActiveTab("proposals");
        fetchProposals();

    } catch (err) {
        console.error(err);
        alert("등록 실패: " + (err.reason || err.message));
    } finally {
        setIsLoading(false);
    }
  };

        } catch (err) {
            console.error("🔥 안건 등록 실패:", err);
            alert("등록 실패: " + (err.reason || err.message));
        } finally {
            setIsLoading(false);
        }
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
    
    setIsChatLoading(true); // 🚀 [핵심] 여기서 로딩 애니메이션 스위치 ON!
    
    try {
      const res = await axios.post(`${API_URL}/api/a2a/chat`, null, { params: { message: userMsg.text, wallet_address: walletAddress } });
      setChatMessages(prev => [...prev, { sender: "bot", text: res.data.reply }]);
    } catch (err) {
      setChatMessages(prev => [...prev, { sender: "bot", text: "오류가 발생했습니다." }]);
    }
    
    setIsChatLoading(false); // 🚀 [핵심] 답변이 오면 로딩 애니메이션 스위치 OFF!
  };
  
  const handleVote = async (proposalId, support) => {
    if (!contract || !walletAddress) return alert("지갑 연결이 필요합니다.");
  
    const amountToUse = parseFloat(voteAmount);
    if (!amountToUse || amountToUse <= 0) return alert("수량을 입력해 주세요.");
    if (amountToUse > parseFloat(myInfo.balance)) return alert("잔액이 부족합니다.");

    try {
      alert("지갑에서 트랜잭션을 승인해주세요...");

      const tokenAmountWei = ethers.parseUnits(amountToUse.toString(), 18);
      const blockchainId = Number(proposalId) - 1; 

      const tx = await contract.vote(blockchainId, support, tokenAmountWei);
      alert("투표 처리 중... (블록체인 승인 대기)");
      await tx.wait();

      alert("✅ 투표 성공!");
      setVoteAmount(""); 
      fetchProposals(); 
      closeModal();
    } catch (err) {
      console.error("투표 실패:", err);
      if (err.message && err.message.includes("Already voted")){alert("오류: 이미 참여한 안건입니다.");}
      else if(err.message && err.message.includes("Insufficient token balance")) {
          alert("오류: 지갑 잔액 부족");
      } else if(err.message && err.message.includes("Voting period has expired")) {
          alert("오류: 투표 기간이 종료되었습니다.");
      } else {
          alert("투표 중 오류가 발생했습니다.");
      }
    }
  };

  const handleExecuteProposal = async (proposalId) => {
    if (!contract) return alert("컨트랙트 연결 확인 필요");
    try {
        alert("자금 집행 트랜잭션을 승인해주세요...");
        const blockchainId = Number(proposalId) - 1;
        const tx = await contract.executeProposal(blockchainId);
        
        alert("지급 처리 중입니다...");
        await tx.wait();
        
        alert("💰 자금 집행 완료! 작성자에게 토큰이 전송되었습니다.");
        fetchProposals();
        closeModal();
    } catch (err) {
        console.error("집행 실패:", err);
        alert("집행 실패: " + (err.reason || "트레저리 잔액 부족 등의 사유로 실패했습니다."));
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
    setActiveAgentLoading('critic'); // 비평가 로딩 켜기
    try {
      const res = await axios.post(`${API_URL}/api/agent/review`, { art_info: agentInput.criticArtInfo });
      setAgentResult(prev => ({ ...prev, critic: res.data.review_text }));
    } catch (err) { alert("실패"); }
    setActiveAgentLoading(null); // 로딩 끄기
  };

  const runMarketer = async () => {
    if (!agentInput.marketerTitle) return alert("입력 필요");
    setActiveAgentLoading('marketer'); // 마케터 로딩 켜기
    try {
      const res = await axios.post(`${API_URL}/api/agent/promote`, { exhibition_title: agentInput.marketerTitle, target_audience: agentInput.marketerTarget });
      setAgentResult(prev => ({ ...prev, marketer: res.data.promo_text }));
    } catch (err) { alert("실패"); }
    setActiveAgentLoading(null); // 로딩 끄기
  };

  const runAuction = async () => {
    if (!agentInput.auctionArtInfo) return alert("입력 필요");
    setActiveAgentLoading('auction'); // 경매사 로딩 켜기
    try {
      const res = await axios.post(`${API_URL}/api/agent/auction`, { art_info: agentInput.auctionArtInfo, critic_review: agentInput.auctionReview });
      setAgentResult(prev => ({ ...prev, auction: res.data.auction_report }));
    } catch (err) { alert("실패"); }
    setActiveAgentLoading(null); // 로딩 끄기
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

        {/* ✅ [신규] 사이드바 하단: 현재 블록체인 시간 및 동기화 버튼 표시 */}
        <div style={{ marginTop: "auto", padding: "20px" }}>
            <div style={{ padding: "12px", background: "#1e293b", color: "#94a3b8", borderRadius: "8px", fontSize: "0.85rem", textAlign: "center", border: "1px solid #334155" }}>
                <div style={{ marginBottom: "5px", fontWeight: "bold", color: "#cbd5e1" }}>🕒 현재 블록체인 시간</div>
                <strong style={{ color: "#38bdf8", fontSize: "0.95rem", display: "block", marginBottom: "10px" }}>
                    {new Date(currentBlockTime * 1000).toLocaleString()}
                </strong>
                <button 
                    onClick={() => fetchProposals()} 
                    style={{ width: "100%", padding: "8px", background: "#3b82f6", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "0.85rem", fontWeight: "bold" }}
                >
                    🔄 시간 동기화 (새로고침)
                </button>
            </div>
        </div>
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
                            {/* ✅ [수정] 목록에서 CLOSED(결산 대기) 상태일 때 회색 뱃지로 표시 */}
                            <span 
                                className={`status-badge ${p.status === 'CLOSED' ? 'REJECTED' : p.status}`} 
                                style={p.status === 'CLOSED' ? {backgroundColor: '#6b7280', color: 'white'} : {}}
                            >
                                {p.status === "CLOSED" ? "CLOSED (결산 대기)" : p.status}
                            </span>
                            <h3>{p.title}</h3>
                            <p className="preview-text">{p.description ? p.description.substring(0, 100) + "..." : "내용 없음"}</p>
                            <span className="read-more">👉 자세히 보기</span>
                        </div>
                        <div className="p-right">
                            {/* 🚨 목록에서는 무거운 이미지 대신 '첨부 아이콘'만 표시하여 로딩 속도 최적화 */}
                            {p.image_url && (
                                <div style={{ padding: '10px 15px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', color: '#64748b', fontSize: '0.85rem', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'center', justifyContent: 'center', height: '80px', width: '80px' }}>
                                    <span style={{ fontSize: '1.8rem' }}>🖼️</span>
                                    <span style={{ fontWeight: 'bold' }}>이미지</span>
                                </div>
                            )}
                            {isLoggedIn && ADMIN_WALLETS.map(w => w.toLowerCase()).includes(walletAddress.toLowerCase()) && (
                                <button className="delete-icon-btn" onClick={(e) => deleteProposal(p.id, e)}>🗑️</button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            <button className="floating-btn" onClick={()=>{
                setProposalForm({ title: "", description: "", style: "General", image_url: "", meta_hash: "", voteType: 0, duration: 3, quorum: 10, fundingAmount: 100 });
                setActiveTab("write");
            }}>
                <span>+</span> 새 안건 작성
            </button>
          </div>
        )}

        {/* ✅ 상세 보기 모달 (가독성 대폭 개선 & IPFS 이미지 완벽 지원) */}
        {selectedProposal && (
            <div className="modal-overlay" onClick={closeModal} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.7)', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, padding: '20px' }}>
                <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ background: '#fff', width: '100%', maxWidth: '850px', maxHeight: '90vh', overflowY: 'auto', borderRadius: '16px', padding: '30px', position: 'relative', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}>
                    
<<<<<<< HEAD
                    <div className="modal-header">
                        <div style={{ background: "#f0f9ff", padding: "10px", borderRadius: "8px", marginBottom: "15px", border: "1px solid #bae6fd", fontSize: "0.9em", color: "#0369a1" }}>
                            <strong>🔗 Blockchain Verified</strong>
                            <div style={{ marginTop: "4px", fontFamily: "monospace", wordBreak: "break-all" }}>
                                Tx Hash: {selectedProposal.meta_hash || "처리 중..."}
                            </div>
                        </div>
                        
                        {/* ✅ [수정] 모달 내 CLOSED 상태 뱃지 스타일 적용 */}
                        <span 
                            className={`status-badge ${selectedProposal.status === 'CLOSED' ? 'REJECTED' : selectedProposal.status}`} 
                            style={selectedProposal.status === 'CLOSED' ? {backgroundColor: '#6b7280', color: 'white', display: 'inline-block', padding: '4px 8px', borderRadius: '12px', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '10px'} : {}}
                        >
                            {selectedProposal.status === "CLOSED" ? "CLOSED (결산 대기)" : selectedProposal.status}
                        </span>
                        <h2>{selectedProposal.title}</h2>
                        
                        {/* ✅ [수정] 작성일과 마감일을 직관적으로 보여주는 UI로 개편 */}
                        <div style={{ fontSize: "0.95rem", color: "#4b5563", marginTop: "15px", background: "#f3f4f6", padding: "12px", borderRadius: "8px" }}>
                            <div style={{ marginBottom: "6px" }}>
                                ⏳ <strong>투표 기간:</strong> {selectedProposal.duration || 3}일
                            </div>
                            <div style={{ marginBottom: "4px" }}>
                                {/* 마감일에서 기간(duration)을 빼서 실제 블록체인 '작성일'을 역산 */}
                                📝 <strong>작성:</strong> {selectedProposal.deadline && selectedProposal.duration 
                                    ? new Date((selectedProposal.deadline - selectedProposal.duration * 86400) * 1000).toLocaleString() 
                                    : "데이터 로딩 중..."}
                            </div>
                            <div style={{ marginBottom: "6px" }}>
                                🛑 <strong>마감:</strong> {selectedProposal.deadline 
                                    ? new Date(selectedProposal.deadline * 1000).toLocaleString() 
                                    : "데이터 로딩 중..."}
                                {selectedProposal.status === "CLOSED" && (
                                    <span style={{ color: "#dc2626", fontWeight: "bold", marginLeft: "10px" }}>[🚫 마감됨]</span>
                                )}
                            </div>
                            <div style={{ borderTop: "1px solid #d1d5db", paddingTop: "6px", marginTop: "6px" }}>
                                🎯 <strong>목표 정족수:</strong> {selectedProposal.quorum || 0}표
                            </div>
                        </div>

                        <div className="vote-gauge-container" style={{ marginTop: "15px", background: "#eee", borderRadius: "10px", overflow: "hidden", height: "25px", position: "relative" }}>
                            <div style={{
                                width: `${(selectedProposal.voteCount / (selectedProposal.voteCount + selectedProposal.againstCount || 1)) * 100}%`,
                                background: "#3b82f6", height: "100%", float: "left", transition: "width 0.5s"
                            }}></div>
                            <div style={{
                                width: `${(selectedProposal.againstCount / (selectedProposal.voteCount + selectedProposal.againstCount || 1)) * 100}%`,
                                background: "#ef4444", height: "100%", float: "left", transition: "width 0.5s"
                            }}></div>
                        </div>
                        
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "5px", fontSize: "0.9rem", fontWeight: "bold" }}>
                            <span style={{ color: "#3b82f6" }}>👍 찬성: {selectedProposal.voteCount ? selectedProposal.voteCount.toFixed(2) : 0}표</span>
                            <span style={{ color: "#ef4444" }}>👎 반대: {selectedProposal.againstCount ? selectedProposal.againstCount.toFixed(2) : 0}표</span>
=======
                    <button onClick={closeModal} style={{ position: 'absolute', top: '20px', right: '20px', background: '#f1f5f9', border: 'none', borderRadius: '50%', width: '40px', height: '40px', fontSize: '20px', cursor: 'pointer', color: '#64748b' }}>✖</button>
                    
                    {/* 1. 모달 헤더 */}
                    <div className="modal-header" style={{ borderBottom: '2px solid #f1f5f9', paddingBottom: '20px', marginBottom: '25px' }}>
                        <div style={{ background: "#f0f9ff", padding: "12px 16px", borderRadius: "10px", marginBottom: "20px", border: "1px solid #bae6fd", color: "#0369a1" }}>
                            <strong style={{ fontSize: '1.1rem' }}>🔗 Blockchain Verified</strong>
                            <div style={{ marginTop: "6px", fontFamily: "monospace", fontSize: '0.95rem', wordBreak: "break-all" }}>
                                Tx Hash / CID: {selectedProposal.meta_hash || "처리 중..."}
                            </div>
                        </div>
                        
                        <div style={{ marginBottom: '10px' }}>
                            <span className={`status-badge ${selectedProposal.status}`} style={{ fontSize: '1rem', padding: '6px 14px' }}>{selectedProposal.status}</span>
                        </div>
                        
                        <h2 style={{ fontSize: '2.2rem', fontWeight: '800', color: '#0f172a', margin: '10px 0', lineHeight: '1.3' }}>
                            {selectedProposal.title}
                        </h2>
                        
                        <div style={{ fontSize: "1.1rem", color: "#475569", display: 'flex', gap: '15px', flexWrap: 'wrap', fontWeight: '500' }}>
                            <span>📅 마감: {selectedProposal.deadline && selectedProposal.deadline > 0 ? new Date(selectedProposal.deadline * 1000).toLocaleString() : "데이터 로딩 중..."}</span>
                            <span>|</span>
                            <span>🎯 목표 정족수: {selectedProposal.quorum || 0}표</span>
>>>>>>> origin/feat/ai-studio-web2.5
                        </div>
                    </div>

                   {/* 🚨 완벽 수정된 모달 본문 (IPFS 동기화 및 에러 핸들링 최적화) */}
                    <div style={{ display: 'flex', flexDirection: 'row', gap: '20px', margin: '20px 0', minHeight: '400px', width: '100%', alignItems: 'stretch' }}>
                        
                        {/* 🖼️ 왼쪽: 그림 영역 */}
                        <div style={{ flex: '1', width: '50%', backgroundColor: '#0f172a', borderRadius: '16px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            {selectedProposal.image_url ? (
                                <>
                                    <div style={{ flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '15px' }}>
                                        <img 
                                            // 🚨 범용성이 가장 뛰어난 공식 ipfs.io 게이트웨이 사용
                                            src={selectedProposal.image_url.startsWith('data:image') ? selectedProposal.image_url : selectedProposal.image_url.replace("ipfs://", "https://ipfs.io/ipfs/")} 
                                            alt="Proposal Art" 
                                            style={{ maxWidth: '100%', maxHeight: '350px', objectFit: 'contain' }}
                                            onError={(e) => { 
                                                e.target.style.display = 'none'; 
                                                // 에러 발생 시 안내 문구 표시 (IPFS 동기화는 전 세계 노드 전파에 시간이 걸림)
                                                if (!e.target.nextElementSibling) {
                                                    e.target.insertAdjacentHTML('afterend', '<div style="color:#94a3b8; padding: 20px; text-align:center; line-height: 1.6;"><span style="font-size:2rem;">⏳</span><br/>블록체인(IPFS) 네트워크에<br/>이미지를 동기화 중입니다.<br/><span style="font-size:0.9rem; color:#64748b;">(약 1~3분 정도 소요될 수 있습니다)</span></div>'); 
                                                }
                                            }}
                                        />
                                    </div>
                                    <div style={{ padding: '12px', background: '#1e293b', textAlign: 'center' }}>
                                        <a 
                                            href={selectedProposal.image_url.startsWith('data:image') ? selectedProposal.image_url : selectedProposal.image_url.replace("ipfs://", "https://ipfs.io/ipfs/")} 
                                            target="_blank" 
                                            rel="noreferrer" 
                                            style={{ color: '#38bdf8', textDecoration: 'none', fontWeight: 'bold' }}
                                        >
                                            👁️ 고화질 원본 보기 (새 창)
                                        </a>
                                    </div>
                                </>
                            ) : (
                                <div style={{ flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', backgroundColor: '#f1f5f9' }}>
                                    첨부된 이미지가 없습니다.
                                </div>
                            )}
                        </div>
                        
                        {/* 📜 오른쪽: 안건 내용 영역 */}
                        <div style={{ flex: '1', width: '50%', background: '#f8fafc', padding: '25px', borderRadius: '16px', border: '1px solid #e2e8f0', overflowY: 'auto', maxHeight: '420px' }}>
                            <h3 style={{ marginTop: 0, color: '#1e293b', borderBottom: '2px solid #cbd5e1', paddingBottom: '12px', fontSize: '1.5rem' }}>📜 안건 내용</h3>
                            <div style={{ whiteSpace: 'pre-wrap', color: '#334155', fontSize: '1.15rem', lineHeight: '1.8', marginTop: '15px' }}>
                                {selectedProposal.description || "안건 내용이 등록되지 않았습니다."}
                            </div>
                        </div>

                    </div>

                    {/* 3. 모달 하단 (투표 영역) */}
                    <div className="modal-footer" style={{ flexDirection: 'column', alignItems: 'stretch', marginTop: '30px', borderTop: '2px solid #f1f5f9', paddingTop: '25px' }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px", fontSize: "1.2rem", fontWeight: "bold" }}>
                            <span style={{ color: "#2563eb" }}>👍 찬성: {selectedProposal.voteCount ? selectedProposal.voteCount.toFixed(2) : 0}표</span>
                            <span style={{ color: "#dc2626" }}>👎 반대: {selectedProposal.againstCount ? selectedProposal.againstCount.toFixed(2) : 0}표</span>
                        </div>
                        <div style={{ width: "100%", background: "#e2e8f0", borderRadius: "12px", height: "30px", position: "relative", overflow: "hidden", marginBottom: '25px' }}>
                            <div style={{ width: `${(selectedProposal.voteCount / ((selectedProposal.voteCount + selectedProposal.againstCount) || 1)) * 100}%`, background: "#3b82f6", height: "100%", float: "left", transition: "width 0.5s" }}></div>
                            <div style={{ width: `${(selectedProposal.againstCount / ((selectedProposal.voteCount + selectedProposal.againstCount) || 1)) * 100}%`, background: "#ef4444", height: "100%", float: "left", transition: "width 0.5s" }}></div>
                        </div>

                        <div style={{ padding: '20px', background: '#eff6ff', borderRadius: '12px', border: '1px solid #bfdbfe', marginBottom: '20px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                <label style={{ fontWeight: 'bold', color: '#1e3a8a', fontSize: '1.2rem' }}>투표할 토큰 수량 (TUK)</label>
                                <span style={{ fontSize: '1rem', color: '#3b82f6', fontWeight: 'bold', background: '#fff', padding: '6px 12px', borderRadius: '20px', border: '1px solid #bfdbfe' }}>내 보유량: {myInfo.balance} TUK</span>
                            </div>
                            <input 
                                type="number" 
                                value={voteAmount} 
                                onChange={(e) => setVoteAmount(e.target.value)}
                                placeholder="사용할 토큰 수량을 입력하세요 (예: 10)"
                                style={{ width: '100%', padding: '15px', borderRadius: '10px', border: '2px solid #93c5fd', fontSize: '1.2rem', boxSizing: 'border-box', outline: 'none' }}
                            />
                            <div style={{ marginTop: '12px', fontSize: '1.1rem', color: '#2563eb', fontWeight: 'bold' }}>
                                💡 예상 행사 표수: {
                                    voteAmount > 0 
                                    ? (selectedProposal.voteType === 1 ? Math.sqrt(voteAmount).toFixed(2) : voteAmount) 
                                    : 0
                                } 표
                            </div>
                        </div>

<<<<<<< HEAD
                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                            {/* ✅ [수정] 결산 대기 상태(CLOSED) 이거나 기한이 지나면 버튼 비활성화 */}
                            <button 
                                className="vote-btn yes" 
                                onClick={() => handleVote(selectedProposal.id, true)}
                                disabled={selectedProposal.status === "CLOSED" || selectedProposal.deadline < currentBlockTime}
                                style={{ cursor: (selectedProposal.status === "CLOSED" || selectedProposal.deadline < currentBlockTime) ? "not-allowed" : "pointer" }}
                            >
                                👍 찬성 투표
                            </button>
                            
                            <button 
                                className="vote-btn no" 
                                onClick={() => handleVote(selectedProposal.id, false)}
                                disabled={selectedProposal.status === "CLOSED" || selectedProposal.deadline < currentBlockTime}
                                style={{ cursor: (selectedProposal.status === "CLOSED" || selectedProposal.deadline < currentBlockTime) ? "not-allowed" : "pointer" }}
                            >
                                👎 반대 투표
                            </button>
                        </div>
                        <div className="modal-footer" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                            {/* ✅ [수정] 상태가 CLOSED로 바뀌었을 때만 결산 버튼 표시 */}
                            {selectedProposal.status === "CLOSED" && (
                                <div style={{ marginTop: '20px', padding: '15px', background: '#e0e7ff', borderRadius: '8px', border: '1px solid #c7d2fe' }}>
                                    <p style={{ color: '#3730a3', fontWeight: 'bold', textAlign: 'center' }}>
                                        ⏳ 투표가 마감되었습니다! 결과를 확정하고 자금을 집행하세요.
                                    </p>
                                    <button 
                                        className="primary-btn" 
                                        onClick={() => handleExecuteProposal(selectedProposal.id)}
                                        style={{ width: '100%', marginTop: '10px', backgroundColor: '#4f46e5' }}
                                    >
                                        ⚖️ 결산 및 자금 집행하기
                                    </button>
                                </div>
                            )}

                            {selectedProposal.status === "REJECTED" && (
                                <div style={{ marginTop: '20px', padding: '15px', background: '#fee2e2', borderRadius: '8px', textAlign: 'center' }}>
                                    <p style={{ color: '#991b1b', fontWeight: 'bold' }}>❌ 부결되었습니다. (정족수 미달 또는 반대 우세)</p>
                                </div>
                            )}
                            
                            {selectedProposal.status === "EXECUTED" && (
                                <div style={{ marginTop: '20px', padding: '15px', background: '#f3f4f6', borderRadius: '8px', textAlign: 'center' }}>
                                    <p style={{ color: '#4b5563', fontWeight: 'bold' }}>✅ 자금 지급 완료 (집행 완료)</p>
                                </div>
                            )}
=======
                        <div style={{ display: 'flex', gap: '15px' }}>
                            <button onClick={() => handleVote(selectedProposal.id, true)} style={{ flex: 1, padding: '15px', fontSize: '1.3rem', fontWeight: 'bold', background: '#2563eb', color: 'white', border: 'none', borderRadius: '12px', cursor: 'pointer', transition: '0.2s' }}>
                                👍 찬성 투표하기
                            </button>
                            <button onClick={() => handleVote(selectedProposal.id, false)} style={{ flex: 1, padding: '15px', fontSize: '1.3rem', fontWeight: 'bold', background: '#dc2626', color: 'white', border: 'none', borderRadius: '12px', cursor: 'pointer', transition: '0.2s' }}>
                                👎 반대 투표하기
                            </button>
>>>>>>> origin/feat/ai-studio-web2.5
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
                        <div style={{ flex: 1 }}>
                            <label>요청 지원금 (TUK)</label>
                            <input 
                                type="number" 
                                value={proposalForm.fundingAmount} 
                                onChange={(e) => setProposalForm({...proposalForm, fundingAmount: e.target.value})} 
                                placeholder="예: 500" 
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

        {/* AI 스튜디오, 에이전트 등 나머지 탭 */}
        {activeTab === "studio" && (
            <div className="page fade-in">
                <h2>🎨 AI Art Studio</h2>
                <div className="studio-layout">
                    <div className="card studio-input">
                        <h3>1. 기획 의도 입력</h3>
                        <input type="text" placeholder="예: 외계인 도시" value={studioData.intent} onChange={(e)=>setStudioData({...studioData, intent: e.target.value})}/>
                        <div className="studio-btns">
                            <button className="primary" onClick={()=>handleStudioAction('draft')} disabled={isLoading}>📜 기획서 생성</button>
                        </div>
                    </div>
                    
                    <div className="card studio-result">
                        <h3>2. 결과물 확인</h3>
                        
                        {/* 🚀 [NEW] 스튜디오 A2A 사고 과정 UI */}
                        {isLoading && studioLoadingStep && (
                            <div className="a2a-thinking-container">
                                <div className="a2a-thinking-header">
                                    <span className="loading-spinner" style={{borderColor: 'rgba(100,116,139,0.3)', borderTopColor: '#64748b'}}></span>
                                    사고 (A2A Protocol)
                                </div>
                                <div className="a2a-step-list">
                                    <div className="a2a-step">유저 인텐트(의도) 분석 완료</div>
                                    <div className="a2a-step active">{studioLoadingStep}</div>
                                </div>
                            </div>
                        )}

                        {studioData.draft && !isLoading && (
                            <>
                                <textarea value={studioData.draft} readOnly />
                                <button className="action-btn primary full-width" onClick={()=>handleStudioAction('image')} disabled={isLoading} style={{marginTop: '10px', marginBottom: '10px'}}>
                                    🎨 포스터 이미지 생성
                                </button>
                            </>
                        )}
                        {studioData.image && !isLoading && (
                            <div className="final-result">
                                <img src={studioData.image} alt="Generated" />
                                <button className="primary full-width" onClick={sendToProposalWrite}>👉 안건 작성 페이지로 이동해서 적용하기</button>
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
                    
                    {/* 1. 비평가 카드 */}
                    <div className={`card agent-card ${activeAgentLoading === 'critic' ? 'loading' : ''}`}>
                        <div className="agent-header"><span className="icon">🧐</span><h3>Art Critic (비평가)</h3></div>
                        <p className="role-desc">작품을 분석하여 심도 있는 비평문을 작성합니다.</p>
                        <div className="input-group">
                            <label>작품 정보</label>
                            <textarea placeholder="예: 사이버펑크 스타일..." value={agentInput.criticArtInfo} onChange={(e) => setAgentInput({...agentInput, criticArtInfo: e.target.value})}/>
                        </div>
                        <button className="primary full-width" onClick={runCritic} disabled={activeAgentLoading !== null}>
                            {activeAgentLoading === 'critic' ? <><span className="loading-spinner"></span>작품 심층 분석 중...</> : "비평 작성 요청"}
                        </button>
                        {activeAgentLoading === 'critic' && <div className="ai-processing-text">✨ AI 비평가가 미술사적 맥락을 파악하고 있습니다...</div>}
                        {agentResult.critic && (
                            <div className="result-box">
                                <h4>📜 비평문</h4><p>{agentResult.critic}</p>
                                <button className="sm-btn" onClick={() => setAgentInput({...agentInput, auctionReview: agentResult.critic})}>👉 경매사에게 전달</button>
                            </div>
                        )}
                    </div>

                    {/* 2. 마케터 카드 */}
                    <div className={`card agent-card ${activeAgentLoading === 'marketer' ? 'loading' : ''}`}>
                        <div className="agent-header"><span className="icon">📢</span><h3>Viral Marketer (마케터)</h3></div>
                        <p className="role-desc">전시회 홍보를 위한 SNS 바이럴 카피를 작성합니다.</p>
                        <div className="input-group">
                            <label>전시회 제목</label>
                            <input type="text" placeholder="예: 2050 서울의 밤" value={agentInput.marketerTitle} onChange={(e) => setAgentInput({...agentInput, marketerTitle: e.target.value})}/>
                            <label>타겟 관객</label>
                            <input type="text" placeholder="예: 20대 힙스터" value={agentInput.marketerTarget} onChange={(e) => setAgentInput({...agentInput, marketerTarget: e.target.value})}/>
                        </div>
                        <button className="primary full-width" onClick={runMarketer} disabled={activeAgentLoading !== null}>
                            {activeAgentLoading === 'marketer' ? <><span className="loading-spinner"></span>홍보 문구 생성 중...</> : "홍보 문구 생성"}
                        </button>
                        {activeAgentLoading === 'marketer' && <div className="ai-processing-text">🚀 트렌드 분석 및 인스타그램 해시태그 조합 중...</div>}
                        {agentResult.marketer && <div className="result-box"><h4>📱 인스타그램 카피</h4><p style={{whiteSpace: "pre-line"}}>{agentResult.marketer}</p></div>}
                    </div>

                    {/* 3. 경매사 카드 */}
                    <div className={`card agent-card ${activeAgentLoading === 'auction' ? 'loading' : ''}`}>
                        <div className="agent-header"><span className="icon">🔨</span><h3>Auctioneer (경매사)</h3></div>
                        <p className="role-desc">비평을 바탕으로 경매 시작가를 책정하고 오프닝 멘트를 합니다.</p>
                        <div className="input-group">
                            <label>작품 정보</label>
                            <input type="text" placeholder="작품 설명 입력" value={agentInput.auctionArtInfo} onChange={(e) => setAgentInput({...agentInput, auctionArtInfo: e.target.value})}/>
                            <label>비평가 리뷰</label>
                            <textarea placeholder="비평가가 쓴 글을 입력하세요" value={agentInput.auctionReview} onChange={(e) => setAgentInput({...agentInput, auctionReview: e.target.value})}/>
                        </div>
                        <button className="primary full-width" onClick={runAuction} disabled={activeAgentLoading !== null}>
                            {activeAgentLoading === 'auction' ? <><span className="loading-spinner"></span>가치 산정 중...</> : "경매 리포트 생성"}
                        </button>
                        {activeAgentLoading === 'auction' && <div className="ai-processing-text">💰 글로벌 경매 데이터와 대조하여 시작가를 책정하고 있습니다...</div>}
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
                                <div className="bubble" style={{ whiteSpace: "pre-line" }}>{msg.text}</div>
                            </div>
                        ))}
                        
                        {/* 🚀 [NEW] 채팅창 A2A 사고 과정 애니메이션 */}
                        {isChatLoading && (
                            <div className="msg bot">
                                <div className="a2a-thinking-container" style={{ width: '100%', maxWidth: '80%', margin: 0, padding: '12px' }}>
                                    <div className="a2a-thinking-header">
                                        <span className="loading-spinner" style={{borderColor: 'rgba(100,116,139,0.3)', borderTopColor: '#64748b', width: '12px', height: '12px'}}></span>
                                        사고 (Agent Network)
                                    </div>
                                    <div className="a2a-step-list">
                                        <div className="a2a-step">유저 성향 및 질문 의도 파악 완료</div>
                                        <div className="a2a-step active">비평가 에이전트와 교차 검증하며 답변 생성 중...</div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                    
                    <div className="chat-input">
                        <input 
                            type="text" 
                            value={chatInput} 
                            onChange={(e)=>setChatInput(e.target.value)} 
                            onKeyPress={(e)=>e.key==='Enter' && !isChatLoading && sendMessage()} 
                            placeholder="미술품 추천을 부탁해보세요..." 
                            disabled={isChatLoading} 
                        />
                        <button className="primary" onClick={sendMessage} disabled={isChatLoading}>전송</button>
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