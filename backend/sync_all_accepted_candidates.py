import os
import sys
import datetime
import json
import re
import requests

# Add current path to sys.path so we can import app modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.main import app  # Initialise SQLAlchemy mappings
from app.database import SessionLocal
from app.models.member import Member

# Supabase Recruitment System API Credentials
SUPABASE_URL = "https://supabase.stratumconsultants.tech"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UtbG9jYWwiLCJpYXQiOjE3NzgwNDM5NDUsImV4cCI6MjA5MzQwMzk0NX0.MLey0ChjN3lr8__Jc1lmiBw6xSbeW-mrXEXsxgkDywI"

TEAM_POSITIONS = {
  "Tech/Product": [
    "Product Manager",
    "UI/UX Designer",
    "Business Analyst",
    "Bridge Software Engineer (BrSE)",
    "Tester/QC"
  ],
  "Dev/DevOps": [
    "Frontend Developer",
    "Backend Developer",
    "Mobile Developer",
    "Fullstack Developer",
    "DevOps Engineer"
  ],
  "Infrastructure": [
    "Network Engineer",
    "System Administrator",
    "IT Support/Helpdesk",
    "Cybersecurity Specialist"
  ],
  "AI": [
    "AI / ML Engineer",
    "Data Scientist",
    "Data Engineer",
    "Computer Vision Engineer",
    "NLP Engineer"
  ],
  "Marketing": [
    "Content Creator",
    "SEO Specialist",
    "Digital Marketer",
    "Media Designer",
    "Copywriter"
  ],
  "Sales/Customer Care": [
    "Account Executive",
    "Sales Consultant",
    "Customer Support Representative",
    "Telemarketer"
  ],
  "Content Production": [
    "Video Editor",
    "Graphic Designer",
    "Motion Designer",
    "Photographer"
  ]
}

def get_primary_team(positions):
    for team, team_positions in TEAM_POSITIONS.items():
        if any(pos in team_positions for pos in positions):
            return team
    return "all"

def get_recruitment_meta(notes):
    raw = re.search(r"\[RECRUITMENT_META\]([\s\S]*?)\[/RECRUITMENT_META\]", notes or "")
    if not raw:
        return {}
    try:
        return json.loads(raw.group(1))
    except Exception:
        return {}

def main():
    print("Fetching accepted candidates from Supabase...")
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }
    
    url = f"{SUPABASE_URL}/rest/v1/applications?status=eq.accepted"
    response = requests.get(url, headers=headers)
    if response.status_code != 200:
        print(f"Error fetching candidates: {response.text}")
        sys.exit(1)
        
    candidates = response.json()
    print(f"Found {len(candidates)} accepted candidates.")
    
    db = SessionLocal()
    success_count = 0
    
    try:
        for idx, app_data in enumerate(candidates):
            full_name = str(app_data.get("full_name", "")).strip()[:255]
            email = str(app_data.get("email", "")).strip().lower()[:255]
            phone = str(app_data.get("phone", "")).strip()[:20]
            positions = app_data.get("career_journey", [])
            primary_team = get_primary_team(positions)[:100]
            position = (positions[0] if positions else "")[:100]
            cv_link = str(app_data.get("cv", "")).strip()[:255]
            
            birth_date_str = app_data.get("dob")
            birth_date = None
            if birth_date_str:
                try:
                    birth_date = datetime.date.fromisoformat(str(birth_date_str).strip()[:10])
                except ValueError:
                    pass
            
            meta = get_recruitment_meta(app_data.get("admin_notes", ""))
            level = meta.get("currentLevel", "lv1")
            telegram_username = str(meta.get("telegram", "")).strip()[:100]
            
            if not full_name:
                continue
                
            # Abbreviate Display Name
            words = [w for w in full_name.split() if w]
            if len(words) <= 2:
                display_name = " ".join(words)[:50]
            else:
                abbr = ".".join([w[0].upper() for w in words[:-2]])
                last_two = " ".join(words[-2:])
                display_name = f"{abbr} {last_two}"[:50]
                
            # Map Level to Team
            mapped_team = primary_team
            if level == "lv1":
                if primary_team in ["AI", "Dev/DevOps", "Infrastructure"]:
                    mapped_team = "Intern L1 Tech"
                else:
                    mapped_team = "Intern L1"
            elif level == "lv2":
                mapped_team = "Intern L2"
            else:
                if primary_team == "Dev/DevOps":
                    mapped_team = "Dev"
                else:
                    mapped_team = primary_team
            mapped_team = mapped_team[:100]
                    
            # Find and Upsert Member
            member = None
            if email:
                member = db.query(Member).filter(Member.email.ilike(email)).first()
            if not member:
                member = db.query(Member).filter(Member.display_name.ilike(display_name)).first()
                
            if member:
                member.full_name = full_name
                member.display_name = display_name
                if email:
                    member.email = email
                if phone:
                    member.phone = phone
                if telegram_username:
                    member.telegram_username = telegram_username
                if mapped_team:
                    member.team = mapped_team
                if position:
                    member.position = position
                if birth_date:
                    member.birth_date = birth_date
                if cv_link:
                    member.cv_link = cv_link
            else:
                member = Member(
                    display_name=display_name,
                    full_name=full_name,
                    email=email or None,
                    phone=phone or None,
                    telegram_username=telegram_username or None,
                    team=mapped_team or None,
                    position=position or None,
                    department=primary_team or None,
                    birth_date=birth_date,
                    cv_link=cv_link or None
                )
                db.add(member)
                
            success_count += 1
            if success_count % 10 == 0:
                print(f"Processed {success_count}/{len(candidates)} candidates...")
                
        db.commit()
        print(f"Successfully synchronized {success_count} candidates to KPI Portal.")
    except Exception as e:
        db.rollback()
        print(f"Error during migration: {str(e)}")
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    main()
