import React, { useState, useEffect } from "react";
import axios from "axios";
import { ethers } from "ethers";
import "./App.css";

// 백엔드 주소
const API_URL = "http://localhost:8000";

function App() {
  // === 상태 관리 (State) ===
  const [activeTab, setActiveTab] = useState("main"); // 현재 보고 있는 페이지
  const [walletAddress, setWalletAddress] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // 데이터 상태
  const [proposals, setProposals] = useState([]);
  const [galleryItems, setGalleryItems] = useState([]);
  
  // 안건 작성 폼 (AI 스튜디오에서 넘어오는 데이터 포함)
  const [proposalForm, setProposalForm] = useState({
    topic: "",
    description: "",
    style: "General",
    image_url: ""
  });

  // AI 스튜디오 상태
  const [studioIntent, setStudioIntent] = useState("");
  const [generatedDraft, setGeneratedDraft] = useState("");
  const [generatedImage, setGeneratedImage] = useState("");
  const [similarityMsg, setSimilarityMsg] = useState("");
  const [isLoading, setIsLoading] = useState(false); // 로딩 상태

  // === 1. 초기 데이터 로드 ===
  useEffect(() => {
    fetchProposals();
    fetchGallery();
  }, []);

  // === 2. API 통신 함수들 ===
  
  // [공통] 안건 목록 조회
  const fetchProposals = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/proposals`);
      setProposals(res.data);
    } catch (err) { console.error("안건 조회 실패:", err); }
  };

  // [공통] 갤러리 조회
  const fetchGallery = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/gallery/items`);
      setGalleryItems(res.data);
    } catch (err) { console.error("갤러리 조회 실패:", err); }
  };

  // [지갑] 메타마스크 연결 & 백엔드 로그인
  const connectWallet = async () => {
    if (!window.ethereum) return alert("메타마스크를 설치해주세요!");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      
      setWalletAddress(address);
      
      // 백엔드로 지갑 주소 전송 (로그인 처리)
      await axios.post(`${API_URL}/api/auth/wallet-login`, {
        wallet_address: address,
        signature: "dummy_signature" // 추후 실제 서명으로 교체 필요
      });
      
      setIsLoggedIn(true);
      alert(`지갑 연결 성공! \n${address.substring(0, 6)}...`);
    } catch (err) {
      console.error(err);
      alert("지갑 연결 실패");
    }
  };

  // [AI 스튜디오] 1. 기획서 초안 생성
  const handleGenerateDraft = async () => {
    if (!studioIntent) return alert("기획 의도를 입력해주세요.");
    setIsLoading(true);
    try {
      const res = await axios.post(`${API_URL}/api/studio/draft`, { intent: studioIntent });
      setGeneratedDraft(res.data.draft_text);
    } catch (err) { alert("생성 실패"); }
    setIsLoading(false);
  };

  // [AI 스튜디오] 2. 포스터 이미지 생성
  const handleGenerateImage = async () => {
    setIsLoading(true);
    try {
      const res = await axios.post(`${API_URL}/api/studio/image`, { keywords: studioIntent });
      setGeneratedImage(res.data.image_url);
    } catch (err) { alert("이미지 생성 실패"); }
    setIsLoading(false);
  };

  // [AI 스튜디오] 3. 유사도 검사
  const handleCheckSimilarity = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/studio/check`, { params: { topic: studioIntent } });
      setSimilarityMsg(`점수: ${res.data.similarity_score}점 - ${res.data.message}`);
    } catch (err) { alert("검사 실패"); }
  };

  // [AI 스튜디오 -> 안건 작성] 데이터 이관
  const sendToProposal = () => {
    setProposalForm({
      topic: studioIntent,
      description: generatedDraft,
      style: "AI Generated",
      image_url: generatedImage
    });
    setActiveTab("proposal-create"); // 페이지 이동
  };

  // [안건] 최종 제출
  const submitProposal = async () => {
    if (!walletAddress) return alert("지갑 연결이 필요합니다.");
    try {
      await axios.post(`${API_URL}/api/proposals`, {
        wallet_address: walletAddress,
        ...proposalForm
      });
      alert("안건이 등록되었습니다!");
      setActiveTab("proposal-list");
      fetchProposals();
      // 폼 초기화
      setProposalForm({ topic: "", description: "", style: "General", image_url: "" });
    } catch (err) { alert("제출 실패"); }
  };

  // [갤러리] 도슨트 듣기
  const handleDocent = async (id) => {
    try {
        const res = await axios.post(`${API_URL}/api/gallery/docent`, null, { params: { item_id: id } });
        alert(`[도슨트 AI]: ${res.data.text_script}`);
    } catch (err) { alert("도슨트 연결 실패"); }
  };


  // === 3. 화면 렌더링 ===
  return (
    <div className="App">
      {/* 헤더 */}
      <header className="header">
        <div className="logo" onClick={() => setActiveTab("main")}>🎨 DAO Art Platform</div>
        <button className={`wallet-btn ${isLoggedIn ? 'connected' : ''}`} onClick={connectWallet}>
          {walletAddress ? `🟢 ${walletAddress.substring(0,6)}...` : "🦊 지갑 연결"}
        </button>
      </header>

      {/* 네비게이션 */}
      <nav className="nav">
        <button className={activeTab==="main"?"active":""} onClick={()=>setActiveTab("main")}>홈</button>
        <button className={activeTab==="proposal-list"?"active":""} onClick={()=>setActiveTab("proposal-list")}>안건 목록</button>
        <button className={activeTab==="studio"?"active":""} onClick={()=>setActiveTab("studio")}>AI 창작 스튜디오</button>
        <button className={activeTab==="gallery"?"active":""} onClick={()=>setActiveTab("gallery")}>온라인 전시관</button>
        <button className={activeTab==="mypage"?"active":""} onClick={()=>setActiveTab("mypage")}>마이페이지</button>
      </nav>

      <main className="content">
        {/* 1. 메인 페이지 */}
        {activeTab === "main" && (
          <div className="page-main">
            <div className="hero-section">
              <h2>Welcome to Art DAO</h2>
              <p>AI와 블록체인이 만나는 새로운 예술 플랫폼</p>
            </div>
            <div className="dashboard-summary">
              <div className="card summary-card" onClick={()=>setActiveTab("proposal-list")}>
                <h3>🔥 진행 중인 안건</h3>
                <p>{proposals.length} 건</p>
              </div>
              <div className="card summary-card" onClick={()=>setActiveTab("gallery")}>
                <h3>🖼️ 전시 작품</h3>
                <p>{galleryItems.length} 점</p>
              </div>
            </div>
          </div>
        )}

        {/* 2. 안건 목록 페이지 */}
        {activeTab === "proposal-list" && (
          <div className="page-proposal-list">
            <div className="page-header">
              <h2>🗳️ 안건 목록</h2>
              <button className="primary-btn" onClick={()=>{
                  setProposalForm({ topic: "", description: "", style: "General", image_url: "" });
                  setActiveTab("proposal-create");
              }}>+ 새 안건 작성</button>
            </div>
            <div className="list-container">
              {proposals.map(p => (
                <div key={p.id} className="card proposal-card">
                  <div className="card-left">
                    {p.image_url && <img src={p.image_url} alt="thumbnail" className="thumb"/>}
                  </div>
                  <div className="card-right">
                    <h3>{p.topic}</h3>
                    <p className="desc">{p.description ? p.description.substring(0, 100) + "..." : "내용 없음"}</p>
                    <div className="tags">
                      <span className="badge">{p.style}</span>
                      <span className={`badge status-${p.status}`}>{p.status}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. 안건 작성 페이지 (일반 + AI 연동) */}
        {activeTab === "proposal-create" && (
          <div className="page-create">
            <h2>📝 안건 작성</h2>
            <div className="form-container">
              <label>투표 종류 (Style)</label>
              <div className="radio-group">
                {["General", "Cyberpunk", "Abstract", "Realistic"].map(style => (
                   <label key={style}>
                     <input type="radio" name="style" 
                            checked={proposalForm.style === style}
                            onChange={(e)=>setProposalForm({...proposalForm, style: e.target.value})}
                            value={style} /> {style}
                   </label>
                ))}
              </div>

              <label>주제 (Topic)</label>
              <input type="text" value={proposalForm.topic} 
                     onChange={(e)=>setProposalForm({...proposalForm, topic: e.target.value})}
                     placeholder="안건 제목을 입력하세요" />

              <label>상세 내용 (Description)</label>
              <textarea rows="5" value={proposalForm.description}
                        onChange={(e)=>setProposalForm({...proposalForm, description: e.target.value})}
                        placeholder="제안 내용을 상세히 적어주세요." />

              <label>첨부 이미지 (URL)</label>
              <div className="image-preview-area">
                 <input type="text" value={proposalForm.image_url} readOnly placeholder="AI 스튜디오에서 생성된 이미지 URL" />
                 {proposalForm.image_url && <img src={proposalForm.image_url} alt="preview" />}
              </div>

              <div className="btn-group">
                <button className="cancel-btn" onClick={()=>setActiveTab("proposal-list")}>취소</button>
                <button className="primary-btn" onClick={submitProposal}>제출하기</button>
              </div>
            </div>
          </div>
        )}

        {/* 4. AI 창작 스튜디오 */}
        {activeTab === "studio" && (
          <div className="page-studio">
            <h2>🎨 AI 창작 스튜디오</h2>
            <div className="studio-container">
                <div className="chat-section">
                    <label>🤖 AI에게 기획 의도를 말해주세요</label>
                    <div className="input-with-btn">
                        <input type="text" placeholder="예: 비 오는 네온사인 도시를 그리고 싶어" 
                               value={studioIntent} onChange={(e)=>setStudioIntent(e.target.value)}/>
                        <button onClick={handleCheckSimilarity}>유사도 검사</button>
                    </div>
                    {similarityMsg && <p className="info-msg">💡 {similarityMsg}</p>}
                    
                    <button className="action-btn" onClick={handleGenerateDraft} disabled={isLoading}>
                        {isLoading ? "생성 중..." : "1. 기획서 초안 생성"}
                    </button>
                </div>

                <div className="result-section">
                    {generatedDraft && (
                        <div className="draft-box">
                            <h4>📜 생성된 기획서</h4>
                            <textarea readOnly value={generatedDraft} />
                            <button className="action-btn" onClick={handleGenerateImage} disabled={isLoading}>
                                {isLoading ? "그리는 중..." : "2. 포스터 이미지 생성"}
                            </button>
                        </div>
                    )}
                    
                    {generatedImage && (
                        <div className="image-box">
                            <h4>🖼️ 생성된 포스터</h4>
                            <img src={generatedImage} alt="AI Art" />
                            <button className="primary-btn full-width" onClick={sendToProposal}>
                                3. 이 내용으로 안건 작성하러 가기 👉
                            </button>
                        </div>
                    )}
                </div>
            </div>
          </div>
        )}

        {/* 5. 온라인 전시관 */}
        {activeTab === "gallery" && (
          <div className="page-gallery">
            <h2>🖼️ 온라인 전시관</h2>
            <div className="gallery-grid">
              {galleryItems.map(item => (
                <div key={item.id} className="gallery-item">
                  <div className="img-wrapper">
                    <img src={item.image_url} alt={item.title} />
                  </div>
                  <div className="info">
                    <h3>{item.title}</h3>
                    <p className="artist">Artist: {item.artist_address ? item.artist_address.substring(0,6) : "Unknown"}</p>
                    <button onClick={()=>handleDocent(item.id)}>🎧 도슨트 해설</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 6. 마이 페이지 */}
        {activeTab === "mypage" && (
           <div className="page-mypage">
             <h2>👤 마이 페이지</h2>
             <div className="card profile-card">
                <h3>내 정보</h3>
                <p><strong>지갑 주소:</strong> {walletAddress || "연결 안됨"}</p>
                <p><strong>멤버십 등급:</strong> Gold (예시)</p>
                <p><strong>토큰 잔액:</strong> 1,000 ART</p>
             </div>
             <div className="card">
                <h3>내 활동</h3>
                <ul>
                    <li>투표 참여: 5회</li>
                    <li>제안 안건: {proposals.filter(p => p.wallet_address === walletAddress).length}건</li>
                </ul>
             </div>
           </div>
        )}
      </main>
    </div>
  );
}

export default App;