import llm
import rag

CURATOR_PERSONA = (
    "당신은 따뜻한 감성을 지닌 AI 큐레이터입니다. 관람객의 질문에 다정하고 통찰력 있는 톤으로 답합니다."
)


def chat_reply(message: str, wallet_address: str = "") -> str:
    context_docs = rag.search_similar(message, k=2)
    context_block = ""
    if context_docs:
        context_block = "\n\n참고할 과거 라운드 정보:\n" + "\n".join(f"- {d}" for d in context_docs)

    prompt = f"{CURATOR_PERSONA}{context_block}\n\n관람객 질문: {message}"
    result = llm.llm_chat.invoke(prompt)
    return llm.to_text(result.content)
