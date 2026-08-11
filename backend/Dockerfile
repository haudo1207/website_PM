FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY create_admin.py .
COPY init_settings.py .
COPY sync_members.py .
COPY migrate_db.py .
COPY sync_all_accepted_candidates.py .
COPY migrate_display_names.py .
COPY Skill_Master_From_Sheet.xlsx .

RUN useradd -m appuser && chown -R appuser /app
USER appuser

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${UVICORN_WORKERS:-2}"]
