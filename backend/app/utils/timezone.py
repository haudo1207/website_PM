"""Business timezone shared across the app.

Every scheduling-related DATETIME column (meetings, Calendar `scheduled_at`)
is stored as a naive value representing Asia/Ho_Chi_Minh wall-clock time —
never UTC. Import VN_TZ instead of redefining a local ZoneInfo constant.
"""
from zoneinfo import ZoneInfo

VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")
