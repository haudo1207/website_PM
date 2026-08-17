from jose import JWTError, jwt
from jose.exceptions import ExpiredSignatureError
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.user import User
from ..config import settings
from datetime import datetime, timedelta, timezone
import hashlib
import secrets

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

def verify_password(p, h):
    try:
        return pwd_ctx.verify(p, h)
    except (TypeError, ValueError):
        # A damaged/legacy hash must behave like bad credentials, not crash login.
        return False

def hash_password(p):
    return pwd_ctx.hash(p)

def create_access_token(data: dict) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({**data, "exp": exp}, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

def generate_refresh_token() -> str:
    """Opaque, cryptographically secure refresh token (raw form, never stored)."""
    return secrets.token_urlsafe(48)

def hash_refresh_token(raw_token: str) -> str:
    """Hash of the refresh token — the only form persisted server-side."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()

def get_current_user(token: str = Depends(oauth2), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user = db.query(User).filter(User.id == int(payload["sub"])).first()
        if not user or not user.is_active:
            raise HTTPException(401, "Invalid token")
        return user
    except ExpiredSignatureError:
        raise HTTPException(
            401,
            "Token expired",
            headers={"X-Error-Code": "TOKEN_EXPIRED"},
        )
    except (JWTError, KeyError, TypeError, ValueError):
        raise HTTPException(401, "Invalid token")

def require_super_admin(user=Depends(get_current_user)):
    """Only super_admin / admin may proceed."""
    if user.role not in {"super_admin", "admin"}:
        raise HTTPException(403, "Yêu cầu quyền Super Admin")
    return user

def require_manager(user=Depends(get_current_user)):
    """super_admin, admin or leader may proceed."""
    if user.role not in {"super_admin", "admin", "leader"}:
        raise HTTPException(403, "Yêu cầu quyền quản lý (Super Admin hoặc Leader)")
    return user

def require_manager_write(request: Request, user=Depends(get_current_user)):
    """Allow every active account to read, but reserve mutations for super_admin, admin and leader."""
    if request.method not in {"GET", "HEAD", "OPTIONS"} and user.role not in {"super_admin", "admin", "leader"}:
        raise HTTPException(403, "Yêu cầu quyền quản lý để thực hiện thao tác ghi")
    return user

# ── Legacy aliases kept for backward compatibility during transition ──

def require_admin(user=Depends(get_current_user)):
    """Legacy alias — maps to require_super_admin."""
    return require_super_admin(user)

def require_admin_write(request: Request, user=Depends(get_current_user)):
    """Legacy alias — maps to require_manager_write."""
    return require_manager_write(request, user)
