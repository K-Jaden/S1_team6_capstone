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
  
  // --- [NEW] Botto DAO 라운드 상태 ---
  const [currentRound, setCurrentRound] = useState(null);
  const [vpInputs, setVpInputs] = useState({}); // 각 후보작별 입력한 VP 값 저장
  
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

  useEffect(() => {
      if (activeTab === "proposals") {
          fetchCurrentRound();
      }
  }, [activeTab]);

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
  
  // 1. 현재 라운드 정보 불러오기
  const fetchCurrentRound = async () => {
      try {
          const res = await axios.get(`${API_URL}/api/rounds/current`);
          setCurrentRound(res.data);
      } catch (err) {
          console.log("진행 중인 라운드가 없습니다.");
          setCurrentRound(null);
      }
  };

  // 2. VP 투표하기
  const handleVoteVP = async (candidateId) => {
      const amount = vpInputs[candidateId];
      if (!amount || amount <= 0) return alert("투표할 VP를 입력하세요!");
      if (!isLoggedIn) return alert("지갑을 먼저 연결해주세요!");

      try {
          const res = await axios.post(`${API_URL}/api/vote`, {
              wallet_address: walletAddress,
              candidate_id: candidateId,
              vp_amount: parseInt(amount)
          });
          alert(res.data.message);
          fetchCurrentRound(); // 투표 후 데이터 새로고침
          setVpInputs({ ...vpInputs, [candidateId]: "" }); // 입력창 초기화
      } catch (err) {
          alert(err.response?.data?.detail || "투표 실패");
      }
  };

  // 3. [데모용] 관리자 강제 라운드 생성
  const handleGenerateRoundDemo = async () => {
      setIsLoading(true);
      alert("AI 에이전트들이 기획 토론 및 이미지 렌더링을 시작합니다. (약 30초~1분 소요)");
      try {
          await axios.post(`${API_URL}/api/admin/generate-round`);
          alert("새 라운드와 4개의 후보작이 성공적으로 생성되었습니다!");
          fetchCurrentRound();
      } catch (err) {
          alert("라운드 생성 실패");
      }
      setIsLoading(false);
  };

  // 4. [데모용] 관리자 강제 투표 종료 및 가치 산정
  const handleEndRoundDemo = async () => {
      setIsLoading(true);
      alert("투표를 마감하고 AI 경매사가 우승작의 가치를 평가합니다...");
      try {
          const res = await axios.post(`${API_URL}/api/admin/end-round`);
          alert(`🎉 1등 우승작: ${res.data.winner_title}\n💰 AI 책정가: ${res.data.auction_price} TUK`);
          fetchCurrentRound(); // 현재 진행중인 라운드가 없어지므로 화면이 비워짐
      } catch (err) {
          alert("라운드 종료 실패");
      }
      setIsLoading(false);
  };

  const fetchProposals = async (status = null) => {
    try {
      const params = status ? { status } : {};
      const res = await axios.get(`${API_URL}/api/proposals`).catch(() => ({data: []})); // 구 API 에러 방지용
      let dbProposals = res.data || [];

      if (contract) {
        try {
            const blockNum = await contract.runner.provider.getBlockNumber();
            const block = await contract.runner.provider.getBlock(blockNum);
            const nowBlockTime = Number(block.timestamp);
            setCurrentBlockTime(nowBlockTime);

            const chainProposals = await contract.getAllProposals();
            const statusMap = ["OPEN", "ACCEPTED", "REJECTED", "EXECUTED"];

            dbProposals = dbProposals.map(p => {
                if (chainProposals.length >= Number(p.id)) {
                    const chainP = chainProposals[Number(p.id) - 1];
                    if (chainP) {
                        let currentStatus = statusMap[Number(chainP[7])];
                        const deadlineTime = Number(chainP[9]);

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
        axios.get(`${API_URL}/api/user/proposals`, { params: { wallet_address: walletAddress } }).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/api/user/recommend`, { params: { wallet_address: walletAddress } }).catch(() => ({ data: null }))
      ]);
      setMyInfo({
        balance: resBal.data.balance,
        membership: resMem.data.grade,
        rewards: resRew.data.pending_amount,
        delegation: resDel.data,
        activity: resAct.data,
        referral: resRef.data,
        myProposals: resMyProp.data || [],
        recommendation: resRec ? resRec.data : null
      });
    } catch (err) { console.error("내 정보 로드 실패", err); }
  };

  const fetchGallery = async () => {
    try {
        const res = await axios.get(`${API_URL}/api/gallery/items`);
        setGalleryItems(res.data);
    } catch (err) {
        console.error("갤러리 로드 실패");
    }
  };

  const handleBadgeUpdate = async () => {
    try {
        const res = await axios.patch(`${API_URL}/api/user/badge`, null, { params: { wallet_address: walletAddress } });
        alert(`뱃지 상태 업데이트: ${res.data.status}`);
        fetchMyPageData();
    } catch (err) { alert("뱃지 업데이트 실패"); }
  };

 const handleGenerateWithIPFS = async () => {
    setIsLoading(true);
    setStudioLoadingStep("🎨 AI 화가 에이전트가 프롬프트를 시각화 및 렌더링 중..."); 
    try {
        const res = await axios.post(`${API_URL}/api/studio/image`, {
            keywords: studioData.intent
        });

        if (res.data.image_url && !res.data.image_url.includes("Error")) {
            setStudioData(prev => ({
                ...prev,
                image: res.data.image_url,  
                meta_cid: "" 
            }));
            alert("🎨 포스터 이미지가 생성되었습니다! (영구 저장은 안건 제출 시 진행됩니다)"); 
        } else {
            alert("이미지 생성에 실패했습니다. (서버 에러)");
        }
    } catch (err) { alert("생성 실패"); }
    setIsLoading(false);
    setStudioLoadingStep(""); 
  };
 const sendToProposalWrite = () => {
    let cleanDescription = studioData.draft || "";
    const splitKeyword = "=========================================\n✨ 3. AI 화가 이미지 프롬프트";
    if (cleanDescription.includes(splitKeyword)) {
        cleanDescription = cleanDescription.split(splitKeyword)[0];
    }
    cleanDescription = cleanDescription.replace(/\*\*큐레이터:\*\*\s*\[이름\].*\n?/g, "");
    cleanDescription = cleanDescription.replace(/큐레이터:\s*\[이름\].*\n?/g, "");
    cleanDescription = cleanDescription.trim();

    setProposalForm({
        title: studioData.intent || "AI 기획 안건",
        description: cleanDescription, 
        image_url: studioData.image || "", 
        style: "AI Generated",
        meta_hash: "", 
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
        setStudioLoadingStep("🤖 AI 에이전트(기획자, 화가, 비평가)가 난상 토론을 진행 중입니다... (약 2분~3분 소요)");
        
        try {
            const res = await axios.post(`${API_URL}/api/studio/draft`, { intent: studioData.intent });
            setStudioData(prev => ({ ...prev, draft: res.data.draft_text }));
        } catch (err) { 
            console.error("A2A 통신 에러:", err);
            alert("기획서 생성 실패. 서버가 켜져 있는지 확인해주세요."); 
        }
        setIsLoading(false);
        setStudioLoadingStep(""); 
    } 
    else if (type === 'image') {
        await handleGenerateWithIPFS(); 
    }
  };

  const submitProposal = async () => {
    if (!walletAddress) return alert("지갑이 연결되지 않았습니다.");
    if (!contract) return alert("스마트 컨트랙트 연결 중... 잠시 후 시도해주세요.");
    if (!proposalForm.title || !proposalForm.description) {
      return alert("제목과 내용을 모두 입력해주세요.");
    }

    const durationNum = parseInt(proposalForm.duration, 10);
    if (!durationNum || durationNum <= 0) return alert("투표 기간을 1일 이상으로 입력해주세요.");

    setIsLoading(true);
    let finalUriToSave = proposalForm.image_url; 

    try {
        if (proposalForm.image_url && proposalForm.image_url.startsWith('data:image')) {
            console.log("🚀 엄청나게 큰 이미지 데이터를 IPFS로 피신시키는 중...");
            const ipfsRes = await axios.post(`${API_URL}/api/ipfs/finalize`, {
                image_url: proposalForm.image_url,
                title: proposalForm.title,
                description: proposalForm.description,
                wallet_address: walletAddress
            });

            if (ipfsRes.data.status === "success") {
                finalUriToSave = ipfsRes.data.token_uri || ipfsRes.data.image_ipfs_url;
                console.log("✅ IPFS 영구 저장소 변환 완료! 짧은 주소:", finalUriToSave);
            } else {
                throw new Error("IPFS 업로드 실패: " + ipfsRes.data.error);
            }
        }

        if (finalUriToSave && finalUriToSave.startsWith('data:image')) {
            throw new Error("이미지 IPFS 변환에 실패했습니다. (Base64 데이터는 블록체인에 올릴 수 없습니다.)");
        }

        alert("지갑에서 트랜잭션을 승인해주세요...");
        
        const quorumWei = ethers.parseUnits(proposalForm.quorum.toString(), 18);
        const fundingWei = ethers.parseUnits(proposalForm.fundingAmount.toString(), 18);

        console.log("🚀 스마트 컨트랙트에 트랜잭션 전송 중...");
        
        let onChainDescription = proposalForm.description;
        if (onChainDescription.length > 150) {
            const cutIndex = onChainDescription.lastIndexOf(' ', 150);
            const safeIndex = cutIndex > 0 ? cutIndex : 150;
            onChainDescription = onChainDescription.substring(0, safeIndex) + " ...\n\n[이 안건의 전체 기획서 원문은 ArtDAO 오프체인 DB 및 IPFS에 영구 보존되어 있습니다.]";
        }

        const tx = await contract.createProposal(
            proposalForm.title, 
            onChainDescription, 
            finalUriToSave, 
            proposalForm.voteType,
            durationNum, 
            quorumWei,
            fundingWei   
        );
    
        alert("⛓️ 블록체인에 기록 중입니다... (약 10~20초 소요)");
        await tx.wait(); 
        
        await axios.post(`${API_URL}/api/proposals`, { 
            wallet_address: walletAddress, 
            ...proposalForm, 
            duration: durationNum, 
            image_url: finalUriToSave, 
            meta_hash: tx.hash 
        });

        const shortHash = `${tx.hash.substring(0,6)}...${tx.hash.substring(tx.hash.length - 4)}`;
        alert(`🎉 안건이 성공적으로 등록되었습니다!\nTx Hash: ${shortHash}`);
        
        setProposalForm({ title: "", description: "", style: "General", image_url: "", meta_hash: "", voteType: 0, duration: 3, quorum: 10, fundingAmount: 100 });
        setActiveTab("proposals");
        fetchProposals();

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
    
    setIsChatLoading(true); 
    
    try {
      const res = await axios.post(`${API_URL}/api/a2a/chat`, { 
          message: userMsg.text, 
          wallet_address: walletAddress 
      });
      setChatMessages(prev => [...prev, { sender: "bot", text: res.data.reply }]);
    } catch (err) {
      console.error(err);
      setChatMessages(prev => [...prev, { sender: "bot", text: "오류가 발생했습니다." }]);
    }
    
    setIsChatLoading(false); 
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
    setActiveAgentLoading('critic'); 
    try {
      const res = await axios.post(`${API_URL}/api/agent/review`, { art_info: agentInput.criticArtInfo });
      setAgentResult(prev => ({ ...prev, critic: res.data.review_text }));
    } catch (err) { alert("실패"); }
    setActiveAgentLoading(null); 
  };

  const runMarketer = async () => {
    if (!agentInput.marketerTitle) return alert("입력 필요");
    setActiveAgentLoading('marketer'); 
    try {
      const res = await axios.post(`${API_URL}/api/agent/promote`, { exhibition_title: agentInput.marketerTitle, target_audience: agentInput.marketerTarget });
      setAgentResult(prev => ({ ...prev, marketer: res.data.promo_text }));
    } catch (err) { alert("실패"); }
    setActiveAgentLoading(null); 
  };

  const runAuction = async () => {
    if (!agentInput.auctionArtInfo) return alert("입력 필요");
    setActiveAgentLoading('auction'); 
    try {
      const res = await axios.post(`${API_URL}/api/agent/auction`, { art_info: agentInput.auctionArtInfo, critic_review: agentInput.auctionReview });
      setAgentResult(prev => ({ ...prev, auction: res.data.auction_report }));
    } catch (err) { alert("실패"); }
    setActiveAgentLoading(null); 
  };

// ==========================================
  // 5. UI 렌더링
  // ==========================================
  return (
    <div className="App">
      {/* 1. 좌측 사이드바 */}
      <aside className="sidebar">
        <h1 className="logo" onClick={() => setActiveTab("main")} style={{cursor: 'pointer'}}>ArtDAO</h1>
        
        <nav>
          <button className={activeTab==="main"?"active":""} onClick={()=>setActiveTab("main")}>📊 Knowledge Graph</button>
          <button className={activeTab==="proposals"?"active":""} onClick={()=>setActiveTab("proposals")}>🗳️ Proposals</button>
          <button className={activeTab==="delegates"?"active":""} onClick={()=>setActiveTab("delegates")}>🤝 Delegates</button>
          <button className={activeTab==="studio"?"active":""} onClick={()=>setActiveTab("studio")}>🎨 AI Studio</button>
          <button className={activeTab==="agents"?"active":""} onClick={()=>setActiveTab("agents")}>💼 Agent Squad</button>
          <button className={activeTab==="gallery"?"active":""} onClick={()=>setActiveTab("gallery")}>🖼️ Gallery</button>
          <button className={activeTab==="mypage"?"active":""} onClick={()=>setActiveTab("mypage")}>👤 Profile</button>
        </nav>

        <div style={{ marginTop: "auto", padding: "15px", background: "#0F0F0F", borderRadius: "8px", border: "1px solid #2A2A2A", textAlign: "center" }}>
            <div style={{ fontSize: "0.8rem", color: "#9CA3AF", marginBottom: "5px" }}>Current Block Time</div>
            <strong style={{ color: "#F3F4F6", fontSize: "0.9rem", display: "block", marginBottom: "10px" }}>
                {new Date(currentBlockTime * 1000).toLocaleString()}
            </strong>
            <button onClick={() => fetchProposals()} style={{ width: "100%", padding: "8px", background: "#1A1A1A", color: "#F3F4F6", border: "1px solid #2A2A2A", borderRadius: "6px", cursor: "pointer", fontSize: "0.8rem" }}>
                🔄 Sync Time
            </button>
        </div>
      </aside>

      {/* 2. 중앙 메인 컨텐츠 */}
      <main className="main-content">
        <header className="top-header">
            {isLoggedIn ? (
                <div className="logged-in-box">
                  <div className="badge-connected">🟢 {walletAddress.substring(0, 6)}...</div>
                  <button className="logout-btn" onClick={handleLogout}>Logout</button>
                </div>
            ) : (
                <button className="connect-btn" onClick={connectWallet}>Connect Wallet</button>
            )}
        </header>

        {activeTab === "main" && (
          <div className="page fade-in">
            <h2>ArtDAO Engine</h2>
            <p className="page-desc">
              Browse through ArtDAO's collections of knowledge and proposals. Add entries to improve the AI's understanding of the art world.
            </p>
            
            <div className="dashboard-grid">
                <div className="card summary" onClick={()=>setActiveTab("proposals")}>
                    <h3>Active Proposals</h3>
                    <p className="highlight">{proposals.filter(p=>p.status==="OPEN").length} <span style={{fontSize: '1rem', color: '#9CA3AF', fontWeight: 'normal'}}>ongoing</span></p>
                    <span>View all &rarr;</span>
                </div>
                
                <div className="card summary" style={{ cursor: 'default' }}>
                    <h3>Collections Overview</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginTop: '15px', color: '#9CA3AF', fontSize: '0.9rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#0F0F0F', borderRadius: '8px' }}>
                            <span>🖼️ Artworks</span> <span style={{color: '#fff'}}>{galleryItems.length}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#0F0F0F', borderRadius: '8px' }}>
                            <span>💰 My Treasury</span> <span style={{color: '#fff'}}>{myInfo.balance || 0} ART</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#0F0F0F', borderRadius: '8px' }}>
                            <span>👥 Members</span> <span style={{color: '#fff'}}>{users.length || 0}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#0F0F0F', borderRadius: '8px' }}>
                            <span>📝 My Proposals</span> <span style={{color: '#fff'}}>{myInfo.myProposals?.length || 0}</span>
                        </div>
                    </div>
                </div>
            </div>
          </div>
        )}

        {/* ✅ DAO 투표 갤러리 */}
        {activeTab === "proposals" && (
          <div className="page fade-in">
            <div className="proposals-header-wrap" style={{borderBottom: 'none', marginBottom: '10px'}}>
                <div>
                    <h2 style={{fontFamily: "'Playfair Display', serif", fontSize: "2.5rem", margin: 0}}>🗳️ Curate the Next Masterpiece</h2>
                    <p style={{color: '#9CA3AF', marginTop: '10px', fontSize: '1rem'}}>AI가 창작한 후보작 중, 최고의 가치를 지닌 작품에 VP(투표력)를 투자하세요.</p>
                </div>
            </div>

            <div className="admin-demo-panel">
                <div>
                    <strong style={{color: '#EF4444'}}>⚙️ Admin Demo Controls</strong>
                    <span style={{color: '#F87171', fontSize: '0.85rem', marginLeft: '10px'}}>(시연용 기능)</span>
                </div>
                <div style={{display: 'flex', gap: '10px'}}>
                    <button onClick={handleGenerateRoundDemo} disabled={isLoading} style={{background: '#B91C1C', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold'}}>
                        {isLoading ? "AI 생성 중..." : "1. 새 라운드(후보작 4개) 생성"}
                    </button>
                    <button onClick={handleEndRoundDemo} disabled={isLoading} style={{background: '#991B1B', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold'}}>
                        2. 투표 마감 및 가치 평가
                    </button>
                </div>
            </div>

            {currentRound ? (
                <>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0F0F0F', padding: '15px 20px', borderRadius: '12px', border: '1px solid #2A2A2A'}}>
                        <span style={{color: '#38BDF8', fontWeight: 'bold', fontSize: '1.1rem'}}>🟢 Round #{currentRound.round_number} 진행 중</span>
                        <span style={{color: '#9CA3AF'}}>내 남은 TUK 잔고: <strong style={{color: 'white'}}>{myInfo.balance} TUK</strong></span>
                    </div>

                    <div className="candidate-grid">
                        {currentRound.candidates.map(candidate => (
                            <div key={candidate.id} className="candidate-card">
                                <div className="candidate-img-box">
                                    <img src={candidate.image_url.replace("ipfs://", "https://ipfs.io/ipfs/")} alt={candidate.title} />
                                </div>
                                <div className="candidate-info">
                                    <h3 className="candidate-title">{candidate.title}</h3>
                                    <p className="candidate-desc">{candidate.description}</p>
                                    
                                    <div className="candidate-stats">
                                        <span style={{color: '#6B7280', fontSize: '0.9rem'}}>현재 누적 투자금</span>
                                        <span className="vp-count">{candidate.vp_votes} VP</span>
                                    </div>

                                    <div className="vote-action-box">
                                        <input 
                                            type="number" 
                                            className="vp-input" 
                                            placeholder="VP 입력" 
                                            value={vpInputs[candidate.id] || ""}
                                            onChange={(e) => setVpInputs({...vpInputs, [candidate.id]: e.target.value})}
                                        />
                                        <button className="vote-btn" onClick={() => handleVoteVP(candidate.id)}>투자하기</button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            ) : (
                <div style={{textAlign: 'center', padding: '60px 20px', background: '#1A1A1A', borderRadius: '16px', border: '1px dashed #2A2A2A'}}>
                    <span style={{fontSize: '3rem'}}>😴</span>
                    <h3 style={{color: '#D1D5DB', marginTop: '20px'}}>현재 진행 중인 투표 라운드가 없습니다.</h3>
                    <p style={{color: '#6B7280'}}>관리자가 다음 시즌을 준비 중입니다.</p>
                </div>
            )}
          </div>
        )}

        {/* 에이전트 센터 */}
        {activeTab === "agents" && (
            <div className="page fade-in">
                <h2 style={{fontFamily: "'Playfair Display', serif", fontSize: "2.5rem", marginBottom: "10px"}}>💼 AI Agent Squad</h2>
                <p style={{color: '#9CA3AF', marginBottom: '30px'}}>각 분야의 AI 전문가들에게 작품 비평, 마케팅, 경매 산정을 의뢰하세요.</p>
                
                <div className="agent-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', alignItems: 'stretch' }}>
                    
                    {/* 1. 비평가 */}
                    <div className={`card agent-card ${activeAgentLoading === 'critic' ? 'loading' : ''}`} style={{background: '#1A1A1A', border: '1px solid #2A2A2A', borderRadius: '16px', display: 'flex', flexDirection: 'column'}}>
                        <div className="agent-header" style={{borderBottom: '1px solid #2A2A2A', paddingBottom: '15px'}}>
                            <span className="icon">🧐</span><h3 style={{color: '#fff', margin: 0, fontSize: '1.2rem'}}>Art Critic</h3>
                        </div>
                        <p className="role-desc" style={{color: '#9CA3AF', marginTop: '15px', marginBottom: '20px', height: '40px'}}>작품을 분석하여 심도 있는 비평문을 작성합니다.</p>
                        <div className="input-group" style={{flex: 1}}>
                            <label style={{color: '#D1D5DB', marginBottom: '8px', display: 'block', fontWeight: 'bold'}}>작품 정보</label>
                            <textarea className="glass-textarea" placeholder="예: 사이버펑크 스타일..." value={agentInput.criticArtInfo} onChange={(e) => setAgentInput({...agentInput, criticArtInfo: e.target.value})} style={{height: '100px', marginBottom: '15px'}}/>
                        </div>
                        <button className="glow-btn" onClick={runCritic} disabled={activeAgentLoading !== null} style={{marginTop: 'auto', padding: '14px', background: '#3B82F6', color: '#fff', border: 'none'}}>
                            {activeAgentLoading === 'critic' ? <><span className="loading-spinner"></span>작품 심층 분석 중...</> : "비평 작성 요청"}
                        </button>
                        {activeAgentLoading === 'critic' && <div className="ai-processing-text" style={{color: '#38BDF8'}}>✨ 미술사적 맥락 파악 중...</div>}
                        {agentResult.critic && (
                            <div className="result-box" style={{background: '#0F0F0F', border: '1px solid #2A2A2A', marginTop: '20px'}}>
                                <h4 style={{color: '#38BDF8', borderBottom: '1px dashed #2A2A2A', paddingBottom: '10px', marginTop: 0}}>📜 비평문</h4>
                                <p style={{color: '#D1D5DB', fontSize: '0.95rem'}}>{agentResult.critic}</p>
                                <button className="sm-btn" onClick={() => setAgentInput({...agentInput, auctionReview: agentResult.critic})} style={{background: '#374151', color: '#fff', marginTop: '15px', padding: '8px 12px', border: 'none', borderRadius: '6px', cursor: 'pointer', width: '100%'}}>
                                    👉 비평 결과를 경매사에게 전달
                                </button>
                            </div>
                        )}
                    </div>

                    {/* 2. 마케터 */}
                    <div className={`card agent-card ${activeAgentLoading === 'marketer' ? 'loading' : ''}`} style={{background: '#1A1A1A', border: '1px solid #2A2A2A', borderRadius: '16px', display: 'flex', flexDirection: 'column'}}>
                        <div className="agent-header" style={{borderBottom: '1px solid #2A2A2A', paddingBottom: '15px'}}>
                            <span className="icon">📢</span><h3 style={{color: '#fff', margin: 0, fontSize: '1.2rem'}}>Viral Marketer</h3>
                        </div>
                        <p className="role-desc" style={{color: '#9CA3AF', marginTop: '15px', marginBottom: '20px', height: '40px'}}>전시회 홍보를 위한 SNS 바이럴 카피를 작성합니다.</p>
                        <div className="input-group" style={{flex: 1}}>
                            <label style={{color: '#D1D5DB', marginBottom: '8px', display: 'block', fontWeight: 'bold'}}>전시회 제목</label>
                            <input type="text" className="glass-input" placeholder="예: 2050 서울의 밤" value={agentInput.marketerTitle} onChange={(e) => setAgentInput({...agentInput, marketerTitle: e.target.value})} style={{marginBottom: '15px'}}/>
                            <label style={{color: '#D1D5DB', marginBottom: '8px', display: 'block', fontWeight: 'bold'}}>타겟 관객</label>
                            <input type="text" className="glass-input" placeholder="예: 20대 힙스터" value={agentInput.marketerTarget} onChange={(e) => setAgentInput({...agentInput, marketerTarget: e.target.value})} style={{marginBottom: '15px'}}/>
                        </div>
                        <button className="glow-btn" onClick={runMarketer} disabled={activeAgentLoading !== null} style={{marginTop: 'auto', padding: '14px', background: '#10B981', color: '#fff', border: 'none'}}>
                            {activeAgentLoading === 'marketer' ? <><span className="loading-spinner"></span>홍보 문구 생성 중...</> : "홍보 문구 생성"}
                        </button>
                        {activeAgentLoading === 'marketer' && <div className="ai-processing-text" style={{color: '#34D399'}}>🚀 트렌드 분석 및 해시태그 조합 중...</div>}
                        {agentResult.marketer && (
                            <div className="result-box" style={{background: '#0F0F0F', border: '1px solid #2A2A2A', marginTop: '20px'}}>
                                <h4 style={{color: '#34D399', borderBottom: '1px dashed #2A2A2A', paddingBottom: '10px', marginTop: 0}}>📱 인스타그램 카피</h4>
                                <p style={{whiteSpace: "pre-line", color: '#D1D5DB', fontSize: '0.95rem'}}>{agentResult.marketer}</p>
                            </div>
                        )}
                    </div>

                    {/* 3. 경매사 */}
                    <div className={`card agent-card ${activeAgentLoading === 'auction' ? 'loading' : ''}`} style={{background: '#1A1A1A', border: '1px solid #2A2A2A', borderRadius: '16px', display: 'flex', flexDirection: 'column'}}>
                        <div className="agent-header" style={{borderBottom: '1px solid #2A2A2A', paddingBottom: '15px'}}>
                            <span className="icon">🔨</span><h3 style={{color: '#fff', margin: 0, fontSize: '1.2rem'}}>Auctioneer</h3>
                        </div>
                        <p className="role-desc" style={{color: '#9CA3AF', marginTop: '15px', marginBottom: '20px', height: '40px'}}>비평을 바탕으로 경매 시작가를 책정하고 멘트를 합니다.</p>
                        <div className="input-group" style={{flex: 1}}>
                            <label style={{color: '#D1D5DB', marginBottom: '8px', display: 'block', fontWeight: 'bold'}}>작품 정보</label>
                            <input type="text" className="glass-input" placeholder="작품 설명 입력" value={agentInput.auctionArtInfo} onChange={(e) => setAgentInput({...agentInput, auctionArtInfo: e.target.value})} style={{marginBottom: '15px'}}/>
                            <label style={{color: '#D1D5DB', marginBottom: '8px', display: 'block', fontWeight: 'bold'}}>비평가 리뷰 (전달받음)</label>
                            <textarea className="glass-textarea" placeholder="비평가가 쓴 글을 입력하세요" value={agentInput.auctionReview} onChange={(e) => setAgentInput({...agentInput, auctionReview: e.target.value})} style={{height: '100px', marginBottom: '15px'}}/>
                        </div>
                        <button className="glow-btn" onClick={runAuction} disabled={activeAgentLoading !== null} style={{marginTop: 'auto', padding: '14px', background: '#F59E0B', color: '#fff', border: 'none'}}>
                            {activeAgentLoading === 'auction' ? <><span className="loading-spinner"></span>가치 산정 중...</> : "경매 리포트 생성"}
                        </button>
                        {activeAgentLoading === 'auction' && <div className="ai-processing-text" style={{color: '#FBBF24'}}>💰 데이터 대조 및 시작가 책정 중...</div>}
                        {agentResult.auction && (
                            <div className="result-box" style={{background: '#0F0F0F', border: '1px solid #2A2A2A', marginTop: '20px'}}>
                                <h4 style={{color: '#FBBF24', borderBottom: '1px dashed #2A2A2A', paddingBottom: '10px', marginTop: 0}}>💰 경매 리포트</h4>
                                <p style={{whiteSpace: "pre-line", color: '#D1D5DB', fontSize: '0.95rem'}}>{agentResult.auction}</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}

        {/* 갤러리 */}
        {activeTab === "gallery" && (
            <div className="page fade-in">
                <h2>🖼️ Online Gallery</h2>
                <div className="gallery-grid">
                    {galleryItems.map(item => (
                        <div key={item.id} className="card gallery-card" style={{background: '#1A1A1A', border: '1px solid #2A2A2A'}}>
                            <div className="img-wrap" style={{borderBottom: '1px solid #2A2A2A'}}>
                                <img src={item.image_url} alt={item.title}/>
                            </div>
                            <div className="info" style={{padding: '15px'}}>
                                <h3 style={{color: '#fff', margin: '0 0 5px 0'}}>{item.title}</h3>
                                <p style={{color: '#9CA3AF', fontSize: '0.85rem'}}>Artist: {item.artist_address ? item.artist_address.substring(0,6) : "Unknown"}</p>
                                <div className="gallery-btns" style={{marginTop: '15px', display: 'flex', gap: '10px'}}>
                                    <button onClick={()=>playDocent(item.id, item.title)} style={{flex: 1, background: '#0F0F0F', color: '#fff', border: '1px solid #2A2A2A', padding: '8px', borderRadius: '6px', cursor: 'pointer'}}>🎧 도슨트</button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {/* 마이페이지 */}
        {activeTab === "mypage" && (
            <div className="page fade-in">
                <h2>👤 My Profile</h2>
                {!isLoggedIn ? <p style={{color: '#9CA3AF'}}>지갑을 먼저 연결해주세요.</p> : (
                    <div className="mypage-grid">
                        <div className="card profile">
                            <h3 style={{color: '#fff'}}>내 정보</h3>
                            <p style={{color: '#9CA3AF'}}><strong>주소:</strong> {walletAddress}</p>
                            <p style={{color: '#9CA3AF'}}><strong>보유 토큰:</strong> {myInfo.balance} ART</p>
                        </div>
                    </div>
                )}
            </div>
        )}
      </main>

      {/* 3. 우측 고정 패널 */}
      <aside className="right-panel">
        <div className="right-panel-header">
            <span style={{ fontSize: '1.2rem' }}>🤖</span> # ai-assistant
        </div>
        <div className="chat-window">
            <div className="messages">
                {chatMessages.map((msg, idx) => (
                    <div key={idx} className={`msg ${msg.sender}`}>
                        {msg.sender === "bot" && (
                            <div className="bot-name"><span>🤖</span> ArtDAO Guide</div>
                        )}
                        <div className="bubble" style={{ whiteSpace: "pre-line" }}>
                            {msg.text}
                        </div>
                    </div>
                ))}
                
                {isChatLoading && (
                    <div className="msg bot">
                        <div className="bot-name"><span>🤖</span> ArtDAO Guide</div>
                        <div className="chat-typing-indicator">
                            <div className="dot"></div>
                            <div className="dot"></div>
                            <div className="dot"></div>
                        </div>
                    </div>
                )}
            </div>
            
            <div className="chat-input-wrapper">
                <input 
                    type="text" 
                    value={chatInput} 
                    onChange={(e)=>setChatInput(e.target.value)} 
                    onKeyPress={(e)=>e.key==='Enter' && !isChatLoading && chatInput.trim() && sendMessage()} 
                    placeholder="작품 추천이나 투표 방법을 물어보세요!" 
                    disabled={isChatLoading} 
                    className="chat-text-input"
                />
                <button 
                    className="chat-send-btn" 
                    onClick={sendMessage} 
                    disabled={isChatLoading || !chatInput.trim()}
                >
                    ➤
                </button>
            </div>
        </div>
      </aside>
    </div>
  );
}

export default App;