"""
Grant Google SSO access to a user by email.

Usage:
    python grant_google_access.py <email> [role]

Creates (or updates) a User record so the google_login endpoint can match it.
Role defaults to "admin". Valid roles: super_admin, admin, leader, member.
"""
import sys
from app.database import SessionLocal
from app.models.user import User
from app.utils.auth import hash_password

VALID_ROLES = {"super_admin", "admin", "leader", "member"}


def grant_access(email: str, role: str = "admin") -> None:
    email = email.strip().lower()
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if user:
            old_role = user.role
            user.role = role
            user.is_active = True
            # google_sub left as-is; it will be linked on first Google login.
            db.commit()
            print(f"User {email} already existed.")
            print(f"  role: {old_role} -> {role}")
            print(f"  is_active: True")
            return
        # hashed_pw is NOT NULL in schema, but password login is disabled —
        # a random bcrypt hash is used as a placeholder.
        user = User(
            email=email,
            full_name=email.split("@")[0],
            hashed_pw=hash_password("google-sso-placeholder-"),
            role=role,
            is_active=True,
        )
        db.add(user)
        db.commit()
        print(f"Created user {email} with role={role}.")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
        raise
    finally:
        db.close()
    print("Google SSO access granted. You can now log in with Google.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python grant_google_access.py <email> [role]")
        sys.exit(1)
    role = sys.argv[2] if len(sys.argv) > 2 else "admin"
    if role not in VALID_ROLES:
        print(f"Invalid role {role!r}. Valid: {sorted(VALID_ROLES)}")
        sys.exit(1)
    grant_access(sys.argv[1], role)