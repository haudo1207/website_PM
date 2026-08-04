from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordRequestForm
from google.auth.exceptions import GoogleAuthError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from sqlalchemy.orm import Session
from ..config import settings
from ..database import get_db
from ..models.user import User
from ..utils.auth import verify_password, create_access_token
from ..utils.audit_service import AuditService

router = APIRouter()

# Google-issued tokens can arrive a few seconds ahead of a developer machine's
# clock. Keep the tolerance small while avoiding false 401s from normal clock
# drift on local Windows/Docker environments.
GOOGLE_TOKEN_CLOCK_SKEW_SECONDS = 10


def token_response(user: User) -> dict:
    token = create_access_token({"sub": str(user.id), "role": user.role})
    return {
        "access_token": token,
        "token_type": "bearer",
        "role": user.role,
        "full_name": user.full_name,
        "avatar_url": user.avatar_url,
    }


@router.get("/config")
def auth_config():
    """Public, non-sensitive settings needed to render the login screen."""
    return {
        "google_login_enabled": settings.GOOGLE_LOGIN_ENABLED,
        "google_client_id": settings.GOOGLE_CLIENT_ID if settings.GOOGLE_LOGIN_ENABLED else "",
        "password_login_enabled": settings.PASSWORD_LOGIN_ENABLED,
    }

@router.post("/login")
def login(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    if not settings.PASSWORD_LOGIN_ENABLED:
        raise HTTPException(403, "Password login is disabled. Use Google instead.")
    email = form.username.strip().lower()
    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(form.password, user.hashed_pw):
        AuditService.record(
            db=db,
            user_id=user.id if user else None,
            module="Authentication",
            entity_type="User",
            entity_id=user.id if user else email,
            action="FAILED_LOGIN",
            description=f"Đăng nhập thất bại cho tài khoản '{email}'",
            request=request
        )
        db.commit()
        raise HTTPException(401, "Invalid email or password")
    if not user.is_active:
        raise HTTPException(403, "Account disabled")

    AuditService.record(
        db=db,
        user_id=user.id,
        module="Authentication",
        entity_type="User",
        entity_id=user.id,
        action="LOGIN",
        description=f"Đăng nhập hệ thống thành công (User: {user.email})",
        request=request
    )
    db.commit()
    return token_response(user)


@router.post("/google")
def google_login(body: dict, db: Session = Depends(get_db)):
    if not settings.GOOGLE_LOGIN_ENABLED or not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(503, "Google login is not configured.")

    credential = str(body.get("credential") or "").strip()
    if not credential:
        raise HTTPException(400, "Missing Google credential.")

    try:
        claims = id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            settings.GOOGLE_CLIENT_ID,
            clock_skew_in_seconds=GOOGLE_TOKEN_CLOCK_SKEW_SECONDS,
        )
    except (ValueError, TypeError, GoogleAuthError):
        raise HTTPException(401, "Invalid Google credential.")

    if not claims.get("email_verified"):
        raise HTTPException(401, "Google email is not verified.")

    email = str(claims.get("email") or "").strip().lower()
    google_sub = str(claims.get("sub") or "").strip()
    if not google_sub:
        raise HTTPException(401, "Google account identifier is missing.")

    # Prefer Google's immutable subject after the first successful link. A
    # pre-approved account is matched by email exactly once to establish it.
    user = db.query(User).filter(User.google_sub == google_sub).first()
    if not user:
        user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(403, "This email has not been granted access.")
    if user.google_sub and user.google_sub != google_sub:
        raise HTTPException(403, "This email is linked to a different Google account.")
    if not user.is_active:
        raise HTTPException(403, "Account disabled.")

    # Google is the identity source for profile fields. Roles, scopes and member
    # linkage remain controlled by the application admin.
    google_name = str(claims.get("name") or "").strip()
    google_avatar = str(claims.get("picture") or "").strip()
    changed = False
    if not user.google_sub:
        user.google_sub = google_sub
        changed = True
    if google_name and user.full_name != google_name:
        user.full_name = google_name
        changed = True
    if google_avatar and user.avatar_url != google_avatar:
        user.avatar_url = google_avatar
        changed = True

    # Automatically ensure GoogleToken record exists for Google SSO user
    try:
        from ..models.google_token import GoogleToken
        gtoken = db.query(GoogleToken).filter(GoogleToken.user_id == user.id).first()
        if not gtoken:
            gtoken = GoogleToken(user_id=user.id, access_token="google_sso_session")
            db.add(gtoken)
            changed = True
    except Exception:
        pass

    if changed:
        db.commit()
        db.refresh(user)
    return token_response(user)
