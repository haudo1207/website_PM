import redis as redis_lib
import os
import logging

logger = logging.getLogger(__name__)

class FallbackRedis:
    def __init__(self):
        self.local_db = {}
        try:
            self.redis_client = redis_lib.from_url(
                os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
                decode_responses=True
            )
            self.redis_client.ping()
            self.is_redis_active = True
        except Exception:
            self.redis_client = None
            self.is_redis_active = False

    def set(self, key, value):
        if self.is_redis_active:
            try:
                self.redis_client.set(key, value)
                return
            except Exception:
                pass
        self.local_db[key] = str(value)

    def get(self, key):
        if self.is_redis_active:
            try:
                return self.redis_client.get(key)
            except Exception:
                pass
        return self.local_db.get(key)

    def delete(self, key):
        if self.is_redis_active:
            try:
                self.redis_client.delete(key)
                return
            except Exception:
                pass
        if key in self.local_db:
            del self.local_db[key]

    def rpush(self, key, value):
        if self.is_redis_active:
            try:
                self.redis_client.rpush(key, value)
                return
            except Exception:
                pass
        if key not in self.local_db:
            self.local_db[key] = []
        if isinstance(self.local_db[key], list):
            self.local_db[key].append(str(value))

    def lrange(self, key, start, end):
        if self.is_redis_active:
            try:
                return self.redis_client.lrange(key, start, end)
            except Exception:
                pass
        val = self.local_db.get(key, [])
        if not isinstance(val, list):
            return []
        if end == -1:
            return val[start:]
        return val[start:end+1]

    def ltrim(self, key, start, end):
        if self.is_redis_active:
            try:
                self.redis_client.ltrim(key, start, end)
                return
            except Exception:
                pass
        val = self.local_db.get(key, [])
        if not isinstance(val, list):
            return
        if start < 0:
            start = max(0, len(val) + start)
        self.local_db[key] = val[start:]

fallback_redis = FallbackRedis()
