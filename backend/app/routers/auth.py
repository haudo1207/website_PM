from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import OAuth2PasswordRequestForm
from google.auth.exceptions import GoogleAuthError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from jose import JWTError, jwt
from sqlalchemy import func
from sqlalchemy.orm import Session
from ..config import settings
from ..database import get_db
from ..models.user import User
from ..utils.auth import verify_password, create_access_token, get_current_user, generate_refresh_token, hash_refresh_token
from ..utils.audit_service import AuditService

router = APIRouter()

GOOGLE_TOKEN_CLOCK_SKEW_SECONDS = 10

# ── Microsoft (Outlook) ID token verification ──────────────────────────────
# Microsoft JWKS endpoint; "common" tenant serves personal + Entra accounts.
OUTLOOK_JWKS_URL = "https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys"
OUTLOOK_JWKS_CACHE_TTL_SECONDS = 24 * 60 * 60
# With OUTLOOK_TENANT_ID=common the issuer varies per account type; accept any
# Microsoft v2.0 issuer while keeping the format strict.
OUTLOOK_V2_ISSUER_PREFIX = "https://login.microsoftonline.com/"
OUTLOOK_V2_ISSUER_SUFFIX = "/v2.0"

_outlook_jwks_cache: dict = {"fetched_at": 0.0, "keys": None}


def _fetch_outlook_jwks() -> dict:
    """Return Microsoft's cached JWKS, refetching when stale or missing."""
    import time
    import requests as http_requests

    cached = _outlook_jwks_cache.get("keys")
    if cached and time.time() - _outlook_jwks_cache["fetched_at"] < OUTLOOK_JWKS_CACHE_TTL_SECONDS:
        return cached
    tenant = settings.OUTLOOK_TENANT_ID.strip() or "common"
    response = http_requests.get(
        OUTLOOK_JWKS_URL.format(tenant=tenant), timeout=10
    )
    response.raise_for_status()
    keys = response.json()
    _outlook_jwks_cache["fetched_at"] = time.time()
    _outlook_jwks_cache["keys"] = keys
    return keys


def _is_outlook_issuer(iss: str) -> bool:
    return (
        iss.startswith(OUTLOOK_V2_ISSUER_PREFIX)
        and iss.endswith(OUTLOOK_V2_ISSUER_SUFFIX)
    )


def verify_outlook_id_token(token: str) -> dict:
    """Verify a Microsoft ID token (signature, RS256, aud, exp, iss, claims)."""
    jwks = _fetch_outlook_jwks()
    try:
        claims = jwt.decode(
            token,
            jwks,
            algorithms=["RS256"],
            audience=settings.OUTLOOK_CLIENT_ID,
            options={
                "verify_aud": True,
                "verify_exp": True,
                "verify_iss": True,
                "verify_signature": True,
            },
        )
    except JWTError:
        # Microsoft rotates signing keys; retry once with a fresh JWKS.
        _outlook_jwks_cache["keys"] = None
        _outlook_jwks_cache["fetched_at"] = 0.0
        try:
            claims = jwt.decode(
                token,
                _fetch_outlook_jwks(),
                algorithms=["RS256"],
                audience=settings.OUTLOOK_CLIENT_ID,
                options={
                    "verify_aud": True,
                    "verify_exp": True,
                    "verify_iss": True,
                    "verify_signature": True,
                },
            )
        except JWTError:
            raise HTTPException(401, "Invalid Microsoft credential.")
    if not _is_outlook_issuer(str(claims.get("iss") or "")):
        raise HTTPException(401, "Invalid Microsoft credential.")
    return claims


def token_response(user: User) -> dict:
    token = create_access_token({"sub": str(user.id), "role": user.role})
    return {
        "access_token": token,
        "token_type": "bearer",
        "role": user.role,
        "full_name": user.full_name,
        "avatar_url": user.avatar_url,
        "email": user.email,
    }


# ── Portal refresh session (Phase 1, non-rotating) ──────────────────────────

def _create_refresh_session(db: Session, user: User, response: Response) -> str:
    """Create a Portal refresh session and set the HttpOnly cookie.

    Only the SHA-256 hash of the token is persisted; the raw token lives
    exclusively in the browser cookie (never exposed to page JavaScript) —
    except it's also returned here so callers serving non-cookie clients
    (the "KPI Prototype" extension, which can't rely on a SameSite=Lax
    cookie surviving its cross-context fetches) can hand it back in the
    response body instead. See login()'s `X-Client: extension` handling.
    """
    from datetime import datetime, timedelta, timezone
    from ..models.refresh_token import RefreshToken

    raw_token = generate_refresh_token()
    session = RefreshToken(
        user_id=user.id,
        token_hash=hash_refresh_token(raw_token),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(session)
    db.flush()
    response.set_cookie(
        key=settings.REFRESH_COOKIE_NAME,
        value=raw_token,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=settings.REFRESH_COOKIE_SECURE,
        samesite="lax",
        path="/",
    )
    return raw_token


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.REFRESH_COOKIE_NAME,
        path="/",
        secure=settings.REFRESH_COOKIE_SECURE,
        httponly=True,
        samesite="lax",
    )


