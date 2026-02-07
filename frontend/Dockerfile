# 1. 베이스 이미지: Node.js 18 버전이 깔린 리눅스를 가져와라
FROM node:18-alpine

# 2. 작업 폴더
WORKDIR /app

# 3. 라이브러리 설치: package.json 먼저 복사하고 npm install 해라
COPY package.json package-lock.json ./
RUN npm install

# 4. 소스 코드 복사
COPY . .

# 5. 포트 개방: 3000번 포트를 열어둬라
EXPOSE 3000

# 6. 실행 명령: 리액트를 켜라
CMD ["npm", "start"]