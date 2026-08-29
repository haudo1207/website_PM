"""
Local-disk storage for Resources/Documents file uploads.
Files live under UPLOAD_DIR/{project_id}/{uuid}_{original_filename}.
"""
import os
import uuid
from pathlib import Path

from fastapi import UploadFile

from ..config import settings

MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 MB, matches the mockup's stated limit


def _upload_root() -> Path:
    root = Path(settings.UPLOAD_DIR)
    if not root.is_absolute():
        root = Path(__file__).resolve().parent.parent.parent / root
    return root


def save_upload(project_id: int, upload: UploadFile) -> tuple[str, int]:
    """Save an UploadFile to disk. Returns (relative_path, size_bytes)."""
    project_dir = _upload_root() / str(project_id)
    project_dir.mkdir(parents=True, exist_ok=True)

    safe_name = os.path.basename(upload.filename or "file")
    stored_name = f"{uuid.uuid4().hex}_{safe_name}"
    dest = project_dir / stored_name

    size = 0
    with open(dest, "wb") as out:
        while True:
            chunk = upload.file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                out.close()
                dest.unlink(missing_ok=True)
                raise ValueError("File vượt quá giới hạn 100 MB.")
            out.write(chunk)

    relative_path = f"{project_id}/{stored_name}"
    return relative_path, size


def resolve_path(relative_path: str) -> Path:
    return _upload_root() / relative_path


def delete_file(relative_path: str) -> None:
    try:
        resolve_path(relative_path).unlink(missing_ok=True)
    except Exception:
        pass


def infer_ext(filename: str) -> str:
    _, dot_ext = os.path.splitext(filename or "")
    return (dot_ext[1:] or "FILE").upper()


_BLANK_LINK_VALUES = {"trống", "-", "none", "n/a"}


def sync_task_link_documents(db, task, project_id: int, phase_id, user_id, uploader_is_leader: bool = True) -> None:
    """Keep the Resources hub in sync with a task's LINK column (Task.ticket_id).

    ticket_id may hold one or several newline-separated links (the Tasks grid
    lets users attach more than one). Each non-blank line becomes/keeps its
    own ProjectDocument, tagged `synced_from_task_link=True` so this function
    only ever touches documents it created — a manually-added "Liên kết" for
    the same task is left alone.

    `uploader_is_leader` mirrors the same upload rule as the Resources upload
    form: a newly-created synced link starts "approved" only when whoever
    edited the LINK column is the project's own Leader (or a super_admin);
    any other member's link goes to "Chờ duyệt" like any other upload. Only
    applies to documents being created here — re-syncing an existing one
    never changes its status.
    """
    from ..models.document import ProjectDocument  # local import: avoid a routers<->services import cycle

    existing = (
        db.query(ProjectDocument)
        .filter(ProjectDocument.task_id == task.id, ProjectDocument.synced_from_task_link.is_(True))
        .all()
    )
    existing_by_url = {d.url: d for d in existing}

    raw_lines = [ln.strip() for ln in (task.ticket_id or "").split("\n")]
    raw_lines = [ln for ln in raw_lines if ln and ln.lower() not in _BLANK_LINK_VALUES]

    target_urls: list[str] = []
    for ln in raw_lines:
        url = ln if ln.startswith("http://") or ln.startswith("https://") else f"https://{ln}"
        if url not in target_urls:
            target_urls.append(url)

    name = f"Liên kết task {task.task_code or task.id} · {task.detail}"[:300]
    initial_status = "approved" if uploader_is_leader else "review"

    for url in target_urls:
        doc = existing_by_url.pop(url, None)
        if doc:
            doc.name = name
            doc.phase_id = phase_id
        else:
            db.add(ProjectDocument(
                project_id=project_id, name=name, doc_type="Liên kết", ext="URL",
                phase_id=phase_id, task_id=task.id, source="link", url=url,
                uploader_user_id=user_id, status=initial_status, synced_from_task_link=True,
            ))

    # Anything left over was removed from the task's LINK column.
    for stale_doc in existing_by_url.values():
        db.delete(stale_doc)


def delete_task_link_documents(db, task_ids) -> None:
    """Remove every auto-synced link document for the given task ids (used
    when those tasks themselves are being deleted)."""
    from ..models.document import ProjectDocument

    if not task_ids:
        return
    db.query(ProjectDocument).filter(
        ProjectDocument.task_id.in_(task_ids),
        ProjectDocument.synced_from_task_link.is_(True),
    ).delete(synchronize_session=False)
