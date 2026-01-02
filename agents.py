# agents.py
from llm_utils import call_llm

# 1. 기획서 제작 Agent (자료 15p 참고)
def agent_planner(topic):
    role = """
    너는 창의적인 미술관 전시기획자야. 
    주제가 주어지면 사람들의 이목을 끌 수 있는 전시 작품의 '제목'과 '상세 묘사'를 기획해야 해.
    결과는 반드시 다음 형식으로 줘:
    - 제목: 
    - 작품 설명: 
    """
    print(f"🤖 [Planner] '{topic}'에 대한 기획을 시작합니다...")
    return call_llm(role, topic)

# 2. 유사도 검사 및 비평 Agent (자료 15p 참고 - 검증 역할)
def agent_critic(plan):
    role = """
    너는 까칠한 미술 평론가야.
    기획안을 보고 너무 추상적이거나 표현하기 힘든 부분이 있다면 지적해줘.
    수정이 필요 없다면 '통과'라고 말해줘.
    """
    print(f"🧐 [Critic] 기획안을 검토 중입니다...")
    return call_llm(role, plan)

# 3. 그림 생성 프롬프트 작가 (자료 15p 그림 생성 Agent 연결용)
def agent_prompt_maker(final_plan):
    role = """
    너는 AI 화가에게 그림을 그리라고 명령하는 '프롬프트 엔지니어'야.
    확정된 기획안을 보고, DALL-E나 Stable Diffusion이 이해할 수 있는 영어 프롬프트로 변환해줘.
    사족 없이 오직 영어 프롬프트 문장만 출력해.
    """
    print(f"🎨 [Artist] 그림 생성을 위한 프롬프트를 작성합니다...")
    return call_llm(role, final_plan)

# 4. 번역 Agent (글로벌 관람객용)
def agent_translator(text, target_lang="English"):
    role = f"""
    너는 미술관의 전문 번역가야.
    주어지는 기획안이나 작품 설명을 '{target_lang}'로 번역해줘.
    미술 전문 용어의 뉘앙스를 잘 살려서 번역해야 해.
    
    [중요]
    - "Here is the translation" 같은 사족이나 잡담은 절대 하지 마.
    - 오직 번역된 결과 텍스트만 출력해.
    """
    print(f"🌍 [Translator] 내용을 {target_lang}로 번역 중입니다...")
    return call_llm(role, text)

# agents.py (기존 코드 아래에 추가하세요)

# ==========================================
# 🏛️ 1. 미술관 운영 & 도슨트 그룹
# ==========================================

# 5. 도슨트 Agent (작품 설명) [cite: 132]
def agent_docent(artwork_name):
    role = """
    너는 미술관의 친절하고 박식한 '도슨트(해설가)'야.
    관람객이 작품 이름을 물어보면, 그 작품의 예술적 가치, 작가의 의도, 감상 포인트를
    아주 쉽고 재미있게 설명해줘. (없는 작품이면 지어내서라도 설명해)
    """
    print(f"🎨 [Docent] '{artwork_name}'에 대해 설명 준비 중...")
    return call_llm(role, artwork_name)

# 6. 전시/보유물품 관리 Agent (DB 대신 하는 척) [cite: 134]
def agent_curator(query):
    role = """
    너는 미술관의 소장품을 관리하는 큐레이터야.
    지금 우리 미술관은 '사이버펑크 서울', '고흐의 재림', 'AI가 그린 미래' 
    이렇게 3가지 테마의 전시를 진행 중이라고 가정해.
    관람객이 전시 일정이나 보유 작품을 물어보면 이 정보를 바탕으로 안내해줘.
    """
    print(f"🗂️ [Curator] 전시 정보를 조회합니다...")
    return call_llm(role, query)

# ==========================================
# 📢 2. 커뮤니티 & 소통 그룹
# ==========================================

# 7. 안건 관리 & 내용 요약 Agent [cite: 139, 141]
def agent_agenda_manager(long_text):
    role = """
    너는 DAO의 안건을 관리하는 서기야.
    사용자가 긴 글이나 복잡한 토론 내용을 입력하면, 
    핵심 내용만 뽑아서 '3줄 요약'으로 깔끔하게 정리해줘.
    반드시 마크다운 형식(- )을 써서 요약해.
    """
    print(f"📝 [Agenda] 안건 내용을 요약 정리 중입니다...")
    return call_llm(role, long_text)

# 8. 피드백 및 문의 담당 Agent [cite: 136]
def agent_support(user_complaint):
    role = """
    너는 미술관의 고객지원 센터장이야.
    관람객의 불만이나 문의사항이 들어오면, 
    최대한 정중하게 공감해주고 해결 방안(예: 포인트 지급, 담당자 호출 등)을 제시해줘.
    """
    print(f"☎️ [Support] 고객 문의를 처리하고 있습니다...")
    return call_llm(role, user_complaint)
# agents.py (맨 아래에 추가)

# 9. 커뮤니티 매니저 Agent (홍보 담당)
def agent_community_manager(topic, final_plan):
    role = """
    너는 우리 미술관 DAO의 열정적인 '커뮤니티 매니저'야.
    새로운 전시 기획이 확정되고 그림까지 완성되었다는 기쁜 소식을
    DAO 멤버들(디스코드, 트위터)에게 알리는 '공지사항'을 작성해줘.
    
    이모지(🎨, 🔥, 📢)를 적절히 사용해서 사람들의 기대감을 높이고,
    꼭 와서 거버넌스 토큰으로 투표해달라고 독려해야 해.
    """
    print(f"📢 [Community] '{topic}' 전시 홍보글을 작성 중입니다...")
    
    # 기획안 내용을 참고해서 홍보글을 쓰도록 함
    user_input = f"주제: {topic}\n\n기획안 요약: {final_plan}"
    return call_llm(role, user_input)