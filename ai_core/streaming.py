import asyncio
import json
import time
from datetime import datetime
from queue import Empty, Queue

from fastapi.responses import StreamingResponse

import config

discussion_queues = {}
_queue_created_at = {}  # session_id -> 생성 시각 (클라이언트 비정상 종료로 정리 안 된 세션 TTL 청소용)


def ensure_session(session_id: str):
    if session_id and session_id not in discussion_queues:
        discussion_queues[session_id] = Queue()
        _queue_created_at[session_id] = time.time()


def purge_stale_queues():
    now = time.time()
    stale = [sid for sid, created in _queue_created_at.items() if now - created > config.QUEUE_TTL_SECONDS]
    for sid in stale:
        discussion_queues.pop(sid, None)
        _queue_created_at.pop(sid, None)


def push_log(session_id: str, agent_role: str, log_type: str, content: str):
    if session_id and session_id in discussion_queues:
        log_entry = {
            "agent": agent_role,
            "type": log_type,
            "content": content,
            "timestamp": datetime.now().strftime("%H:%M:%S"),
        }
        discussion_queues[session_id].put(log_entry)


async def stream_response(session_id: str) -> StreamingResponse:
    purge_stale_queues()
    ensure_session(session_id)

    async def event_generator():
        q = discussion_queues[session_id]
        hello = {
            "agent": "시스템",
            "type": "system",
            "content": "🎬 AI 에이전트 난상토론 스트림 연결 완료. 곧 토론이 시작됩니다...",
            "timestamp": datetime.now().strftime("%H:%M:%S"),
        }
        yield f"data: {json.dumps(hello, ensure_ascii=False)}\n\n"

        try:
            while True:
                try:
                    log = q.get(timeout=0.5)
                    yield f"data: {json.dumps(log, ensure_ascii=False)}\n\n"
                    if log.get("type") == "final":
                        break
                except Empty:
                    yield ": keepalive\n\n"
                    await asyncio.sleep(0.1)
        finally:
            discussion_queues.pop(session_id, None)
            _queue_created_at.pop(session_id, None)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )
