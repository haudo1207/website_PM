"""
Project Documents Router — the real "Trung tâm dữ liệu dự án" (Resources tab)
backing API: upload/list/filter files or links, star, edit, delete, and a
draft → review → approved workflow where only the project's own Technical
Leader (or a super_admin) may approve/reject.
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.audit_log import AuditLog
from ..models.document import ProjectDocument
from ..services.document_storage import delete_file, infer_ext, resolve_path, save_upload
from ..utils.audit_service import AuditService
from ..utils.access import is_project_leader, require_route_project_access
from ..utils.auth import get_current_user

router = APIRouter(tags=["project-documents"], dependencies=[Depends(require_route_project_access)])

APPROVAL_REQUIRED_TYPES = {"Biên bản", "Báo cáo"}


def _get_doc_or_404(db: Session, pid: int, doc_id: int) -> ProjectDocument:
    doc = (
        db.query(ProjectDocument)
        .filter(ProjectDocument.id == doc_id, ProjectDocument.project_id == pid)
        .first()
    )
    if not doc:
        raise HTTPException(404, "Không tìm thấy dữ liệu.")
    return doc


def serialize_document(doc: ProjectDocument) -> dict:
    uploader_name = None
    if doc.uploader:
        uploader_name = (
            doc.uploader.full_name
            or (doc.uploader.member.display_name if doc.uploader.member else None)
            or doc.uploader.email
        )
    task_label = None
    if doc.task:
        task_label = f"{doc.task.task_code or doc.task.id} · {doc.task.detail}"

    return {
        "id": doc.id,
        "project_id": doc.project_id,
        "name": doc.name,
        "doc_type": doc.doc_type,
        "ext": doc.ext,
        "phase_id": doc.phase_id,
        "phase_name": doc.phase.name if doc.phase else None,
        "task_id": doc.task_id,
        "task_label": task_label,
        "source": doc.source,
        "url": doc.url,
        "size_bytes": doc.size_bytes,
        "owner_member_id": doc.owner_member_id,
        "owner_name": doc.owner.display_name if doc.owner else None,
        "uploader_user_id": doc.uploader_user_id,
        "uploader_name": uploader_name or "—",
        "status": doc.status,
        "is_starred": bool(doc.is_starred),
        "version": doc.version,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
    }


@router.get("/projects/{pid:int}/documents")
def list_documents(
    pid: int,
    special: Optional[str] = None,  # starred | recent | review
    phase_id: Optional[int] = None,
    q: Optional[str] = None,
    doc_type: Optional[str] = None,
    uploader_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    all_docs = db.query(ProjectDocument).filter(ProjectDocument.project_id == pid).all()
    total = len(all_docs)
    starred_count = sum(1 for d in all_docs if d.is_starred)
    review_count = sum(1 for d in all_docs if d.status == "review")
    approved_count = sum(1 for d in all_docs if d.status == "approved")
    approved_pct = round(100 * approved_count / total) if total else 0

    query = db.query(ProjectDocument).filter(ProjectDocument.project_id == pid)
    if special == "starred":
        query = query.filter(ProjectDocument.is_starred.is_(True))
    elif special == "review":
        query = query.filter(ProjectDocument.status == "review")
    elif special == "recent":
        cutoff = datetime.utcnow() - timedelta(days=14)
        query = query.filter(ProjectDocument.updated_at >= cutoff)
    if phase_id:
        query = query.filter(ProjectDocument.phase_id == phase_id)
    if doc_type:
        query = query.filter(ProjectDocument.doc_type == doc_type)
    if uploader_id:
        query = query.filter(ProjectDocument.uploader_user_id == uploader_id)
    if q:
        query = query.filter(ProjectDocument.name.ilike(f"%{q.strip()}%"))

    docs = query.order_by(ProjectDocument.updated_at.desc()).all()

    return {
        "items": [serialize_document(d) for d in docs],
        "metrics": {
            "total": total,
            "starred": starred_count,
            "review": review_count,
            "approved": approved_count,
            "approved_pct": approved_pct,
        },
        "can_approve": is_project_leader(db, current_user, pid),
    }


@router.get("/projects/{pid:int}/documents/categories")
def document_categories(pid: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    rows = (
        db.query(ProjectDocument.doc_type, ProjectDocument.id)
        .filter(ProjectDocument.project_id == pid)
        .all()
    )
    counts: dict[str, int] = {}
    for doc_type, _ in rows:
        counts[doc_type] = counts.get(doc_type, 0) + 1
    return {
        "items": [{"doc_type": k, "count": v} for k, v in sorted(counts.items(), key=lambda kv: -kv[1])],
        "total": len(rows),
    }


@router.post("/projects/{pid:int}/documents")
async def create_document(
    pid: int,
    name: str = Form(...),
    doc_type: str = Form("Tài liệu"),
    phase_id: Optional[int] = Form(None),
    task_id: Optional[int] = Form(None),
    url: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if not file and not url:
        raise HTTPException(400, "Cần chọn file hoặc nhập liên kết.")
    if file and url:
        raise HTTPException(400, "Chỉ chọn một trong hai: file hoặc liên kết.")

    source = "file" if file else "link"
    file_path = None
    size_bytes = None
    ext = "URL"
    if file:
        try:
            file_path, size_bytes = save_upload(pid, file)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        ext = infer_ext(file.filename or name)

    clean_name = name.strip() or (file.filename if file else url) or "Dữ liệu mới"
    # Two independent triggers send a new document to "Chờ duyệt":
    # 1) its doc_type always requires sign-off (Biên bản/Báo cáo), or
    # 2) the uploader isn't the project's own Leader (or a super_admin) — any
    #    regular member's upload needs the Leader's eyes on it regardless of type.
    # Everything else is "approved" immediately — it must never get stuck as
    # a permanent, un-promotable "draft".
    requires_review = doc_type in APPROVAL_REQUIRED_TYPES or not is_project_leader(db, current_user, pid)
    status = "review" if requires_review else "approved"

    doc = ProjectDocument(
        project_id=pid,
        name=clean_name,
        doc_type=doc_type,
        ext=ext,
        phase_id=phase_id or None,
        task_id=task_id or None,
        source=source,
        file_path=file_path,
        url=url.strip() if url else None,
        size_bytes=size_bytes,
        uploader_user_id=current_user.id,
        owner_member_id=getattr(current_user, "member_id", None),
        status=status,
    )
    db.add(doc)
    db.flush()

    AuditService.record(
        db=db, user_id=current_user.id, module="ProjectDocument", entity_type="ProjectDocument",
        entity_id=doc.id, action="CREATE", project_id=pid, resource_name=doc.name,
        description=f"Tải lên dữ liệu '{doc.name}'",
    )
    db.commit()
    db.refresh(doc)
    return serialize_document(doc)


@router.patch("/projects/{pid:int}/documents/{doc_id:int}")
async def update_document(
    pid: int,
    doc_id: int,
    name: Optional[str] = Form(None),
    doc_type: Optional[str] = Form(None),
    phase_id: Optional[int] = Form(None),
    task_id: Optional[int] = Form(None),
    url: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    doc = _get_doc_or_404(db, pid, doc_id)
    old_name = doc.name

    if name:
        doc.name = name.strip()
    if doc_type and doc_type != doc.doc_type:
        now_requires_approval = doc_type in APPROVAL_REQUIRED_TYPES
        was_requiring_approval = doc.doc_type in APPROVAL_REQUIRED_TYPES
        doc.doc_type = doc_type
        if now_requires_approval and not was_requiring_approval:
            # Switched into a type that needs sign-off (e.g. Liên kết → Báo cáo) —
            # it hasn't actually been reviewed yet, so it can't stay "approved".
            doc.status = "review"
        elif was_requiring_approval and not now_requires_approval and doc.status != "approved":
            # Switched away from a type that needs sign-off — nothing left to approve.
            doc.status = "approved"
    if phase_id is not None:
        doc.phase_id = phase_id or None
    if task_id is not None:
        doc.task_id = task_id or None

    replaced = False
    if file:
        if doc.file_path:
            delete_file(doc.file_path)
        doc.file_path, doc.size_bytes = save_upload(pid, file)
        doc.ext = infer_ext(file.filename or doc.name)
        doc.source = "file"
        doc.url = None
        replaced = True
    elif url and url.strip() != doc.url:
        # The edit modal always resends the current url for link-type documents
        # even when only metadata (name/phase/task) changed — only treat this
        # as a real replacement (new version, audit entry) when it actually differs.
        if doc.file_path:
            delete_file(doc.file_path)
        doc.file_path = None
        doc.url = url.strip()
        doc.ext = "URL"
        doc.source = "link"
        replaced = True

    if replaced:
        doc.version = (doc.version or 1) + 1

    db.flush()
    AuditService.record(
        db=db, user_id=current_user.id, module="ProjectDocument", entity_type="ProjectDocument",
        entity_id=doc.id, action="UPDATE", project_id=pid, resource_name=doc.name,
        field_name="file" if replaced else "metadata", old_value=old_name, new_value=doc.name,
        description=f"Cập nhật dữ liệu '{doc.name}'" + (f" (phiên bản v{doc.version})" if replaced else ""),
    )
    db.commit()
    db.refresh(doc)
    return serialize_document(doc)


@router.post("/projects/{pid:int}/documents/{doc_id:int}/approve")
def approve_document(pid: int, doc_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not is_project_leader(db, current_user, pid):
        raise HTTPException(403, "Chỉ Leader của dự án mới có quyền duyệt dữ liệu này.")
    doc = _get_doc_or_404(db, pid, doc_id)
    doc.status = "approved"
    db.flush()
    AuditService.record(
        db=db, user_id=current_user.id, module="ProjectDocument", entity_type="ProjectDocument",
        entity_id=doc.id, action="UPDATE", project_id=pid, resource_name=doc.name,
        description=f"Duyệt dữ liệu '{doc.name}'",
    )
    db.commit()
    db.refresh(doc)
    return serialize_document(doc)


@router.post("/projects/{pid:int}/documents/{doc_id:int}/reject")
def reject_document(pid: int, doc_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not is_project_leader(db, current_user, pid):
        raise HTTPException(403, "Chỉ Leader của dự án mới có quyền duyệt/từ chối dữ liệu này.")
    doc = _get_doc_or_404(db, pid, doc_id)
    doc.status = "draft"
    db.flush()
    AuditService.record(
        db=db, user_id=current_user.id, module="ProjectDocument", entity_type="ProjectDocument",
        entity_id=doc.id, action="UPDATE", project_id=pid, resource_name=doc.name,
        description=f"Từ chối duyệt dữ liệu '{doc.name}', trả về bản nháp",
    )
    db.commit()
    db.refresh(doc)
    return serialize_document(doc)


@router.post("/projects/{pid:int}/documents/{doc_id:int}/star")
def toggle_star_document(pid: int, doc_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    doc = _get_doc_or_404(db, pid, doc_id)
    doc.is_starred = not doc.is_starred
    db.commit()
    db.refresh(doc)
    return serialize_document(doc)


@router.delete("/projects/{pid:int}/documents/{doc_id:int}")
def delete_document(pid: int, doc_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    doc = _get_doc_or_404(db, pid, doc_id)
    if doc.file_path:
        delete_file(doc.file_path)
    name = doc.name
    db.delete(doc)
    db.flush()
    AuditService.record(
        db=db, user_id=current_user.id, module="ProjectDocument", entity_type="ProjectDocument",
        entity_id=doc_id, action="DELETE", project_id=pid, resource_name=name,
        description=f"Xóa dữ liệu '{name}'",
    )
    db.commit()
    return {"ok": True}


@router.get("/projects/{pid:int}/documents/{doc_id:int}/file")
def download_document_file(pid: int, doc_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    doc = _get_doc_or_404(db, pid, doc_id)
    if doc.source != "file" or not doc.file_path:
        raise HTTPException(404, "Dữ liệu này không có file đính kèm.")
    path = resolve_path(doc.file_path)
    if not path.is_file():
        raise HTTPException(404, "File không còn tồn tại trên hệ thống.")
    return FileResponse(path, filename=doc.name)


@router.get("/projects/{pid:int}/documents/{doc_id:int}/history")
def document_history(pid: int, doc_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _get_doc_or_404(db, pid, doc_id)
    logs = (
        db.query(AuditLog)
        .filter(AuditLog.entity_type == "ProjectDocument", AuditLog.entity_id == str(doc_id))
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .all()
    )
    return {"items": [log.to_dict() for log in logs]}
