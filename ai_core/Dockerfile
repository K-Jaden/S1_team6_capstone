FROM python:3.10
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 8002번 포트 사용 (백엔드는 8000, 크로마는 8001이니 피해서)
CMD ["uvicorn", "agent:app", "--host", "0.0.0.0", "--port", "8002", "--reload"]