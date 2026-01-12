from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from app import models, schemas, database

# ⭐ 여기가 핵심! 서버 켜질 때 DB 테이블이 없으면 자동으로 만들어줌 ⭐
models.Base.metadata.create_all(bind=database.engine)

app = FastAPI()

@app.post("/propose", response_model=schemas.ProposalResponse)
def create_proposal(request: schemas.ProposalCreate, db: Session = Depends(database.get_db)):
    new_art = models.ArtRequest(
        wallet_address=request.wallet_address,
        topic=request.topic,
        status="WAITING"
    )
    db.add(new_art)
    db.commit()
    db.refresh(new_art)
    return new_art

@app.get("/list", response_model=list[schemas.ProposalResponse])
def get_list(db: Session = Depends(database.get_db)):
    return db.query(models.ArtRequest).all()