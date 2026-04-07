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

function App() {
  
  // ==========================================
  // 1. 핵심 상태 관리 (State)
  // ==========================================
  const [activeTab, setActiveTab] = useState("main"); 
  const [walletAddress, setWalletAddress] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  
  const [myInfo, setMyInfo] = useState({ balance: 0, membership: "", rewards: 0 });
  const [galleryItems, setGalleryItems] = useState([]);
  
  // --- Botto DAO 핵심 상태 ---
  const [currentRound, setCurrentRound] = useState(null);
  const [vpInputs, setVpInputs] = useState({}); 
  const [isLoading, setIsLoading] = useState(false);

  // --- AI 챗봇 상태 ---
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    { sender: "bot", text: "안녕하세요! ArtDAO 큐레이터입니다. 투표 방법이나 추천 작품을 물어보세요!" }
  ]);

  const [currentBlockTime, setCurrentBlockTime] = useState(Math.floor(Date.now() / 1000));
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
          } catch (err) { console.error("재연결 실패:", err); }
        };
        restoreContract();
      }
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn && walletAddress) fetchMyPageData();
    fetchGallery();   
  }, [isLoggedIn, walletAddress, contract]);

  useEffect(() => {
      if (activeTab === "curate") {
          fetchCurrentRound();
      }
  }, [activeTab]);

  // 주기적으로 블록체인 시간 동기화 (UI 표시용)
  useEffect(() => {
      const timer = setInterval(() => setCurrentBlockTime(Math.floor(Date.now() / 1000)), 1000);
      return () => clearInterval(timer);
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
  // 3. DAO 핵심 액션 함수 (조회, 투표, 관리자 데모)
  // ==========================================
  const fetchMyPageData = async () => {
    if (!walletAddress) return;
    try {
      const resBal = await axios.get(`${API_URL}/api/wallet/balance`, { params: { wallet_address: walletAddress } });
      setMyInfo(prev => ({ ...prev, balance: resBal.data.balance }));
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

      try {
          const res = await axios.post(`${API_URL}/api/vote`, {
              wallet_address: walletAddress,
              candidate_id: candidateId,
              vp_amount: parseInt(amount)
          });
          alert(res.data.message);
          fetchCurrentRound(); 
          setVpInputs({ ...vpInputs, [candidateId]: "" }); 
      } catch (err) { alert(err.response?.data?.detail || "투표 실패"); }
  };

  const handleGenerateRoundDemo = async () => {
      setIsLoading(true);
      alert("AI 에이전트들이 트렌드 검색 및 이미지 생성을 시작합니다.\n(백엔드 터미널을 확인하세요! 약 1~2분 소요)");
      try {
          await axios.post(`${API_URL}/api/admin/generate-round`, {}, { timeout: 300000 });
          alert("🎉 새 라운드와 4개의 후보작이 성공적으로 생성되었습니다!");
          fetchCurrentRound();
      } catch (err) { alert("라운드 생성 중 오류가 발생했습니다."); }
      setIsLoading(false);
  };

  const handleEndRoundDemo = async () => {
      setIsLoading(true);
      alert("투표를 마감하고 우승작을 선별합니다...\n(AI 경매사가 가치를 산정합니다)");
      try {
          const res = await axios.post(`${API_URL}/api/admin/end-round`);
          alert(`🏆 1등 우승작: ${res.data.winner_title}\n💰 AI 책정가: ${res.data.auction_price} TUK\n\n${res.data.message}`);
          fetchCurrentRound(); 
          fetchGallery(); // 갤러리에 추가되었는지 갱신
      } catch (err) { alert("라운드 종료 실패"); }
      setIsLoading(false);
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
// --- [추가] 상세 보기 모달 상태 ---
  const [selectedCandidate, setSelectedCandidate] = useState(null);

  const openCandidateModal = (candidate) => {
    setSelectedCandidate(candidate);
  };

  const closeCandidateModal = () => {
    setSelectedCandidate(null);
  };
  // ==========================================
  // 4. UI 렌더링 (다이어트 & 랜딩페이지 고도화)
  // ==========================================
  return (
    <div className="App">
      {/* 1. 좌측 사이드바 (깔끔하게 4개 메뉴만) */}
      <aside className="sidebar">
        <h1 className="logo" onClick={() => setActiveTab("main")} style={{cursor: 'pointer'}}>ArtDAO</h1>
        
        <nav>
        <button className={activeTab==="main"?"active":""} onClick={()=>setActiveTab("main")}>📊 Dashboard</button>
        <button className={activeTab==="curate"?"active":""} onClick={()=>setActiveTab("curate")}>🗳️ Curate</button>
        <button className={activeTab==="insights"?"active":""} onClick={()=>setActiveTab("insights")}>📈 Market Insights</button> {/* 추가 */}
        <button className={activeTab==="gallery"?"active":""} onClick={()=>setActiveTab("gallery")}>🖼️ Hall of Fame</button>
        <button className={activeTab==="treasury"?"active":""} onClick={()=>setActiveTab("treasury")}>🏦 Treasury</button> {/* 추가 */}
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
        {/* ----------------------------------------------------------- */}
        {/* ① 📈 Market Insights (AI 분석 데이터 시각화) */}
        {/* ----------------------------------------------------------- */}
        {activeTab === "insights" && (
          <div className="page fade-in">
            <h2 className="page-title">📈 Market Insights</h2>
            <p style={{color: '#9CA3AF', marginBottom: '30px'}}>AI 에이전트가 실시간으로 분석한 이번 주 글로벌 디지털 아트 트렌드 리포트입니다.</p>
            
            <div className="insights-grid" style={{display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '20px'}}>
                <div className="card" style={{padding: '30px', background: '#1A1A1A'}}>
                    <h3>🔥 Hot Keywords (Word Cloud)</h3>
                    <div style={{display: 'flex', flexWrap: 'wrap', gap: '15px', marginTop: '20px'}}>
                        {['#Cyberpunk', '#Surrealism', '#Digital_Human', '#Eco_Art', '#Glitched', '#Abstract', '#Bio_Organic'].map(tag => (
                            <span key={tag} style={{padding: '10px 20px', background: '#2A2A2A', borderRadius: '30px', color: '#38BDF8', fontSize: '1.1rem'}}>{tag}</span>
                        ))}
                    </div>
                </div>
                <div className="card" style={{padding: '30px', background: '#1A1A1A'}}>
                    <h3>🎨 Preferred Styles</h3>
                    <ul style={{listStyle: 'none', padding: 0, marginTop: '20px', color: '#BBB'}}>
                        <li style={{marginBottom: '10px'}}>3D Render (High Detail) - 45%</li>
                        <li style={{marginBottom: '10px'}}>Oil Painting Texture - 30%</li>
                        <li>Minimalist Vector - 25%</li>
                    </ul>
                </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------- */}
        {/* ② 🏦 Treasury (DAO 재정 통계) */}
        {/* ----------------------------------------------------------- */}
        {activeTab === "treasury" && (
          <div className="page fade-in">
            <h2 className="page-title">🏦 Treasury & Statistics</h2>
            <div className="stats-container" style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginTop: '30px'}}>
                <div className="card-mini"><h4>Total Asset</h4><p>1,250,000 TUK</p></div>
                <div className="card-mini"><h4>Total Dividends</h4><p>450,000 TUK</p></div>
                <div className="card-mini"><h4>Minted NFTs</h4><p>12 NFTs</p></div>
                <div className="card-mini"><h4>Active Curators</h4><p>1,024 Users</p></div>
            </div>
            {/* 배당금 분배 차트 더미 (이미지 등으로 대체 가능) */}
            <div className="card" style={{marginTop: '30px', padding: '40px', textAlign: 'center', background: '#1A1A1A'}}>
                <h3 style={{marginBottom: '20px'}}>Dividend Distribution Ratio</h3>
                <div style={{width: '100%', height: '20px', background: '#333', borderRadius: '10px', display: 'flex', overflow: 'hidden'}}>
                    <div style={{width: '70%', background: '#3B82F6'}}></div> {/* Voter Pool */}
                    <div style={{width: '20%', background: '#10B981'}}></div> {/* Creator Pool */}
                    <div style={{width: '10%', background: '#F59E0B'}}></div> {/* Treasury */}
                </div>
                <div style={{display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '15px', fontSize: '0.9rem'}}>
                    <span style={{color: '#3B82F6'}}>● Voter Pool (70%)</span>
                    <span style={{color: '#10B981'}}>● Creator Pool (20%)</span>
                    <span style={{color: '#F59E0B'}}>● Treasury (10%)</span>
                </div>
            </div>
          </div>
        )}
        {/* 🌟 [NEW] 랜딩 페이지 (Dashboard) */}
        {activeTab === "main" && (
          <div className="page fade-in">
            {/* 메인 히어로 배너 */}
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

            {/* 작동 원리 (How it Works) */}
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

        {/* ✅ DAO 투표 (Curate) 탭 */}
        {activeTab === "curate" && (
          <div className="page fade-in">
            <div className="proposals-header-wrap" style={{borderBottom: 'none', marginBottom: '10px'}}>
                <div>
                    <h2 style={{fontFamily: "'Playfair Display', serif", fontSize: "2.5rem", margin: 0}}>🗳️ Curate the Masterpiece</h2>
                    <p style={{color: '#9CA3AF', marginTop: '10px', fontSize: '1rem'}}>AI가 창작한 후보작 중, 최고의 가치를 지닌 작품에 VP(투표력)를 투자하세요.</p>
                </div>
            </div>

            {/* 🚨 [데모용] 관리자 패널 */}
            <div className="admin-demo-panel">
                <div>
                    <strong style={{color: '#EF4444'}}>⚙️ Admin Demo Controls</strong>
                    <span style={{color: '#F87171', fontSize: '0.85rem', marginLeft: '10px'}}>(시연용 제어판)</span>
                </div>
                <div style={{display: 'flex', gap: '10px'}}>
                    <button onClick={handleGenerateRoundDemo} disabled={isLoading} style={{background: '#B91C1C', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold'}}>
                        {isLoading ? "AI 생성 중..." : "1. 새 라운드 (AI 4개 생성)"}
                    </button>
                    <button onClick={handleEndRoundDemo} disabled={isLoading} style={{background: '#991B1B', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold'}}>
                        2. 투표 마감 및 결산
                    </button>
                </div>
            </div>

            {currentRound ? (
                <>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0F0F0F', padding: '15px 20px', borderRadius: '12px', border: '1px solid #2A2A2A', marginBottom: '20px'}}>
                        <span style={{color: '#38BDF8', fontWeight: 'bold', fontSize: '1.1rem'}}>🟢 Round #{currentRound.round_number} 진행 중</span>
                        <span style={{color: '#9CA3AF'}}>내 남은 잔고: <strong style={{color: 'white'}}>{myInfo.balance} TUK</strong></span>
                    </div>

                    <div className="candidate-grid">
    {currentRound.candidates.map(candidate => (
        <div key={candidate.id} className="candidate-card" onClick={() => openCandidateModal(candidate)} style={{cursor: 'pointer'}}>
            <div className="candidate-img-box">
                <img src={candidate.image_url.replace("ipfs://", "https://ipfs.io/ipfs/")} alt={candidate.title} />
            </div>
            <div className="candidate-info">
                <h3 className="candidate-title">{candidate.title}</h3>
                <p className="candidate-desc" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {candidate.description}
                </p>
                
                <div className="candidate-stats">
                    <span style={{color: '#6B7280', fontSize: '0.9rem'}}>현재 누적 투자금</span>
                    <span className="vp-count">{candidate.vp_votes} VP</span>
                </div>

                <div className="vote-action-box" onClick={(e) => e.stopPropagation()}> 
                    {/* ☝️ 입력창 클릭 시 모달이 뜨지 않도록 전파 방지 */}
                    <input 
                        type="number" 
                        className="vp-input" 
                        placeholder="VP 입력" 
                        min="1"
                        value={vpInputs[candidate.id] || ""}
                        onKeyDown={(e) => {
                            if (["-", "+", "e", "E"].includes(e.key)) e.preventDefault();
                        }}
                        onChange={(e) => {
                            const val = e.target.value;
                            if (val === "" || parseInt(val) > 0) {
                                setVpInputs({...vpInputs, [candidate.id]: val});
                            }
                        }}
                    />
                    <button className="vote-btn" onClick={() => handleVote(candidate.id)}>투자하기</button>
                </div>
            </div>
        </div>
    ))}
</div>                </>
            ) : (
                <div style={{textAlign: 'center', padding: '80px 20px', background: '#1A1A1A', borderRadius: '16px', border: '1px dashed #2A2A2A'}}>
                    <span style={{fontSize: '3rem'}}>😴</span>
                    <h3 style={{color: '#D1D5DB', marginTop: '20px'}}>현재 진행 중인 큐레이션 라운드가 없습니다.</h3>
                    <p style={{color: '#6B7280'}}>관리자 패널에서 새로운 라운드를 생성해 주세요.</p>
                </div>
            )}
          </div>
        )}

        {/* 명예의 전당 (Gallery) */}
        {activeTab === "gallery" && (
            <div className="page fade-in">
                <h2 style={{fontFamily: "'Playfair Display', serif", fontSize: "2.5rem"}}>🖼️ Hall of Fame</h2>
                <p style={{color: '#9CA3AF', marginBottom: '30px'}}>대중의 선택을 받아 NFT로 영구 박제된 우승작 컬렉션입니다.</p>
                <div className="gallery-grid">
                    {galleryItems.length === 0 ? (
                        <p style={{color: '#6B7280'}}>아직 등록된 우승작이 없습니다.</p>
                    ) : (
                        galleryItems.map(item => (
                            <div key={item.id} className="card gallery-card" style={{background: '#1A1A1A', border: '1px solid #2A2A2A'}}>
                                <div className="img-wrap" style={{borderBottom: '1px solid #2A2A2A'}}>
                                    <img src={item.image_url} alt={item.title}/>
                                </div>
                                <div className="info" style={{padding: '15px'}}>
                                    <h3 style={{color: '#fff', margin: '0 0 5px 0'}}>{item.title}</h3>
                                    <p style={{color: '#34D399', fontSize: '0.85rem', fontWeight: 'bold'}}>🏆 우승작</p>
                                    <div className="gallery-btns" style={{marginTop: '15px', display: 'flex', gap: '10px'}}>
                                        <button onClick={()=>playDocent(item.id, item.title)} style={{flex: 1, background: '#0F0F0F', color: '#fff', border: '1px solid #2A2A2A', padding: '8px', borderRadius: '6px', cursor: 'pointer'}}>🎧 작품 해설 듣기</button>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        )}

        {/* 마이페이지 */}
        {activeTab === "mypage" && (
            <div className="page fade-in">
                <h2 style={{fontFamily: "'Playfair Display', serif", fontSize: "2.5rem"}}>👤 My Profile</h2>
                {!isLoggedIn ? <p style={{color: '#9CA3AF'}}>지갑을 먼저 연결해주세요.</p> : (
                    <div className="mypage-grid">
                        <div className="card profile" style={{background: '#1A1A1A', border: '1px solid #2A2A2A'}}>
                            <h3 style={{color: '#fff', borderBottom: '1px solid #2A2A2A', paddingBottom: '10px'}}>내 지갑 정보</h3>
                            <p style={{color: '#9CA3AF', margin: '15px 0'}}><strong>주소:</strong> <span style={{color: '#fff'}}>{walletAddress}</span></p>
                            <p style={{color: '#9CA3AF'}}><strong>보유 토큰:</strong> <span style={{color: '#38BDF8', fontWeight: 'bold', fontSize: '1.2rem'}}>{myInfo.balance} TUK</span></p>
                        </div>
                    </div>
                )}
            </div>
        )}
      </main>

      {/* 3. 우측 고정 패널 (AI 만능 어시스턴트) */}
      <aside className="right-panel">
        <div className="right-panel-header">
            <span style={{ color: '#38BDF8', marginRight: '8px' }}>✦</span> 
            <span style={{ fontWeight: 'bold', letterSpacing: '1px' }}>GUIDE</span> 
            <span style={{ fontSize: '0.7rem', marginLeft: 'auto', color: '#34D399' }}>● Online</span>
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
            {/* ✅ 후보작 상세 보기 모달 */}
{selectedCandidate && (
    <div className="modal-overlay" onClick={closeCandidateModal} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.85)', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2000 }}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ background: '#1A1A1A', width: '90%', maxWidth: '900px', borderRadius: '20px', padding: '40px', border: '1px solid #2A2A2A', position: 'relative', display: 'flex', gap: '30px' }}>
            <button onClick={closeCandidateModal} style={{ position: 'absolute', top: '20px', right: '20px', background: 'none', border: 'none', color: '#fff', fontSize: '24px', cursor: 'pointer' }}>✖</button>
            
            <div style={{ flex: 1 }}>
                <img src={selectedCandidate.image_url.replace("ipfs://", "https://ipfs.io/ipfs/")} alt={selectedCandidate.title} style={{ width: '100%', borderRadius: '12px', border: '1px solid #2A2A2A' }} />
            </div>
            
            <div style={{ flex: 1.2, display: 'flex', flexDirection: 'column' }}>
                <h2 style={{ fontSize: '2rem', color: '#fff', marginBottom: '20px' }}>{selectedCandidate.title}</h2>
                <div style={{ flex: 1, overflowY: 'auto', color: '#D1D5DB', lineHeight: '1.8', fontSize: '1.1rem', marginBottom: '20px', paddingRight: '10px' }}>
                    {selectedCandidate.description}
                </div>
                <div style={{ background: '#0F0F0F', padding: '20px', borderRadius: '12px', border: '1px solid #2A2A2A' }}>
                    <p style={{ color: '#9CA3AF', margin: 0 }}>현재 총 투자금: <strong style={{ color: '#38BDF8', fontSize: '1.4rem' }}>{selectedCandidate.vp_votes} VP</strong></p>
                </div>
            </div>
        </div>
    </div>
)}
            
            <div className="chat-input-wrapper">
                <input 
                    type="text" 
                    value={chatInput} 
                    onChange={(e)=>setChatInput(e.target.value)} 
                    onKeyPress={(e)=>e.key==='Enter' && !isChatLoading && chatInput.trim() && sendMessage()} 
                    placeholder="투표 방법이나 작품을 물어보세요!" 
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