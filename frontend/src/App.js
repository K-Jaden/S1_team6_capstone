import React, { useState, useEffect } from "react";
import axios from "axios";
import { ethers } from "ethers";
import "./App.css";

// LIM. 블록체인 연결 정보 가져오기. contracts 폴더가 src 안에 있어야 합니다
import { CONTRACT_ADDRESS } from './contracts/address';
import ArtPlanningDAO from './contracts/ArtPlanningDAO.json';
const API_URL = "http://localhost:8000";

// ✅ [설정] 관리자 지갑 주소 (팀장님 지갑 주소를 여기에 넣으세요!)
const ADMIN_WALLETS = [
    "0xa06e02093A85F32b2707f4f7ec646f6D606D0F4C", // 예시: 본인 지갑 주소
];

function App() {
  // ==========================================
  // 1. 상태 관리 (State)
  // ==========================================
  const [activeTab, setActiveTab] = useState("main"); 
  const [walletAddress, setWalletAddress] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  
  // 데이터 상태
  const [proposals, setProposals] = useState([]);
  const [galleryItems, setGalleryItems] = useState([]);
  
  // 상세 보기를 위한 상태 (선택된 안건)
  const [selectedProposal, setSelectedProposal] = useState(null); 

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

  // 안건 작성 폼
  const [proposalForm, setProposalForm] = useState({ 
    title: "", description: "", style: "General", image_url: "", meta_hash: "" 
  });

  // 에이전트 센터 상태
  const [agentInput, setAgentInput] = useState({
    criticArtInfo: "", marketerTitle: "", marketerTarget: "", auctionArtInfo: "", auctionReview: ""
  });
  const [agentResult, setAgentResult] = useState({ critic: "", marketer: "", auction: "" });


  // 스마트 컨트랙트 객체 저장용 State
  const [contract, setContract] = useState(null);
  // ==========================================
  // 2. 초기화 및 지갑 연동
  // ==========================================
  
  // [NEW] 새로고침 시 로그인 유지 & 컨트랙트 자동 재연결 (수정된 버전)
  useEffect(() => {
    const storedAddress = localStorage.getItem("walletAddress");
    
    if (storedAddress) {
      // 1. 지갑 주소 & 로그인 상태 복구
      setWalletAddress(storedAddress);
      setIsLoggedIn(true);

      // 2. 🟢 [핵심] 끊어진 스마트 컨트랙트 연결선 다시 잇기
      if (window.ethereum) {
        const restoreContract = async () => {
          try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            // 주소와 ABI(설명서)를 이용해 컨트랙트 객체 재생성
            const daoContract = new ethers.Contract(CONTRACT_ADDRESS, ArtPlanningDAO.abi, signer);
            setContract(daoContract); // 상태 변수에 다시 저장 (중요!)
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
      console.log("JSON 파일 내용:", ArtPlanningDAO);
      const address = await signer.getAddress();
	
      //LIM. 스마트 컨트랙트 연결
      const daoContract = new ethers.Contract(CONTRACT_ADDRESS, ArtPlanningDAO.abi, signer);
      setContract(daoContract); // 나중에 사용하기 위해 상태에 저장
      console.log("블록체인 계약 연결 완료:", daoContract);
      
      await axios.post(`${API_URL}/api/auth/wallet-login`, { wallet_address: address, signature: "dummy_sig" });
      
      localStorage.setItem("walletAddress", address); // 로컬 스토리지 저장
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
      localStorage.removeItem("walletAddress"); // 로컬 스토리지 삭제
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

  const fetchProposals = async (status = null) => {
    try {
      const params = status ? { status } : {};
      const res = await axios.get(`${API_URL}/api/proposals`, { params });
      setProposals(res.data);
    } catch (err) { console.error(err); }
  };

  const fetchGallery = async () => {
    const res = await axios.get(`${API_URL}/api/gallery/items`);
    setGalleryItems(res.data);
  };

  // --- 각종 핸들러 ---
  const handleBadgeUpdate = async () => {
    try {
        const res = await axios.patch(`${API_URL}/api/user/badge`, null, { params: { wallet_address: walletAddress } });
        alert(`뱃지 상태 업데이트: ${res.data.status}`);
        fetchMyPageData();
    } catch (err) { alert("뱃지 업데이트 실패"); }
  };

  const handleStudioAction = async (type) => {
    setIsLoading(true);
    try {
      if (type === "draft") {
        const res = await axios.post(`${API_URL}/api/studio/draft`, { intent: studioData.intent });
        setStudioData(prev => ({ ...prev, draft: res.data.draft_text }));
      } else if (type === "image") {
        const res = await axios.post(`${API_URL}/api/studio/image`, { keywords: studioData.intent });
        setStudioData(prev => ({ ...prev, image: res.data.image_url }));
      } else if (type === "check") {
        const res = await axios.get(`${API_URL}/api/studio/check`, { params: { topic: studioData.intent } });
        setStudioData(prev => ({ ...prev, similarity: `유사도: ${res.data.similarity_score}점 (${res.data.message})` }));
      }
    } catch (err) { alert("AI 요청 실패"); }
    setIsLoading(false);
  };

  const sendToProposalWrite = () => {
    setProposalForm({
        title: studioData.intent,
        description: studioData.draft,
        image_url: studioData.image,
        style: "AI Generated",
        meta_hash: "mock_ipfs_hash_123"
    });
    setActiveTab("write");
  };

  //LIM. 기존 코드 수정. backend 서버에서 meta_hash 받아주는지 확인 필요함.
  //블록체인에 먼저 저장하고 백엔드 DB에 저장하도록 코드 수정
  const submitProposal = async () => {
    // 1. 유효성 검사
    if (!walletAddress) return alert("지갑이 연결되지 않았습니다.");
    if (!contract) return alert("스마트 컨트랙트가 로드되지 않았습니다. 잠시 후 다시 시도하거나 새로고침 해주세요.");
    
    // 필수 입력값 체크
    if (!proposalForm.title || !proposalForm.description) {
      return alert("제목과 내용을 모두 입력해주세요.");
    }

    try {
        // 2. 블록체인에 먼저 기록 (메타마스크 서명 유도)
        alert("지갑에서 트랜잭션을 승인해주세요...");
        
        // 주의: 솔리디티 함수 인자 순서와 개수가 정확해야 합니다!
        // (제목, 내용, 이미지URL 순서라고 가정)
        const tx = await contract.createProposal(
            proposalForm.title, 
            proposalForm.description, 
            proposalForm.image_url || "" // 이미지가 없으면 빈 문자열
        );
        
        alert("블록체인에 기록 중입니다... (약 10~20초 소요)");
        
        // 블록에 담길 때까지 기다림 (여기서 시간이 좀 걸립니다)
        const receipt = await tx.wait(); 
        console.log("트랜잭션 성공:", receipt);
        
        // 3. 블록체인 성공 후 백엔드(DB)에도 저장
        // meta_hash 필드에 트랜잭션 해시(tx.hash)를 저장하면 나중에 조회하기 좋습니다.
        await axios.post(`${API_URL}/api/proposals`, { 
            wallet_address: walletAddress, 
            ...proposalForm,
            meta_hash: tx.hash // 블록체인 영수증 번호 저장
        });

        alert("✅ 안건이 블록체인과 DB에 모두 안전하게 등록되었습니다!");
        
        // 목록으로 이동 및 갱신
        setActiveTab("proposals");
        fetchProposals();

        // 입력 폼 초기화
        setProposalForm({ title: "", description: "", style: "General", image_url: "", meta_hash: "" });

    } catch(err) { 
        console.error("등록 실패:", err);
        
        // 에러 메시지 분석 (사용자 취소 등)
        if (err.code === "ACTION_REJECTED") {
          alert("지갑 서명을 취소하셨습니다.");
        } else {
          alert("제출 실패: " + (err.message || "알 수 없는 오류"));
        }
    }
  };

  // ✅ [삭제] 안건 삭제 함수 (여기에 정의됨!)
  const deleteProposal = async (id, e) => {
    e.stopPropagation(); // 모달 열림 방지
    if (!window.confirm("정말 이 안건을 삭제하시겠습니까?")) return;
    try {
        await axios.delete(`${API_URL}/api/proposals/${id}`);
        alert("🗑️ 삭제되었습니다.");
        fetchProposals(); 
        setSelectedProposal(null);
    } catch (err) {
        console.error(err);
        alert("삭제 실패 (서버 오류)");
    }
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

  // [도슨트] 음성 재생 함수 (브라우저 내장 TTS 사용 - 무료!)
  const playDocent = async (id, title) => {
    try {
        const res = await axios.post(`${API_URL}/api/gallery/docent`, null, { params: { item_id: id } });
        const script = res.data.text_script;
        
        // 1. 텍스트로 보여주기 (알림)
        alert(`🎧 도슨트 해설이 시작됩니다:\n\n"${script}"`);
        
        // 2. 음성으로 읽어주기 (TTS)
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel(); // 기존 음성 중지
            const utterance = new SpeechSynthesisUtterance(script);
            utterance.lang = 'ko-KR'; // 한국어 설정
            utterance.rate = 1.0;     // 속도 (1.0 = 보통)
            utterance.pitch = 1.0;    // 톤 (1.0 = 보통)
            window.speechSynthesis.speak(utterance);
        }
    } catch(err) { 
        console.error(err);
        alert("도슨트 재생 실패 (백엔드 연결 확인 필요)"); 
    }
  };

  const sendFeedback = async (id) => {
      const msg = prompt("관람평을 남겨주세요:");
      if(msg) {
        await axios.post(`${API_URL}/api/gallery/feedback`, null, { params: { item_id: id, content: msg, wallet_address: walletAddress } });
        alert("소중한 의견 감사합니다!");
      }
  };

  // 에이전트 센터 함수들
  const runCritic = async () => {
    if (!agentInput.criticArtInfo) return alert("작품 정보를 입력해주세요.");
    setIsLoading(true);
    try {
      const res = await axios.post(`${API_URL}/api/agent/review`, { art_info: agentInput.criticArtInfo });
      setAgentResult(prev => ({ ...prev, critic: res.data.review_text }));
    } catch (err) { alert("비평 생성 실패"); }
    setIsLoading(false);
  };
  const runMarketer = async () => {
    if (!agentInput.marketerTitle || !agentInput.marketerTarget) return alert("정보를 모두 입력해주세요.");
    setIsLoading(true);
    try {
      const res = await axios.post(`${API_URL}/api/agent/promote`, { exhibition_title: agentInput.marketerTitle, target_audience: agentInput.marketerTarget });
      setAgentResult(prev => ({ ...prev, marketer: res.data.promo_text }));
    } catch (err) { alert("마케팅 문구 생성 실패"); }
    setIsLoading(false);
  };
  const runAuction = async () => {
    if (!agentInput.auctionArtInfo || !agentInput.auctionReview) return alert("정보를 모두 입력해주세요.");
    setIsLoading(true);
    try {
      const res = await axios.post(`${API_URL}/api/agent/auction`, { art_info: agentInput.auctionArtInfo, critic_review: agentInput.auctionReview });
      setAgentResult(prev => ({ ...prev, auction: res.data.auction_report }));
    } catch (err) { alert("경매 리포트 생성 실패"); }
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

        {/* ✅ 안건 목록 (카드 리스트 + 모달 상세 보기) */}
        {activeTab === "proposals" && (
          <div className="page fade-in">
            <div className="page-header">
                <h2>🗳️ Governance Proposals</h2>
                <div className="filters">
                    <button onClick={()=>fetchProposals("OPEN")}>🔵 진행중</button>
                    <button onClick={()=>fetchProposals(null)}>⚪ 전체</button>
                    <button className="primary" onClick={()=>{
                        setProposalForm({ title: "", description: "", style: "General", image_url: "", meta_hash: "" });
                        setActiveTab("write");
                    }}>+ 새 안건 작성</button>
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
                            {/* 관리자 삭제 버튼 */}
                            {isLoggedIn && ADMIN_WALLETS.map(w => w.toLowerCase()).includes(walletAddress.toLowerCase()) && (
                                <button className="delete-icon-btn" onClick={(e) => deleteProposal(p.id, e)}>🗑️</button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
          </div>
        )}

        {/* ✅ 상세 보기 모달 */}
        {selectedProposal && (
            <div className="modal-overlay" onClick={() => setSelectedProposal(null)}>
                <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                    <button className="close-btn" onClick={() => setSelectedProposal(null)}>✖</button>
                    <div className="modal-header">
                        <span className={`status-badge ${selectedProposal.status}`}>{selectedProposal.status}</span>
                        <h2>{selectedProposal.title}</h2>
                        <p className="meta">작성자: {selectedProposal.wallet_address}</p>
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
                    <div className="modal-footer">
                        <button className="vote-btn yes">👍 찬성 투표</button>
                        <button className="vote-btn no">👎 반대 투표</button>
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

        {/* AI 스튜디오 */}
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
                                <button className="primary full-width" onClick={sendToProposalWrite}>👉 이 내용으로 안건 작성하기</button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}

        {/* AI 에이전트 센터 */}
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

        {/* 온라인 전시관 */}
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
                                    {/* ✅ 도슨트 버튼이 여기 있어야 합니다! */}
                                    <button onClick={()=>playDocent(item.id, item.title)}>
                                        🎧 도슨트 듣기
                                    </button>
                                    
                                    <button onClick={()=>sendFeedback(item.id)}>
                                        💬 방명록
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {/* AI 큐레이터 (채팅) */}
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

        {/* 마이 페이지 */}
        {activeTab === "mypage" && (
            <div className="page fade-in">
                <h2>👤 My Page</h2>
                {!isLoggedIn ? <p>지갑을 먼저 연결해주세요.</p> : (
                    <div className="mypage-grid">
                        <div className="card profile">
                            <h3>내 정보</h3>
                            <p><strong>주소:</strong> {walletAddress}</p>
                            <p><strong>멤버십 등급:</strong> <span className="gold-text">{myInfo.membership}</span></p>
                            <p><strong>보유 토큰:</strong> {myInfo.balance} ART</p>
                        </div>
                        <div className="card recommend">
                            <h3>🎯 취향 저격 전시 추천</h3>
                            {myInfo.recommendation ? (
                                <div><p><strong>{myInfo.recommendation.title || "추천 전시"}</strong></p><p className="desc">{myInfo.recommendation.reason || "회원님의 활동을 바탕으로 선정된 전시입니다."}</p></div>
                            ) : <p>분석 중입니다...</p>}
                        </div>
                        <div className="card badge-section">
                            <h3>🏅 큐레이터 뱃지</h3>
                            <p>현재 상태: <strong>{myInfo.badge || "자격 심사 중"}</strong></p>
                            <button className="primary-btn sm" onClick={handleBadgeUpdate}>뱃지 갱신/신청</button>
                        </div>
                        <div className="card rewards">
                            <h3>💰 보상 관리</h3>
                            <p>미수령 보상: <strong>{myInfo.rewards} ART</strong></p>
                            <button className="primary-btn sm">보상 수령</button>
                        </div>
                        <div className="card delegation">
                            <h3>🤝 위임 상태</h3>
                            <p>위임 대상: {myInfo.delegation.delegated_to || "없음"}</p>
                            <p>위임 수량: {myInfo.delegation.amount || 0} Vote</p>
                        </div>
                        <div className="card history">
                            <h3>📅 활동 내역</h3>
                            <ul>{myInfo.activity.map((act, i) => <li key={i}>{act.date}: {act.type}</li>)}</ul>
                        </div>
                        <div className="card my-proposals">
                            <h3>📝 내가 쓴 기획서 ({myInfo.myProposals.length})</h3>
                            {myInfo.myProposals.map(p => <div key={p.id} className="mini-item">#{p.id} {p.title} ({p.status})</div>)}
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
