from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Docker MySQL 접속 정보 (ID: root, PW: root, DB: art_platform)
SQLALCHEMY_DATABASE_URL = "mysql+pymysql://root:root@127.0.0.1:3306/art_platform"

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()