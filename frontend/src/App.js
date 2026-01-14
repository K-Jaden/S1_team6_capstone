import React, { useState, useEffect } from "react";
import axios from "axios";
import { ethers } from "ethers";
import "./App.css";

const API_URL = "http://localhost:8000";

function App() {
  // === 1. 상태 관리 (State) ===
  const [activeTab, setActiveTab] = useState("main"); 
  const [walletAddress, setWalletAddress] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  
  // 데이터 상태
  const [proposals, setProposals] = useState([]);
  const [galleryItems, setGalleryItems] = useState([]);
  
  // [수정] 마이페이지 데이터 (추천 전시, 뱃지 상태 추가)
  const [myInfo, setMyInfo] = useState({ 
    balance: 0, 
    membership: "", 
    rewards: 0, 
    delegation: {},
    activity: [],
    badge: "",
    referral: {},
    myProposals: [],
    recommendation: null // 개인별 전시 추천 데이터
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
    title: "", 
    description: "", 
    style: "General", 
    image_url: "",
    meta_hash: "" 
  });

  // === 2. 초기화 및 지갑 연동 ===
  useEffect(() => {
    if (isLoggedIn) {
      fetchMyPageData(); // 로그인 성공 시 내 정보 로드
    }
    // 공통 데이터는 항상 로드
    fetchProposals(); 
    fetchGallery();   
  }, [isLoggedIn]);

  const connectWallet = async () => {
    if (!window.ethereum) return alert("메타마스크를 설치해주세요!");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      
      // 백엔드 로그인
      await axios.post(`${API_URL}/api/auth/wallet-login`, { wallet_address: address, signature: "dummy_sig" });
      
      setWalletAddress(address);
      setIsLoggedIn(true);
      alert("지갑 연결 및 로그인 성공!");
    } catch (err) { alert("지갑 연결 실패"); console.error(err); }
  };

  // === 3. 데이터 조회 함수들 (API 연동) ===
  
  // [마이페이지] 명세서의 모든 정보 로드 (추천 전시 포함)
  const fetchMyPageData = async () => {
    if (!walletAddress) return;
    try {
      // 명세서에 있는 API들 병렬 호출
      const [resBal, resMem, resRew, resDel, resAct, resRef, resMyProp, resRec] = await Promise.all([
        axios.get(`${API_URL}/api/wallet/balance`, { params: { wallet_address: walletAddress } }),
        axios.get(`${API_URL}/api/user/membership`, { params: { wallet_address: walletAddress } }),
        axios.get(`${API_URL}/api/wallet/rewards`, { params: { wallet_address: walletAddress } }),
        axios.get(`${API_URL}/api/dao/delegation`, { params: { wallet_address: walletAddress } }),
        axios.get(`${API_URL}/api/user/activity`, { params: { wallet_address: walletAddress } }),
        axios.get(`${API_URL}/api/user/referral`, { params: { wallet_address: walletAddress } }),
        axios.get(`${API_URL}/api/user/proposals`, { params: { wallet_address: walletAddress } }),
        // [추가] 개인별 전시 추천 API (GET /api/user/recommend)
        // 만약 백엔드에 이 API가 없다면 에러가 날 수 있으니 try-catch로 감싸거나 백엔드 추가 필요
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
        recommendation: resRec ? resRec.data : null // 추천 데이터 저장
      });
    } catch (err) { console.error("내 정보 로드 실패", err); }
  };

  // 안건 목록 조회
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

  // === 4. 액션 핸들러 ===

  // [큐레이터 뱃지 관리] PATCH /api/user/badge
  const handleBadgeUpdate = async () => {
    try {
        // 명세서: checkCuratorEligibility -> 백엔드 PATCH 호출
        const res = await axios.patch(`${API_URL}/api/user/badge`, null, {
            params: { wallet_address: walletAddress }
        });
        alert(`뱃지 상태 업데이트: ${res.data.status}`);
        fetchMyPageData(); // 정보 갱신
    } catch (err) { alert("뱃지 업데이트 실패"); }
  };

  // [AI 스튜디오]
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

  // [안건 제출]
  const submitProposal = async () => {
    if (!walletAddress) return alert("로그인 필요");
    try {
        await axios.post(`${API_URL}/api/proposals`, {
        wallet_address: walletAddress,
        ...proposalForm
        });
        alert("안건 등록 완료!");
        setActiveTab("proposals");
        fetchProposals();
    } catch(err) { alert("제출 실패"); }
  };

  // [채팅 & 도슨트]
  const sendMessage = async () => {
    if (!chatInput.trim()) return;
    const userMsg = { sender: "user", text: chatInput };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");

    try {
      const res = await axios.post(`${API_URL}/api/a2a/chat`, null, { 
          params: { message: userMsg.text, wallet_address: walletAddress } 
      });
      const botMsg = { sender: "bot", text: res.data.reply };
      setChatMessages(prev => [...prev, botMsg]);
    } catch (err) {
      setChatMessages(prev => [...prev, { sender: "bot", text: "오류가 발생했습니다." }]);
    }
  };

  const playDocent = async (id) => {
    try {
        const res = await axios.post(`${API_URL}/api/gallery/docent`, null, { params: { item_id: id } });
        alert(`🎧 도슨트 재생 중...\n\n"${res.data.text_script}"`);
    } catch(err) { alert("도슨트 재생 실패"); }
  };

  const sendFeedback = async (id) => {
      const msg = prompt("관람평을 남겨주세요:");
      if(msg) {
        await axios.post(`${API_URL}/api/gallery/feedback`, null, { 
            params: { item_id: id, content: msg, wallet_address: walletAddress } 
        });
        alert("소중한 의견 감사합니다!");
      }
  };

  // === 5. UI 렌더링 ===
  return (
    <div className="App">
      {/* 1. 사이드바 */}
      <aside className="sidebar">
        <h1 className="logo">🎨 ArtDAO</h1>
        <div className="user-status">
            {isLoggedIn ? (
                <div className="badge-connected">🟢 Connected</div>
            ) : (
                <button className="connect-btn" onClick={connectWallet}>🦊 Connect Wallet</button>
            )}
        </div>
        <nav>
          <button className={activeTab==="main"?"active":""} onClick={()=>setActiveTab("main")}>🏠 메인 (Hub)</button>
          <button className={activeTab==="proposals"?"active":""} onClick={()=>setActiveTab("proposals")}>🗳️ 안건 목록</button>
          <button className={activeTab==="studio"?"active":""} onClick={()=>setActiveTab("studio")}>🎨 AI 스튜디오</button>
          <button className={activeTab==="gallery"?"active":""} onClick={()=>setActiveTab("gallery")}>🖼️ 온라인 전시관</button>
          <button className={activeTab==="chat"?"active":""} onClick={()=>setActiveTab("chat")}>🤖 AI 큐레이터</button>
          <button className={activeTab==="mypage"?"active":""} onClick={()=>setActiveTab("mypage")}>👤 마이페이지</button>
        </nav>
      </aside>

      {/* 2. 메인 컨텐츠 */}
      <main className="main-content">
        
        {/* 메인 대시보드 */}
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

        {/* 안건 목록 */}
        {activeTab === "proposals" && (
          <div className="page fade-in">
            <div className="page-header">
                <h2>🗳️ Governance Proposals</h2>
                <div className="filters">
                    <button onClick={()=>fetchProposals("OPEN")}>🔵 진행중(OPEN)</button>
                    <button onClick={()=>fetchProposals(null)}>⚪ 전체보기</button>
                    <button className="primary" onClick={()=>{
                        setProposalForm({ title: "", description: "", style: "General", image_url: "", meta_hash: "" });
                        setActiveTab("write");
                    }}>+ 새 안건 작성</button>
                </div>
            </div>
            <div className="list">
                {proposals.map(p => (
                    <div key={p.id} className="card proposal-item">
                        <div className="p-left">
                            <span className={`status-badge ${p.status}`}>{p.status}</span>
                            <h3>{p.title}</h3>
                            <p>{p.description}</p>
                        </div>
                        {p.image_url && <img src={p.image_url} alt="art" className="thumb"/>}
                    </div>
                ))}
            </div>
          </div>
        )}

        {/* 안건 작성 */}
        {activeTab === "write" && (
            <div className="page fade-in">
                <h2>📝 Create Proposal</h2>
                <div className="card form-card">
                    <label>안건 제목 (Title)</label>
                    <input type="text" 
                           value={proposalForm.title} 
                           onChange={(e)=>setProposalForm({...proposalForm, title: e.target.value})} 
                           placeholder="제목 입력"/>
                    
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
                        <input type="text" placeholder="예: 우울한 사이버펑크 도시" 
                               value={studioData.intent} onChange={(e)=>setStudioData({...studioData, intent: e.target.value})}/>
                        <div className="studio-btns">
                            <button onClick={()=>handleStudioAction('check')}>🔍 유사도 검사</button>
                            <button onClick={()=>handleStudioAction('draft')} disabled={isLoading}>📜 기획서 생성</button>
                        </div>
                        {studioData.similarity && <p className="info-msg">{studioData.similarity}</p>}
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
                                <button className="primary full-width" onClick={sendToProposalWrite}>
                                    👉 이 내용으로 안건 작성하기
                                </button>
                            </div>
                        )}
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
                            <div className="img-wrap"><img src={item.image_url} alt={item.title}/></div>
                            <div className="info">
                                <h3>{item.title}</h3>
                                <p>Artist: {item.artist_address ? item.artist_address.substring(0,6) : "Unknown"}</p>
                                <div className="gallery-btns">
                                    <button onClick={()=>playDocent(item.id)}>🎧 도슨트</button>
                                    <button onClick={()=>sendFeedback(item.id)}>💬 방명록</button>
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
                        <input type="text" value={chatInput} onChange={(e)=>setChatInput(e.target.value)} 
                               onKeyPress={(e)=>e.key==='Enter' && sendMessage()} placeholder="미술품 추천을 부탁해보세요..." />
                        <button onClick={sendMessage}>전송</button>
                    </div>
                </div>
            </div>
        )}

        {/* [수정] 마이 페이지 (명세서의 추천 및 뱃지 기능 추가됨) */}
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
                        
                        {/* [추가] 개인별 전시 추천 */}
                        <div className="card recommend">
                            <h3>🎯 취향 저격 전시 추천</h3>
                            {myInfo.recommendation ? (
                                <div>
                                    <p><strong>{myInfo.recommendation.title || "추천 전시"}</strong></p>
                                    <p className="desc">{myInfo.recommendation.reason || "회원님의 활동을 바탕으로 선정된 전시입니다."}</p>
                                </div>
                            ) : (
                                <p>분석 중입니다...</p>
                            )}
                        </div>

                        {/* [추가] 큐레이터 뱃지 관리 */}
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
                            <ul>
                                {myInfo.activity.map((act, i) => (
                                    <li key={i}>{act.date}: {act.type}</li>
                                ))}
                            </ul>
                        </div>
                        
                        <div className="card my-proposals">
                            <h3>📝 내가 쓴 기획서 ({myInfo.myProposals.length})</h3>
                            {myInfo.myProposals.map(p => (
                                <div key={p.id} className="mini-item">#{p.id} {p.title} ({p.status})</div>
                            ))}
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