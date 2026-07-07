from fastapi import APIRouter
from ..database import SessionLocal
from ..models.phase_model import Phase

router = APIRouter(
    prefix="/api/phases",
    tags=["Phase"]
)


@router.get("/ping")
def ping():
    return {
        "message": "Phase router OK"
    }

@router.post("")
def create_phase(body: dict):
    db = SessionLocal()

    try:
        phase = Phase(
            project_id=body["project_id"],
            name=body["name"],
            spreadsheet_url=body.get("spreadsheet_url"),
            spreadsheet_id=body.get("spreadsheet_id"),
            worksheet_name=body.get("worksheet_name"),
        )

        db.add(phase)
        db.commit()
        db.refresh(phase)

        return {
            "id": phase.id,
            "message": "created"
        }

    finally:
        db.close()