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

    const toggleLogExpansion = (idx) => {
        setExpandedLogs(prev => ({ ...prev, [idx]: !prev[idx] }));
    };

    // ==========================================
    // Co-creation (Human-in-the-loop) 상태
    // ==========================================
    const [roundPhase, setRoundPhase] = useState("VOTING"); // "KEYWORD", "VOTING", "VALUATION"

    // Step 1: 키워드 투표 상태
    const [selectedKeywords, setSelectedKeywords] = useState([]);
    const [selectedStyle, setSelectedStyle] = useState("");
    const [customSubject, setCustomSubject] = useState("");

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

    const [customStyle, setCustomStyle] = useState("");

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

            // 🚨 1단계: 내 지갑의 TUK 토큰을 쓸 수 있게 허락(Approve)하기
            alert("1/2단계: TUK 토큰 사용 승인을 진행합니다. 메타마스크를 확인해주세요.");
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();

            const tokenAddress = await contract.governanceToken();
            const tokenAbi = ["function approve(address spender, uint256 amount) public returns (bool)"];
            const tokenContract = new ethers.Contract(tokenAddress, tokenAbi, signer);

            const approveTx = await tokenContract.approve(CONTRACT_ADDRESS, vpInWei);
            await approveTx.wait();

            // 🚨 2단계: 승인이 끝나면 진짜 투표(Vote) 트랜잭션 쏘기
            alert("2/2단계: 승인 완료! 실제 투자(Vote) 트랜잭션을 승인해주세요.");
            const tx = await contract.vote(candidateIndex, vpInWei);
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
                selected_style: selectedStyle,
                wallet_address: walletAddress // 지갑 주소 필증 전송
            });

            fetchCurrentRound();
            alert(`🎉 [${selectedKeywords.join(', ')}] 테마 및 [${selectedStyle}] 화풍으로 투표가 확정되었습니다!`);

            setSelectedKeywords([]);
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
                <h1 className="logo" onClick={() => setActiveTab("main")} style={{ cursor: 'pointer' }}>ArtDAO</h1>

                <nav>
                    <button className={activeTab === "대시보드" ? "active" : ""} onClick={() => setActiveTab("main")}>대시보드</button>
                    <button className={activeTab === "큐레이션" ? "active" : ""} onClick={() => setActiveTab("curate")}>큐레이션</button>
                    <button className={activeTab === "명예의전당" ? "active" : ""} onClick={() => setActiveTab("gallery")}>명예의 전당</button>
                    <button className={activeTab === "프로필" ? "active" : ""} onClick={() => setActiveTab("mypage")}>프로필</button>
                </nav>

            </aside>

            {/* 2. 중앙 메인 컨텐츠 */}
            <main className="main-content">
                <header className="top-header" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '15px 30px', background: 'rgba(15, 15, 15, 0.9)', borderBottom: '1px solid #2A2A2A', position: 'sticky', top: 0, zIndex: 1000, backdropFilter: 'blur(10px)' }}>
                    {isLoggedIn ? (
                        <div className="logged-in-box" style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>

                            {/* 실시간 내 자산 글로벌 위젯 */}
                            <div style={{ display: 'flex', gap: '15px', background: '#1A1A1A', padding: '10px 20px', borderRadius: '30px', border: '1px solid #333', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
                                <span style={{ color: '#9CA3AF', fontSize: '0.95rem' }}>
                                    투표권: <strong style={{ color: '#38BDF8' }}>{myInfo.balance} TUK</strong>
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
                    <div className="page fade-in">
                        <div style={{ padding: '60px 40px', background: 'linear-gradient(135deg, #1e1e1e 0%, #0f0f0f 100%)', borderRadius: '16px', border: '1px solid #2A2A2A', marginBottom: '30px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
                            <div style={{ position: 'relative', zIndex: 2 }}>
                                <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: '5.5rem', color: '#F3F4F6', margin: '0 0 15px 0' }}>
                                    ArtDAO
                                </h1>
                                <p style={{ color: '#9CA3AF', fontSize: '1.2rem', lineHeight: '1.6', maxWidth: '600px', margin: '0 auto 30px auto' }}>
                                    AI가 트렌드를 분석하여 매주 새로운 예술을 창조합니다.<br />
                                    DAO 멤버가 되어 가스비 없이 투표하고, 블록체인 배당을 받으세요.
                                </p>
                                <button onClick={() => setActiveTab("curate")} style={{ background: '#3B82F6', color: '#fff', border: 'none', padding: '16px 36px', fontSize: '1.1rem', fontWeight: 'bold', borderRadius: '30px', cursor: 'pointer', boxShadow: '0 4px 15px rgba(59, 130, 246, 0.4)' }}>
                                    큐레이션 참여하기
                                </button>
                            </div>
                        </div>

                        <h2 style={{ marginTop: '40px', marginBottom: '20px', fontSize: '1.5rem' }}>동작 방식</h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '40px' }}>
                            <div className="card" style={{ background: '#1A1A1A', padding: '25px', borderRadius: '12px', border: '1px solid #2A2A2A' }}>
                                <div style={{ fontSize: '2.5rem', marginBottom: '15px' }}></div>
                                <h3 style={{ color: '#fff', fontSize: '1.1rem', marginBottom: '10px' }}>1. AI 에이전트 생성</h3>
                                <p style={{ color: '#9CA3AF', fontSize: '0.9rem', lineHeight: '1.5' }}>매주 AI 기획자와 비평가가 웹 트렌드를 검색하여 4개의 고품질 디지털 아트 후보작을 오프체인에 생성합니다.</p>
                            </div>
                            <div className="card" style={{ background: '#1A1A1A', padding: '25px', borderRadius: '12px', border: '1px solid #2A2A2A' }}>
                                <div style={{ fontSize: '2.5rem', marginBottom: '15px' }}></div>
                                <h3 style={{ color: '#fff', fontSize: '1.1rem', marginBottom: '10px' }}>2. 집단지성 투자</h3>
                                <p style={{ color: '#9CA3AF', fontSize: '0.9rem', lineHeight: '1.5' }}>유저는 보유한 TUK를 직접 지불하여 가장 가치 있는 작품에 투자합니다. 우승작에 투자한 경우 배당을 얻지만, 탈락 시 투자금은 DAO에 귀속되어 소각됩니다.</p>
                            </div>
                            <div className="card" style={{ background: '#1A1A1A', padding: '25px', borderRadius: '12px', border: '1px solid #2A2A2A' }}>
                                <div style={{ fontSize: '2.5rem', marginBottom: '15px' }}></div>
                                <h3 style={{ color: '#fff', fontSize: '1.1rem', marginBottom: '10px' }}>3. 스마트 컨트랙트 배당</h3>
                                <p style={{ color: '#9CA3AF', fontSize: '0.9rem', lineHeight: '1.5' }}>투표 종료 시 1등 작품만 NFT로 민팅되며, AI 경매사의 산정가에 따라 안목 있는 투표자들에게 수익이 자동 배당됩니다.</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Curate */}
                {activeTab === "curate" && (
                    <div className="page fade-in">
                        <div className="proposals-header-wrap" style={{ borderBottom: 'none', marginBottom: '20px' }}>
                            <div>
                                <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: "2.5rem", margin: 0 }}>명작 큐레이션</h2>
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
                                <p style={{ color: '#9CA3AF', marginBottom: '25px' }}>투자할 작품의 기획 요소를 2개 카테고리에서 조율해 주세요.</p>
                                <h4 style={{ color: '#38BDF8', margin: '20px 0 10px 0' }}>1. 기획 대상 및 테마 (최대 3개 선택)</h4>
                                <div className="keyword-tag-container">
                                    {currentRound && currentRound.subjects && currentRound.subjects.map((kw) => (
                                        <button
                                            key={kw.word}
                                            className={`keyword-tag ${selectedKeywords.includes(kw.word) ? 'active' : ''}`}
                                            onClick={() => {
                                                if (selectedKeywords.includes(kw.word)) setSelectedKeywords(selectedKeywords.filter(k => k !== kw.word));
                                                else if (selectedKeywords.length < 3) setSelectedKeywords([...selectedKeywords, kw.word]);
                                            }}
                                        >
                                            #{kw.word} <span style={{ fontSize: '0.85rem', color: '#FBBF24', marginLeft: '6px', fontWeight: 'bold' }}>{kw.vote_count}표</span>
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

                                <h4 style={{ color: '#A78BFA', margin: '30px 0 10px 0' }}>2. 표현 방식 (화풍, 사조, 재질 등 1개 선택)</h4>
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
                                    disabled={selectedKeywords.length === 0 || !selectedStyle}
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
                                    <span style={{ color: '#9CA3AF' }}>이번 라운드 잔여 투표력: <strong style={{ color: 'white' }}>{myInfo.balance} TUK</strong></span>
                                </div>

                                {currentRound && currentRound.candidates && currentRound.candidates.length > 0 ? (
                                    <div className="candidate-grid">
                                        {currentRound.candidates.map(candidate => (
                                            <div key={candidate.id} className="candidate-card" onClick={() => openCandidateModal(candidate)} style={{ cursor: 'pointer' }}>
                                                <div className="candidate-img-box">
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
                                        ))}
                                    </div>
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
                        <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: "2.5rem" }}>🖼️ Hall of Fame</h2>
                        <p style={{ color: '#9CA3AF', marginBottom: '30px' }}>대중의 선택을 받아 NFT로 영구 박제된 우승작 컬렉션입니다.</p>

                        {/* auto-fill 덕분에 작품이 무한히 늘어나도 다음 줄로 예쁘게 정렬됩니다. */}
                        <div className="gallery-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '25px' }}>
                            {galleryItems.length === 0 ? (
                                <p style={{ color: '#6B7280' }}>아직 등록된 우승작이 없습니다.</p>
                            ) : (
                                galleryItems.map(item => (
                                    <div
                                        key={item.id}
                                        className="card gallery-card"
                                        // 클릭 시 이미 구현된 openCandidateModal을 재사용하여 상세 내용을 띄웁니다.
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

                                        <div className="img-wrap" style={{ width: '100%', height: '280px', borderBottom: '1px solid #2A2A2A', overflow: 'hidden', backgroundColor: '#000' }}>
                                            <img
                                                src={getImageUrl(item.image_url)}
                                                alt={item.title}
                                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                            />
                                        </div>

                                        <div className="info" style={{ padding: '20px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                                            <h3 style={{ color: '#fff', margin: '0 0 10px 0', fontSize: '1.25rem', lineHeight: '1.4' }}>{item.title}</h3>
                                            <p style={{ color: '#34D399', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '15px' }}>🏆 우승작 (IPFS 영구 보존)</p>

                                            {/* 평소에는 3줄만 보여주고 '...' 처리합니다. */}
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
                                            <div style={{ marginTop: '15px', color: '#3B82F6', fontSize: '0.85rem', fontWeight: 'bold' }}>
                                                더 보기...
                                            </div>
                                            {/* 가상 판매 상태 및 버튼 UI */}
                                            {/* 가상 판매 상태 및 영수증 영리한 전환 UI 구현 블록 */}
                                            <div
                                                className="sale-status"
                                                style={{ marginTop: '15px' }}
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                {!item.is_sold ? (
                                                    /*  Case 1: 판매 대기 중 상태 (결정된 매각 금액 시각화 강조) */
                                                    <div style={{ padding: '15px', background: '#0F0F0F', borderRadius: '12px', border: '1px solid #333' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                                            <span style={{ color: '#9CA3AF', fontSize: '0.85rem' }}> 확정 가상 매각가</span>
                                                            <strong style={{ color: '#FBBF24', fontSize: '1.2rem' }}>{Number(item.auction_price || 0).toLocaleString()} TUK</strong>
                                                        </div>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <span style={{ color: '#10B981', fontWeight: 'bold', fontSize: '0.85rem' }}> 가상 배당 가능</span>
                                                            <button
                                                                onClick={() => handleVirtualSell(item)}
                                                                style={{
                                                                    background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)',
                                                                    color: '#fff', border: 'none', padding: '8px 16px',
                                                                    borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold',
                                                                    boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)'
                                                                }}
                                                            >
                                                                배당금 받기
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    /* 🔴 Case 2: 판매 완료 상태 (디테일 벼락 영수증 UI 레이아웃 출력) */
                                                    <div style={{ padding: '15px', background: '#111', borderRadius: '12px', border: '1px solid #EF4444', fontFamily: "'Courier New', Courier, monospace" }}>
                                                        <div style={{ fontSize: '0.8rem', color: '#EF4444', Jack: 'bold', borderBottom: '1px dashed #333', paddingBottom: '6px', marginBottom: '10px', textAlign: 'center', fontWeight: 'bold' }}>
                                                            🧾 ART SALES RECEIPTS
                                                        </div>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '5px', color: '#9CA3AF' }}>
                                                            <span>판매금액</span>
                                                            <span style={{ color: '#fff' }}>{Number(item.auction_price || 0).toLocaleString()} TUK</span>
                                                        </div>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '5px', color: '#F87171' }}>
                                                            <span>- DAO 유지비용 (30%)</span>
                                                            <span>{Number((item.auction_price || 0) * 0.3).toLocaleString()} TUK</span>
                                                        </div>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 'bold', borderBottom: '1px dashed #333', paddingBottom: '8px', marginBottom: '8px', color: '#34D399' }}>
                                                            <span>= 투자자들의 수익 (70%)</span>
                                                            <span>{Number((item.auction_price || 0) * 0.7).toLocaleString()} TUK</span>
                                                        </div>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#9CA3AF', marginBottom: '4px' }}>
                                                            <span>내 투자 지분율</span>
                                                            <span style={{ color: '#38BDF8', fontWeight: 'bold' }}>{Number(item.stake_ratio || 0).toFixed(2)} %</span>
                                                        </div>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', fontWeight: 'bold', color: '#FBBF24', paddingTop: '4px' }}>
                                                            <span>🎁 내 지분 수익</span>
                                                            <span>{Number(item.my_profit || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} TUK</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {activeTab === "mypage" && (
                    <div className="page fade-in">
                        <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: "2.5rem", marginBottom: '30px' }}>👤 My Assets & Activity</h2>
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
                                        <div style={{ fontSize: '3.5rem', fontWeight: 'bold', color: '#38BDF8' }}>{myInfo.balance} <span style={{ fontSize: '1.5rem', color: '#6B7280' }}>TUK</span></div>
                                        <p style={{ color: '#6B7280', fontSize: '0.95rem', marginTop: '15px' }}>투표에 사용할 수 있는 실제 블록체인 거버넌스 토큰입니다.</p>
                                    </div>
                                </div>
                                {/* 3. 스마트 컨트랙트 배당금 청구 (기존 기능 유지) */}
                                <div className="card profile" style={{ background: '#1A1A1A', border: '1px solid #2A2A2A', padding: '30px' }}>
                                    <h3 style={{ color: '#FBBF24', borderBottom: '1px solid #333', paddingBottom: '15px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <span>🏆</span> 온체인 우승 배당금 수령 (Claim)
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
                                style={{ width: '100%', borderRadius: '12px', border: '1px solid #2A2A2A', objectFit: 'cover' }}
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

                            {/* 하단 정보바: 후보작(투표수)인지 우승작인지 구분해서 표시 */}
                            <div style={{ background: '#0F0F0F', padding: '20px', borderRadius: '12px', border: '1px solid #2A2A2A' }}>
                                {selectedCandidate.vp_votes !== undefined ? (
                                    <p style={{ color: '#9CA3AF', margin: 0 }}>현재 총 투자금: <strong style={{ color: '#38BDF8', fontSize: '1.4rem' }}>{selectedCandidate.vp_votes} TUK</strong></p>
                                ) : (
                                    <p style={{ color: '#34D399', margin: 0, fontWeight: 'bold' }}>🏆 이 작품은 ArtDAO 명예의 전당에 헌액된 우승작입니다.</p>
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
                                    <span style={{ color: '#9CA3AF' }}>입력 중...</span>
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
                                    <span style={{ marginLeft: '10px', color: '#9CA3AF', fontSize: '0.85rem' }}>
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
