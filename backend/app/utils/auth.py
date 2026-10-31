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
import logging
import secrets

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
_support_key_logger = logging.getLogger("support_integration_api_key")

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

def _load_user_from_jwt(token: str, db: Session) -> User:
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

def get_current_user(token: str = Depends(oauth2), db: Session = Depends(get_db)):
    return _load_user_from_jwt(token, db)

def get_current_user_or_support_key(request: Request, db: Session = Depends(get_db)):
    """Giống get_current_user (chấp nhận JWT Bearer bình thường), CỘNG THÊM 1
    đường xác thực phụ: Authorization: Bearer <SUPPORT_INTEGRATION_API_KEY> —
    dùng cho hệ thống ngoài (Tech_Support/Ticket) gọi server-to-server, nơi
    không có (hoặc không tiện) duy trì JWT 30 phút qua username/password.

    QUAN TRỌNG — đây KHÔNG phải bypass quyền Super Admin: key chỉ thay thế
    bước xác thực (ai đang gọi), còn PHÂN QUYỀN vẫn y hệt như user JWT bình
    thường — trả về đúng user thật (SUPPORT_INTEGRATION_SERVICE_EMAIL) với role
    thật của tài khoản đó trong DB (khuyến nghị "member", thấp nhất). Mọi
    route dùng require_super_admin/require_manager vẫn chặn tài khoản này y
    hệt bất kỳ member thường nào — chỉ các route chỉ cần get_current_user
    (hoặc require_manager_write/require_admin_write, đã trỏ qua hàm này, cho
    phép GET với mọi role) mới dùng được key.

    Chỉ áp dụng ở ĐÚNG các route Tech_Support thật sự cần gọi (xem các
    Depends(get_current_user_or_support_key) rải rác trong routers/ —
    system_categories, skills, members, task_groups) — các route khác trong
    hệ thống vẫn chỉ nhận JWT như trước, không đổi gì.
    """
    auth_header = request.headers.get("authorization", "")
    scheme, _, raw_token = auth_header.partition(" ")
    if scheme.lower() != "bearer" or not raw_token:
        raise HTTPException(401, "Not authenticated")

    configured_key = settings.SUPPORT_INTEGRATION_API_KEY
    if configured_key and secrets.compare_digest(raw_token, configured_key):
        user = db.query(User).filter(User.email == settings.SUPPORT_INTEGRATION_SERVICE_EMAIL).first()
        if not user or not user.is_active:
            raise HTTPException(
                500,
                f"SUPPORT_INTEGRATION_API_KEY đã cấu hình nhưng chưa có tài khoản "
                f"service-account '{settings.SUPPORT_INTEGRATION_SERVICE_EMAIL}' "
                f"(hoặc tài khoản đang bị khoá is_active=false).",
            )
        _support_key_logger.info(
            "SUPPORT_INTEGRATION_API_KEY used: %s %s?%s from %s (user_id=%s role=%s)",
            request.method,
            request.url.path,
            request.url.query or "",
            request.client.host if request.client else "unknown",
            user.id,
            user.role,
        )
        return user

    return _load_user_from_jwt(raw_token, db)

_support_key_write_logger = logging.getLogger("support_integration_api_key.write")


def _resolve_support_key_write_user(request: Request, db: Session):
    """Trả về User thật của service-account nếu request xác thực bằng
    SUPPORT_INTEGRATION_API_KEY, hoặc None nếu không phải (caller tự rơi về
    xác thực JWT bình thường). Cố tình KHÔNG gọi lại
    get_current_user_or_support_key() — tách hẳn code đọc (dùng ở rất nhiều
    route GET, xem docstring hàm đó) khỏi code cấp quyền GHI, chỉ áp dụng cho
    đúng 5 route tạo Customer/Project/Phase/TaskGroup/Member phục vụ tính
    năng "đồng bộ Customer theo khách hàng" từ Tech_Support (xem
    Tech_Support/docs/spec-review/kpi-reference.md, mục "Vòng 5") — để sau
    này sửa bên đọc không vô tình ảnh hưởng bên ghi hoặc ngược lại.
    """
    auth_header = request.headers.get("authorization", "")
    scheme, _, raw_token = auth_header.partition(" ")
    if scheme.lower() != "bearer" or not raw_token:
        return None
    configured_key = settings.SUPPORT_INTEGRATION_API_KEY
    if not configured_key or not secrets.compare_digest(raw_token, configured_key):
        return None
    user = db.query(User).filter(User.email == settings.SUPPORT_INTEGRATION_SERVICE_EMAIL).first()
    if not user or not user.is_active:
        raise HTTPException(
            500,
            f"SUPPORT_INTEGRATION_API_KEY đã cấu hình nhưng chưa có tài khoản "
            f"service-account '{settings.SUPPORT_INTEGRATION_SERVICE_EMAIL}' "
            f"(hoặc tài khoản đang bị khoá is_active=false).",
        )
    _support_key_write_logger.info(
        "SUPPORT_INTEGRATION_API_KEY WRITE used: %s %s?%s from %s (user_id=%s role=%s)",
        request.method,
        request.url.path,
        request.url.query or "",
        request.client.host if request.client else "unknown",
        user.id,
        user.role,
    )
    return user