def _refresh_session_error(response: Response, detail: str, code: str):
    """Invalid/expired/revoked session → clear the cookie and reject."""
    _clear_refresh_cookie(response)
    raise HTTPException(401, detail, headers={"X-Error-Code": code})


def _refresh_session_from_cookie(db: Session, request: Request, response: Response, body_refresh_token: str = None):
    """Resolve the refresh session from the cookie, returning (session, user).

    Falls back to `body_refresh_token` when no cookie is present — the "KPI
    Prototype" extension presents its refresh token via a JSON body instead,
    since SameSite=Lax cookies aren't sent on its cross-context fetches.
    """
    from datetime import datetime, timezone
    from ..models.refresh_token import RefreshToken

    raw_token = request.cookies.get(settings.REFRESH_COOKIE_NAME) or body_refresh_token
    if not raw_token:
        _refresh_session_error(response, "No refresh session", "NO_REFRESH_SESSION")
    session = (
        db.query(RefreshToken)
        .filter(RefreshToken.token_hash == hash_refresh_token(raw_token))
        .first()
    )
    if not session or session.revoked_at is not None:
        _refresh_session_error(response, "Refresh session not found", "REFRESH_SESSION_INVALID")
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        db.delete(session)
        db.commit()
        _refresh_session_error(response, "Refresh session expired", "REFRESH_SESSION_EXPIRED")
    user = db.query(User).filter(User.id == session.user_id).first()
    if not user or not user.is_active:
        db.delete(session)
        db.commit()
        _refresh_session_error(response, "Refresh session revoked", "REFRESH_SESSION_REVOKED")
    return session, user

@router.get("/config")
def auth_config():
    """Public, non-sensitive settings needed to render the login screen."""
    return {
        "google_login_enabled": settings.GOOGLE_LOGIN_ENABLED,
        "google_client_id": settings.GOOGLE_CLIENT_ID if settings.GOOGLE_LOGIN_ENABLED else "",
        "password_login_enabled": settings.PASSWORD_LOGIN_ENABLED,
        "outlook_login_enabled": settings.OUTLOOK_LOGIN_ENABLED,
        "outlook_client_id": settings.OUTLOOK_CLIENT_ID if settings.OUTLOOK_LOGIN_ENABLED else "",
        "outlook_tenant_id": settings.OUTLOOK_TENANT_ID if settings.OUTLOOK_LOGIN_ENABLED else "",
    }

@router.post("/login")
def login(request: Request, response: Response, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
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
            severity="WARNING",
            login_method="Password",
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
        severity="INFO",
        login_method="Password",
        description=f"Đăng nhập thành công bằng mật khẩu ({user.email})",
        request=request
    )
    raw_refresh_token = _create_refresh_session(db, user, response)
    db.commit()
    result = token_response(user)
    if request.headers.get("x-client") == "extension":
        result["refresh_token"] = raw_refresh_token
    return result

