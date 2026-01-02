# main.py
# 1. 필요한 에이전트들을 모두 불러옵니다. (도슨트, 커뮤니티 매니저 추가됨)
from agents import agent_planner, agent_critic, agent_prompt_maker, agent_translator, agent_docent, agent_community_manager
from image_gen import generate_image_file 
import time

def run_a2a_pipeline(user_topic):
    process_log = [] # 웹 화면에 띄울 로그 저장소

    print(f"🚀 [System] '{user_topic}' 프로젝트를 시작합니다...\n")

    # 1단계: 기획 (Planner)
    plan = agent_planner(user_topic)
    process_log.append({"agent": "Planner", "message": plan})
    print(f"-> 📜 기획안: {plan}\n")
    time.sleep(1)

    # 2단계: 비평 (Critic)
    critique = agent_critic(plan)
    process_log.append({"agent": "Critic", "message": critique})
    print(f"-> 🧐 비평: {critique}\n")
    time.sleep(1)

    # 3단계: 프롬프트 작성 (PromptMaker)
    image_prompt = agent_prompt_maker(plan)
    process_log.append({"agent": "PromptMaker", "message": image_prompt})
    print(f"-> 🎨 생성 프롬프트: {image_prompt}\n")

    # 4단계: 번역 (Translator)
    translated_plan = agent_translator(plan, "English") 
    process_log.append({"agent": "Translator", "message": translated_plan})
    # 수정 후 (전체 출력)
    print(f"-> 번역 결과: {translated_plan}\n")

    # 5단계: 이미지 생성 (ImageGen)
    print("🖌️ [System] 이미지를 생성 중입니다...")
    image_path = generate_image_file(image_prompt, "my_art_work.jpg")
    print(f"-> ✅ 이미지 저장 완료: {image_path}\n")

    # ==================================================
    # ★★★ [추가] 6단계: 도슨트 해설 (Docent) ★★★
    # ==================================================
    # 그림이 나왔으니 도슨트가 등장해서 설명해줍니다.
    docent_comment = agent_docent(user_topic) 
    process_log.append({"agent": "Docent", "message": docent_comment})
    print(f"-> 🎤 도슨트 해설: {docent_comment}\n")

    # ==================================================
    # ★★★ [추가] 7단계: 커뮤니티 홍보 (Community Manager) ★★★
    # ==================================================
    # 마지막으로 DAO 멤버들에게 자랑하는 공지글을 씁니다.
    community_post = agent_community_manager(user_topic, plan)
    process_log.append({"agent": "CommunityManager", "message": community_post})
    print(f"-> 📢 커뮤니티 공지: {community_post}\n")

    # 최종 결과물 패키징 (백엔드로 전달할 데이터)
    result = {
        "topic": user_topic,
        "final_plan": plan,
        "translated_plan": translated_plan, 
        "image_prompt": image_prompt,
        "image_path": image_path,
        "docent_comment": docent_comment,
        "community_post": community_post,
        "logs": process_log 
    }
    
    return result

# 테스트 실행
if __name__ == "__main__":
    topic = input("전시 주제를 입력하세요 (예: 사이버펑크 서울): ")
    if not topic:
        topic = "미래의 도시" # 입력 없으면 기본값
        
    final_output = run_a2a_pipeline(topic)
    
    print("\n=== ✨ 최종 결과 JSON (백엔드 전달용) ===")
    # 결과가 너무 기니까 핵심만 출력해서 확인
    print(f"1. 이미지 경로: {final_output['image_path']}")
    print(f"2. 도슨트 코멘트: {final_output['docent_comment'][:50]}...")
    print(f"3. 홍보 공지사항: {final_output['community_post'][:50]}...")