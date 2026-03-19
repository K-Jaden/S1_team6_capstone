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
            const blockNum = await contract.runner.provider.getBlockNumber();
            const block = await contract.runner.provider.getBlock(blockNum);
            const nowBlockTime = Number(block.timestamp);
            setCurrentBlockTime(nowBlockTime);

            const chainProposals = await contract.getAllProposals();
            const statusMap = ["OPEN", "ACCEPTED", "REJECTED", "EXECUTED"];

            dbProposals = dbProposals.map(p => {
                const chainP = chainProposals[Number(p.id) - 1];
                // 블록체인 배열 길이보다 DB의 p.id가 크면 접근하지 않도록 보호
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
                return p; // 👈 에러 나면 그냥 DB 데이터만 반환
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

 const handleGenerateWithIPFS = async () => {
    setIsLoading(true);
    setStudioLoadingStep("🎨 AI 화가 에이전트가 프롬프트를 시각화 및 렌더링 중..."); 
    try {
        // ✅ 백엔드의 새 주소(/api/studio/image)와 새 변수명(keywords)으로 맞춤!
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
    // 1. 스튜디오에서 생성된 텍스트 원본 가져오기
    let cleanDescription = studioData.draft || "";

    // 2. [필터링 1] "3. AI 화가 이미지 프롬프트" 아랫부분 싹둑 자르기
    const splitKeyword = "=========================================\n✨ 3. AI 화가 이미지 프롬프트";
    if (cleanDescription.includes(splitKeyword)) {
        cleanDescription = cleanDescription.split(splitKeyword)[0];
    }

    // 3. [필터링 2] "**큐레이터:** [이름]..." 또는 "큐레이터: [이름]..." 들어간 줄 삭제 (정규식 사용)
    cleanDescription = cleanDescription.replace(/\*\*큐레이터:\*\*\s*\[이름\].*\n?/g, "");
    cleanDescription = cleanDescription.replace(/큐레이터:\s*\[이름\].*\n?/g, "");

    // 4. 위아래 쓸데없는 줄바꿈(엔터) 깔끔하게 정리
    cleanDescription = cleanDescription.trim();

    // 정제된 텍스트를 안건 작성 폼에 세팅하고 화면 이동!
    setProposalForm({
        title: studioData.intent || "AI 기획 안건",
        description: cleanDescription, // 👈 깔끔하게 다듬어진 텍스트 삽입!
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
  
  // ==========================================
  // 🔥 [수정됨] A2A 파이프라인 호출 함수 (에러 해결!)
  // ==========================================
  const handleStudioAction = async (type) => {
    if (type === 'draft') {
        setIsLoading(true);
        setStudioLoadingStep("🤖 AI 에이전트(기획자, 화가, 비평가)가 난상 토론을 진행 중입니다... (약 2분~3분 소요)");
        
        try {
            // 백엔드(main.py)의 정상적인 API 주소로 호출합니다.
            const res = await axios.post(`${API_URL}/api/studio/draft`, { intent: studioData.intent });
            
            // 백엔드가 이미 예쁘게 조립해서 보낸 draft_text를 그대로 화면에 넣습니다!
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
  // ✅ 안건 제출 (가스비 에러 완벽 해결)
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
        // 1. 이미지가 화면에 떠있는 Base64 글자라면? ➔ 무조건 IPFS 서버로 먼저 보냄!
        if (proposalForm.image_url && proposalForm.image_url.startsWith('data:image')) {
            console.log("🚀 엄청나게 큰 이미지 데이터를 IPFS로 피신시키는 중...");
            const ipfsRes = await axios.post(`${API_URL}/api/ipfs/finalize`, {
                image_url: proposalForm.image_url,
                title: proposalForm.title,
                description: proposalForm.description,
                wallet_address: walletAddress
            });

            if (ipfsRes.data.status === "success") {
                // 🚨 IPFS 서버가 반환해준 아주 짧은 주소(ipfs://...)로 교체!
                finalUriToSave = ipfsRes.data.token_uri || ipfsRes.data.image_ipfs_url;
                console.log("✅ IPFS 영구 저장소 변환 완료! 짧은 주소:", finalUriToSave);
            } else {
                throw new Error("IPFS 업로드 실패: " + ipfsRes.data.error);
            }
        }

        // 🚨 [핵심 방어막] IPFS 통신에 실패해서 여전히 Base64라면 트랜잭션 강제 중단!
        if (finalUriToSave && finalUriToSave.startsWith('data:image')) {
            throw new Error("이미지 IPFS 변환에 실패했습니다. (Base64 데이터는 블록체인에 올릴 수 없습니다.)");
        }

        alert("지갑에서 트랜잭션을 승인해주세요...");
        
        const quorumWei = ethers.parseUnits(proposalForm.quorum.toString(), 18);
        const fundingWei = ethers.parseUnits(proposalForm.fundingAmount.toString(), 18);

        console.log("🚀 스마트 컨트랙트에 트랜잭션 전송 중...");
        
        // 기획서가 너무 길면 블록체인 가스비가 터지므로 150자로 자르고 원본은 DB에 둔다고 명시
        let onChainDescription = proposalForm.description;
        if (onChainDescription.length > 150) {
            const cutIndex = onChainDescription.lastIndexOf(' ', 150);
            const safeIndex = cutIndex > 0 ? cutIndex : 150;
            onChainDescription = onChainDescription.substring(0, safeIndex) + " ...\n\n[이 안건의 전체 기획서 원문은 ArtDAO 오프체인 DB 및 IPFS에 영구 보존되어 있습니다.]";
        }

        // 🚨 드디어 짧고 안전한 주소(finalUriToSave)를 블록체인에 전송!
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
        
        // 블록체인 기록이 끝나면 오프체인(MySQL) DB에도 저장
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
      // 🚨 바뀐 부분: null과 params를 없애고 JSON 객체를 바로 던집니다.
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
  // 5. UI 렌더링 (Botto DAO 스타일 3단 레이아웃 완벽 병합본)
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

        {/* 블록체인 시간 동기화 (다크모드 맞춤) */}
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
        {/* 상단 지갑 연결 헤더 */}
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

        {/* 탭: 메인 (대시보드) */}
        {activeTab === "main" && (
          <div className="page fade-in">
            <h2>ArtDAO Engine</h2>
            <p className="page-desc">
              Browse through ArtDAO's collections of knowledge and proposals. Add entries to improve the AI's understanding of the art world.
            </p>
            
            <div className="dashboard-grid">
                {/* 좌측 요약 카드 */}
                <div className="card summary" onClick={()=>setActiveTab("proposals")}>
                    <h3>Active Proposals</h3>
                    <p className="highlight">{proposals.filter(p=>p.status==="OPEN").length} <span style={{fontSize: '1rem', color: '#9CA3AF', fontWeight: 'normal'}}>ongoing</span></p>
                    <span>View all &rarr;</span>
                </div>
                
                {/* 우측 컬렉션 리스트 */}
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

{/* ✅ 안건 목록 */}
        {activeTab === "proposals" && (
          <div className="page fade-in">
            <div className="proposals-header-wrap">
                <div>
                    <h2>🗳️ Governance Proposals</h2>
                    <p style={{color: '#9CA3AF', marginTop: '5px', fontSize: '0.95rem'}}>ArtDAO의 미래를 결정할 기획 안건에 투표하세요.</p>
                </div>
                <div className="filter-group">
                    <button className="filter-btn active" onClick={()=>fetchProposals("OPEN")}>진행중</button>
                    <button className="filter-btn" onClick={()=>fetchProposals(null)}>전체 보기</button>
                </div>
            </div>
            
            <div className="list">
                {proposals.map(p => (
                    <div key={p.id} className="proposal-premium-card" onClick={() => setSelectedProposal(p)}>
                        
                        <div className="proposal-content-left">
                            <div className="proposal-meta">
                                <span className={`badge-premium ${p.status === 'CLOSED' ? 'CLOSED' : p.status}`}>
                                    {p.status === "CLOSED" ? "CLOSED (결산 대기)" : p.status}
                                </span>
                                <span style={{color: '#6B7280', fontSize: '0.85rem', fontFamily: 'monospace'}}>
                                    ID: #{p.id}
                                </span>
                            </div>
                            
                            <h3 className="proposal-premium-title">{p.title}</h3>
                            <p className="proposal-premium-desc">
                                {p.description ? p.description : "상세 내용이 없습니다."}
                            </p>
                            
                            <div className="proposal-footer-info">
                                <span>🗳️ 현재 참여: {p.voteCount + p.againstCount || 0} Votes</span>
                                <span className="read-more-premium">자세히 보기 &rarr;</span>
                            </div>
                        </div>

                        {/* 우측 썸네일 이미지 영역 */}
                        <div className="proposal-thumbnail-box">
                            {p.image_url ? (
                                <img 
                                    src={p.image_url.startsWith('data:image') ? p.image_url : p.image_url.replace("ipfs://", "https://ipfs.io/ipfs/")} 
                                    alt="Thumbnail" 
                                    onError={(e) => { e.target.style.display = 'none'; }}
                                />
                            ) : (
                                <span style={{fontSize: '2rem', opacity: 0.3}}>🖼️</span>
                            )}
                            
                            {/* 관리자용 삭제 버튼 (이미지 위에 작게 플로팅) */}
                            {isLoggedIn && ADMIN_WALLETS.map(w => w.toLowerCase()).includes(walletAddress.toLowerCase()) && (
                                <button 
                                    onClick={(e) => deleteProposal(p.id, e)}
                                    style={{position: 'absolute', top: '5px', right: '5px', background: 'rgba(239, 68, 68, 0.8)', color: 'white', border: 'none', borderRadius: '50%', width: '25px', height: '25px', cursor: 'pointer', zIndex: 10}}
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <button 
                className="glow-btn" 
                style={{marginTop: '20px', maxWidth: '300px', display: 'block', marginLeft: 'auto', marginRight: 'auto'}}
                onClick={()=>{
                    setProposalForm({ title: "", description: "", style: "General", image_url: "", meta_hash: "", voteType: 0, duration: 3, quorum: 10, fundingAmount: 100 });
                    setActiveTab("write");
                }}
            >
                ✨ 새 기획 안건 작성하기
            </button>
          </div>
        )}
        {/* ✅ 상세 보기 모달 */}
        {selectedProposal && (
            <div className="modal-overlay" onClick={closeModal} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.8)', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, padding: '20px' }}>
                <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ background: '#1A1A1A', color: '#F3F4F6', width: '100%', maxWidth: '850px', maxHeight: '90vh', overflowY: 'auto', borderRadius: '16px', padding: '30px', position: 'relative', border: '1px solid #2A2A2A' }}>
                    
                    <button onClick={closeModal} style={{ position: 'absolute', top: '20px', right: '20px', background: '#0F0F0F', border: '1px solid #2A2A2A', borderRadius: '50%', width: '40px', height: '40px', fontSize: '20px', cursor: 'pointer', color: '#9CA3AF', zIndex: 10 }}>✖</button>
                    
                    <div className="modal-header" style={{borderBottom: '1px solid #2A2A2A', background: 'transparent'}}>
                        <div style={{ background: "#0F0F0F", padding: "10px", borderRadius: "8px", marginBottom: "15px", border: "1px solid #2A2A2A", fontSize: "0.9em", color: "#3B82F6" }}>
                            <strong>🔗 Blockchain Verified</strong>
                            <div style={{ marginTop: "4px", fontFamily: "monospace", wordBreak: "break-all", color: '#9CA3AF' }}>
                                Tx Hash: {selectedProposal.meta_hash || "처리 중..."}
                            </div>
                        </div>
                        
                        <span 
                            className={`status-badge ${selectedProposal.status === 'CLOSED' ? 'REJECTED' : selectedProposal.status}`} 
                            style={selectedProposal.status === 'CLOSED' ? {backgroundColor: '#374151', color: '#9CA3AF', display: 'inline-block', padding: '4px 8px', borderRadius: '12px', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '10px'} : {backgroundColor: '#10B981', color: '#fff', display: 'inline-block', padding: '4px 8px', borderRadius: '12px', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '10px'}}
                        >
                            {selectedProposal.status === "CLOSED" ? "CLOSED (결산 대기)" : selectedProposal.status}
                        </span>
                        <h2 style={{color: '#fff'}}>{selectedProposal.title}</h2>
                        
                        <div style={{ fontSize: "0.95rem", color: "#9CA3AF", marginTop: "15px", background: "#0F0F0F", padding: "12px", borderRadius: "8px", border: '1px solid #2A2A2A' }}>
                            <div style={{ marginBottom: "6px" }}>
                                ⏳ <strong>투표 기간:</strong> {selectedProposal.duration || 3}일
                            </div>
                            <div style={{ marginBottom: "6px" }}>
                                🛑 <strong>마감:</strong> {selectedProposal.deadline 
                                    ? new Date(selectedProposal.deadline * 1000).toLocaleString() 
                                    : "데이터 로딩 중..."}
                            </div>
                            <div style={{ borderTop: "1px solid #2A2A2A", paddingTop: "6px", marginTop: "6px" }}>
                                🎯 <strong>목표 정족수:</strong> {selectedProposal.quorum || 0}표
                            </div>
                        </div>
                    </div>

                    {/* 모달 본문 */}
                    <div style={{ display: 'flex', flexDirection: 'row', gap: '20px', margin: '20px 0', minHeight: '400px', width: '100%', alignItems: 'stretch' }}>
                        <div style={{ flex: '1', width: '50%', backgroundColor: '#0F0F0F', borderRadius: '16px', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid #2A2A2A' }}>
                            {selectedProposal.image_url ? (
                                <div style={{ flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '15px' }}>
                                    <img 
                                        src={selectedProposal.image_url.startsWith('data:image') ? selectedProposal.image_url : selectedProposal.image_url.replace("ipfs://", "https://ipfs.io/ipfs/")} 
                                        alt="Proposal Art" 
                                        style={{ maxWidth: '100%', maxHeight: '350px', objectFit: 'contain' }}
                                    />
                                </div>
                            ) : (
                                <div style={{ flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>첨부된 이미지가 없습니다.</div>
                            )}
                        </div>
                        <div style={{ flex: '1', width: '50%', background: '#0F0F0F', padding: '25px', borderRadius: '16px', border: '1px solid #2A2A2A', overflowY: 'auto', maxHeight: '420px' }}>
                            <h3 style={{ marginTop: 0, color: '#fff', borderBottom: '1px solid #2A2A2A', paddingBottom: '12px' }}>📜 안건 내용</h3>
                            <div style={{ whiteSpace: 'pre-wrap', color: '#D1D5DB', fontSize: '1rem', lineHeight: '1.8', marginTop: '15px' }}>
                                {selectedProposal.description || "안건 내용이 등록되지 않았습니다."}
                            </div>
                        </div>
                    </div>

                    <div className="modal-footer" style={{ flexDirection: 'column', alignItems: 'stretch', marginTop: '10px', borderTop: '1px solid #2A2A2A', paddingTop: '20px', background: 'transparent' }}>
                        <div style={{ padding: '20px', background: '#0F0F0F', borderRadius: '12px', border: '1px solid #2A2A2A', marginBottom: '20px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                <label style={{ fontWeight: 'bold', color: '#fff', fontSize: '1.1rem' }}>투표할 토큰 수량 (TUK)</label>
                                <span style={{ fontSize: '0.9rem', color: '#3b82f6', background: '#1A1A1A', padding: '6px 12px', borderRadius: '20px', border: '1px solid #2A2A2A' }}>내 보유량: {myInfo.balance} TUK</span>
                            </div>
                            <input 
                                type="number" 
                                value={voteAmount} 
                                onChange={(e) => setVoteAmount(e.target.value)}
                                placeholder="사용할 토큰 수량을 입력하세요 (예: 10)"
                                style={{ width: '100%', padding: '15px', borderRadius: '10px', border: '1px solid #2A2A2A', background: '#1A1A1A', color: '#fff', fontSize: '1rem', boxSizing: 'border-box', outline: 'none' }}
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                            <button className="vote-btn yes" onClick={() => handleVote(selectedProposal.id, true)} disabled={selectedProposal.status === "CLOSED" || selectedProposal.deadline < currentBlockTime} style={{ flex: 1, padding: '15px', fontSize: '1.1rem' }}>👍 찬성 투표</button>
                            <button className="vote-btn no" onClick={() => handleVote(selectedProposal.id, false)} disabled={selectedProposal.status === "CLOSED" || selectedProposal.deadline < currentBlockTime} style={{ flex: 1, padding: '15px', fontSize: '1.1rem' }}>👎 반대 투표</button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* 안건 작성 */}
        {activeTab === "write" && (
            <div className="page fade-in">
                <h2 style={{fontFamily: "'Playfair Display', serif", fontSize: "2.5rem", marginBottom: "10px"}}>📝 Create Proposal</h2>
                <p style={{color: '#9CA3AF', marginBottom: '30px'}}>새로운 전시 안건이나 DAO 정책을 제안해 주세요.</p>
                
                <div className="card form-card" style={{background: '#1A1A1A', border: '1px solid #2A2A2A', borderRadius: '16px', padding: '30px'}}>
                    
                    <label style={{color: '#D1D5DB', fontWeight: '600', marginBottom: '8px'}}>안건 제목 (Title)</label>
                    <input type="text" value={proposalForm.title} onChange={(e)=>setProposalForm({...proposalForm, title: e.target.value})} placeholder="제목 입력" style={{background: '#0F0F0F', color: '#fff', border: '1px solid #2A2A2A', padding: '14px', borderRadius: '8px', width: '100%', marginBottom: '20px', outline: 'none', boxSizing: 'border-box'}}/>
            
                    <label style={{color: '#D1D5DB', fontWeight: '600', marginBottom: '8px'}}>상세 내용</label>
                    <textarea rows="6" value={proposalForm.description} onChange={(e)=>setProposalForm({...proposalForm, description: e.target.value})} placeholder="내용 입력" style={{background: '#0F0F0F', color: '#fff', border: '1px solid #2A2A2A', padding: '14px', borderRadius: '8px', width: '100%', marginBottom: '20px', outline: 'none', resize: 'vertical', boxSizing: 'border-box'}}/>

                    <label style={{color: '#D1D5DB', fontWeight: '600', marginBottom: '8px'}}>스타일 (Style)</label>
                    <select value={proposalForm.style} onChange={(e)=>setProposalForm({...proposalForm, style: e.target.value})} style={{background: '#0F0F0F', color: '#fff', border: '1px solid #2A2A2A', padding: '14px', borderRadius: '8px', width: '100%', marginBottom: '20px', outline: 'none', boxSizing: 'border-box'}}>
                        <option value="General">General</option>
                        <option value="Cyberpunk">Cyberpunk</option>
                        <option value="Abstract">Abstract</option>
                        <option value="Realistic">Realistic</option>
                        <option value="AI Generated">AI Generated</option>
                    </select>

                    <label style={{color: '#D1D5DB', fontWeight: '600', marginBottom: '8px'}}>투표 방식 설정 (Vote Type)</label>
                    <select value={proposalForm.voteType} onChange={(e) => setProposalForm({...proposalForm, voteType: parseInt(e.target.value)})} style={{background: '#0F0F0F', color: '#fff', border: '1px solid #2A2A2A', padding: '14px', borderRadius: '8px', width: '100%', marginBottom: '20px', outline: 'none', boxSizing: 'border-box'}}>
                        <option value={0}>가중치 투표 (1 TUK = 1 표)</option>
                        <option value={1}>제곱근 투표 (Quadratic Voting)</option>
                    </select>

                    <div style={{ display: "flex", gap: "20px", marginBottom: "20px" }}>
                        <div style={{ flex: 1 }}>
                            <label style={{color: '#D1D5DB', fontWeight: '600', display: 'block', marginBottom: '8px'}}>투표 기간 (일)</label>
                            <input type="number" value={proposalForm.duration} onChange={(e) => setProposalForm({...proposalForm, duration: e.target.value})} placeholder="예: 3" style={{background: '#0F0F0F', color: '#fff', border: '1px solid #2A2A2A', padding: '14px', borderRadius: '8px', width: '100%', outline: 'none', boxSizing: 'border-box'}} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{color: '#D1D5DB', fontWeight: '600', display: 'block', marginBottom: '8px'}}>목표 정족수</label>
                            <input type="number" value={proposalForm.quorum} onChange={(e) => setProposalForm({...proposalForm, quorum: e.target.value})} placeholder="예: 10" style={{background: '#0F0F0F', color: '#fff', border: '1px solid #2A2A2A', padding: '14px', borderRadius: '8px', width: '100%', outline: 'none', boxSizing: 'border-box'}} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{color: '#D1D5DB', fontWeight: '600', display: 'block', marginBottom: '8px'}}>지원금 (TUK)</label>
                            <input type="number" value={proposalForm.fundingAmount} onChange={(e) => setProposalForm({...proposalForm, fundingAmount: e.target.value})} placeholder="예: 100" style={{background: '#0F0F0F', color: '#fff', border: '1px solid #2A2A2A', padding: '14px', borderRadius: '8px', width: '100%', outline: 'none', boxSizing: 'border-box'}} />
                        </div>
                    </div>

                    {proposalForm.image_url && (
                        <div className="img-preview" style={{background: '#0F0F0F', padding: '15px', borderRadius: '12px', border: '1px solid #2A2A2A', marginBottom: '20px', textAlign: 'center'}}>
                            <p style={{color: '#9CA3AF', marginTop: 0, marginBottom: '10px', textAlign: 'left', fontWeight: 'bold'}}>🖼️ 첨부된 이미지 미리보기</p>
                            <img src={proposalForm.image_url} alt="attached" style={{maxWidth: '100%', maxHeight: '300px', borderRadius: '8px', objectFit: 'contain', border: '1px solid #2A2A2A'}}/>
                        </div>
                    )}
            
                    <div className="btn-group" style={{marginTop: '10px', display: 'flex', gap: '15px'}}>
                        <button className="cancel" onClick={()=>setActiveTab("proposals")} style={{background: '#374151', color: '#fff', padding: '14px 24px', border: 'none', borderRadius: '8px', cursor: 'pointer', flex: 1, fontSize: '1.05rem', fontWeight: 'bold'}}>취소</button>
                        <button className="primary" onClick={submitProposal} style={{background: '#3B82F6', color: '#fff', padding: '14px 24px', border: 'none', borderRadius: '8px', cursor: 'pointer', flex: 2, fontSize: '1.05rem', fontWeight: 'bold'}}>제출하기</button>
                    </div>
                </div>
            </div>
        )}

       {/* AI 스튜디오 */}
        {activeTab === "studio" && (
            <div className="page fade-in">
                <h2>🎨 AI Art Studio</h2>
                <p className="page-desc">최첨단 AI 에이전트들과 함께 당신만의 전시 기획서와 메인 아트워크를 창조하세요.</p>
                <div className="studio-layout">
                    {/* 왼쪽 카드 */}
                    <div className="studio-card">
                        <h3 style={{color: '#F3F4F6', fontSize: '1.2rem', marginBottom: '20px', display:'flex', alignItems:'center', gap:'10px'}}>
                           <span>💡</span> 1. 기획 의도 입력
                        </h3>
                        <input 
                            type="text" 
                            className="glass-input"
                            placeholder="예: 네온사인이 빛나는 사이버펑크 고양이 도시" 
                            value={studioData.intent} 
                            onChange={(e)=>setStudioData({...studioData, intent: e.target.value})} 
                        />
                        <button 
                            className="glow-btn" 
                            onClick={()=>handleStudioAction('draft')} 
                            disabled={isLoading || !studioData.intent.trim()}
                        >
                            📜 기획서 생성 (A2A 시작)
                        </button>
                    </div>
                    
                    {/* 오른쪽 카드 */}
                    <div className="studio-card">
                        <h3 style={{color: '#F3F4F6', fontSize: '1.2rem', marginBottom: '20px', display:'flex', alignItems:'center', gap:'10px'}}>
                            <span>✨</span> 2. 결과물 확인
                        </h3>
                        
                       {isLoading && studioLoadingStep && (
                            <div className="a2a-premium-thinking">
                                <div className="a2a-header-title">
                                    <span 
                                        className="loading-spinner" 
                                        style={{width: '20px', height: '20px', borderTopColor: '#38BDF8', borderColor: 'rgba(56,189,248,0.2)'}}>
                                    </span>
                                    Agent Network Protocol
                                </div>
                                <div className="a2a-steps-wrapper">
                                    <div className="a2a-step-item done">
                                        유저 인텐트(의도) 분석 및 기초 데이터 수집 완료
                                    </div>
                                    <div className="a2a-step-item active">
                                        <span style={{fontSize: '1.2rem', marginRight: '6px', verticalAlign: 'middle'}}>🤖</span>
                                        {studioLoadingStep}
                                    </div>
                                </div>
                            </div>
                        )}

                        {!isLoading && !studioData.draft && !studioData.image && (
                            <div style={{flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4B5563', border: '1px dashed #333', borderRadius: '12px', minHeight: '200px'}}>
                                아직 생성된 결과물이 없습니다.
                            </div>
                        )}

                        {studioData.draft && !isLoading && (
                            <>
                                <textarea 
                                    className="glass-textarea" 
                                    value={studioData.draft} 
                                    readOnly 
                                    style={{ height: "250px", marginBottom: "15px" }} 
                                />
                                <button 
                                    className="glow-btn" 
                                    onClick={()=>handleStudioAction('image')} 
                                    disabled={isLoading}
                                >
                                    🎨 메인 포스터 렌더링
                                </button>
                            </>
                        )}
                        {studioData.image && !isLoading && (
                            <div className="final-result" style={{marginTop: '20px'}}>
                                <img 
                                    src={studioData.image} 
                                    alt="Generated" 
                                    style={{borderRadius: '12px', border: '1px solid #333', width: '100%', boxShadow: '0 4px 20px rgba(0,0,0,0.5)'}} 
                                />
                                <button className="glow-btn" onClick={sendToProposalWrite} style={{background: '#3B82F6', color: '#fff'}}>
                                    👉 이 결과물로 안건 제출하기
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}
        {/* 에이전트 센터 */}
        {activeTab === "agents" && (
            <div className="page fade-in">
                <h2 style={{fontFamily: "'Playfair Display', serif", fontSize: "2.5rem", marginBottom: "10px"}}>💼 AI Agent Squad</h2>
                <p style={{color: '#9CA3AF', marginBottom: '30px'}}>각 분야의 AI 전문가들에게 작품 비평, 마케팅, 경매 산정을 의뢰하세요.</p>
                
                {/* 👇 무조건 가로로 3개 나란히 배치되도록 Grid 강제 고정! */}
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

      {/* 3. 우측 고정 패널 (AI 만능 어시스턴트) */}
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
                
                {/* 세련된 타이핑 인디케이터 (점 3개 애니메이션) */}
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
            
            {/* 전송 버튼이 포함된 둥근 입력창 */}
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