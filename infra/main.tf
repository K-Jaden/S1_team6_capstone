provider "aws" {
  region = "ap-northeast-2"
}

# 1. 최신 Ubuntu 이미지 검색
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
}

# 2. 보안 그룹 (방화벽) 설정 🌟 여기가 핵심입니다!
resource "aws_security_group" "art_dao_sg" {
  name        = "art-dao-security-group"
  description = "Allow required ports for ArtPlanningDAO"

  # SSH 접속 허용 (유저님이 서버 설정할 때 필요)
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"] 
  }

  # React 프론트엔드 포트 허용 (App.js 실행용)
  ingress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # 백엔드 API 포트 허용 (App.js에서 호출하는 8000번)
  ingress {
    from_port   = 8000
    to_port     = 8000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # 아웃바운드 (서버에서 외부로 나가는 통신은 모두 허용)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# 3. 보안 그룹이 적용된 EC2 서버 생성
resource "aws_instance" "art_dao_server" {
  ami             = data.aws_ami.ubuntu.id
  instance_type   = "t3.micro"
  
  # 위에서 만든 방화벽(Security Group)을 이 서버에 입혀줍니다!
  vpc_security_group_ids = [aws_security_group.art_dao_sg.id]

  root_block_device {
    volume_size = 30
    volume_type = "gp3" # 최신형 빠르고 저렴한 SSD 타입
  }

  key_name = "DAO-key"
  tags = {
    Name = "ArtPlanningDAO-Live-Server"
  }
}

# 4. 서버 생성 후 IP 주소를 터미널에 출력해줌! (팀원들에게 알려줄 주소)
output "public_ip" {
  value = aws_instance.art_dao_server.public_ip
  description = "The Public IP of the Art DAO Server"
}