def require_support_key_write(request: Request, db: Session = Depends(get_db)):
    """Dùng cho POST /projects, /projects/{id}/phases, /projects/{id}/members.

    JWT: giữ nguyên y hệt hành vi cũ của các route này (bất kỳ ai đăng nhập
    đều gọi được, không thêm ràng buộc role nào ở đây). Thêm: Authorization:
    Bearer <SUPPORT_INTEGRATION_API_KEY> cũng được chấp nhận, trả về đúng
    user thật của service-account — PHÂN QUYỀN GHI thật sự (được tạo/sửa
    project nào) vẫn hoàn toàn do require_route_project_access/
    has_full_project_access quyết định như với mọi user khác; key chỉ thay
    bước xác thực, không bypass bước đó.
    """
    key_user = _resolve_support_key_write_user(request, db)
    if key_user is not None:
        return key_user
    auth_header = request.headers.get("authorization", "")
    scheme, _, raw_token = auth_header.partition(" ")
    if scheme.lower() != "bearer" or not raw_token:
        raise HTTPException(401, "Not authenticated")
    return _load_user_from_jwt(raw_token, db)


def require_admin_or_support_key_write(request: Request, db: Session = Depends(get_db)):
    """Dùng cho POST /customers — JWT: giữ nguyên yêu cầu cũ (chỉ super_admin,
    xem require_admin/require_super_admin). Thêm: SUPPORT_INTEGRATION_API_KEY
    cũng được chấp nhận (tạo Customer mới khi Tech_Support đồng bộ)."""
    key_user = _resolve_support_key_write_user(request, db)
    if key_user is not None:
        return key_user
    auth_header = request.headers.get("authorization", "")
    scheme, _, raw_token = auth_header.partition(" ")
    if scheme.lower() != "bearer" or not raw_token:
        raise HTTPException(401, "Not authenticated")
    user = _load_user_from_jwt(raw_token, db)
    if user.role != "super_admin":
        raise HTTPException(403, "Yêu cầu quyền Super Admin")
    return user


def is_support_key_write_user(user) -> bool:
    """True nếu *user* chính là service-account đứng sau
    SUPPORT_INTEGRATION_API_KEY. Dùng ở route handler để quyết định có chạy
    nhánh logic riêng cho Tech_Support hay không (vd tự thêm làm PM của
    project vừa tạo, resolve assigned_ids theo leader ở create_task_group,
    hoặc ghi chú audit log) — không dùng để cấp thêm quyền, chỉ để nhận diện."""
    return bool(
        settings.SUPPORT_INTEGRATION_API_KEY
        and getattr(user, "email", None) == settings.SUPPORT_INTEGRATION_SERVICE_EMAIL
    )


def require_super_admin(user=Depends(get_current_user)):
    """Only super_admin may proceed."""
    if user.role != "super_admin":
        raise HTTPException(403, "Yêu cầu quyền Super Admin")
    return user

def require_manager(user=Depends(get_current_user)):
    """super_admin or leader may proceed."""
    if user.role not in {"super_admin", "leader"}:
        raise HTTPException(403, "Yêu cầu quyền quản lý (Super Admin hoặc Leader)")
    return user

def require_manager_write(request: Request, user=Depends(get_current_user_or_support_key)):
    """Allow every active account to read, but reserve mutations for super_admin and leader."""
    if request.method not in {"GET", "HEAD", "OPTIONS"} and user.role not in {"super_admin", "leader"}:
        raise HTTPException(403, "Yêu cầu quyền quản lý để thực hiện thao tác ghi")
    return user


def require_zalo_user(user=Depends(get_current_user)):
    """Authorises the Zalo integration (tab + its whole API surface).

    super_admin, leader, and member may each connect and own their own
    Zalo account — Members create meetings and link projects too, so they
    need the same access as a Leader here. viewer is excluded."""
    if user.role not in {"super_admin", "leader", "member"}:
        raise HTTPException(403, "Yêu cầu quyền Member trở lên")
    return user


def require_skill_creator(user=Depends(get_current_user)):
    """Authorises the Task Detail inline Skill creation flow.

    Used by POST /api/skills/groups and POST /api/skills/skills so a Member
    or Leader can create the missing skill they need while filling out a
    task, instead of bouncing out to Settings. The full Skill CRUD on
    Settings still requires super_admin via require_admin — this gate is
    strictly the create-only entrypoint that the Task Detail `+` button
    reaches into. viewer is excluded.
    """
    if user.role not in {"super_admin", "leader", "member"}:
        raise HTTPException(403, "Yêu cầu quyền Member trở lên")
    return user

# ── Legacy aliases kept for backward compatibility during transition ──

def require_admin(user=Depends(get_current_user)):
    """Legacy alias — maps to require_super_admin."""
    return require_super_admin(user)

def require_admin_write(request: Request, user=Depends(get_current_user_or_support_key)):
    """Legacy alias — maps to require_manager_write."""
    return require_manager_write(request, user)


def require_audit_user(user=Depends(get_current_user)):
    """Authorise the System Audit dashboard.

    Allows super_admin (full visibility) and leader (scoped to the
    Workspaces they're granted). The actual Workspace-scope enforcement
    happens inside each endpoint via `audit_log_query_for_user()` and the
    existing `project_query_for_user*` helpers — this dependency only gates
    access to the route itself.

    Anyone else (member, viewer, anonymous) is rejected with 403.
    """
    if user.role not in {"super_admin", "leader"}:
        raise HTTPException(403, "Yêu cầu quyền Super Admin hoặc Leader để truy cập System Audit")
    return user
