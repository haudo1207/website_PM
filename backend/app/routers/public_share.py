"""
Public, unauthenticated project share links for the "KPI Prototype" extension
— read-only, token-gated. Deliberately mounted WITHOUT get_current_user /
require_route_project_access: token secrecy is the only gate, same trust
model as the existing refresh-token cookie (opaque, unguessable, revocable).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.project import Project
from ..models.project_feature import ProjectFeature, ProjectFeatureLog

router = APIRouter(tags=["public-share"])


@router.get("/public/project-share/{token}")
def get_public_project_share(token: str, feature: str = None, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.share_token == token).first()
    if not project:
        raise HTTPException(404, "Link chia sẻ không hợp lệ hoặc đã hết hạn")

    features_query = db.query(ProjectFeature).filter(ProjectFeature.project_id == project.id)
    if feature:
        features_query = features_query.filter(ProjectFeature.name.ilike(feature))
    features = features_query.order_by(ProjectFeature.created_at.asc()).all()

    result = []
    for f in features:
        logs = (
            db.query(ProjectFeatureLog)
            .filter(ProjectFeatureLog.feature_id == f.id)
            .order_by(ProjectFeatureLog.created_at.desc())
            .all()
        )
        result.append({
            "id": f.id,
            "name": f.name,
            "logs": [
                {
                    "id": l.id,
                    "content": l.content,
                    "author": l.author.display_name if l.author else None,
                    "created_at": l.created_at.isoformat() if l.created_at else None,
                }
                for l in logs
            ],
        })

    return {"project_name": project.name, "features": result}
