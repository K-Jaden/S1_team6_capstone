# 1. 베이스 이미지: 파이썬 3.9 버전이 깔린 리눅스를 가져와라
FROM python:3.9

# 2. 작업 폴더: 가상 컴퓨터 안의 /app 폴더에서 작업하겠다
WORKDIR /app

# 3. 라이브러리 설치: requirements.txt를 먼저 복사하고 설치해라
# (이렇게 하면 코드를 고쳐도 라이브러리는 다시 설치 안 해서 빨라짐)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 4. 소스 코드 복사: 내 컴퓨터에 있는 파일들을 가상 컴퓨터로 다 복사해라
COPY . .

# 5. 실행 명령: 서버를 켜라 (8000번 포트)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]