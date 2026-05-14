import React, { useState, useEffect, useRef } from 'react';
import axios from "axios";
import { ethers } from "ethers";
import "./App.css";

import { DAO_CONTRACT_ADDRESS as CONTRACT_ADDRESS, TUK_TOKEN_ADDRESS } from './contracts/address';
import ArtPlanningDAO from './contracts/ArtPlanningDAO.json';

const currentHost = window.location.hostname;
const API_URL = currentHost === "localhost" 
  ? "http://localhost:8000" 
  : "http://13.125.234.38:8000";

// 🔥 [NEW] AI Core 서버 주소 (SSE 직접 연결용)
const AI_CORE_URL = currentHost === "localhost"
  ? "http://localhost:8002"
  : "http://13.125.234.38:8002";

function App() {
  
  // ==========================================
  // 1. 핵심 상태 관리 (State)
  // ==========================================
  const [activeTab, setActiveTab] = useState("main"); 
  const [walletAddress, setWalletAddress] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  
  const [myInfo, setMyInfo] = useState({ balance: 0, membership: "", rewards: 0 });
  const [galleryItems, setGalleryItems] = useState([]);
  const [endedRounds, setEndedRounds] = useState([]);
  
  const [currentRound, setCurrentRound] = useState(null);
  const [vpInputs, setVpInputs] = useState({}); 
  const [isLoading, setIsLoading] = useState(false);

  const [insightsData, setInsightsData] = useState(null);
  const [isInsightsLoading, setIsInsightsLoading] = useState(false);

  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    { sender: "bot", text: "안녕하세요! ArtDAO 큐레이터입니다. 투표 방법이나 추천 작품을 물어보세요!" }
  ]);

  const [currentBlockTime, setCurrentBlockTime] = useState(Math.floor(Date.now() / 1000));
  const [contract, setContract] = useState(null);

  // 🔥 [NEW] 에이전트 난상토론 라이브 뷰어 상태
  const [showDiscussion, setShowDiscussion] = useState(false);
  const [discussionLogs, setDiscussionLogs] = useState([]);
  const [isDiscussing, setIsDiscussing] = useState(false);
  const eventSourceRef = useRef(null);
  const discussionEndRef = useRef(null);
  const [isChatOpen, setIsChatOpen] = useState(false);

  // ==========================================
  // 🔥 [NEW] Co-creation (Human-in-the-loop) 상태
  // ==========================================
  const [roundPhase, setRoundPhase] = useState("VOTING"); // "KEYWORD", "VOTING", "VALUATION"
  
  // Step 1: 키워드 투표 상태
  const mockKeywords = ['Cyberpunk', 'Cubism', 'Seoul', 'Impressionism', 'Minimalism', 'Space', 'Dystopia', 'Neon'];
  const [selectedKeywords, setSelectedKeywords] = useState([]);
  
  // Step 2: 결산 및 가치 책정 상태
  const [valuationPrice, setValuationPrice] = useState("");
  const [valuationDuration, setValuationDuration] = useState("7");
  
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
          } catch (err) { console.error("재연결 실패:", err); }
        };
        restoreContract();
      }
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn && walletAddress) {
        fetchMyPageData();
        fetchEndedRounds();
    }
    fetchGallery();   
  }, [isLoggedIn, walletAddress, contract]);

  const fetchEndedRounds = async () => {
      try {
          const res = await axios.get(`${API_URL}/api/rounds/ended`);
          setEndedRounds(res.data);
      } catch (err) { console.error("종료된 라운드 로드 실패"); }
  };

  useEffect(() => {
    if (activeTab === "curate") {
        fetchCurrentRound(); // 탭 누르자마자 1번 실행
        
        // 5초(5000ms)마다 백엔드에 최신 데이터 물어보기
        const timer = setInterval(() => {
            fetchCurrentRound();
        }, 5000);
        
        // 다른 탭으로 이동하면 타이머 끄기 (메모리 낭비 방지)
        return () => clearInterval(timer);
    }
}, [activeTab]);

  useEffect(() => {
      const timer = setInterval(() => setCurrentBlockTime(Math.floor(Date.now() / 1000)), 1000);
      return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeTab === "insights" && !insightsData) {
      const fetchInsights = async () => {
        setIsInsightsLoading(true);
        try {
          const res = await axios.get(`${API_URL}/api/insights/trends`);
          setInsightsData(res.data);
        } catch (err) { console.error("인사이트 로드 실패"); }
        setIsInsightsLoading(false);
      };
      fetchInsights();
    }
  }, [activeTab, insightsData]);

  // 🔥 [NEW] 새 토론 로그가 추가될 때마다 자동 스크롤
  useEffect(() => {
    if (discussionEndRef.current) {
      discussionEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [discussionLogs]);

  // 🔥 [NEW] 컴포넌트 언마운트 시 SSE 연결 정리
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

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
      alert("지갑 연결 성공!");
    } catch (err) { alert("지갑 연결 실패"); }
  };
  
  const handleLogout = async () => {
    try {
      if (walletAddress) await axios.post(`${API_URL}/api/auth/logout`, null, { params: { wallet_address: walletAddress } });
    } catch (err) {} 
    finally {
      localStorage.removeItem("walletAddress");
      setWalletAddress("");
      setIsLoggedIn(false);
      setMyInfo({ balance: 0, membership: "", rewards: 0 });
      setActiveTab("main");
    }
  };

  // ==========================================
  // 3. DAO 핵심 액션 함수
  // ==========================================
  const fetchMyPageData = async () => {
    if (!walletAddress) return;
    try {
      const resBal = await axios.get(`${API_URL}/api/wallet/balance`, { params: { wallet_address: walletAddress } });
      let displayBalance = resBal.data.balance;

      if (contract) {
          try {
              const remainingVpWei = await contract.getRemainingVP(walletAddress);
              displayBalance = ethers.formatEther(remainingVpWei);
          } catch(e) { console.error("VP 로드 에러:", e); }
      }
      setMyInfo(prev => ({ ...prev, balance: displayBalance }));
    } catch (err) { console.error("내 정보 로드 실패"); }
  };

  const fetchGallery = async () => {
    try {
        const res = await axios.get(`${API_URL}/api/gallery/items`);
        setGalleryItems(res.data);
    } catch (err) { console.error("갤러리 로드 실패"); }
  };

  const fetchCurrentRound = async () => {
      try {
          const res = await axios.get(`${API_URL}/api/rounds/current`);
          setCurrentRound(res.data);
      } catch (err) { setCurrentRound(null); }
  };

  const handleVote = async (candidateId) => {
      const amount = vpInputs[candidateId];
      if (!amount || amount <= 0) return alert("투표할 VP를 입력하세요!");
      if (!isLoggedIn) return alert("지갑을 먼저 연결해주세요!");
      if (!contract) return alert("스마트 컨트랙트가 연결되지 않았습니다.");

      try {
          alert("메타마스크에서 트랜잭션을 승인해 주세요! (가스비 발생)");
          const vpInWei = ethers.parseEther(amount.toString());
          
          const candidateIndex = currentRound.candidates.findIndex(c => c.id === candidateId);
          if(candidateIndex === -1) return alert("후보를 찾을 수 없습니다.");

          const tx = await contract.vote(candidateIndex, vpInWei);
          alert("트랜잭션 전송 완료! 블록체인 승인을 기다리는 중...");
          await tx.wait();
          
          await axios.post(`${API_URL}/api/vote`, {
              wallet_address: walletAddress,
              candidate_id: candidateId,
              vp_amount: parseInt(amount)
          });
          
          alert("🎉 투표가 블록체인에 성공적으로 기록되었습니다!");
          fetchCurrentRound();
          fetchMyPageData();
          setVpInputs({ ...vpInputs, [candidateId]: "" }); 
      } catch (err) { 
          console.error(err);
          alert("투표 실패: 트랜잭션을 거절했거나 VP가 부족합니다."); 
      }
  };

  const handleClaimReward = async (roundId) => {
      if (!contract) return alert("스마트 컨트랙트가 연결되지 않았습니다.");
      if (!roundId) return alert("청구할 라운드 번호를 입력하세요!");

      try {
          alert("메타마스크에서 배당금 청구 트랜잭션을 승인해 주세요!");
          const tx = await contract.claimReward(roundId);
          alert("트랜잭션 전송 완료! 승인을 기다리는 중...");
          const receipt = await tx.wait();

          let receivedAmount = "알 수 없음";
          for (const log of receipt.logs) {
              try {
                  const parsedLog = contract.interface.parseLog(log);
                  if (parsedLog && parsedLog.name === 'RewardClaimed') {
                      receivedAmount = ethers.formatEther(parsedLog.args.rewardAmount);
                  }
              } catch (e) {}
          }

          alert(`🎉 배당금이 지갑으로 성공적으로 지급되었습니다!\n지급 금액: ${receivedAmount} TUK`);
          fetchMyPageData();
      } catch (err) {
          console.error("Claim 에러:", err);
          alert("보상 청구 실패: 이미 수령했거나 우승작에 투표하지 않았습니다.");
      }
  };

  const [loadingStatus, setLoadingStatus] = useState("");

  // ==========================================
  // 🔥 [NEW] 에이전트 난상토론 라이브 뷰어 함수들
  // ==========================================
  
  // SSE 연결 시작 (토론 로그 실시간 수신)
  const startDiscussionStream = (sessionId) => {
    // 기존 연결 정리
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    // 토론창 초기화 및 오픈
    setDiscussionLogs([]);
    setShowDiscussion(true);
    setIsDiscussing(true);

    // SSE 연결 (AI Core에 직접 연결)
    const es = new EventSource(`${AI_CORE_URL}/api/agent/stream/${sessionId}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const log = JSON.parse(event.data);
        setDiscussionLogs(prev => [...prev, log]);

        // FINAL 신호 받으면 스트림 종료
        if (log.type === "final") {
          setIsDiscussing(false);
          setTimeout(() => {
            es.close();
            eventSourceRef.current = null;
          }, 1000);
        }
      } catch (e) {
        console.error("SSE 파싱 에러:", e);
      }
    };

    es.onerror = (err) => {
      console.error("SSE 연결 에러:", err);
      // 자동 재연결 시도하지 않음 (이미 토론이 끝났을 수 있음)
    };
  };

  // 토론창 닫기
  const closeDiscussion = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setShowDiscussion(false);
    setIsDiscussing(false);
  };

 // 에이전트별 아바타/색상 매핑
  const getAgentStyle = (agentRole) => {
    const map = {
      "트렌드 수집가":     { icon: "📡", color: "#34D399", bg: "rgba(52, 211, 153, 0.1)" }, // 에메랄드
      "키워드 스토리텔러": { icon: "✍️", color: "#A78BFA", bg: "rgba(167, 139, 250, 0.1)" }, // 보라색
      "가중치 프롬프터":   { icon: "💻", color: "#F472B6", bg: "rgba(244, 114, 182, 0.1)" }, // 핑크색
      "가치 증명자":       { icon: "📈", color: "#FBBF24", bg: "rgba(251, 191, 36, 0.1)" }, // 노란색
      "AI 큐레이터":       { icon: "💬", color: "#10B981", bg: "rgba(16, 185, 129, 0.1)" }, // 진한 초록
      "시스템":            { icon: "⚙️", color: "#60A5FA", bg: "rgba(96, 165, 250, 0.1)" }, // 파란색
    };

    // 💡 넘어온 이름에 위 키워드가 포함되어 있으면 해당 스타일을 반환
    const foundKey = Object.keys(map).find(key => agentRole && agentRole.includes(key));
    
    return foundKey ? map[foundKey] : { icon: "🤖", color: "#9CA3AF", bg: "rgba(156, 163, 175, 0.1)" };
  };
// ==========================================
  // 🔥 [NEW] Step 1. 트렌드 키워드 추출 & 새 라운드 생성 API
  // ==========================================
  const handleStartPhase1 = async () => {
    setIsLoading(true);
    setLoadingStatus("🤖 AI가 새로운 라운드 테마를 탐색 중입니다...");
    try {
      const res = await axios.post(`${API_URL}/api/admin/phase1-keywords`);
      setRoundPhase("KEYWORD"); // 화면 전환
      fetchCurrentRound();      // 방금 생성된 라운드 정보 불러오기
      setLoadingStatus("✅ 새 라운드가 생성되었습니다!");
      setTimeout(() => {
        alert(res.data.message);
        setIsLoading(false);
        setLoadingStatus("");
      }, 500);
    } catch (err) {
      console.error(err);
      alert("새 라운드 생성에 실패했습니다.");
      setIsLoading(false);
      setLoadingStatus("");
    }
  };

  // ==========================================
  // 🔥 [NEW] Step 1.5. 유저 키워드 투표 백엔드 전송 API
  // ==========================================
  const submitKeywordVote = async () => {
    if (!currentRound) return alert("진행 중인 라운드가 없습니다.");
    try {
      await axios.post(`${API_URL}/api/rounds/vote-keyword`, {
        round_id: currentRound.id,
        selected_words: selectedKeywords
      });
      alert(`[${selectedKeywords.join(', ')}] 투표 완료! \n\n상단의 'Step 2' 버튼을 눌러 그림을 렌더링하세요.`);
    } catch (err) {
      console.error(err);
      alert("키워드 투표 실패");
    }
  };
  // ==========================================
  // 4. 관리자 데모 함수 (🔥 SSE 연동)
  // ==========================================
  const handleGenerateRoundDemo = async () => {
      setIsLoading(true);
      
      // 🔥 [NEW] 1단계: 세션 ID 생성 후 SSE 먼저 연결
      const sessionId = `round_${Date.now()}`;
      startDiscussionStream(sessionId);
      
      const statuses = [
          "🤖 AI 비평가 에이전트가 최신 예술 트렌드를 분석하고 있습니다...",
          "🔍 트렌드 키워드 추출 완료. 프롬프트 엔지니어링 진행 중...",
          "🎨 후보작 1/2 렌더링 중 (Cloudflare FLUX-1)...",
          "🎨 후보작 2/2 렌더링 중 (Cloudflare FLUX-1)...",
          "🔗 오프체인 갤러리 등록 및 블록체인 라운드 시작 트랜잭션 전송 중..."
      ];
      
      let step = 0;
      setLoadingStatus(statuses[0]);
      const interval = setInterval(() => {
          step++;
          if (step < statuses.length) {
              setLoadingStatus(statuses[step]);
          }
      }, 15000);

      try {
          // 🔥 [수정] 옛날 URL(generate-round)을 새 URL(phase2-generate)로 변경!
          const targetRoundId = currentRound ? currentRound.id : 0;
          const res = await axios.post(`${API_URL}/api/admin/phase2-generate`, null, {
              params: { round_id: targetRoundId, session_id: sessionId }
          });
          clearInterval(interval);
          setLoadingStatus("✅ 라운드 생성 완료!");
          setTimeout(() => {
             alert(res.data.message);
             fetchCurrentRound();
             setIsLoading(false);
             setLoadingStatus("");
          }, 500);
      } catch (err) {
          clearInterval(interval);
          alert(err.response?.data?.detail || "생성 실패"); 
          setIsLoading(false);
          setLoadingStatus("");
      }
  };

  const handleEndRoundDemo = async () => {
      setIsLoading(true);
      
      // 🔥 [NEW] SSE 연결
      const sessionId = `endround_${Date.now()}`;
      startDiscussionStream(sessionId);
      
      const statuses = [
          "📊 투표 결과를 집계하고 있습니다...",
          "🔍 AI 경매사가 우승작의 예술적 가치와 득표수를 분석 중입니다...",
          "🎨 우승작 메타데이터를 IPFS에 영구 박제하는 중...",
          "💰 우승작을 ArtNFT로 발행하고 배당금 풀을 생성 중..."
      ];
      
      let step = 0;
      setLoadingStatus(statuses[0]);
      const interval = setInterval(() => {
          step++;
          if (step < statuses.length) {
              setLoadingStatus(statuses[step]);
          }
      }, 5000);

      try {
          // 🔥 [수정] 옛날 URL(end-round)을 새 URL(phase3-valuation)로 변경!
          const targetRoundId = currentRound ? currentRound.id : 0;
          const res = await axios.post(`${API_URL}/api/admin/phase3-valuation`, null, {
              params: { round_id: targetRoundId, session_id: sessionId }
          });
          clearInterval(interval);
          setLoadingStatus("✅ 결산 완료!");
          setTimeout(() => {
              // 🔥 [수정] 팝업창 메시지도 비평가 리포트를 띄우도록 변경
              alert(`🏆 가치 평가 완료!\n\n📜 비평가 리포트:\n${res.data.report}`);
              fetchCurrentRound(); 
              fetchGallery();
              setIsLoading(false);
              setLoadingStatus("");
          }, 500);
      } catch (err) {
          clearInterval(interval);
          alert("라운드 종료 실패"); 
          setIsLoading(false);
          setLoadingStatus("");
      }
  };

  const sendMessage = async () => {
    if (!chatInput.trim()) return;
    const userMsg = { sender: "user", text: chatInput };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    setIsChatLoading(true); 
    try {
      const res = await axios.post(`${API_URL}/api/a2a/chat`, { message: userMsg.text, wallet_address: walletAddress });
      setChatMessages(prev => [...prev, { sender: "bot", text: res.data.reply }]);
    } catch (err) { setChatMessages(prev => [...prev, { sender: "bot", text: "오류가 발생했습니다." }]); }
    setIsChatLoading(false); 
  };

  const playDocent = async (id, title) => {
    try {
        const res = await axios.post(`${API_URL}/api/gallery/docent`, { message: title, wallet_address: walletAddress });
        const script = res.data.reply;
        alert(`🎧 도슨트 시작: "${script}"`);
    } catch(err) { alert("도슨트 실패"); }
  };

  const [selectedCandidate, setSelectedCandidate] = useState(null);

  const openCandidateModal = (candidate) => {
    setSelectedCandidate(candidate);
  };

  const closeCandidateModal = () => {
    setSelectedCandidate(null);
  };

  // AI가 만든 Base64 이미지와 일반 URL을 모두 처리하는 함수
  const getImageUrl = (url) => {
    if (!url) return ""; 
    if (url.startsWith("data:image")) return url; // Base64 그대로 통과
    if (url.startsWith("ipfs://")) return url.replace("ipfs://", "https://ipfs.io/ipfs/"); 
    if (!url.startsWith("http")) return `${API_URL}${url}`; 
    return url;
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
        <button className={activeTab==="main"?"active":""} onClick={()=>setActiveTab("main")}>📊 Dashboard</button>
        <button className={activeTab==="curate"?"active":""} onClick={()=>setActiveTab("curate")}>🗳️ Curate</button>
        <button className={activeTab==="insights"?"active":""} onClick={()=>setActiveTab("insights")}>📈 Market Insights</button>
        <button className={activeTab==="gallery"?"active":""} onClick={()=>setActiveTab("gallery")}>🖼️ Hall of Fame</button>
        <button className={activeTab==="treasury"?"active":""} onClick={()=>setActiveTab("treasury")}>🏦 Treasury</button>
        <button className={activeTab==="mypage"?"active":""} onClick={()=>setActiveTab("mypage")}>👤 Profile</button>
        </nav>
        

        <div style={{ marginTop: "auto", padding: "15px", background: "#0F0F0F", borderRadius: "8px", border: "1px solid #2A2A2A", textAlign: "center" }}>
            <div style={{ fontSize: "0.8rem", color: "#9CA3AF", marginBottom: "5px" }}>Current Block Time</div>
            <strong style={{ color: "#F3F4F6", fontSize: "0.9rem", display: "block", marginBottom: "10px" }}>
                {new Date(currentBlockTime * 1000).toLocaleString()}
            </strong>
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

        {/* Market Insights */}
        {activeTab === "insights" && (
          <div className="page fade-in">
            <h2 className="page-title">📈 Market Insights</h2>
            <p style={{color: '#9CA3AF', marginBottom: '30px'}}>AI 에이전트가 실시간으로 분석한 이번 주 글로벌 디지털 아트 트렌드 리포트입니다.</p>
            
            {isInsightsLoading ? (
                <div style={{textAlign: 'center', padding: '50px', color: '#38BDF8', fontSize: '1.2rem'}}>
                    🤖 AI가 실시간 글로벌 웹 트렌드를 분석 중입니다... ⏳
                </div>
            ) : insightsData ? (
                <div className="insights-grid" style={{display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '20px'}}>
                    <div className="card" style={{padding: '30px', background: '#1A1A1A'}}>
                        <h3>🔥 Hot Keywords (Word Cloud)</h3>
                        <div style={{display: 'flex', flexWrap: 'wrap', gap: '15px', marginTop: '20px'}}>
                            {insightsData.keywords.map((tag, idx) => (
                                <span key={idx} style={{padding: '10px 20px', background: '#2A2A2A', borderRadius: '30px', color: '#38BDF8', fontSize: '1.1rem'}}>
                                    {tag}
                                </span>
                            ))}
                        </div>
                    </div>
                    <div className="card" style={{padding: '30px', background: '#1A1A1A'}}>
                        <h3>🎨 Preferred Styles</h3>
                        <ul style={{listStyle: 'none', padding: 0, marginTop: '20px', color: '#BBB'}}>
                            {insightsData.styles.map((style, idx) => (
                                <li key={idx} style={{marginBottom: '15px', fontSize: '1.1rem'}}>
                                    {style.name} - <strong style={{color: '#10B981'}}>{style.percent}%</strong>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            ) : (
                <div style={{textAlign: 'center', padding: '50px', color: '#EF4444'}}>데이터를 불러오지 못했습니다.</div>
            )}
          </div>
        )}

        {/* Treasury */}
        {activeTab === "treasury" && (
          <div className="page fade-in">
            <h2 className="page-title">🏦 Treasury & Statistics</h2>
            <div className="stats-container" style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginTop: '30px'}}>
                <div className="card-mini"><h4>Total Asset</h4><p>1,250,000 TUK</p></div>
                <div className="card-mini"><h4>Total Dividends</h4><p>450,000 TUK</p></div>
                <div className="card-mini"><h4>Minted NFTs</h4><p>12 NFTs</p></div>
                <div className="card-mini"><h4>Active Curators</h4><p>1,024 Users</p></div>
            </div>
            <div className="card" style={{marginTop: '30px', padding: '40px', textAlign: 'center', background: '#1A1A1A'}}>
                <h3 style={{marginBottom: '20px'}}>Dividend Distribution Ratio</h3>
                <div style={{width: '100%', height: '20px', background: '#333', borderRadius: '10px', display: 'flex', overflow: 'hidden'}}>
                    <div style={{width: '70%', background: '#3B82F6'}}></div>
                    <div style={{width: '20%', background: '#10B981'}}></div>
                    <div style={{width: '10%', background: '#F59E0B'}}></div>
                </div>
                <div style={{display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '15px', fontSize: '0.9rem'}}>
                    <span style={{color: '#3B82F6'}}>● Voter Pool (70%)</span>
                    <span style={{color: '#10B981'}}>● Creator Pool (20%)</span>
                    <span style={{color: '#F59E0B'}}>● Treasury (10%)</span>
                </div>
            </div>
          </div>
        )}

        {/* Dashboard */}
        {activeTab === "main" && (
          <div className="page fade-in">
            <div style={{ padding: '60px 40px', background: 'linear-gradient(135deg, #1e1e1e 0%, #0f0f0f 100%)', borderRadius: '16px', border: '1px solid #2A2A2A', marginBottom: '30px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'relative', zIndex: 2 }}>
                    <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: '3.5rem', color: '#F3F4F6', margin: '0 0 15px 0' }}>
                        Autonomous Art Protocol
                    </h1>
                    <p style={{ color: '#9CA3AF', fontSize: '1.2rem', lineHeight: '1.6', maxWidth: '600px', margin: '0 auto 30px auto' }}>
                        AI가 트렌드를 분석하여 매주 새로운 예술을 창조합니다.<br/>
                        DAO 멤버가 되어 가스비 없이 투표하고, 블록체인 배당을 받으세요.
                    </p>
                    <button onClick={() => setActiveTab("curate")} style={{ background: '#3B82F6', color: '#fff', border: 'none', padding: '16px 36px', fontSize: '1.1rem', fontWeight: 'bold', borderRadius: '30px', cursor: 'pointer', boxShadow: '0 4px 15px rgba(59, 130, 246, 0.4)' }}>
                        🔥 큐레이션 참여하기
                    </button>
                </div>
            </div>

            <h2 style={{marginTop: '40px', marginBottom: '20px', fontSize: '1.5rem'}}>⚙️ How It Works</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '40px' }}>
                <div className="card" style={{ background: '#1A1A1A', padding: '25px', borderRadius: '12px', border: '1px solid #2A2A2A' }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '15px' }}>🤖</div>
                    <h3 style={{ color: '#fff', fontSize: '1.1rem', marginBottom: '10px' }}>1. AI 에이전트 생성</h3>
                    <p style={{ color: '#9CA3AF', fontSize: '0.9rem', lineHeight: '1.5' }}>매주 AI 기획자와 비평가가 웹 트렌드를 검색하여 4개의 고품질 디지털 아트 후보작을 오프체인에 생성합니다.</p>
                </div>
                <div className="card" style={{ background: '#1A1A1A', padding: '25px', borderRadius: '12px', border: '1px solid #2A2A2A' }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '15px' }}>🗳️</div>
                    <h3 style={{ color: '#fff', fontSize: '1.1rem', marginBottom: '10px' }}>2. 가스리스(Gasless) 투표</h3>
                    <p style={{ color: '#9CA3AF', fontSize: '0.9rem', lineHeight: '1.5' }}>유저는 지갑의 TUK 토큰을 소모하지 않고, 토큰 보유량에 비례하는 VP로 가장 가치 있는 작품에 분산 투자합니다.</p>
                </div>
                <div className="card" style={{ background: '#1A1A1A', padding: '25px', borderRadius: '12px', border: '1px solid #2A2A2A' }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '15px' }}>💰</div>
                    <h3 style={{ color: '#fff', fontSize: '1.1rem', marginBottom: '10px' }}>3. 스마트 컨트랙트 배당</h3>
                    <p style={{ color: '#9CA3AF', fontSize: '0.9rem', lineHeight: '1.5' }}>투표 종료 시 1등 작품만 NFT로 민팅되며, AI 경매사의 산정가에 따라 안목 있는 투표자들에게 수익이 자동 배당됩니다.</p>
                </div>
            </div>
          </div>
        )}

        {/* Curate */}
        {activeTab === "curate" && (
          <div className="page fade-in">
            <div className="proposals-header-wrap" style={{borderBottom: 'none', marginBottom: '10px'}}>
                <div>
                    <h2 style={{fontFamily: "'Playfair Display', serif", fontSize: "2.5rem", margin: 0}}>🗳️ Curate the Masterpiece</h2>
                    <p style={{color: '#9CA3AF', marginTop: '10px', fontSize: '1rem'}}>AI와 함께 예술의 방향성을 정하고, 최고의 가치를 지닌 작품에 투자하세요.</p>
                </div>
            </div>

            {/* 🔥 관리자 데모 패널 (Phase 전환용) */}
            <div className="admin-demo-panel">
                <div>
                    <strong style={{color: '#EF4444'}}>⚙️ Admin Pipeline Controls</strong>
                    <span style={{color: '#F87171', fontSize: '0.85rem', marginLeft: '10px'}}>(파이프라인 테스트)</span>
                </div>
                <div style={{display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap'}}>
                    <button onClick={handleStartPhase1} style={{background: roundPhase === "KEYWORD" ? '#F59E0B' : '#4B5563', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold'}}>
                        Step 1. 트렌드 추출
                    </button>
                    <button onClick={() => { setRoundPhase("VOTING"); handleGenerateRoundDemo(); }} style={{background: roundPhase === "VOTING" ? '#3B82F6' : '#4B5563', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold'}}>
                        Step 2. 그림 생성 & 투표
                    </button>
                    <button onClick={() => setRoundPhase("VALUATION")} style={{background: roundPhase === "VALUATION" ? '#10B981' : '#4B5563', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold'}}>
                        Step 3. 결산 (가치 책정)
                    </button>
                    
                    {discussionLogs.length > 0 && !showDiscussion && (
                        <button onClick={() => setShowDiscussion(true)} style={{background: '#7C3AED', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold'}}>
                            💬 직전 토론 보기
                        </button>
                    )}
                    {loadingStatus && <span style={{color: '#38BDF8', fontSize: '0.9rem', marginLeft: '10px'}}>{loadingStatus}</span>}
                </div>
            </div>

            {/* ========================================== */}
            {/* 🟢 PHASE 1: 키워드 투표 화면 */}
            {/* ========================================== */}
            {roundPhase === "KEYWORD" && (
                <div className="co-creation-panel fade-in">
                    <h3 style={{ color: '#38BDF8', marginBottom: '10px', fontSize: '1.4rem' }}>🔥 1. 예술의 방향성을 결정해주세요</h3>
                    <p style={{ color: '#9CA3AF', marginBottom: '20px' }}>AI 트렌드 수집가가 가져온 키워드입니다. 이번 라운드에 반영할 키워드를 최대 3개 선택하세요.</p>
                    
                    <div className="keyword-tag-container">
                        {mockKeywords.map((word) => (
                        <button
                            key={word}
                            className={`keyword-tag ${selectedKeywords.includes(word) ? 'active' : ''}`}
                            onClick={() => {
                                if (selectedKeywords.includes(word)) {
                                    setSelectedKeywords(selectedKeywords.filter(k => k !== word));
                                } else if (selectedKeywords.length < 3) {
                                    setSelectedKeywords([...selectedKeywords, word]);
                                }
                            }}
                        >
                            #{word}
                        </button>
                        ))}
                    </div>
                    
                    {/* ⭕ 수정 후: 진짜로 유저 투표 DB에 전송 */}
                    <button 
                        className="glow-btn" 
                        disabled={selectedKeywords.length === 0}
                        onClick={submitKeywordVote}
                        style={{ marginTop: '20px', width: 'auto', padding: '12px 30px' }}
                    >
                        선택한 키워드로 투표 완료하기
                    </button>
                </div>
            )}

            {/* ========================================== */}
            {/* 🟢 PHASE 2: 기존 후보작 투표 화면 */}
            {/* ========================================== */}
            {roundPhase === "VOTING" && (
                <>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0F0F0F', padding: '15px 20px', borderRadius: '12px', border: '1px solid #2A2A2A', marginBottom: '20px'}}>
                        <span style={{color: '#38BDF8', fontWeight: 'bold', fontSize: '1.1rem'}}>🟢 Round #{currentRound?.round_number || "X"} 작품 투표 중</span>
                        <span style={{color: '#9CA3AF'}}>이번 라운드 잔여 투표력(VP): <strong style={{color: 'white'}}>{myInfo.balance} VP</strong></span>
                    </div>

                    {currentRound && currentRound.candidates && currentRound.candidates.length > 0 ? (
                        <div className="candidate-grid">
                            {currentRound.candidates.map(candidate => (
                                <div key={candidate.id} className="candidate-card" onClick={() => openCandidateModal(candidate)} style={{cursor: 'pointer'}}>
                                    <div className="candidate-img-box">
                                        <img src={getImageUrl(candidate.image_url)} alt={candidate.title} />
                                    </div>
                                    <div className="candidate-info">
                                        <h3 className="candidate-title">{candidate.title}</h3>
                                        <p className="candidate-desc">{candidate.description}</p>
                                        
                                        <div className="candidate-stats">
                                            <span style={{color: '#6B7280', fontSize: '0.9rem'}}>현재 누적 투자금</span>
                                            <span className="vp-count">{candidate.vp_votes} VP</span>
                                        </div>

                                        <div className="vote-action-box" onClick={(e) => e.stopPropagation()}> 
                                            <input 
                                                type="number" 
                                                className="vp-input" 
                                                placeholder="VP 입력" 
                                                min="1"
                                                value={vpInputs[candidate.id] || ""}
                                                onChange={(e) => setVpInputs({...vpInputs, [candidate.id]: e.target.value})}
                                            />
                                            <button className="vote-btn" onClick={() => handleVote(candidate.id)}>투자하기</button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{textAlign: 'center', padding: '80px 20px', background: '#1A1A1A', borderRadius: '16px', border: '1px dashed #2A2A2A'}}>
                            <p style={{color: '#6B7280'}}>현재 생성된 작품이 없습니다. 'Step 2' 버튼을 눌러주세요.</p>
                        </div>
                    )}
                </>
            )}

            {/* ========================================== */}
            {/* 🟢 PHASE 3: 우승작 가치 평가 및 결산 화면 */}
            {/* ========================================== */}
            {roundPhase === "VALUATION" && (
                <div className="co-creation-panel fade-in" style={{ display: 'flex', gap: '30px' }}>
                    
                    {/* 왼쪽: AI 비평가 보고서 */}
                    <div style={{ flex: 1.5, background: '#0F0F0F', padding: '25px', borderRadius: '12px', border: '1px solid #2A2A2A' }}>
                        <h3 style={{ color: '#FBBF24', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span>🔍</span> 수석 미술 비평가의 가치 평가
                        </h3>
                        <div className="critic-report-box">
                            "이 작품은 유저들이 선택한 'Cyberpunk'와 'Seoul'의 키워드를 완벽하게 융합했습니다. 
                            차가운 네온 불빛 속에 담긴 인간의 고립감을 르네상스적 구도로 표현하여 미학적 가치가 매우 뛰어납니다. 
                            웹3 커뮤니티에서 밈(Meme)으로 소비될 잠재력도 높아 높은 상업적 가치를 지닙니다."
                        </div>
                        <p style={{ color: '#6B7280', fontSize: '0.9rem', marginTop: '15px' }}>
                            * 위 보고서를 참고하여 아래 폼에서 최종 판매 가격과 기한을 결정해주세요.
                        </p>
                    </div>

                    {/* 오른쪽: 유저 가격 책정 폼 */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        <h3 style={{ color: '#fff', margin: '0 0 10px 0' }}>💰 최종 결산 및 컨트랙트 등록</h3>
                        <label style={{ color: '#9CA3AF', fontSize: '0.95rem' }}>
                            희망 시작가 (TUK 토큰)
                            <input 
                                type="number" 
                                className="glass-input" 
                                value={valuationPrice} 
                                onChange={(e) => setValuationPrice(e.target.value)} 
                                placeholder="예: 1000" 
                                style={{ marginTop: '8px' }}
                            />
                        </label>
                        
                        <label style={{ color: '#9CA3AF', fontSize: '0.95rem' }}>
                            경매 진행 기한
                            <select 
                                className="glass-input" 
                                value={valuationDuration} 
                                onChange={(e) => setValuationDuration(e.target.value)} 
                                style={{ marginTop: '8px', cursor: 'pointer' }}
                            >
                                <option value="3">3일</option>
                                <option value="7">7일 (권장)</option>
                                <option value="14">14일</option>
                            </select>
                        </label>

                        <button 
                            className="glow-btn" 
                            style={{ marginTop: 'auto', background: '#10B981', color: 'white' }}
                            onClick={() => alert(`가격: ${valuationPrice} TUK, 기한: ${valuationDuration}일\n스마트 컨트랙트에 민팅 및 등록 요청을 보냅니다!`)}
                        >
                            이 조건으로 블록체인에 등록
                        </button>
                    </div>
                </div>
            )}
          </div>
        )}
        {/* Hall of Fame */}
        {activeTab === "gallery" && (
            <div className="page fade-in">
                <h2 style={{fontFamily: "'Playfair Display', serif", fontSize: "2.5rem"}}>🖼️ Hall of Fame</h2>
                <p style={{color: '#9CA3AF', marginBottom: '30px'}}>대중의 선택을 받아 NFT로 영구 박제된 우승작 컬렉션입니다.</p>
                
                {/* 💡 auto-fill 덕분에 작품이 무한히 늘어나도 다음 줄로 예쁘게 정렬됩니다. */}
                <div className="gallery-grid" style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '25px'}}>
                    {galleryItems.length === 0 ? (
                        <p style={{color: '#6B7280'}}>아직 등록된 우승작이 없습니다.</p>
                    ) : (
                        galleryItems.map(item => (
                            <div 
                                key={item.id} 
                                className="card gallery-card" 
                                // 💡 클릭 시 이미 구현된 openCandidateModal을 재사용하여 상세 내용을 띄웁니다.
                                onClick={() => openCandidateModal(item)}
                                style={{
                                    background: '#1A1A1A', 
                                    border: '1px solid #2A2A2A', 
                                    borderRadius: '12px', 
                                    overflow: 'hidden', 
                                    display: 'flex', 
                                    flexDirection: 'column',
                                    cursor: 'pointer', // 마우스 올리면 손가락 모양으로 변경
                                    transition: 'transform 0.2s ease, border-color 0.2s ease'
                                }}
                                // 마우스 오버 시 살짝 떠오르는 효과 (선택사항)
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-5px)';
                                    e.currentTarget.style.borderColor = '#3B82F6';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.borderColor = '#2A2A2A';
                                }}
                            >
                                
                                <div className="img-wrap" style={{width: '100%', height: '280px', borderBottom: '1px solid #2A2A2A', overflow: 'hidden', backgroundColor: '#000'}}>
                                    <img 
                                        src={getImageUrl(item.image_url)} 
                                        alt={item.title}
                                        style={{width: '100%', height: '100%', objectFit: 'cover'}}
                                    />
                                </div>

                                <div className="info" style={{padding: '20px', display: 'flex', flexDirection: 'column', flex: 1}}>
                                    <h3 style={{color: '#fff', margin: '0 0 10px 0', fontSize: '1.25rem', lineHeight: '1.4'}}>{item.title}</h3>
                                    <p style={{color: '#34D399', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '15px'}}>🏆 우승작 (IPFS 영구 보존)</p>
                                    
                                    {/* 💡 평소에는 3줄만 보여주고 '...' 처리합니다. */}
                                    <p style={{
                                        color: '#9CA3AF', 
                                        fontSize: '0.95rem', 
                                        lineHeight: '1.6', 
                                        display: '-webkit-box', 
                                        WebkitLineClamp: 3, 
                                        WebkitBoxOrient: 'vertical', 
                                        overflow: 'hidden', 
                                        margin: 0
                                    }}>
                                        {item.description}
                                    </p>
                                    <div style={{marginTop: '15px', color: '#3B82F6', fontSize: '0.85rem', fontWeight: 'bold'}}>
                                        더 보기...
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        )}

        {/* My Profile */}
        {activeTab === "mypage" && (
            <div className="page fade-in">
                <h2 style={{fontFamily: "'Playfair Display', serif", fontSize: "2.5rem"}}>👤 My Profile</h2>
                {!isLoggedIn ? <p style={{color: '#9CA3AF'}}>지갑을 먼저 연결해주세요.</p> : (
                    <div className="mypage-grid">
                        <div className="card profile" style={{background: '#1A1A1A', border: '1px solid #2A2A2A'}}>
                            <h3 style={{color: '#fff', borderBottom: '1px solid #2A2A2A', paddingBottom: '10px'}}>내 지갑 정보</h3>
                            <p style={{color: '#9CA3AF', margin: '15px 0'}}><strong>주소:</strong> <span style={{color: '#fff'}}>{walletAddress}</span></p>
                            <p style={{color: '#9CA3AF'}}><strong>이번 라운드 잔여 투표력:</strong> <span style={{color: '#38BDF8', fontWeight: 'bold', fontSize: '1.2rem'}}>{myInfo.balance} VP</span></p>

                            <h3 style={{color: '#fff', borderBottom: '1px solid #2A2A2A', paddingBottom: '10px', marginTop: '30px'}}>💰 배당금 수령 (Claim)</h3>
                            <p style={{color: '#9CA3AF', marginTop: '10px', fontSize: '0.9rem', marginBottom: '15px'}}>지난 라운드에서 1등(우승작)에 투표하셨다면, 기여도에 비례해 TUK 토큰 수익을 배당받습니다.</p>
                            
                            {endedRounds.length === 0 ? (
                                <p style={{color: '#6B7280', fontSize: '0.9rem'}}>종료된 라운드가 없습니다.</p>
                            ) : (
                                <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
                                    {endedRounds.map(r => (
                                        <div key={r.round_id} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0F0F0F', padding: '12px 15px', borderRadius: '8px', border: '1px solid #333'}}>
                                            <div>
                                                <div style={{color: '#fff', fontWeight: 'bold'}}>Round #{r.round_id}</div>
                                                <div style={{color: '#9CA3AF', fontSize: '0.85rem'}}>우승작: {r.winner_title} (AI 매각가: {r.auction_price} TUK)</div>
                                            </div>
                                            <button onClick={() => handleClaimReward(r.round_id)} style={{background: '#38BDF8', color: '#000', fontWeight: 'bold', border: 'none', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.9rem'}}>
                                                보상 청구
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        )}
      </main>
      {/* ========================================== */}
      {/* 🔥 [추가] 후보작 및 우승작 상세 모달창 */}
      {/* ========================================== */}
      {selectedCandidate && (
        <div 
          className="modal-overlay" 
          onClick={closeCandidateModal} 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            backgroundColor: 'rgba(0,0,0,0.85)', 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0, 
            zIndex: 3000 // 💡 z-index를 높게 설정하여 다른 UI보다 위에 뜨게 합니다.
          }}
        >
          <div 
            className="modal-content" 
            onClick={(e) => e.stopPropagation()} 
            style={{ 
              background: '#1A1A1A', 
              width: '90%', 
              maxWidth: '900px', 
              borderRadius: '20px', 
              padding: '40px', 
              border: '1px solid #2A2A2A', 
              position: 'relative', 
              display: 'flex', 
              gap: '30px' 
            }}
          >
            {/* 닫기 버튼 */}
            <button 
              onClick={closeCandidateModal} 
              style={{ position: 'absolute', top: '20px', right: '20px', background: 'none', border: 'none', color: '#fff', fontSize: '24px', cursor: 'pointer' }}
            >
              ✖
            </button>
            
            {/* 왼쪽: 이미지 영역 */}
            <div style={{ flex: 1 }}>
                <img 
                  src={getImageUrl(selectedCandidate.image_url)} 
                  alt={selectedCandidate.title} 
                  style={{ width: '100%', borderRadius: '12px', border: '1px solid #2A2A2A', objectFit: 'cover' }} 
                />
            </div>
            
            {/* 오른쪽: 텍스트 영역 */}
            <div style={{ flex: 1.2, display: 'flex', flexDirection: 'column' }}>
                <h2 style={{ fontSize: '2rem', color: '#fff', marginBottom: '20px' }}>{selectedCandidate.title}</h2>
                
                {/* 💡 전체 설명을 보여주는 스크롤 가능 영역 */}
                <div style={{ 
                  flex: 1, 
                  overflowY: 'auto', 
                  color: '#D1D5DB', 
                  lineHeight: '1.8', 
                  fontSize: '1.1rem', 
                  marginBottom: '20px', 
                  paddingRight: '10px',
                  maxHeight: '400px' // 너무 길어지면 스크롤이 생기게 제한
                }}>
                    {selectedCandidate.description}
                </div>
                
                {/* 하단 정보바: 후보작(투표수)인지 우승작인지 구분해서 표시 */}
                <div style={{ background: '#0F0F0F', padding: '20px', borderRadius: '12px', border: '1px solid #2A2A2A' }}>
                    {selectedCandidate.vp_votes !== undefined ? (
                        <p style={{ color: '#9CA3AF', margin: 0 }}>현재 총 투자금: <strong style={{ color: '#38BDF8', fontSize: '1.4rem' }}>{selectedCandidate.vp_votes} VP</strong></p>
                    ) : (
                        <p style={{ color: '#34D399', margin: 0, fontWeight: 'bold' }}>🏆 이 작품은 ArtDAO 명예의 전당에 헌액된 우승작입니다.</p>
                    )}
                </div>
            </div>
        </div>
    </div>
)}

     {/* ========================================== */}
      {/* 🔥 [NEW] 우측 고정 패널 ➔ 플로팅 패널로 변경 */}
      {/* ========================================== */}
      
      {/* 플로팅 버튼 (화면 우측 하단 고정) */}
      <button 
          onClick={() => setIsChatOpen(!isChatOpen)}
          style={{
              position: 'fixed',
              bottom: '40px',
              right: '40px',
              width: '65px',
              height: '65px',
              borderRadius: '50%',
              backgroundColor: '#3B82F6',
              color: '#fff',
              fontSize: '30px',
              border: 'none',
              boxShadow: '0 4px 15px rgba(0, 0, 0, 0.4)',
              cursor: 'pointer',
              zIndex: 2000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'transform 0.3s ease',
              transform: isChatOpen ? 'rotate(90deg)' : 'rotate(0deg)'
          }}
      >
          {isChatOpen ? '✖' : '💬'}
      </button>

      {/* 숨겨졌다가 나오는 AI 패널 */}
      <aside 
        className="right-panel"
        style={{
            position: 'fixed',
            top: 0,
            right: isChatOpen ? '0' : '-400px', // 💡 열리면 0, 닫히면 화면 밖으로 숨김!
            width: '380px',
            height: '100vh',
            backgroundColor: '#0F0F0F',
            borderLeft: '1px solid #2A2A2A',
            transition: 'right 0.3s ease-in-out',
            zIndex: 1999,
            boxShadow: isChatOpen ? '-5px 0 25px rgba(0,0,0,0.7)' : 'none',
            display: 'flex',
            flexDirection: 'column'
        }}
      >
        <div className="right-panel-header" style={{ padding: '20px', borderBottom: '1px solid #2A2A2A', display: 'flex', alignItems: 'center' }}>
            <span style={{ color: '#38BDF8', marginRight: '8px' }}>✦</span> 
            <span style={{ fontWeight: 'bold', letterSpacing: '1px' }}>AI GUIDE</span> 
            <span style={{ fontSize: '0.7rem', marginLeft: 'auto', color: '#34D399' }}>● Online</span>
        </div>
        
        <div className="chat-window" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="messages" style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
                {chatMessages.map((msg, idx) => (
                    <div key={idx} className={`msg ${msg.sender}`} style={{ marginBottom: '15px' }}>
                        {msg.sender === "bot" && (
                            <div className="bot-name" style={{ fontSize: '0.85rem', color: '#9CA3AF', marginBottom: '5px' }}><span>🤖</span> ArtDAO Guide</div>
                        )}
                        <div className="bubble" style={{ 
                            whiteSpace: "pre-line", 
                            padding: '12px 16px', 
                            borderRadius: '12px', 
                            backgroundColor: msg.sender === 'bot' ? '#1A1A1A' : '#3B82F6',
                            color: '#fff',
                            border: msg.sender === 'bot' ? '1px solid #2A2A2A' : 'none',
                            alignSelf: msg.sender === 'bot' ? 'flex-start' : 'flex-end',
                            display: 'inline-block',
                            maxWidth: '90%'
                        }}>
                            {msg.text}
                        </div>
                    </div>
                ))}
                
                {isChatLoading && (
                    <div className="msg bot">
                        <div className="bot-name"><span>🤖</span> ArtDAO Guide</div>
                        <div className="chat-typing-indicator" style={{ padding: '12px', background: '#1A1A1A', borderRadius: '12px', display: 'inline-block' }}>
                            <span style={{ color: '#9CA3AF' }}>입력 중...</span>
                        </div>
                    </div>
                )}
            </div>
            
            <div className="chat-input-wrapper" style={{ padding: '20px', borderTop: '1px solid #2A2A2A', display: 'flex', gap: '10px' }}>
                <input 
                    type="text" 
                    value={chatInput} 
                    onChange={(e)=>setChatInput(e.target.value)} 
                    onKeyPress={(e)=>e.key==='Enter' && !isChatLoading && chatInput.trim() && sendMessage()} 
                    placeholder="무엇이든 물어보세요!" 
                    disabled={isChatLoading} 
                    className="chat-text-input"
                    style={{ flex: 1, padding: '12px 15px', borderRadius: '20px', border: '1px solid #333', background: '#1A1A1A', color: '#fff' }}
                />
                <button 
                    className="chat-send-btn" 
                    onClick={sendMessage} 
                    disabled={isChatLoading || !chatInput.trim()}
                    style={{ width: '45px', height: '45px', borderRadius: '50%', background: '#3B82F6', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                    ➤
                </button>
            </div>
        </div>
      </aside>
      {/* 🔥 [NEW] 에이전트 난상토론 라이브 뷰어 모달 */}
      {showDiscussion && (
        <div className="discussion-overlay">
          <div className="discussion-modal">
            <div className="discussion-header">
              <div className="discussion-title">
                <span className="discussion-icon">🎭</span>
                <span>AI 에이전트 난상토론 라이브</span>
                {isDiscussing && (
                  <span className="live-badge">
                    <span className="live-dot"></span>
                    LIVE
                  </span>
                )}
              </div>
              <button className="discussion-close" onClick={closeDiscussion}>✖</button>
            </div>

            <div className="discussion-body">
              {discussionLogs.length === 0 ? (
                <div className="discussion-empty">
                  <div className="loader-pulse"></div>
                  <p>에이전트들이 토론을 준비하고 있습니다...</p>
                </div>
              ) : (
                discussionLogs.map((log, idx) => {
                  const style = getAgentStyle(log.agent);
                  return (
                    <div key={idx} className="discussion-msg" style={{ borderLeftColor: style.color, background: style.bg }}>
                      <div className="discussion-msg-header">
                        <span className="discussion-msg-icon">{style.icon}</span>
                        <span className="discussion-msg-agent" style={{ color: style.color }}>
                          {log.agent}
                        </span>
                        <span className="discussion-msg-type">{getLogTypeLabel(log.type)}</span>
                        <span className="discussion-msg-time">{log.timestamp}</span>
                      </div>
                      <div className="discussion-msg-content">{log.content}</div>
                    </div>
                  );
                })
              )}
              
              {isDiscussing && (
                <div className="discussion-typing">
                  <div className="dot"></div>
                  <div className="dot"></div>
                  <div className="dot"></div>
                  <span style={{ marginLeft: '10px', color: '#9CA3AF', fontSize: '0.85rem' }}>
                    에이전트가 사고 중...
                  </span>
                </div>
              )}
              
              <div ref={discussionEndRef} />
            </div>

            <div className="discussion-footer">
              <span className="discussion-stat">
                💬 총 {discussionLogs.length}개 메시지
              </span>
              {!isDiscussing && discussionLogs.length > 0 && (
                <span className="discussion-stat" style={{ color: '#34D399' }}>
                  ✅ 토론 완료
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
    
  );
}

export default App;
