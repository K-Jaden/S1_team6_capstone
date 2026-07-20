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

// AI Core 서버 주소 (SSE 직접 연결용)
const AI_CORE_URL = currentHost === "localhost"
    ? "http://localhost:8002"
    : "http://13.125.234.38:8002";

function App() {

    // 스마트 컨트랙트 실시간 스탯 상태 추가
    const [daoStats, setDaoStats] = useState({ totalSupply: "0", daoBalance: "0", rawSupply: 0 });

    // TUK 토큰 정보 블록체인에서 직접 읽어오기
    const fetchDaoStats = async () => {
        // contract 객체가 들어왔을 때만 실행되도록 안전장치 추가
        if (!window.ethereum || !contract) return;
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);

            // 하드코딩된 주소 대신, DAO 컨트랙트에게 직접 TUK 토큰 주소를 물어봅니다!
            const tokenAddress = await contract.governanceToken();

            const tokenAbi = [
                "function totalSupply() view returns (uint256)",
                "function balanceOf(address account) view returns (uint256)"
            ];
            const tokenContract = new ethers.Contract(tokenAddress, tokenAbi, provider);

            const supplyWei = await tokenContract.totalSupply();
            const daoBalWei = await tokenContract.balanceOf(CONTRACT_ADDRESS);

            setDaoStats({
                totalSupply: parseInt(ethers.formatEther(supplyWei)).toLocaleString(),
                daoBalance: parseInt(ethers.formatEther(daoBalWei)).toLocaleString(),
                rawSupply: parseInt(ethers.formatEther(supplyWei)) // 계산용 원본 숫자
            });
        } catch (error) {
            console.error("DAO Stats 로드 실패:", error);
        }
    };

    // ==========================================
    // 1. 핵심 상태 관리 (State)
    // ==========================================
    const [showLanding, setShowLanding] = useState(() => !sessionStorage.getItem("entered"));
    const [activeTab, setActiveTab] = useState("main");
    const [walletAddress, setWalletAddress] = useState("");
    const [isLoggedIn, setIsLoggedIn] = useState(false);

    const [myInfo, setMyInfo] = useState({ balance: 0, membership: "", rewards: 0 });
    const [galleryItems, setGalleryItems] = useState([]);
    const [endedRounds, setEndedRounds] = useState([]);

    const [currentRound, setCurrentRound] = useState(null);
    const [vpInputs, setVpInputs] = useState({});
    const [isLoading, setIsLoading] = useState(false);

    const [chatInput, setChatInput] = useState("");
    const [isChatLoading, setIsChatLoading] = useState(false);
    const [chatMessages, setChatMessages] = useState([
        { sender: "bot", text: "안녕하세요! ArtDAO 큐레이터입니다. 투표 방법이나 추천 작품을 물어보세요!" }
    ]);

    const [currentBlockTime, setCurrentBlockTime] = useState(Math.floor(Date.now() / 1000));
    const [contract, setContract] = useState(null);

    // 에이전트 난상토론 라이브 뷰어 상태
    const [showDiscussion, setShowDiscussion] = useState(false);
    const [discussionLogs, setDiscussionLogs] = useState([]);
    const [isDiscussing, setIsDiscussing] = useState(false);
    const eventSourceRef = useRef(null);
    const discussionEndRef = useRef(null);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [expandedLogs, setExpandedLogs] = useState({});

    // 대시보드 통합 토론방 상태
    const [globalMessages, setGlobalMessages] = useState([]);
    const [globalInput, setGlobalInput] = useState("");


    const toggleLogExpansion = (idx) => {
        setExpandedLogs(prev => ({ ...prev, [idx]: !prev[idx] }));
    };

    // ==========================================
    // Co-creation (Human-in-the-loop) 상태
    // ==========================================
    const [roundPhase, setRoundPhase] = useState("VOTING"); // "KEYWORD", "VOTING", "VALUATION"

    // Step 1: 키워드 투표 상태
    const [selectedKeywords, setSelectedKeywords] = useState([]);
    const [selectedEra, setSelectedEra] = useState("");
    const [selectedBackground, setSelectedBackground] = useState("");
    const [selectedStyle, setSelectedStyle] = useState("");

    const [customSubject, setCustomSubject] = useState("");
    const [customEra, setCustomEra] = useState("");
    const [customBackground, setCustomBackground] = useState("");
    const [customStyle, setCustomStyle] = useState("");

    const handleAddCustomSubject = async () => {
        if (!isLoggedIn) return alert("지갑을 먼저 연결해주세요!");
        if (!customSubject.trim()) return alert("추가할 키워드를 입력하세요.");

        try {
            const res = await axios.post(`${API_URL}/api/rounds/custom-keyword`, {
                round_id: currentRound.id,
                word: customSubject,
                type: "subject",
                wallet_address: walletAddress
            });
            alert(res.data.message);
            setCustomSubject("");
            fetchCurrentRound();
        } catch (err) {
            alert(`❌ 추가 실패: ${err.response?.data?.detail || "알 수 없는 오류"}`);
        }
    };

    const handleAddCustomEra = async () => {
        if (!isLoggedIn) return alert("지갑을 먼저 연결해주세요!");
        if (!customEra.trim()) return alert("추가할 시대를 입력하세요.");

        try {
            const res = await axios.post(`${API_URL}/api/rounds/custom-keyword`, {
                round_id: currentRound.id,
                word: customEra,
                type: "era",
                wallet_address: walletAddress
            });
            alert(res.data.message);
            setCustomEra("");
            fetchCurrentRound();
        } catch (err) {
            alert(`❌ 추가 실패: ${err.response?.data?.detail || "알 수 없는 오류"}`);
        }
    };

    const handleAddCustomBackground = async () => {
        if (!isLoggedIn) return alert("지갑을 먼저 연결해주세요!");
        if (!customBackground.trim()) return alert("추가할 배경을 입력하세요.");

        try {
            const res = await axios.post(`${API_URL}/api/rounds/custom-keyword`, {
                round_id: currentRound.id,
                word: customBackground,
                type: "background",
                wallet_address: walletAddress
            });
            alert(res.data.message);
            setCustomBackground("");
            fetchCurrentRound();
        } catch (err) {
            alert(`❌ 추가 실패: ${err.response?.data?.detail || "알 수 없는 오류"}`);
        }
    };

    const handleAddCustomStyle = async () => {
        if (!isLoggedIn) return alert("지갑을 먼저 연결해주세요!");
        if (!customStyle.trim()) return alert("추가할 화풍을 입력하세요.");

        try {
            const res = await axios.post(`${API_URL}/api/rounds/custom-keyword`, {
                round_id: currentRound.id,
                word: customStyle,
                type: "style", // 화풍(style) 분류 전송
                wallet_address: walletAddress
            });
            alert(res.data.message);
            setCustomStyle("");
            fetchCurrentRound();
        } catch (err) {
            alert(`❌ 추가 실패: ${err.response?.data?.detail || "알 수 없는 오류"}`);
        }
    };



    // Step 2: 결산 및 가치 책정 상태
    const [valuationPrice, setValuationPrice] = useState("");
    const [valuationDuration, setValuationDuration] = useState("7");
    const [criticReport, setCriticReport] = useState(""); // AI 비평문 저장용

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
            const roundsData = res.data;

            if (contract && walletAddress) {
                const roundsWithStatus = await Promise.all(roundsData.map(async (r) => {
                    try {
                        // 블록체인 장부에 수령 여부 확인
                        const claimed = await contract.hasClaimedReward(r.round_id, walletAddress);
                        return { ...r, isClaimed: claimed };
                    } catch (e) {
                        return { ...r, isClaimed: false };
                    }
                }));
                setEndedRounds(roundsWithStatus);
            } else {
                setEndedRounds(roundsData.map(r => ({ ...r, isClaimed: false })));
            }
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

    // 새 토론 로그가 추가될 때마다 자동 스크롤
    useEffect(() => {
        if (discussionEndRef.current) {
            discussionEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [discussionLogs]);

    // 컴포넌트 언마운트 시 SSE 연결 정리
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
        } catch (err) { }
        finally {
            localStorage.removeItem("walletAddress");
            setWalletAddress("");
            setIsLoggedIn(false);
            setMyInfo({ balance: 0, membership: "", rewards: 0 });
            setActiveTab("main");
        }
    };
    useEffect(() => {
        if (activeTab === "treasury") {
            fetchDaoStats();
        }
    }, [activeTab, walletAddress]);
    // ==========================================
    // 3. DAO 핵심 액션 함수
    // ==========================================
    const fetchMyPageData = async () => {
        if (!walletAddress) return;
        try {
            // 1. DB에서 오프체인 가상 잔고(virtualBalance) 가져오기
            const resBal = await axios.get(`${API_URL}/api/wallet/balance`, { params: { wallet_address: walletAddress } });
            let dbBalance = resBal.data.balance;

            // 2. 스마트 컨트랙트에서 온체인 잔고(balance) 가져오기
            let onChainBalance = "0";
            if (contract) {
                try {
                    const remainingVpWei = await contract.getRemainingVP(walletAddress);
                    onChainBalance = ethers.formatEther(remainingVpWei);
                } catch (e) { console.error("VP 로드 에러:", e); }
            }

            // 🚨 두 잔고를 덮어쓰지 않고 분리해서 나란히 저장!
            setMyInfo(prev => ({ ...prev, balance: onChainBalance, virtualBalance: dbBalance }));
        } catch (err) { console.error("내 정보 로드 실패"); }
    };

    const fetchGallery = async () => {
        try {
            // API 호출 시 현재 로그인한 유저의 지갑 주소를 매개변수로 전송합니다.
            const res = await axios.get(`${API_URL}/api/gallery/items`, {
                params: { wallet_address: walletAddress }
            });
            setGalleryItems(res.data);
        } catch (err) { console.error("갤러리 로드 실패"); }
    };

    const fetchCurrentRound = async () => {
        try {
            const res = await axios.get(`${API_URL}/api/rounds/current`);
            setCurrentRound(res.data);

            // 일반 유저도 백엔드 라운드 상태에 따라 자동으로 화면이 바뀌도록 동기화!
            if (res.data.status === "keyword_voting") setRoundPhase("KEYWORD");
            else if (res.data.status === "voting") setRoundPhase("VOTING");
            else if (res.data.status === "valuation") setRoundPhase("VALUATION");

        } catch (err) { setCurrentRound(null); }
    };

    const handleVote = async (candidateId) => {
        const amount = vpInputs[candidateId];
        if (!amount || amount <= 0) return alert("투표할 VP를 입력하세요!");
        if (!isLoggedIn) return alert("지갑을 먼저 연결해주세요!");
        if (!contract) return alert("스마트 컨트랙트가 연결되지 않았습니다.");

        try {
            const vpInWei = ethers.parseEther(amount.toString());
            const candidateIndex = currentRound.candidates.findIndex(c => c.id === candidateId);
            if (candidateIndex === -1) return alert("후보를 찾을 수 없습니다.");

            // 매번 최신 signer를 새로 생성하여 stale signer 문제 방지
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();

            // 🚨 1단계: 내 지갑의 TUK 토큰을 쓸 수 있게 허락(Approve)하기
            alert("1/2단계: TUK 토큰 사용 승인을 진행합니다. 메타마스크를 확인해주세요.");
            const tokenAddress = await contract.governanceToken();
            const tokenAbi = ["function approve(address spender, uint256 amount) public returns (bool)"];
            const tokenContract = new ethers.Contract(tokenAddress, tokenAbi, signer);

            const approveTx = await tokenContract.approve(CONTRACT_ADDRESS, vpInWei);
            await approveTx.wait();

            // 🚨 2단계: 최신 signer로 컨트랙트 재연결 후 투표
            // gasLimit을 명시적으로 지정하여 MetaMask의 stale 캐시 기반 estimateGas 시뮬레이션을 우회
            alert("2/2단계: 승인 완료! 실제 투자(Vote) 트랜잭션을 승인해주세요.");
            const freshContract = contract.connect(signer);
            const tx = await freshContract.vote(candidateIndex, vpInWei, { gasLimit: 300000 });
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
            await tx.wait();

            alert("🎉 배당금이 지갑으로 성공적으로 지급되었습니다!\n좌측의 내 지갑 잔고를 확인해주세요.");
            fetchMyPageData();

            // [핵심 추가] ABI 에러를 무시하고 리액트 화면의 버튼을 즉시 잠가버립니다!
            setEndedRounds(prev => prev.map(r => r.round_id === roundId ? { ...r, isClaimed: true } : r));

        } catch (err) {
            console.error("Claim 에러:", err);
            alert("보상 청구 실패: 이미 수령했거나 트랜잭션이 거절되었습니다.");
        }
    };

    const handleVirtualSell = async (item) => {
        if (!isLoggedIn) return alert("지갑을 먼저 연결해주세요!");

        if (window.confirm(`'${item.title}' 작품을 가상 판매하시겠습니까?\n투자한 VP 지분에 따라 수익이 배당됩니다.`)) {
            setIsLoading(true);
            try {
                const res = await axios.post(`${API_URL}/api/gallery/virtual-sell`, {
                    item_id: item.id,
                    wallet_address: walletAddress
                });

                if (res.data.error) {
                    alert(`❌ 실패: ${res.data.error}`);
                } else {
                    // 알림창도 30% 기준 명세서로 예쁘게 리포팅되도록 수정합니다.
                    alert(`🎉 판매 및 정산 완료!\n\n🧾 [오프체인 배당 명세서]\n 총 매각 금액: ${res.data.total_price.toLocaleString()} TUK\n🏛️ DAO 유지비용 (30%): ${(res.data.total_price * 0.3).toLocaleString()} TUK\n📈 나의 투자 지분율: ${res.data.stake_ratio.toFixed(2)}%\n💸 최종 실수령액 (70%): ${res.data.profit.toFixed(2)} TUK 입금 완료!`);
                    
                    // 모달 창 상태를 즉시 매각 완료(영수증 뷰)로 반영
                    setSelectedCandidate(prev => prev && prev.id === item.id ? { 
                        ...prev, 
                        is_sold: true, 
                        my_profit: res.data.profit, 
                        stake_ratio: res.data.stake_ratio 
                    } : prev);

                    fetchGallery();
                    fetchMyPageData();
                    fetchEndedRounds();
                }
            } catch (err) {
                alert("서버 오류로 판매를 진행할 수 없습니다.");
            } finally {
                setIsLoading(false);
            }
        }
    };

    const [loadingStatus, setLoadingStatus] = useState("");

    // ==========================================
    // 에이전트 난상토론 라이브 뷰어 함수들
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
            "트렌드 수집가": { icon: "📡", color: "#34D399", bg: "rgba(52, 211, 153, 0.1)" },
            "키워드 스토리텔러": { icon: "✍️", color: "#A78BFA", bg: "rgba(167, 139, 250, 0.1)" },
            "가중치 프롬프터": { icon: "💻", color: "#F472B6", bg: "rgba(244, 114, 182, 0.1)" },
            "가치 증명자": { icon: "📈", color: "#FBBF24", bg: "rgba(251, 191, 36, 0.1)" },
            "AI 큐레이터": { icon: "", color: "#10B981", bg: "rgba(16, 185, 129, 0.1)" },
            "시스템": { icon: "", color: "#60A5FA", bg: "rgba(96, 165, 250, 0.1)" },
        };
        const foundKey = Object.keys(map).find(key => agentRole && agentRole.includes(key));
        return foundKey ? map[foundKey] : { icon: "", color: "#9CA3AF", bg: "rgba(156, 163, 175, 0.1)" };
    };

    const getLogTypeLabel = (type) => {
        const map = {
            "system": "🔔 시스템",
            "thought": "💭 사고",
            "action": "🔧 액션",
            "output": "📤 출력",
            "task_complete": "완료",
            "final": "🎉 최종",
            "error": "에러",
        };
        return map[type] || type;
    };
    // ==========================================
    // Step 1. 트렌드 키워드 추출 & 새 라운드 생성 API
    // ==========================================
    const handleStartPhase1 = async () => {
        setIsLoading(true);
        setLoadingStatus(" AI가 새로운 라운드 테마를 탐색 중입니다...");
        try {
            const res = await axios.post(`${API_URL}/api/admin/phase1-keywords`);
            setRoundPhase("KEYWORD"); // 화면 전환
            fetchCurrentRound();      // 방금 생성된 라운드 정보 불러오기
            setLoadingStatus("새 라운드가 생성되었습니다!");
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
    // Step 1.5. 유저 키워드 투표 백엔드 전송 API
    // ==========================================
    const submitKeywordVote = async () => {
        if (!currentRound) return alert("진행 중인 라운드가 없습니다.");
        if (!walletAddress) return alert("지갑을 먼저 연결해주세요!");
        try {
            await axios.post(`${API_URL}/api/rounds/vote-keyword`, {
                round_id: currentRound.id,
                selected_words: selectedKeywords,
                selected_era: selectedEra,
                selected_background: selectedBackground,
                selected_style: selectedStyle,
                wallet_address: walletAddress // 지갑 주소 필증 전송
            });

            fetchCurrentRound();
            alert(`🎉 조합 설계 투표가 성공적으로 블록체인 및 백엔드 서버에 확정되었습니다!`);

            setSelectedKeywords([]);
            setSelectedEra("");
            setSelectedBackground("");
            setSelectedStyle("");
        } catch (err) {
            console.error(err);
            // 백엔드가 뱉은 "이미 투표에 참여하셨습니다" 문구를 동적으로 출력
            const errMsg = err.response?.data?.detail || "키워드 투표 실패";
            alert(`❌ 투표 실패: ${errMsg}`);
        }
    };
    // ==========================================
    // 4. 관리자 데모 함수 (SSE 연동)
    // ==========================================
    const handleGenerateRoundDemo = async () => {
        setIsLoading(true);

        // 1단계: 세션 ID 생성 후 SSE 먼저 연결
        const sessionId = `round_${Date.now()}`;
        startDiscussionStream(sessionId);

        const statuses = [
            "📊 투자자들의 키워드 투표 결과를 집계하고 있습니다...",
            "🧠 투표 1~5위 가중치 비율을 적용하여 AI가 프롬프트를 설계 중입니다...",
            " 조합된 가이드라인으로 후보작 5개를 렌더링하고 있습니다...",
            "🔗 생성된 후보작들을 투표 풀에 등록하는 중입니다..."
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
            // 옛날 URL(generate-round)을 새 URL(phase2-generate)로 변경!
            const targetRoundId = currentRound ? currentRound.id : 0;
            const res = await axios.post(`${API_URL}/api/admin/phase2-generate`, null, {
                params: { round_id: targetRoundId, session_id: sessionId }
            });
            clearInterval(interval);
            setLoadingStatus("라운드 생성 완료!");
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
        setRoundPhase("VALUATION"); // UI를 Phase 3으로 넘김

        const sessionId = `endround_${Date.now()}`;
        startDiscussionStream(sessionId);

        const statuses = [
            "📊 투표 결과를 집계하여 1등 우승작을 선정하고 있습니다...",
            "🔍 AI 수석 비평가가 우승작의 미학적, 상업적 가치를 분석 중입니다..."
        ];

        let step = 0;
        setLoadingStatus(statuses[0]);
        const interval = setInterval(() => {
            step++;
            if (step < statuses.length) setLoadingStatus(statuses[step]);
        }, 5000);

        try {
            const targetRoundId = currentRound ? currentRound.id : 0;
            const res = await axios.post(`${API_URL}/api/admin/phase3-valuation`, null, {
                params: { round_id: targetRoundId, session_id: sessionId }
            });
            clearInterval(interval);
            setLoadingStatus("가치 분석 완료!");

            setCriticReport(res.data.report); // AI가 써준 비평문 상태에 저장

            setTimeout(() => {
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

    // 유저가 가격을 입력하고 최종 승인할 때 실행되는 함수
    const submitFinalization = async () => {
        if (!valuationPrice || valuationPrice <= 0) return alert("적정 희망 시작가를 입력해주세요!");
        setIsLoading(true);
        setLoadingStatus("🔗 블록체인 스마트 컨트랙트에 등록 중...");

        try {
            await axios.post(`${API_URL}/api/admin/finalize`, {
                round_id: currentRound.id,
                price_tuk: parseInt(valuationPrice),
                duration_days: parseInt(valuationDuration)
            });

            fetchGallery(); // 갤러리 데이터 새로고침
            fetchEndedRounds();
            setActiveTab("gallery"); // 명예의 전당 탭으로 자동 이동!
            setRoundPhase("KEYWORD"); // 라운드 상태 초기화
            alert("🎉 최종 결산 및 스마트 컨트랙트 등록이 완료되었습니다!\n우승작이 명예의 전당(Hall of Fame)에 영구 박제되었습니다.");
        } catch (err) {
            console.error(err);
            alert("블록체인 등록에 실패했습니다.");
        } finally {
            setIsLoading(false);
            setLoadingStatus("");
            setValuationPrice("");
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
        } catch (err) { alert("도슨트 실패"); }
    };

    // 대시보드 통합 토론방 메시지 불러오기
    const fetchGlobalMessages = async () => {
        try {
            const res = await axios.get(`${API_URL}/api/chat/global`);
            setGlobalMessages(res.data || []);
        } catch (e) { /* 조용히 실패 */ }
    };

    // 대시보드 통합 토론방 메시지 전송
    const submitGlobalMessage = async () => {
        if (!isLoggedIn || !globalInput.trim()) return;
        try {
            await axios.post(`${API_URL}/api/chat/global`, {
                wallet_address: walletAddress,
                text: globalInput.trim()
            });
            setGlobalInput("");
            fetchGlobalMessages();
        } catch (e) { console.error("글로벌 채팅 전송 실패", e); }
    };

    // 대시보드 탭 진입 시 글로벌 채팅 불러오기
    useEffect(() => {
        if (activeTab === "main") {
            fetchGlobalMessages();
        }
    }, [activeTab]);

    const [selectedCandidate, setSelectedCandidate] = useState(null);

    // 프로필 관련 상태
    const [myNickname, setMyNickname] = useState("");
    const [myProfilePic, setMyProfilePic] = useState("🔮");
    const [isSavingProfile, setIsSavingProfile] = useState(false);

    const openCandidateModal = (candidate) => {
        setSelectedCandidate(candidate);
    };

    const closeCandidateModal = () => {
        setSelectedCandidate(null);
    };

    // 유저 프로필(닉네임, 프로필픽) 불러오기
    const fetchUserProfile = async () => {
        if (!walletAddress) return;
        try {
            const res = await axios.get(`${API_URL}/api/user/profile`, { params: { wallet_address: walletAddress } });
            setMyNickname(res.data.nickname || "");
            setMyProfilePic(res.data.profile_pic || "🔮");
        } catch (e) { console.error("프로필 로드 실패", e); }
    };

    // 프로필 저장(닉네임 + 프로필픽)
    const handleSaveProfile = async () => {
        setIsSavingProfile(true);
        try {
            const res = await axios.post(`${API_URL}/api/user/profile`, {
                nickname: myNickname,
                profile_pic: myProfilePic
            }, { params: { wallet_address: walletAddress } });
            alert("✅ 프로필이 저장되었습니다!");
        } catch (e) {
            alert("프로필 저장 실패");
        } finally {
            setIsSavingProfile(false);
        }
    };

    // 프로필 이미지 파일 업로드
    const handleProfilePicUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append("file", file);
        try {
            const res = await axios.post(`${API_URL}/api/user/upload-profile-pic`, formData, {
                params: { wallet_address: walletAddress },
                headers: { "Content-Type": "multipart/form-data" }
            });
            setMyProfilePic(res.data.profile_pic);
        } catch (e) { alert("이미지 업로드 실패"); }
    };

    // 지갑 연결 시 프로필도 불러오기
    useEffect(() => {
        if (isLoggedIn && walletAddress) {
            fetchUserProfile();
        }
    }, [isLoggedIn, walletAddress]);

    // 대시보드 글로벌 메시지 시간 포맷팅 헬퍼 함수 (당일 -> 시간, 어제 이전 -> 경과일수/월수/년수 표시)
    const formatMessageTime = (dateStr) => {
        if (!dateStr) return "";
        try {
            const msgDate = new Date(dateStr);
            const now = new Date();
            const diffMs = now - msgDate;

            if (isNaN(msgDate.getTime())) return "";

            const diffSec = Math.floor(diffMs / 1000);
            const diffMin = Math.floor(diffSec / 60);
            const diffHr = Math.floor(diffMin / 60);
            const diffDays = Math.floor(diffHr / 24);

            const isSameDay = msgDate.getFullYear() === now.getFullYear() &&
                msgDate.getMonth() === now.getMonth() &&
                msgDate.getDate() === now.getDate();

            if (isSameDay) {
                return msgDate.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
            }

            if (diffDays < 30) {
                const count = diffDays || 1;
                return `${count} ${count === 1 ? 'day' : 'days'} ago`;
            }

            const diffMonths = Math.floor(diffDays / 30);
            if (diffMonths < 12) {
                return `${diffMonths} ${diffMonths === 1 ? 'month' : 'months'} ago`;
            }

            const diffYears = Math.floor(diffMonths / 12);
            return `${diffYears} ${diffYears === 1 ? 'year' : 'years'} ago`;
        } catch (e) {
            return "";
        }
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
    if (showLanding) {
        // 더미 이미지 3가지 비율 (1:1 정사각형, 16:9 가로형, 9:16 세로형)
        const dummyArtworks = [
            { url: "/static/images/round1_c1.png", ratio: "ratio-square" },
            { url: "/static/images/round1_c2.png", ratio: "ratio-landscape" },
            { url: "/static/images/round1_c3.png", ratio: "ratio-portrait" },
            { url: "/static/images/round1_c4.png", ratio: "ratio-landscape" },
            { url: "/static/images/round1_c5.png", ratio: "ratio-portrait" },
        ];

        // 갤러리 아이템이 존재할 경우 포함하여 5개 컬럼 생성
        const buildColumnItems = (colIndex) => {
            const list = [...dummyArtworks];
            if (galleryItems && galleryItems.length > 0) {
                galleryItems.forEach(item => {
                    const url = (item.image_url || "").toLowerCase();
                    let ratio = "ratio-square";
                    if (url.includes("c2") || url.includes("c4") || url.includes("landscape") || url.includes("seed_2") || url.includes("seed_4")) {
                        ratio = "ratio-landscape";
                    } else if (url.includes("c3") || url.includes("c5") || url.includes("portrait") || url.includes("seed_3") || url.includes("seed_7")) {
                        ratio = "ratio-portrait";
                    }
                    list.push({ url: item.image_url, ratio });
                });
            }
            const offset = (colIndex * 2) % list.length;
            return [...list.slice(offset), ...list.slice(0, offset)];
        };

        return (
            <div className="landing-splash-container" style={{
                height: '100vh',
                width: '100vw',
                background: '#000000',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                textAlign: 'center',
                padding: '20px',
                boxSizing: 'border-box',
                position: 'fixed',
                top: 0,
                left: 0,
                zIndex: 9999,
                color: '#fff',
                fontFamily: "'Inter', sans-serif",
                overflow: 'hidden'
            }}>
                {/* 1. 무한 갤러리 하강/비상 애니메이션 레이어 (이중 트랙으로 100% 무봉제 보정) */}
                <div className="landing-art-bg-canvas">
                    {[0, 1, 2, 3, 4].map((colIdx) => {
                        const colItems = buildColumnItems(colIdx);
                        return (
                            <div key={colIdx} className="landing-art-column">
                                <div className="landing-art-track">
                                    {colItems.map((art, idx) => (
                                        <div key={idx} className={`landing-art-card ${art.ratio}`}>
                                            <img src={getImageUrl(art.url)} alt="ArtDAO Masterwork" />
                                        </div>
                                    ))}
                                </div>
                                <div className="landing-art-track">
                                    {colItems.map((art, idx) => (
                                        <div key={idx} className={`landing-art-card ${art.ratio}`}>
                                            <img src={getImageUrl(art.url)} alt="ArtDAO Masterwork" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* 2. 시인성을 높이는 가독성 딤 오버레이 */}
                <div className="landing-vignette-overlay" />

                {/* 3. 중앙 브랜딩 & 입장 버튼 컨텐츠 */}
                <div className="fade-in" style={{ animation: 'fadeIn 1.5s ease-out', zIndex: 10, position: 'relative' }}>
                    <h1 style={{
                        fontFamily: "'Playfair Display', serif",
                        fontSize: '7rem',
                        fontWeight: '900',
                        margin: '0 0 20px 0',
                        letterSpacing: '6px',
                        color: '#FFFFFF',
                        textShadow: '0 0 40px rgba(255,255,255,0.2)'
                    }}>
                        ArtDAO
                    </h1>
                    <p style={{
                        color: '#D1D5DB',
                        fontSize: '1.2rem',
                        lineHeight: '1.9',
                        maxWidth: '900px',
                        margin: '0 auto 50px auto',
                        fontWeight: '300',
                        wordBreak: 'keep-all',
                        textShadow: '0 2px 10px rgba(0,0,0,0.8)'
                    }}>
                        세계 최초의 자율형 AI 멀티에이전트 미술 DAO 프로젝트.<br />
                        AI가 실시간 글로벌 서브컬처 트렌드를 수집·난상토론하여 매주 독창적 명작을 탄생시키며,<br />
                        모든 거버넌스는 스마트 컨트랙트를 통해 배당금 형태로 투자자에게 공정하게 환원됩니다.
                    </p>
                    <button
                        onClick={() => { setShowLanding(false); sessionStorage.setItem("entered", "true"); }}
                        style={{
                            background: '#ffffff',
                            color: '#000000',
                            border: 'none',
                            padding: '18px 54px',
                            fontSize: '1.1rem',
                            fontWeight: 'bold',
                            borderRadius: '30px',
                            cursor: 'pointer',
                            letterSpacing: '3px',
                            transition: 'all 0.3s ease',
                            boxShadow: '0 8px 30px rgba(255,255,255,0.2)'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'scale(1.05)';
                            e.currentTarget.style.background = '#e5e5e5';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'scale(1)';
                            e.currentTarget.style.background = '#ffffff';
                        }}
                    >
                        VISIT SITE
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="App">
            {/* 1. 좌측 사이드바 */}
            <aside className="sidebar">
                <h1 className="logo" onClick={() => setActiveTab("main")} style={{ cursor: 'pointer' }}>ArtDAO</h1>

                <nav>
                    <button className={activeTab === "main" ? "active" : ""} onClick={() => setActiveTab("main")}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
                        HOME
                    </button>
                    <button className={activeTab === "curate" ? "active" : ""} onClick={() => setActiveTab("curate")}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" /><path d="m9 12 2 2 4-4" /></svg>
                        VOTE
                    </button>
                    <button className={activeTab === "gallery" ? "active" : ""} onClick={() => setActiveTab("gallery")}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>
                        GALLERY
                    </button>
                    <button className={activeTab === "mypage" ? "active" : ""} onClick={() => setActiveTab("mypage")}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                        PROFILE
                    </button>
                </nav>

            </aside>

            {/* 2. 중앙 메인 컨텐츠 */}
            <main className="main-content">
                <header className="top-header" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '15px 30px', background: 'rgba(15, 15, 15, 0.9)', borderBottom: '1px solid #2A2A2A', position: 'sticky', top: 0, zIndex: 1000, backdropFilter: 'blur(10px)' }}>
                    {isLoggedIn ? (
                        <div className="logged-in-box" style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>

                            {/* 실시간 내 자산 글로벌 위젯 */}
                            <div style={{ display: 'flex', gap: '15px', background: '#1A1A1A', padding: '10px 20px', borderRadius: '30px', border: '1px solid #333', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
                                <span style={{ color: '#9CA3AF', fontSize: '0.95rem' }} title={`${Number(myInfo.balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TUK`}>
                                    투표권: <strong style={{ color: '#38BDF8' }}>{Number(myInfo.balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TUK</strong>
                                </span>
                            </div>
                            {/* 지갑 주소 및 로그아웃 */}
                            <div className="badge-connected" style={{ background: '#2A2A2A', padding: '10px 20px', borderRadius: '30px', color: '#FFF', fontSize: '0.9rem', border: '1px solid #4B5563' }}>
                                {walletAddress.substring(0, 6)}...{walletAddress.substring(walletAddress.length - 4)}
                            </div>
                            <button className="logout-btn" onClick={handleLogout} style={{ background: 'transparent', color: '#EF4444', border: '1px solid #EF4444', padding: '8px 15px', borderRadius: '30px', cursor: 'pointer', fontWeight: 'bold' }}>
                                Logout
                            </button>
                        </div>
                    ) : (
                        <button className="connect-btn" onClick={connectWallet} style={{ background: '#3B82F6', color: '#fff', border: 'none', padding: '10px 25px', borderRadius: '30px', fontWeight: 'bold', cursor: 'pointer' }}>
                            Connect Wallet
                        </button>
                    )}
                </header>

                {/* 🏦 Treasury (실시간 스마트 컨트랙트 연동 완료) */}
                {activeTab === "treasury" && (
                    <div className="page fade-in">
                        <h2 className="page-title" style={{ fontFamily: "'Playfair Display', serif", fontSize: "2.5rem", marginBottom: '10px' }}>🏦 Treasury & Statistics</h2>
                        <p style={{ color: '#9CA3AF', marginBottom: '30px' }}>스마트 컨트랙트 기반 ArtDAO의 실시간 자산 현황입니다.</p>

                        {/* 1. 실시간 온체인 대시보드 위젯 */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                            <div className="card" style={{ background: 'linear-gradient(145deg, #1A1A1A, #0F0F0F)', border: '1px solid #3B82F6', textAlign: 'center', padding: '35px' }}>
                                <h3 style={{ color: '#9CA3AF', fontSize: '1.1rem', margin: '0 0 15px 0' }}>🌐 TUK Token 총 발행량</h3>
                                <div style={{ fontSize: '3rem', fontWeight: 'bold', color: '#38BDF8' }}>
                                    {daoStats.totalSupply} <span style={{ fontSize: '1.5rem', color: '#6B7280' }}>TUK</span>
                                </div>
                                <p style={{ color: '#6B7280', fontSize: '0.9rem', marginTop: '15px' }}>블록체인 상에 발행된 전체 거버넌스 토큰입니다.</p>
                            </div>

                            <div className="card" style={{ background: 'linear-gradient(145deg, #1A1A1A, #0F0F0F)', border: '1px solid #10B981', textAlign: 'center', padding: '35px' }}>
                                <h3 style={{ color: '#9CA3AF', fontSize: '1.1rem', margin: '0 0 15px 0' }}>🏦 DAO Treasury 잔고</h3>
                                <div style={{ fontSize: '3rem', fontWeight: 'bold', color: '#10B981' }}>
                                    {daoStats.daoBalance} <span style={{ fontSize: '1.5rem', color: '#6B7280' }}>TUK</span>
                                </div>
                                <p style={{ color: '#6B7280', fontSize: '0.9rem', marginTop: '15px' }}>스마트 컨트랙트 금고에 보관된 배당 대기 자산입니다.</p>
                            </div>
                        </div>

                        {/* 2. 배당 분배 비율 및 실제 풀 잔고 실시간 연동 */}
                        <div className="card" style={{ marginTop: '30px', padding: '40px', textAlign: 'center', background: '#1A1A1A', border: '1px solid #2A2A2A' }}>
                            <h3 style={{ marginBottom: '10px', color: '#fff' }}>Dividend Distribution Ratio</h3>
                            <p style={{ color: '#9CA3AF', fontSize: '0.9rem', marginBottom: '25px' }}>현재 금고 자산 기준 자금 분배 예치 현황</p>

                            {/* 비율 게이지 바 */}
                            <div style={{ width: '100%', height: '24px', background: '#333', borderRadius: '12px', display: 'flex', overflow: 'hidden', marginBottom: '25px' }}>
                                <div style={{ width: '70%', background: 'linear-gradient(90deg, #3B82F6, #1D4ED8)', title: 'Voter Pool' }} concord-hint="70%"></div>
                                <div style={{ width: '20%', background: 'linear-gradient(90deg, #10B981, #047857)', title: 'Creator Pool' }} concord-hint="20%"></div>
                                <div style={{ width: '10%', background: 'linear-gradient(90deg, #F59E0B, #B45309)', title: 'Treasury' }} concord-hint="10%"></div>
                            </div>

                            {/* 실시간 자산 비례 분배 금액 계산 및 렌더링 */}
                            {(() => {
                                // DAO 잔고는 즉시 발행/지급되어 0이 맞습니다. 
                                // 화면을 채우기 위해 전체 생태계 자산(총 발행량)을 기준으로 풀을 가상으로 보여줍니다.
                                const totalPool = daoStats.rawSupply || 0;
                                return (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px', padding: '15px', background: '#0F0F0F', borderRadius: '8px' }}>
                                        <div style={{ textAlign: 'center', borderRight: '1px solid #2A2A2A' }}>
                                            <div style={{ color: '#3B82F6', fontWeight: 'bold', fontSize: '0.95rem', marginBottom: '5px' }}>● Voter Pool (70%)</div>
                                            <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: '#FFF' }}>
                                                {Math.floor(totalPool * 0.7).toLocaleString()} <span style={{ fontSize: '0.8rem', color: '#6B7280' }}>TUK</span>
                                            </div>
                                        </div>
                                        <div style={{ textAlign: 'center', borderRight: '1px solid #2A2A2A' }}>
                                            <div style={{ color: '#10B981', fontWeight: 'bold', fontSize: '0.95rem', marginBottom: '5px' }}>● 창작자 풀 (20%)</div>
                                            <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: '#FFF' }}>
                                                {Math.floor(totalPool * 0.2).toLocaleString()} <span style={{ fontSize: '0.8rem', color: '#6B7280' }}>TUK</span>
                                            </div>
                                        </div>
                                        <div style={{ textAlign: 'center' }}>
                                            <div style={{ color: '#F59E0B', fontWeight: 'bold', fontSize: '0.95rem', marginBottom: '5px' }}>● 금고 (10%)</div>
                                            <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: '#FFF' }}>
                                                {Math.floor(totalPool * 0.1).toLocaleString()} <span style={{ fontSize: '0.8rem', color: '#6B7280' }}>TUK</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                )}


                {/* Dashboard */}
                {activeTab === "main" && (
                    <div className="page fade-in" style={{ padding: '0 40px 40px 40px' }}>
                        {/* 1. 컴팩트 대시보드 헤더 */}
                        <div style={{ marginBottom: '35px', borderBottom: '1px solid #2A2A2A', paddingBottom: '20px', marginTop: '10px' }}>
                            <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: '2.5rem', fontWeight: 'bold', color: '#F3F4F6', margin: 0 }}>Dashboard</h1>
                            <p style={{ color: '#9CA3AF', margin: '5px 0 0 0', fontSize: '0.95rem' }}>AI 에이전트와 집단 지성의 실시간 협업 통계 및 리더보드</p>
                        </div>

                        {/* 2. 실시간 DAO 통계 위젯 Grid */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '45px' }}>
                            <div className="dashboard-stat-premium-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                <div>
                                    <span style={{ fontSize: '0.85rem', color: '#8B5CF6', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px' }}>Current Phase</span>
                                    <h3 style={{ fontSize: '1.4rem', color: '#F3F4F6', margin: '10px 0 5px 0', fontWeight: 'bold' }}>
                                        {roundPhase === "KEYWORD" && "📝 1단계: 테마 기획"}
                                        {roundPhase === "VOTING" && "🗳️ 2단계: 투자 투표"}
                                        {roundPhase === "VALUATION" && "⚖️ 3단계: 가치평가"}
                                    </h3>
                                </div>
                                <span style={{ fontSize: '0.85rem', color: '#9CA3AF', marginTop: '15px' }}>
                                    {roundPhase === "KEYWORD" && "현재 레딧 트렌드와 자체 지식을 기반으로 키워드 조율 중"}
                                    {roundPhase === "VOTING" && "최종 조율된 시대/장소/화풍 기반 AI 이미지 5선 투표 진행 중"}
                                    {roundPhase === "VALUATION" && "선정작의 미술 가치를 심사하여 블록체인 경매 등록 단계"}
                                </span>
                            </div>

                            <div className="dashboard-stat-premium-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                <div>
                                    <span style={{ fontSize: '0.85rem', color: '#10B981', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px' }}>DAO TVL Balance</span>
                                    <h3 style={{ fontSize: '2.1rem', color: '#10B981', margin: '5px 0 0 0', fontWeight: '900' }}>
                                        {daoStats.daoBalance} <span style={{ fontSize: '1rem', color: '#6B7280', fontWeight: 'normal' }}>TUK</span>
                                    </h3>
                                </div>
                                <span style={{ fontSize: '0.85rem', color: '#9CA3AF', marginTop: '15px' }}>DAO 스마트 컨트랙트 금고에 누적 보관된 가상 자산 통계</span>
                            </div>

                            <div className="dashboard-stat-premium-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                <div>
                                    <span style={{ fontSize: '0.85rem', color: '#38BDF8', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px' }}>Collection Size</span>
                                    <h3 style={{ fontSize: '2.1rem', color: '#38BDF8', margin: '5px 0 0 0', fontWeight: '900' }}>
                                        {galleryItems.length} <span style={{ fontSize: '1rem', color: '#6B7280', fontWeight: 'normal' }}>NFTs</span>
                                    </h3>
                                </div>
                                <span style={{ fontSize: '0.85rem', color: '#9CA3AF', marginTop: '15px' }}>DAO 컬렉터들의 투표를 거쳐 IPFS에 박제된 명예의 전당 보존 개수</span>
                            </div>
                        </div>

                        {/* 3. 실시간 투자 리더보드 (왼쪽 65%) + 통합 토론장 (오른쪽 35%) */}
                        <div style={{ display: 'flex', gap: '30px', alignItems: 'stretch', marginBottom: '55px' }}>
                            {/* Left Side: Live Curation Grid */}
                            <div style={{ flex: 1.6, display: 'flex', flexDirection: 'column' }}>
                                <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: '2.2rem', color: '#F3F4F6', marginBottom: '10px', letterSpacing: '1px' }}>Leaderboard</h2>
                                {currentRound && currentRound.candidates && currentRound.candidates.length > 0 ? (
                                    <>
                                        {(() => {
                                            const sorted = [...currentRound.candidates].sort((a, b) => b.vp_votes - a.vp_votes);

                                            // 공동 순위 계산 (1, 1, 3, 4...)
                                            let currentRank = 1;
                                            const ranks = sorted.map((cand, idx) => {
                                                if (idx > 0 && cand.vp_votes < sorted[idx - 1].vp_votes) {
                                                    currentRank = idx + 1;
                                                }
                                                return currentRank;
                                            });

                                            return (
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px' }}>
                                                    {sorted.map((candidate, index) => {
                                                        const computedRank = ranks[index];
                                                        let cardStyle = {};
                                                        let rankLabel = "";
                                                        let glowColor = "";

                                                        if (index === 0) {
                                                            cardStyle = { gridColumn: 'span 2', gridRow: 'span 2', borderColor: '#F59E0B', boxShadow: '0 0 20px rgba(245, 158, 11, 0.15)' };
                                                        } else if (index === 1) {
                                                            cardStyle = { gridColumn: 'span 2', borderColor: '#9CA3AF', boxShadow: '0 0 15px rgba(156, 163, 175, 0.1)' };
                                                        } else if (index === 2) {
                                                            cardStyle = { gridColumn: 'span 2', borderColor: '#B45309', boxShadow: '0 0 10px rgba(180, 83, 9, 0.1)' };
                                                        } else {
                                                            cardStyle = { gridColumn: 'span 2', borderColor: '#2A2A2A' };
                                                        }

                                                        // 순위 라벨 및 강조 색상은 공동 순위를 반영하여 계산된 순위(computedRank) 기준 단독 표시
                                                        const suffix = computedRank === 1 ? "st" : computedRank === 2 ? "nd" : computedRank === 3 ? "rd" : "th";
                                                        const emoji = computedRank === 1 ? "🥇 " : computedRank === 2 ? "🥈 " : computedRank === 3 ? "🥉 " : "";
                                                        rankLabel = `${emoji}${computedRank}${suffix}`;

                                                        if (computedRank === 1) {
                                                            glowColor = "#FBBF24";
                                                        } else if (computedRank === 2) {
                                                            glowColor = "#D1D5DB";
                                                        } else if (computedRank === 3) {
                                                            glowColor = "#F59E0B";
                                                        } else {
                                                            glowColor = "#9CA3AF";
                                                        }

                                                        return (
                                                            <div
                                                                key={candidate.id}
                                                                className="candidate-card"
                                                                onClick={() => openCandidateModal(candidate)}
                                                                style={{
                                                                    cursor: 'pointer',
                                                                    ...cardStyle,
                                                                    transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                                                                    display: 'flex',
                                                                    flexDirection: 'column',
                                                                    background: '#1A1A1A',
                                                                    borderRadius: '12px',
                                                                    border: '1px solid',
                                                                    overflow: 'hidden'
                                                                }}
                                                            >
                                                                <div className="candidate-img-box" style={{ height: index === 0 ? '585px' : '285px', position: 'relative', background: '#0B0B0B' }}>
                                                                    <img src={getImageUrl(candidate.image_url)} alt={candidate.title} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#0B0B0B' }} />
                                                                    <div style={{ position: 'absolute', top: '10px', left: '10px', background: 'rgba(0,0,0,0.8)', padding: '4px 8px', borderRadius: '30px', border: `1px solid ${glowColor}`, fontSize: '0.65rem', color: '#fff', fontWeight: 'bold' }}>
                                                                        {rankLabel}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })()}
                                    </>
                                ) : (
                                    <div style={{
                                        background: '#1A1A1A',
                                        border: '1px solid #2A2A2A',
                                        borderRadius: '12px',
                                        padding: '40px 30px',
                                        height: '100%',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        justifyContent: 'center',
                                        minHeight: '380px',
                                        boxSizing: 'border-box'
                                    }}>
                                        <h3 style={{ margin: '0 0 25px 0', fontSize: '1.4rem', color: '#fff', fontWeight: 'bold', fontFamily: "'Playfair Display', serif", borderBottom: '1px solid #333', paddingBottom: '15px' }}>DAO Weekly Timeline</h3>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                            {/* Step 1 */}
                                            <div style={{
                                                padding: '15px 20px',
                                                borderRadius: '8px',
                                                background: roundPhase === "KEYWORD" ? 'rgba(59, 130, 246, 0.08)' : '#0F0F0F',
                                                border: `1px solid ${roundPhase === "KEYWORD" ? '#3B82F6' : '#222'}`,
                                                position: 'relative',
                                                textAlign: 'left'
                                            }}>
                                                {roundPhase === "KEYWORD" && <span style={{ position: 'absolute', top: '15px', right: '20px', background: '#3B82F6', color: '#fff', fontSize: '0.7rem', padding: '2px 8px', borderRadius: '10px', fontWeight: 'bold' }}>ACTIVE</span>}
                                                <div style={{ fontSize: '0.8rem', color: roundPhase === "KEYWORD" ? '#3B82F6' : '#9CA3AF', fontWeight: 'bold', marginBottom: '4px' }}>월 ~ 화 (Mon ~ Tue)</div>
                                                <div style={{ fontSize: '1rem', color: '#fff', fontWeight: 'bold' }}>1. 테마/화풍 기획 (Theme & Style Curation)</div>
                                                <p style={{ margin: '5px 0 0 0', fontSize: '0.8rem', color: '#6B7280', lineHeight: '1.4', wordBreak: 'keep-all' }}>AI 에이전트들의 난상토론과 유저 키워드 투표로 작품의 컨셉을 도출합니다.</p>
                                            </div>

                                            {/* Step 2 */}
                                            <div style={{
                                                padding: '15px 20px',
                                                borderRadius: '8px',
                                                background: roundPhase === "VOTING" ? 'rgba(59, 130, 246, 0.08)' : '#0F0F0F',
                                                border: `1px solid ${roundPhase === "VOTING" ? '#3B82F6' : '#222'}`,
                                                position: 'relative',
                                                textAlign: 'left'
                                            }}>
                                                {roundPhase === "VOTING" && <span style={{ position: 'absolute', top: '15px', right: '20px', background: '#3B82F6', color: '#fff', fontSize: '0.7rem', padding: '2px 8px', borderRadius: '10px', fontWeight: 'bold' }}>ACTIVE</span>}
                                                <div style={{ fontSize: '0.8rem', color: roundPhase === "VOTING" ? '#3B82F6' : '#9CA3AF', fontWeight: 'bold', marginBottom: '4px' }}>수 ~ 금 (Wed ~ Fri)</div>
                                                <div style={{ fontSize: '1rem', color: '#fff', fontWeight: 'bold' }}>2. AI 작품 생성 & 투자 (AI Art Gen & Vote)</div>
                                                <p style={{ margin: '5px 0 0 0', fontSize: '0.8rem', color: '#6B7280', lineHeight: '1.4', wordBreak: 'keep-all' }}>기획된 테마로 AI가 생성한 5개 후보작에 거버넌스 토큰(TUK)을 투자합니다.</p>
                                            </div>

                                            {/* Step 3 */}
                                            <div style={{
                                                padding: '15px 20px',
                                                borderRadius: '8px',
                                                background: roundPhase === "VALUATION" ? 'rgba(16, 185, 129, 0.08)' : '#0F0F0F',
                                                border: `1px solid ${roundPhase === "VALUATION" ? '#10B981' : '#222'}`,
                                                position: 'relative',
                                                textAlign: 'left'
                                            }}>
                                                {roundPhase === "VALUATION" ? <span style={{ position: 'absolute', top: '15px', right: '20px', background: '#10B981', color: '#fff', fontSize: '0.7rem', padding: '2px 8px', borderRadius: '10px', fontWeight: 'bold' }}>ACTIVE</span> : null}
                                                <div style={{ fontSize: '0.8rem', color: roundPhase === "VALUATION" ? '#10B981' : '#9CA3AF', fontWeight: 'bold', marginBottom: '4px' }}>토 ~ 일 (Sat ~ Sun)</div>
                                                <div style={{ fontSize: '1rem', color: '#fff', fontWeight: 'bold' }}>3. 결산 및 배당 시작 (Finalize & Rewards)</div>
                                                <p style={{ margin: '5px 0 0 0', fontSize: '0.8rem', color: '#6B7280', lineHeight: '1.4', wordBreak: 'keep-all' }}>우승작을 온체인 NFT로 민팅하고, 가상 옥션 매각금을 투자자들에게 배당금으로 분배합니다.</p>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Right Side: Global Chat Room */}
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                                <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: '2.2rem', color: '#F3F4F6', marginBottom: '10px', letterSpacing: '1px' }}>💬 Chat Room</h2>

                                <div style={{
                                    background: 'rgba(26, 26, 26, 0.6)',
                                    border: '1px solid rgba(255, 255, 255, 0.05)',
                                    borderRadius: '16px',
                                    padding: '20px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    height: 'calc(100% - 70px)',
                                    minHeight: '430px',
                                    justifyContent: 'space-between'
                                }}>
                                    {/* 메시지 리스트 */}
                                    <div style={{
                                        flex: 1,
                                        overflowY: 'auto',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '12px',
                                        marginBottom: '15px',
                                        paddingRight: '5px',
                                        maxHeight: '350px'
                                    }}>
                                        {globalMessages.length === 0 ? (
                                            <div style={{ textAlign: 'center', color: '#6B7280', fontSize: '0.85rem', margin: 'auto 0' }}>
                                                아직 나누어진 대화가 없습니다.<br />첫 메시지를 남겨보세요!
                                            </div>
                                        ) : (
                                            globalMessages.map((msg) => (
                                                <div key={msg.id} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: '#111', padding: '10px 12px', borderRadius: '10px', border: '1px solid #222' }}>
                                                    {/* 프로필 이미지 또는 이모지 영역 */}
                                                    <div style={{
                                                        width: '32px', height: '32px', borderRadius: '50%',
                                                        background: '#0F0F0F', border: '1px solid #333',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        overflow: 'hidden', flexShrink: 0
                                                    }}>
                                                        {msg.profile_pic && (msg.profile_pic.startsWith("http") || msg.profile_pic.startsWith("/static")) ? (
                                                            <img
                                                                src={msg.profile_pic.startsWith("http") ? msg.profile_pic : `${API_URL}${msg.profile_pic}`}
                                                                alt="profile"
                                                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                            />
                                                        ) : (
                                                            <span style={{ fontSize: '1.2rem' }}>{msg.profile_pic || "🔮"}</span>
                                                        )}
                                                    </div>

                                                    {/* 메시지 상세 영역 */}
                                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#6B7280', marginBottom: '4px' }}>
                                                            <span style={{ color: '#38BDF8', fontWeight: 'bold' }}>
                                                                {msg.nickname ? `${msg.nickname} (${msg.wallet_address.substring(0, 4)}...${msg.wallet_address.substring(msg.wallet_address.length - 4)})` : `${msg.wallet_address.substring(0, 6)}...${msg.wallet_address.substring(msg.wallet_address.length - 4)}`}
                                                            </span>
                                                            <span>{formatMessageTime(msg.created_at)}</span>
                                                        </div>
                                                        <div style={{ color: '#E5E7EB', fontSize: '0.85rem', lineHeight: '1.4', wordBreak: 'break-all' }}>{msg.text}</div>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>

                                    {/* 입력창 */}
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <input
                                            type="text"
                                            placeholder={isLoggedIn ? "메시지를 입력하세요..." : "지갑을 연결해야 대화가 가능합니다."}
                                            disabled={!isLoggedIn}
                                            value={globalInput}
                                            onChange={(e) => setGlobalInput(e.target.value)}
                                            onKeyPress={(e) => e.key === 'Enter' && submitGlobalMessage()}
                                            style={{
                                                flex: 1,
                                                padding: '10px 15px',
                                                background: '#0F0F0F',
                                                border: '1px solid #333',
                                                color: '#fff',
                                                borderRadius: '8px',
                                                fontSize: '0.85rem',
                                                outline: 'none'
                                            }}
                                        />
                                        <button
                                            onClick={submitGlobalMessage}
                                            disabled={!isLoggedIn || !globalInput.trim()}
                                            style={{
                                                background: isLoggedIn && globalInput.trim() ? 'linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%)' : '#374151',
                                                color: '#fff',
                                                border: 'none',
                                                padding: '0 20px',
                                                borderRadius: '8px',
                                                cursor: isLoggedIn && globalInput.trim() ? 'pointer' : 'not-allowed',
                                                fontSize: '0.85rem',
                                                fontWeight: 'bold'
                                            }}
                                        >
                                            전송
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 4. 동작 방식 타임라인 */}
                        <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: '2.2rem', color: '#F3F4F6', marginBottom: '25px', letterSpacing: '1px' }}>동작 방식 (How it Works)</h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '25px', marginBottom: '40px' }}>
                            <div className="card timeline-premium-step" style={{ background: '#1A1A1A', padding: '30px', borderRadius: '12px', border: '1px solid #2A2A2A', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                                <span style={{ position: 'absolute', top: '20px', right: '25px', fontSize: '3rem', fontWeight: '900', color: 'rgba(255,255,255,0.03)', fontFamily: "'Courier New', monospace" }}>01</span>
                                <h3 style={{ color: '#fff', fontSize: '1.2rem', marginBottom: '12px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ color: '#8B5CF6' }}>Step 1.</span> AI 에이전트 생성
                                </h3>
                                <p style={{ color: '#9CA3AF', fontSize: '0.92rem', lineHeight: '1.6', margin: 0 }}>
                                    매주 AI 기획자/비평가가 Reddit 웹 트렌드를 수집하고, 독창적인 시대·장소·피사체·화풍 조합을 발굴하여 AI 기획 토론을 시작합니다.
                                </p>
                            </div>
                            <div className="card timeline-premium-step" style={{ background: '#1A1A1A', padding: '30px', borderRadius: '12px', border: '1px solid #2A2A2A', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                                <span style={{ position: 'absolute', top: '20px', right: '25px', fontSize: '3rem', fontWeight: '900', color: 'rgba(255,255,255,0.03)', fontFamily: "'Courier New', monospace" }}>02</span>
                                <h3 style={{ color: '#fff', fontSize: '1.2rem', marginBottom: '12px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ color: '#38BDF8' }}>Step 2.</span> 집단지성 큐레이션
                                </h3>
                                <p style={{ color: '#9CA3AF', fontSize: '0.92rem', lineHeight: '1.6', margin: 0 }}>
                                    DAO 멤버들은 직접 4대 슬롯 조합설계 투표에 참가해 테마 방향성을 유도하며, 생성된 5개 후보작 중 최고의 미술품에 가스비 없이 TUK을 배팅합니다.
                                </p>
                            </div>
                            <div className="card timeline-premium-step" style={{ background: '#1A1A1A', padding: '30px', borderRadius: '12px', border: '1px solid #2A2A2A', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                                <span style={{ position: 'absolute', top: '20px', right: '25px', fontSize: '3rem', fontWeight: '900', color: 'rgba(255,255,255,0.03)', fontFamily: "'Courier New', monospace" }}>03</span>
                                <h3 style={{ color: '#fff', fontSize: '1.2rem', marginBottom: '12px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ color: '#10B981' }}>Step 3.</span> 컨트랙트 배당 분배
                                </h3>
                                <p style={{ color: '#9CA3AF', fontSize: '0.92rem', lineHeight: '1.6', margin: 0 }}>
                                    가장 많은 투표를 받은 우승작만 NFT로 영구 박제되며, 실거래 매각 시 매각 자금(TUK)의 70%가 지분 비율에 따라 안목 높은 투자자들에게 스마트 컨트랙트로 실시간 배당됩니다.
                                </p>
                            </div>
                        </div>

                        {/* 5. Featured Collection Portfolio Showcase */}
                        {galleryItems && galleryItems.length > 0 && (
                            <div style={{ marginTop: '60px', marginBottom: '20px' }}>
                                <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: '2.2rem', color: '#F3F4F6', marginBottom: '10px', letterSpacing: '1px' }}>Featured Collection</h2>

                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 300px))',
                                    justifyContent: 'start',
                                    gap: '20px',
                                    alignItems: 'start'
                                }}>
                                    {galleryItems.slice(0, 6).map(item => {
                                        const url = (item.image_url || "").toLowerCase();
                                        let isLandscape = url.includes("c2") || url.includes("c4") || url.includes("landscape");
                                        let isPortrait = url.includes("c3") || url.includes("c5") || url.includes("portrait");

                                        let cardStyle = {};
                                        let imgHeight = "230px";

                                        if (isLandscape) {
                                            cardStyle = { gridColumn: 'span 2' };
                                            imgHeight = "230px";
                                        } else if (isPortrait) {
                                            cardStyle = { gridColumn: 'span 1' };
                                            imgHeight = "330px";
                                        } else {
                                            cardStyle = { gridColumn: 'span 1' };
                                            imgHeight = "230px";
                                        }

                                        return (
                                            <div
                                                key={item.id}
                                                className="portfolio-premium-card"
                                                onClick={() => openCandidateModal(item)}
                                                style={{
                                                    ...cardStyle,
                                                    background: '#1A1A1A',
                                                    border: '1px solid #2A2A2A',
                                                    borderRadius: '12px',
                                                    overflow: 'hidden',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    flexDirection: 'column'
                                                }}
                                            >
                                                <div style={{ width: '100%', height: imgHeight, background: '#0B0B0B', overflow: 'hidden', position: 'relative' }}>
                                                    <img
                                                        src={getImageUrl(item.image_url)}
                                                        alt={item.title}
                                                        style={{ width: '100%', height: '100%', objectFit: 'contain', transition: 'transform 0.4s ease' }}
                                                        className="portfolio-img"
                                                    />
                                                </div>
                                                <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                    <h4 style={{ margin: 0, fontSize: '1.05rem', color: '#fff', fontWeight: 'bold', fontFamily: "'Playfair Display', serif" }}>{item.title}</h4>
                                                    <p style={{ margin: 0, fontSize: '0.82rem', color: '#9CA3AF', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: '1.4' }}>{item.description}</p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === "curate" && (
                    <div className="page fade-in">
                        <div className="proposals-header-wrap" style={{ borderBottom: 'none', marginBottom: '20px' }}>
                            <div>
                                <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: "2.5rem", margin: 0 }}>VOTE</h2>
                                <p style={{ color: '#9CA3AF', marginTop: '10px', fontSize: '1rem' }}>AI와 함께 예술의 방향성을 정하고, 최고의 가치를 지닌 작품에 투자하세요.</p>
                            </div>
                        </div>

                        {/* ArtDAO 주간 자동화 스케줄 타임라인 */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', background: '#0F0F0F', padding: '20px', borderRadius: '12px', border: '1px solid #2A2A2A', marginBottom: '30px' }}>
                            <div style={{ flex: 1, textAlign: 'center', padding: '10px', borderRight: '1px solid #2A2A2A', opacity: roundPhase === "KEYWORD" ? 1 : 0.4 }}>
                                <div style={{ color: roundPhase === "KEYWORD" ? '#F59E0B' : '#9CA3AF', fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '5px' }}>월 ~ 화</div>
                                <div style={{ color: '#fff' }}>1. 테마/화풍 기획</div>
                            </div>
                            <div style={{ flex: 1, textAlign: 'center', padding: '10px', borderRight: '1px solid #2A2A2A', opacity: roundPhase === "VOTING" ? 1 : 0.4 }}>
                                <div style={{ color: roundPhase === "VOTING" ? '#3B82F6' : '#9CA3AF', fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '5px' }}>수 ~ 금</div>
                                <div style={{ color: '#fff' }}>2. AI 작품 생성 & 투자</div>
                            </div>
                            <div style={{ flex: 1, textAlign: 'center', padding: '10px', opacity: roundPhase === "VALUATION" ? 1 : 0.4 }}>
                                <div style={{ color: roundPhase === "VALUATION" ? '#10B981' : '#9CA3AF', fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '5px' }}>토 ~ 일</div>
                                <div style={{ color: '#fff' }}>3. 결산 및 배당 시작</div>
                            </div>
                        </div>

                        {/* 관리자 데모 패널 (시연용 타임머신) */}
                        <div className="admin-demo-panel" style={{ background: 'rgba(239, 68, 68, 0.05)', border: '1px dashed #EF4444' }}>
                            <div>
                                <strong style={{ color: '#EF4444' }}>데모 컨트롤 패널 (스케줄 시연용)</strong>
                            </div>
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                                <button onClick={handleStartPhase1} style={{ background: roundPhase === "KEYWORD" ? '#F59E0B' : '#4B5563', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                                    기획 단계로 이동 (월~화)
                                </button>
                                <button onClick={() => { setRoundPhase("VOTING"); handleGenerateRoundDemo(); }} style={{ background: roundPhase === "VOTING" ? '#3B82F6' : '#4B5563', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                                    투표 단계로 이동 (수~금)
                                </button>
                                <button onClick={handleEndRoundDemo} style={{ background: roundPhase === "VALUATION" ? '#10B981' : '#4B5563', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                                    결산 단계로 이동 (토~일)
                                </button>

                                {discussionLogs.length > 0 && !showDiscussion && (
                                    <button onClick={() => setShowDiscussion(true)} style={{ background: '#7C3AED', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                                        이전 토론 로그 확인
                                    </button>
                                )}
                                {loadingStatus && <span style={{ color: '#38BDF8', fontSize: '0.9rem', marginLeft: '10px' }}>{loadingStatus}</span>}
                            </div>
                        </div>

                        {/* ========================================== */}
                        {/* 단계 1: 키워드 투표 화면 (실시간 집계) */}
                        {/* ========================================== */}
                        {roundPhase === "KEYWORD" && (
                            <div className="co-creation-panel fade-in">
                                <h3 style={{ color: '#38BDF8', marginBottom: '10px' }}>Autonomous Art Co-Creation</h3>
                                <p style={{ color: '#9CA3AF', marginBottom: '20px' }}>투자할 작품의 기획 요소를 4개 카테고리에서 조율해 주세요.</p>

                                <div style={{ display: 'flex', gap: '20px', marginBottom: '30px', padding: '12px 20px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)', fontSize: '0.9rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                    <span style={{ color: '#38BDF8', fontWeight: 'bold' }}>키워드 표시 안내 :</span>
                                    <span style={{ color: '#FFF' }}>🔥 실시간 레딧 트렌드</span>
                                    <span style={{ color: '#FFF' }}>✨ AI 자체 분석 추천</span>
                                </div>

                                <h4 style={{ color: '#F59E0B', margin: '20px 0 10px 0' }}>1. 배경이 되는 시대 (1개 선택)</h4>
                                <div className="keyword-tag-container">
                                    {currentRound && currentRound.eras && currentRound.eras.map((kw) => (
                                        <button
                                            key={kw.word}
                                            className={`keyword-tag ${selectedEra === kw.word ? 'active' : ''}`}
                                            onClick={() => setSelectedEra(kw.word)}
                                            style={{ borderColor: '#F59E0B' }}
                                        >
                                            {kw.word} <span style={{ fontSize: '0.85rem', color: '#FBBF24', marginLeft: '6px', fontWeight: 'bold' }}>{kw.vote_count}표</span>
                                        </button>
                                    ))}
                                </div>

                                <div style={{ display: 'flex', gap: '10px', marginTop: '15px', marginBottom: '15px' }}>
                                    <input
                                        type="text"
                                        className="glass-input"
                                        placeholder="직접 제안하고 싶은 시대 입력 (예: 조선 시대)"
                                        value={customEra}
                                        onChange={(e) => setCustomEra(e.target.value)}
                                        onKeyPress={(e) => e.key === 'Enter' && handleAddCustomEra()}
                                        style={{ flex: 1, padding: '12px 15px', fontSize: '0.9rem', background: '#1A1A1A', border: '1px solid #333', color: '#fff', borderRadius: '8px' }}
                                    />
                                    <button
                                        onClick={handleAddCustomEra}
                                        style={{ background: '#F59E0B', color: '#fff', border: 'none', padding: '0 20px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                                    >
                                        + 직접 제안
                                    </button>
                                </div>

                                <h4 style={{ color: '#38BDF8', margin: '30px 0 10px 0' }}>2. 기획 대상 및 테마 (최대 3개 선택)</h4>
                                <div className="keyword-tag-container">
                                    {currentRound && currentRound.subjects && currentRound.subjects.map((kw) => (
                                        <button
                                            key={kw.word}
                                            className={`keyword-tag ${selectedKeywords.includes(kw.word) ? 'active' : ''}`}
                                            onClick={() => {
                                                if (selectedKeywords.includes(kw.word)) setSelectedKeywords(selectedKeywords.filter(k => k !== kw.word));
                                                else if (selectedKeywords.length < 3) setSelectedKeywords([...selectedKeywords, kw.word]);
                                            }}
                                            style={{ borderColor: '#38BDF8', fontWeight: 'bold' }}
                                        >
                                            {kw.word} <span style={{ fontSize: '0.85rem', color: '#FBBF24', marginLeft: '6px', fontWeight: 'bold' }}>{kw.vote_count}표</span>
                                        </button>
                                    ))}
                                </div>

                                <div style={{ display: 'flex', gap: '10px', marginTop: '15px', marginBottom: '15px' }}>
                                    <input
                                        type="text"
                                        className="glass-input"
                                        placeholder="직접 제안하고 싶은 테마 입력 (예: 해커톤)"
                                        value={customSubject}
                                        onChange={(e) => setCustomSubject(e.target.value)}
                                        onKeyPress={(e) => e.key === 'Enter' && handleAddCustomSubject()}
                                        style={{ flex: 1, padding: '12px 15px', fontSize: '0.9rem', background: '#1A1A1A', border: '1px solid #333', color: '#fff', borderRadius: '8px' }}
                                    />
                                    <button
                                        onClick={handleAddCustomSubject}
                                        style={{ background: '#38BDF8', color: '#fff', border: 'none', padding: '0 20px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                                    >
                                        + 직접 제안
                                    </button>
                                </div>

                                <h4 style={{ color: '#10B981', margin: '30px 0 10px 0' }}>3. 세부 장소 (1개 선택)</h4>
                                <div className="keyword-tag-container">
                                    {currentRound && currentRound.backgrounds && currentRound.backgrounds.map((kw) => (
                                        <button
                                            key={kw.word}
                                            className={`keyword-tag ${selectedBackground === kw.word ? 'active' : ''}`}
                                            onClick={() => setSelectedBackground(kw.word)}
                                            style={{ borderColor: '#10B981' }}
                                        >
                                            {kw.word} <span style={{ fontSize: '0.85rem', color: '#FBBF24', marginLeft: '6px', fontWeight: 'bold' }}>{kw.vote_count}표</span>
                                        </button>
                                    ))}
                                </div>

                                <div style={{ display: 'flex', gap: '10px', marginTop: '15px', marginBottom: '15px' }}>
                                    <input
                                        type="text"
                                        className="glass-input"
                                        placeholder="직접 제안하고 싶은 장소 입력 (예: 골목길)"
                                        value={customBackground}
                                        onChange={(e) => setCustomBackground(e.target.value)}
                                        onKeyPress={(e) => e.key === 'Enter' && handleAddCustomBackground()}
                                        style={{ flex: 1, padding: '12px 15px', fontSize: '0.9rem', background: '#1A1A1A', border: '1px solid #333', color: '#fff', borderRadius: '8px' }}
                                    />
                                    <button
                                        onClick={handleAddCustomBackground}
                                        style={{ background: '#10B981', color: '#fff', border: 'none', padding: '0 20px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                                    >
                                        + 직접 제안
                                    </button>
                                </div>

                                <h4 style={{ color: '#A78BFA', margin: '30px 0 10px 0' }}>4. 표현 방식 (화풍, 사조, 재질 등 1개 선택)</h4>
                                <div className="keyword-tag-container">
                                    {currentRound && currentRound.styles && currentRound.styles.map((kw) => (
                                        <button
                                            key={kw.word}
                                            className={`keyword-tag ${selectedStyle === kw.word ? 'active' : ''}`}
                                            onClick={() => setSelectedStyle(kw.word)}
                                            style={{ borderColor: '#A78BFA' }}
                                        >
                                            {kw.word} <span style={{ fontSize: '0.85rem', color: '#FBBF24', marginLeft: '6px', fontWeight: 'bold' }}>{kw.vote_count}표</span>
                                        </button>
                                    ))}
                                </div>

                                <div style={{ display: 'flex', gap: '10px', marginTop: '15px', marginBottom: '15px' }}>
                                    <input
                                        type="text"
                                        className="glass-input"
                                        placeholder="직접 제안하고 싶은 화풍 입력 (예: 3D 미니멀리즘)"
                                        value={customStyle}
                                        onChange={(e) => setCustomStyle(e.target.value)}
                                        onKeyPress={(e) => e.key === 'Enter' && handleAddCustomStyle()}
                                        style={{ flex: 1, padding: '12px 15px', fontSize: '0.9rem', background: '#1A1A1A', border: '1px solid #333', color: '#fff', borderRadius: '8px' }}
                                    />
                                    <button
                                        onClick={handleAddCustomStyle}
                                        style={{ background: '#A78BFA', color: '#fff', border: 'none', padding: '0 20px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                                    >
                                        + 직접 제안
                                    </button>
                                </div>

                                <button
                                    className="glow-btn"
                                    disabled={selectedKeywords.length === 0 || !selectedEra || !selectedBackground || !selectedStyle}
                                    onClick={submitKeywordVote}
                                    style={{ marginTop: '35px', width: 'auto', padding: '12px 35px' }}
                                >
                                    조합 설계 투표 확정하기
                                </button>
                            </div>
                        )}
                        {/* ========================================== */}
                        {/* 단계 2: 기존 후보작 투표 화면 */}
                        {/* ========================================== */}
                        {roundPhase === "VOTING" && (
                            <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0F0F0F', padding: '15px 20px', borderRadius: '12px', border: '1px solid #2A2A2A', marginBottom: '20px' }}>
                                    <span style={{ color: '#38BDF8', fontWeight: 'bold', fontSize: '1.1rem' }}>라운드 #{currentRound?.round_number || "X"} 작품 투표 중</span>
                                    <span style={{ color: '#9CA3AF' }} title={`${Number(myInfo.balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TUK`}>이번 라운드 잔여 투표력: <strong style={{ color: 'white' }}>{Number(myInfo.balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TUK</strong></span>
                                </div>

                                {currentRound && currentRound.candidates && currentRound.candidates.length > 0 ? (
                                    (() => {
                                        const sorted = [...currentRound.candidates].sort((a, b) => b.vp_votes - a.vp_votes);

                                        // 공동 순위 계산 (1, 1, 3, 4...)
                                        let currentRank = 1;
                                        const ranks = sorted.map((cand, idx) => {
                                            if (idx > 0 && cand.vp_votes < sorted[idx - 1].vp_votes) {
                                                currentRank = idx + 1;
                                            }
                                            return currentRank;
                                        });

                                        return (
                                            <div className="candidate-grid">
                                                {sorted.map((candidate, index) => {
                                                    const computedRank = ranks[index];
                                                    return (
                                                        <div key={candidate.id} className="candidate-card" onClick={() => openCandidateModal(candidate)} style={{ cursor: 'pointer' }}>
                                                            <div className="candidate-img-box">

                                                                <div className={`rank-badge rank-${computedRank}`}>
                                                                    🏆 {computedRank}
                                                                </div>

                                                                <img src={getImageUrl(candidate.image_url)} alt={candidate.title} />
                                                            </div>
                                                            <div className="candidate-info">
                                                                <h3 className="candidate-title">{candidate.title}</h3>
                                                                <p className="candidate-desc">{candidate.description}</p>

                                                                <div className="candidate-stats">
                                                                    <span style={{ color: '#6B7280', fontSize: '0.9rem' }}>현재 누적 투자금</span>
                                                                    <span className="vp-count">{candidate.vp_votes} TUK</span>
                                                                </div>

                                                                <div className="vote-action-box" onClick={(e) => e.stopPropagation()}>
                                                                    <input
                                                                        type="number"
                                                                        className="vp-input"
                                                                        placeholder="TUK 입력"
                                                                        min="1"
                                                                        value={vpInputs[candidate.id] || ""}
                                                                        onChange={(e) => setVpInputs({ ...vpInputs, [candidate.id]: e.target.value })}
                                                                    />
                                                                    <button className="vote-btn" onClick={() => handleVote(candidate.id)}>투자하기</button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })()
                                ) : (
                                    <div style={{ textAlign: 'center', padding: '80px 20px', background: '#1A1A1A', borderRadius: '16px', border: '1px dashed #2A2A2A' }}>
                                        <p style={{ color: '#6B7280' }}>현재 생성된 작품이 없습니다. 'Step 2' 버튼을 눌러주세요.</p>
                                    </div>
                                )}
                            </>
                        )}

                        {/* ========================================== */}
                        {/*  PHASE 3: 우승작 가치 평가 및 결산 화면 */}
                        {/* ========================================== */}
                        {roundPhase === "VALUATION" && (
                            <div className="co-creation-panel fade-in" style={{ display: 'flex', gap: '30px' }}>

                                {/* 왼쪽: AI 비평가 보고서 */}
                                <div style={{ flex: 1.5, background: '#0F0F0F', padding: '25px', borderRadius: '12px', border: '1px solid #2A2A2A' }}>
                                    <h3 style={{ color: '#FBBF24', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <span>🔍</span> 수석 미술 비평가의 가치 평가
                                    </h3>
                                    <div className="critic-report-box" style={{ whiteSpace: "pre-wrap", lineHeight: "1.6", color: "#D1D5DB" }}>
                                        {criticReport || "분석 데이터를 불러오고 있습니다..."}
                                    </div>
                                    <p style={{ color: '#6B7280', fontSize: '0.9rem', marginTop: '15px' }}>
                                        * 위 보고서를 참고하여 아래 폼에서 최종 판매 가격과 기한을 결정해주세요.
                                    </p>
                                </div>

                                {/* 오른쪽: 유저 가격 책정 폼 */}
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                    <h3 style={{ color: '#fff', margin: '0 0 10px 0' }}> 최종 결산 및 컨트랙트 등록</h3>
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
                                        onClick={submitFinalization}
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
                        <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: "2.5rem" }}>GALLERY</h2>
                        <p style={{ color: '#9CA3AF', marginBottom: '30px' }}>대중의 선택을 받아 NFT로 영구 박제된 우승작 컬렉션입니다.</p>

                        {/* auto-fill 덕분에 작품이 무한히 늘어나도 다음 줄로 예쁘게 정렬됩니다. */}
                        <div className="gallery-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '25px' }}>
                            {galleryItems.length === 0 ? (
                                <p style={{ color: '#6B7280' }}>아직 등록된 우승작이 없습니다.</p>
                            ) : (
                                galleryItems.map(item => (
                                    <div
                                        key={item.id}
                                        className="card gallery-card"
                                        onClick={() => openCandidateModal(item)}
                                        style={{
                                            background: '#1A1A1A',
                                            border: '1px solid #2A2A2A',
                                            borderRadius: '16px',
                                            overflow: 'hidden',
                                            cursor: 'pointer',
                                            height: '340px',
                                            position: 'relative',
                                            transition: 'transform 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.transform = 'translateY(-6px)';
                                            e.currentTarget.style.borderColor = '#3B82F6';
                                            e.currentTarget.style.boxShadow = '0 12px 30px rgba(59, 130, 246, 0.25)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.transform = 'translateY(0)';
                                            e.currentTarget.style.borderColor = '#2A2A2A';
                                            e.currentTarget.style.boxShadow = 'none';
                                        }}
                                    >
                                        <div style={{ width: '100%', height: '100%', backgroundColor: '#0B0B0B', overflow: 'hidden' }}>
                                            <img
                                                src={getImageUrl(item.image_url)}
                                                alt={item.title}
                                                style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.4s ease' }}
                                            />
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {activeTab === "mypage" && (
                    <div className="page fade-in">
                        <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: "2.5rem", marginBottom: '30px' }}>PROFILE</h2>
                        {!isLoggedIn ? <p style={{ color: '#9CA3AF' }}>지갑을 먼저 연결해주세요.</p> : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>

                                {/* 1. 최상단 지갑 정보 */}
                                <div style={{ background: 'linear-gradient(90deg, #1e3a8a 0%, #172554 100%)', padding: '25px', borderRadius: '16px', border: '1px solid #2563eb' }}>
                                    <h3 style={{ color: '#bfdbfe', margin: '0 0 10px 0', fontSize: '1rem' }}>연결된 지갑 주소</h3>
                                    <div style={{ color: '#fff', fontSize: '1.2rem', fontFamily: 'monospace' }}>{walletAddress}</div>
                                </div>

                                {/* 2. 자산 현황 단일 카드 */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                    {/* 온체인 지갑 자산 */}
                                    <div className="card" style={{ background: '#1A1A1A', padding: '40px', textAlign: 'center', border: '1px solid #38BDF8', boxShadow: '0 4px 20px rgba(56, 189, 248, 0.1)' }}>
                                        <h3 style={{ color: '#9CA3AF', margin: '0 0 15px 0', fontSize: '1.1rem' }}>내 지갑 TUK 잔고 (On-chain)</h3>
                                        <div style={{ fontSize: '3.5rem', fontWeight: 'bold', color: '#38BDF8' }}>{Number(myInfo.balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span style={{ fontSize: '1.5rem', color: '#6B7280' }}>TUK</span></div>
                                        <p style={{ color: '#6B7280', fontSize: '0.95rem', marginTop: '15px' }}>투표에 사용할 수 있는 실제 블록체인 거버넌스 토큰입니다.</p>
                                    </div>
                                </div>
                                {/* 1.5 내 프로필 설정 (Profile Settings) */}
                                <div className="card" style={{ background: '#1A1A1A', border: '1px solid #2A2A2A', padding: '30px' }}>
                                    <h3 style={{ color: '#38BDF8', borderBottom: '1px solid #333', paddingBottom: '15px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <span>👤</span> Profile Settings
                                    </h3>
                                    <div style={{ display: 'flex', gap: '30px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                        {/* 프로필픽 */}
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                                            <div style={{
                                                width: '90px', height: '90px', borderRadius: '50%',
                                                background: '#0F0F0F', border: '2px solid #38BDF8',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                overflow: 'hidden', flexShrink: 0
                                            }}>
                                                {myProfilePic && (myProfilePic.startsWith("http") || myProfilePic.startsWith("/static")) ? (
                                                    <img
                                                        src={myProfilePic.startsWith("http") ? myProfilePic : `${API_URL}${myProfilePic}`}
                                                        alt="profile"
                                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                    />
                                                ) : (
                                                    <span style={{ fontSize: '4.5rem' }}>{myProfilePic}</span>
                                                )}
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                                                <div style={{ display: 'flex', gap: '6px' }}>
                                                    {["🔮", "🎨", "🦁", "🚀", "💎", "👾"].map(emoji => (
                                                        <button
                                                            key={emoji}
                                                            onClick={() => setMyProfilePic(emoji)}
                                                            style={{
                                                                background: myProfilePic === emoji ? 'rgba(56,189,248,0.15)' : '#0F0F0F',
                                                                border: `1px solid ${myProfilePic === emoji ? '#38BDF8' : '#333'}`,
                                                                color: '#fff',
                                                                borderRadius: '50%',
                                                                width: '28px',
                                                                height: '28px',
                                                                fontSize: '0.9rem',
                                                                cursor: 'pointer',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                transition: 'all 0.2s'
                                                            }}
                                                        >
                                                            {emoji}
                                                        </button>
                                                    ))}
                                                </div>
                                                <label style={{
                                                    background: '#0F0F0F',
                                                    border: '1px solid #333',
                                                    color: '#9CA3AF',
                                                    padding: '6px 12px',
                                                    borderRadius: '6px',
                                                    fontSize: '0.8rem',
                                                    cursor: 'pointer',
                                                    fontWeight: 'bold',
                                                    marginTop: '5px',
                                                    display: 'inline-block'
                                                }}>
                                                    📷 이미지 업로드
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        onChange={handleProfilePicUpload}
                                                        style={{ display: 'none' }}
                                                    />
                                                </label>
                                            </div>
                                        </div>

                                        {/* 닉네임 입력 */}
                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            <label style={{ color: '#9CA3AF', fontSize: '0.9rem' }}>닉네임 설정</label>
                                            <input
                                                type="text"
                                                maxLength={15}
                                                placeholder="닉네임을 입력하세요 (최대 15자)"
                                                value={myNickname}
                                                onChange={(e) => setMyNickname(e.target.value)}
                                                style={{
                                                    padding: '12px 15px',
                                                    background: '#0F0F0F',
                                                    border: '1px solid #333',
                                                    color: '#fff',
                                                    borderRadius: '8px',
                                                    fontSize: '1rem',
                                                    outline: 'none',
                                                    width: '100%',
                                                    maxWidth: '300px'
                                                }}
                                            />
                                            <button
                                                onClick={handleSaveProfile}
                                                disabled={isSavingProfile}
                                                style={{
                                                    background: 'linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%)',
                                                    color: '#fff',
                                                    border: 'none',
                                                    padding: '12px 24px',
                                                    borderRadius: '8px',
                                                    fontWeight: 'bold',
                                                    cursor: 'pointer',
                                                    marginTop: '10px',
                                                    maxWidth: '150px',
                                                    boxShadow: '0 4px 10px rgba(59, 130, 246, 0.2)'
                                                }}
                                            >
                                                {isSavingProfile ? "저장 중..." : "프로필 저장"}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* 3. 스마트 컨트랙트 배당금 청구 (기존 기능 유지) */}

                                <div className="card profile" style={{ background: '#1A1A1A', border: '1px solid #2A2A2A', padding: '30px' }}>
                                    <h3 style={{ color: '#FBBF24', borderBottom: '1px solid #333', paddingBottom: '15px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <span>🏆</span> Claim Rewards
                                    </h3>
                                    <p style={{ color: '#9CA3AF', fontSize: '0.95rem', lineHeight: '1.6', marginBottom: '20px' }}>
                                        종료된 라운드에서 1등(우승작)에 투표하셨다면 스마트 컨트랙트를 통해 내 지갑으로 TUK 토큰을 직접 청구할 수 있습니다.
                                    </p>

                                    {endedRounds.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '30px', background: '#0F0F0F', borderRadius: '12px' }}>
                                            <p style={{ color: '#6B7280', margin: 0 }}>청구 가능한 종료 라운드가 없습니다.</p>
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                            {endedRounds.map(r => (
                                                <div key={r.round_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0F0F0F', padding: '15px 20px', borderRadius: '12px', border: '1px solid #333' }}>
                                                    <div>
                                                        <div style={{ color: '#fff', fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '5px' }}>Round #{r.round_id}</div>
                                                        <div style={{ color: '#9CA3AF', fontSize: '0.9rem' }}>우승작: {r.winner_title} <span style={{ color: '#6B7280' }}>(AI 매각가: {r.auction_price} TUK)</span></div>
                                                    </div>
                                                    <button
                                                        onClick={() => !r.isClaimed && handleClaimReward(r.round_id)}
                                                        disabled={r.isClaimed}
                                                        style={{
                                                            background: r.isClaimed ? '#374151' : 'linear-gradient(135deg, #F59E0B, #EF4444)',
                                                            color: r.isClaimed ? '#9CA3AF' : '#fff',
                                                            fontWeight: 'bold',
                                                            border: 'none',
                                                            padding: '10px 20px',
                                                            borderRadius: '8px',
                                                            cursor: r.isClaimed ? 'not-allowed' : 'pointer',
                                                            transition: 'all 0.2s'
                                                        }}
                                                    >
                                                        {r.isClaimed ? "수령 완료" : "지갑으로 TUK 받기"}
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
            {/* 후보작 및 우승작 상세 모달창 */}
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
                        zIndex: 3000 // z-index를 높게 설정하여 다른 UI보다 위에 뜨게 합니다.
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
                                style={{ width: '100%', maxHeight: '480px', borderRadius: '12px', border: '1px solid #2A2A2A', objectFit: 'contain', backgroundColor: '#0B0B0B' }}
                            />
                        </div>

                        {/* 오른쪽: 텍스트 영역 */}
                        <div style={{ flex: 1.2, display: 'flex', flexDirection: 'column' }}>
                            <h2 style={{ fontSize: '2rem', color: '#fff', marginBottom: '20px' }}>{selectedCandidate.title}</h2>

                            {/* 전체 설명을 보여주는 스크롤 가능 영역 */}
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

                            {selectedCandidate.image_prompt && (
                                <div style={{ marginBottom: '20px' }}>
                                    <h4 style={{ color: '#38BDF8', marginBottom: '8px', fontSize: '0.95rem' }}>🎨 AI 생성 프롬프트 및 조합 키워드</h4>
                                    <div style={{ background: '#111', padding: '10px 15px', borderRadius: '8px', border: '1px solid #333', fontSize: '0.85rem', color: '#9CA3AF', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                        {selectedCandidate.image_prompt}
                                    </div>
                                </div>
                            )}

                            {/* 하단 정보바: 후보작(투표수)인지 우승작인지 구분해서 표시 */}
                            <div style={{ background: '#0F0F0F', padding: '20px', borderRadius: '12px', border: '1px solid #2A2A2A' }}>
                                {selectedCandidate.vp_votes !== undefined ? (
                                    <p style={{ color: '#9CA3AF', margin: 0 }}>현재 총 투자금: <strong style={{ color: '#38BDF8', fontSize: '1.4rem' }}>{selectedCandidate.vp_votes} TUK</strong></p>
                                ) : (
                                    <div className="sale-status">
                                        {!selectedCandidate.is_sold ? (
                                            <div style={{ padding: 0, background: 'transparent' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                                    <span style={{ color: '#9CA3AF', fontSize: '0.9rem' }}>확정 가상 매각가</span>
                                                    <strong style={{ color: '#FBBF24', fontSize: '1.3rem' }}>{Number(selectedCandidate.auction_price || 0).toLocaleString()} TUK</strong>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <span style={{ color: '#10B981', fontWeight: 'bold', fontSize: '0.85rem' }}>가상 배당 가능</span>
                                                    <button
                                                        onClick={() => handleVirtualSell(selectedCandidate)}
                                                        style={{
                                                            background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)',
                                                            color: '#fff', border: 'none', padding: '8px 18px',
                                                            borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold',
                                                            boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)'
                                                        }}
                                                    >
                                                        배당금 받기
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ padding: 0, background: 'transparent', fontFamily: "'Courier New', Courier, monospace" }}>
                                                <div style={{ fontSize: '0.85rem', color: '#EF4444', borderBottom: '1px dashed #333', paddingBottom: '6px', marginBottom: '12px', textAlign: 'center', fontWeight: 'bold' }}>
                                                    🧾 ART SALES RECEIPTS
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '6px', color: '#9CA3AF' }}>
                                                    <span>판매금액</span>
                                                    <span style={{ color: '#fff' }}>{Number(selectedCandidate.auction_price || 0).toLocaleString()} TUK</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '6px', color: '#F87171' }}>
                                                    <span>- DAO 유지비용 (30%)</span>
                                                    <span>{Number((selectedCandidate.auction_price || 0) * 0.3).toLocaleString()} TUK</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 'bold', borderBottom: '1px dashed #333', paddingBottom: '8px', marginBottom: '8px', color: '#34D399' }}>
                                                    <span>= 투자자들의 수익 (70%)</span>
                                                    <span>{Number((selectedCandidate.auction_price || 0) * 0.7).toLocaleString()} TUK</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#9CA3AF', marginBottom: '4px' }}>
                                                    <span>내 투자 지분율</span>
                                                    <span style={{ color: '#38BDF8', fontWeight: 'bold' }}>{Number(selectedCandidate.stake_ratio || 0).toFixed(2)} %</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', fontWeight: 'bold', color: '#FBBF24', paddingTop: '4px' }}>
                                                    <span>🎁 내 지분 수익</span>
                                                    <span>{Number(selectedCandidate.my_profit || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} TUK</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ========================================== */}
            {/* 우측 고정 패널 ➔ 플로팅 패널로 변경 */}
            {/* ========================================== */}

            {/* 플로팅 버튼 (화면 우측 하단 고정) */}

            {/* 숨겨졌다가 나오는 AI 패널 */}
            <aside
                className="right-panel"
                style={{
                    position: 'fixed',
                    top: 0,
                    right: isChatOpen ? '0' : '-400px', // 열리면 0, 닫히면 화면 밖으로 숨김!
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
                                    <div className="bot-name" style={{ fontSize: '0.85rem', color: '#9CA3AF', marginBottom: '5px' }}><span></span> ArtDAO Guide</div>
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
                                <div className="bot-name"><span></span> ArtDAO Guide</div>
                                <div className="chat-typing-indicator" style={{ padding: '12px', background: '#1A1A1A', borderRadius: '12px', display: 'inline-block' }}>
                                    <span style={{ color: '#9CA3AF' }} title={`${Number(myInfo.balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TUK`}>입력 중...</span>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="chat-input-wrapper" style={{ padding: '20px', borderTop: '1px solid #2A2A2A', display: 'flex', gap: '10px' }}>
                        <input
                            type="text"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && !isChatLoading && chatInput.trim() && sendMessage()}
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
            {/* 에이전트 난상토론 라이브 뷰어 모달 */}
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

                                    // 150자가 넘어가면 '더보기' 활성화
                                    const isLong = log.content && log.content.length > 150;
                                    const isExpanded = expandedLogs[idx];
                                    const displayContent = (!isLong || isExpanded) ? log.content : log.content.substring(0, 150) + "...";

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

                                            <div className="discussion-msg-content" style={{ whiteSpace: "pre-wrap" }}>
                                                {displayContent}
                                            </div>

                                            {/* 더보기/접기 버튼 */}
                                            {isLong && (
                                                <button
                                                    onClick={() => toggleLogExpansion(idx)}
                                                    style={{
                                                        background: 'transparent', border: 'none', color: '#38BDF8',
                                                        marginTop: '8px', padding: 0, cursor: 'pointer',
                                                        fontSize: '0.85rem', fontWeight: 'bold'
                                                    }}
                                                >
                                                    {isExpanded ? "▲ 접기" : "▼ 더보기"}
                                                </button>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                            {isDiscussing && (
                                <div className="discussion-typing">
                                    <div className="dot"></div>
                                    <div className="dot"></div>
                                    <div className="dot"></div>
                                    <span style={{ marginLeft: '10px', color: '#9CA3AF', fontSize: '0.85rem' }} title={`${Number(myInfo.balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TUK`}>
                                        에이전트가 사고 중...
                                    </span>
                                </div>
                            )}

                            <div ref={discussionEndRef} />
                        </div>

                        <div className="discussion-footer">
                            <span className="discussion-stat">
                                총 {discussionLogs.length}개 메시지
                            </span>
                            {!isDiscussing && discussionLogs.length > 0 && (
                                <span className="discussion-stat" style={{ color: '#34D399' }}>
                                    토론 완료
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
