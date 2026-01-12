import React, { useState, useEffect } from "react";
import axios from "axios";
import { ethers } from "ethers";
import "./App.css";

const API_URL = "http://localhost:8000";

function App() {
  const [activeTab, setActiveTab] = useState("main");
  const [walletAddress, setWalletAddress] = useState("");
  
  // 데이터 상태
  const [proposals, setProposals] = useState([]);
  const [galleryItems, setGalleryItems] = useState([]);
  
  // AI 스튜디오 상태
  const [studioIntent, setStudioIntent] = useState("");
  const [generatedDraft, setGeneratedDraft] = useState("");
  const [generatedImage, setGeneratedImage] = useState("");
  
  // --- API 호출 함수들 ---
  const connectWallet = async () => {
    if (window.ethereum) {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        setWalletAddress(address);
      } catch (err) { alert("연결 실패"); }
    } else { alert("메타마스크 필요"); }
  };

  const fetchProposals = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/proposals`);
      setProposals(res.data);
    } catch (err) { console.error(err); }
  };

  const fetchGallery = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/gallery/items`);
      setGalleryItems(res.data);
    } catch (err) { console.error(err); }
  };

  // AI 스튜디오: 기획서 초안 생성
  const handleGenerateDraft = async () => {
    if (!studioIntent) return alert("기획 의도를 입력해주세요!");
    const res = await axios.post(`${API_URL}/api/studio/draft`, { intent: studioIntent });
    setGeneratedDraft(res.data.draft_text);
  };

  // AI 스튜디오: 이미지 생성
  const handleGenerateImage = async () => {
    const res = await axios.post(`${API_URL}/api/studio/image`, { keywords: studioIntent });
    setGeneratedImage(res.data.image_url);
  };

  // 안건 최종 제출
  const submitProposal = async () => {
    if (!walletAddress) return alert("지갑을 연결해주세요!");
    await axios.post(`${API_URL}/api/proposals`, {
      wallet_address: walletAddress,
      topic: studioIntent,
      description: generatedDraft,
      image_url: generatedImage,
      style: "AI Studio"
    });
    alert("제출 완료!");
    setActiveTab("proposals");
    fetchProposals();
  };

  useEffect(() => {
    fetchProposals();
    fetchGallery();
  }, []);

  return (
    <div className="App">
      <header className="header">
        <h1>🎨 DAO Art Platform</h1>
        <button className="wallet-btn" onClick={connectWallet}>
          {walletAddress ? `🟢 ${walletAddress.substring(0,6)}...` : "🦊 지갑 연결"}
        </button>
      </header>

      <nav className="nav">
        <button onClick={() => setActiveTab("main")} className={activeTab==="main"?"active":""}>🏠 메인</button>
        <button onClick={() => setActiveTab("studio")} className={activeTab==="studio"?"active":""}>🎨 AI 창작 스튜디오</button>
        <button onClick={() => setActiveTab("gallery")} className={activeTab==="gallery"?"active":""}>🖼️ 온라인 전시관</button>
        <button onClick={() => setActiveTab("proposals")} className={activeTab==="proposals"?"active":""}>🗳️ 안건 목록</button>
      </nav>

      <main className="content">
        {/* 1. 메인 */}
        {activeTab === "main" && (
          <div className="tab-content">
            <h2>🔥 환영합니다!</h2>
            <div className="card summary">
              <h3>현재 진행중인 안건: {proposals.length}개</h3>
              <h3>전시중인 작품: {galleryItems.length}점</h3>
            </div>
          </div>
        )}

        {/* 2. AI 창작 스튜디오 */}
        {activeTab === "studio" && (
          <div className="tab-content">
            <h2>🎨 AI 창작 스튜디오</h2>
            <div className="input-group">
              <input placeholder="기획 의도를 입력하세요 (예: 우울한 사이버펑크 도시)" 
                     value={studioIntent} onChange={(e)=>setStudioIntent(e.target.value)} />
              <button onClick={handleGenerateDraft}>1. 초안 생성</button>
            </div>
            
            {generatedDraft && (
              <div className="card">
                <h4>📜 생성된 기획서</h4>
                <textarea style={{width:"100%", height:"100px"}} value={generatedDraft} readOnly />
                <button onClick={handleGenerateImage}>2. 포스터 생성</button>
              </div>
            )}

            {generatedImage && (
              <div className="card">
                <h4>🖼️ 생성된 포스터</h4>
                <img src={generatedImage} alt="AI Art" style={{maxWidth:"100%"}} />
                <br/><br/>
                <button className="wallet-btn" onClick={submitProposal}>3. 이대로 안건 제출하기</button>
              </div>
            )}
          </div>
        )}

        {/* 3. 온라인 전시관 */}
        {activeTab === "gallery" && (
          <div className="tab-content">
            <h2>🖼️ 온라인 전시관</h2>
            <div className="list">
              {galleryItems.map(item => (
                <div key={item.id} className="card">
                  <img src={item.image_url} alt={item.title} style={{maxWidth:"100%"}}/>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  <button onClick={()=>alert("도슨트 재생 중... (오디오)")}>🎧 도슨트 듣기</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 4. 안건 목록 */}
        {activeTab === "proposals" && (
          <div className="tab-content">
             <h2>🗳️ 안건 목록</h2>
             {proposals.map(p => (
               <div key={p.id} className="card">
                 <h4>#{p.id} {p.topic}</h4>
                 <p>{p.description}</p>
                 {p.image_url && <img src={p.image_url} width="100" alt="proposal art" />}
                 <span className="status">{p.status}</span>
               </div>
             ))}
          </div>
        )}
      </main>
    </div>
  );
}
export default App;