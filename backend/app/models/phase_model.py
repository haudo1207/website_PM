from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func

from ..database import Base


class Phase(Base):
    __tablename__ = "phases"

    id = Column(Integer, primary_key=True)

    project_id = Column(Integer, ForeignKey("sheets.id"))

    name = Column(String, nullable=False)

    order_index = Column(Integer, default=0)

    spreadsheet_id = Column(String, nullable=True)

    spreadsheet_url = Column(String, nullable=True)

    worksheet_name = Column(String, nullable=True)

    created_at = Column(DateTime, server_default=func.now())