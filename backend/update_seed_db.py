import sys
import os
import random

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app import database
from sqlalchemy import text

def update_seed_items():
    db = database.SessionLocal()
    try:
        # 1000 ~ 7000 사이, 100단위 난수로 판매금액(auction_price) 설정
        result = db.execute(text("SELECT id FROM gallery_items WHERE image_url LIKE '%/static/images/seed/%'")).fetchall()
        
        # 난수 생성을 고정된 시드 대신 각 항목별로 1000~7000 범위 100단위 생성 (예: 1500, 3200, 5800 등)
        random.seed(42) # 언제나 고정되면서도 자연스러운 100단위 난수 부여
        for row in result:
            item_id = row[0]
            random_price = float(random.randint(10, 70) * 100) # 1,000 ~ 7,000 (100단위)
            db.execute(
                text("UPDATE gallery_items SET is_sold = 1, auction_price = :price WHERE id = :id"), 
                {"price": random_price, "id": item_id}
            )
        
        db.commit()
        print(f"Successfully updated {len(result)} seed gallery items to random auction_prices (1000~7000, step 100)!")
    except Exception as e:
        print(f"Error updating seed items: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    update_seed_items()
