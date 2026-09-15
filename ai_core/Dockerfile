FROM python:3.10
WORKDIR /app

# 1. 기본 Web 및 API 패키지 설치
RUN pip install --no-cache-dir fastapi uvicorn pydantic python-dotenv requests

# 2. PyTorch CPU 버전 개별 설치 (메모리 과부하 방지)
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu torch torchvision

# 3. LangChain 및 ChromaDB 개별 설치
RUN pip install --no-cache-dir langchain langchain-core langchain-community langchain-google-genai langchain-openai langgraph langchain-chroma chromadb

# 4. 나머지 패키지 설치
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 8002번 포트 사용 (백엔드는 8000, 크로마는 8001이니 피해서)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002", "--reload"]