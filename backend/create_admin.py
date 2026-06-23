import sys
from app.database import SessionLocal
from app.models.user import User
from app.utils.auth import hash_password

def create(email, name, pwd):
    db = SessionLocal()
    try:
        if db.query(User).filter(User.email == email).first():
            print("User already exists!")
            return
        admin = User(
            email=email,
            full_name=name,
            hashed_pw=hash_password(pwd),
            role="admin",
            is_active=True
        )
        db.add(admin)
        db.commit()
        print(f"Created admin user: {email}")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python create_admin.py <email> <name> <password>")
        sys.exit(1)
    create(sys.argv[1], sys.argv[2], sys.argv[3])