@router.post("/google")
def google_login(body: dict, request: Request, response: Response, db: Session = Depends(get_db)):
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

    user = db.query(User).filter(User.google_sub == google_sub).first()
    if not user:
        user = db.query(User).filter(User.email == email).first()
    if not user:
        if email in settings.superadmin_emails:
            user = User(
                email=email,
                full_name=claims.get("name") or email.split("@")[0],
                google_sub=google_sub,
                hashed_pw="!google-only!",
                role="super_admin",
                data_scope="all",
                is_active=True
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        else:
            AuditService.record(
                db=db,
                user_id=None,
                module="Authentication",
                entity_type="User",
                entity_id=email,
                action="FAILED_LOGIN",
                severity="WARNING",
                login_method="Google OAuth",
                description=f"Đăng nhập Google thất bại: Email '{email}' chưa được cấp quyền",
                request=request
            )
            db.commit()
            raise HTTPException(403, "This email has not been granted access.")
    if user.google_sub and user.google_sub != google_sub:
        raise HTTPException(403, "Email này đã được liên kết với một tài khoản Google khác.")
    if not user.is_active:
        raise HTTPException(403, "Tài khoản đã bị vô hiệu hoá.")

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

    AuditService.record(
        db=db,
        user_id=user.id,
        module="Authentication",
        entity_type="User",
        entity_id=user.id,
        action="LOGIN",
        severity="INFO",
        login_method="Google OAuth",
        description=f"Đăng nhập thành công bằng Google OAuth ({user.email})",
        request=request
    )
    _create_refresh_session(db, user, response)
    db.commit()
    return token_response(user)

@router.post("/outlook")
def outlook_login(body: dict, request: Request, response: Response, db: Session = Depends(get_db)):
    if not settings.OUTLOOK_LOGIN_ENABLED or not settings.OUTLOOK_CLIENT_ID:
        raise HTTPException(503, "Microsoft login is not configured.")

    credential = str(body.get("credential") or "").strip()
    if not credential:
        raise HTTPException(400, "Missing Microsoft credential.")

    claims = verify_outlook_id_token(credential)

    email = str(
        claims.get("email") or claims.get("preferred_username") or ""
    ).strip().lower()
    outlook_sub = str(claims.get("oid") or claims.get("sub") or "").strip()
    if not email or not outlook_sub:
        raise HTTPException(401, "Microsoft account identifier is missing.")

    user = db.query(User).filter(User.outlook_sub == outlook_sub).first()
    if not user:
        user = db.query(User).filter(func.lower(User.outlook_mail) == email).first()
    if not user:
        AuditService.record(
            db=db,
            user_id=None,
            module="Authentication",
            entity_type="User",
            entity_id=email,
            action="FAILED_LOGIN",
            severity="WARNING",
            login_method="Microsoft OAuth",
            description=f"Đăng nhập Microsoft thất bại: Email '{email}' chưa được cấp quyền",
            request=request
        )
        db.commit()
        raise HTTPException(403, "This Microsoft email has not been granted access.")
    if user.outlook_sub and user.outlook_sub != outlook_sub:
        raise HTTPException(403, "Tài khoản Microsoft này đã được liên kết với một tài khoản khác.")
    if not user.is_active:
        raise HTTPException(403, "Tài khoản đã bị vô hiệu hoá.")

    changed = False
    if not user.outlook_sub:
        user.outlook_sub = outlook_sub
        changed = True
    outlook_name = str(claims.get("name") or "").strip()
    if outlook_name and user.full_name != outlook_name:
        user.full_name = outlook_name
        changed = True

    if changed:
        db.commit()
        db.refresh(user)

    AuditService.record(
        db=db,
        user_id=user.id,
        module="Authentication",
        entity_type="User",
        entity_id=user.id,
        action="LOGIN",
        severity="INFO",
        login_method="Microsoft OAuth",
        description=f"Đăng nhập thành công bằng Microsoft OAuth ({user.email})",
        request=request
    )
    _create_refresh_session(db, user, response)
    db.commit()
    return token_response(user)

@router.post("/refresh")
def refresh_session(request: Request, response: Response, body: dict = None, db: Session = Depends(get_db)):
    """Issue a new Portal Access JWT from the HttpOnly refresh cookie.

    Deliberately does NOT depend on a valid Access JWT — the refresh session
    alone is sufficient. The refresh token is NOT rotated in Phase 1. `body`
    is only used as a fallback when there's no cookie (the "KPI Prototype"
    extension calls this with `{"refresh_token": "..."}` in the JSON body).
    """
    from datetime import datetime, timezone

    body_refresh_token = (body or {}).get("refresh_token") if isinstance(body, dict) else None
    session, user = _refresh_session_from_cookie(db, request, response, body_refresh_token)
    session.last_used_at = datetime.now(timezone.utc)
    db.commit()
    return token_response(user)

@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    """Revoke the Portal refresh session and clear the cookie.

    Works even when the Access JWT is already expired: revocation is driven by
    the HttpOnly refresh cookie, not by a valid Access JWT.
    """
    from ..models.refresh_token import RefreshToken

    user = None
    user_name = "Unknown User"
    raw_token = request.cookies.get(settings.REFRESH_COOKIE_NAME)
    if raw_token:
        session = (
            db.query(RefreshToken)
            .filter(RefreshToken.token_hash == hash_refresh_token(raw_token))
            .first()
        )
        if session:
            user = db.query(User).filter(User.id == session.user_id).first()
            db.delete(session)
    if user:
        user_name = user.full_name or user.email
    _clear_refresh_cookie(response)
    AuditService.record(
        db=db,
        user_id=user.id if user else None,
        module="Authentication",
        entity_type="User",
        entity_id=user.id if user else None,
        action="LOGOUT",
        severity="INFO",
        description=f"Người dùng {user_name} đã đăng xuất",
        request=request
    )
    db.commit()
    return {"message": "Logged out successfully"}
