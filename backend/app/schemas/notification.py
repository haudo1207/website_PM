from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class NotificationBase(BaseModel):
    message: str
    notification_type: Optional[str] = "task_reminder"


class NotificationCreate(NotificationBase):
    recipient_id: int
    sender_id: int
    task_id: int


class Notification(NotificationBase):
    id: int
    is_read: bool
    created_at: datetime
    sender_id: int
    task_id: int
    recipient_id: int

    class Config:
        orm_mode = True
