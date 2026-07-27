import sys
import os
from sqlalchemy import text

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app.models.skill_master import Skill
from app.models.member import Member
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.config import settings

db_url = settings.DATABASE_URL.replace(":5432", ":6543")
engine = create_engine(db_url, pool_pre_ping=True)
SessionLocalCustom = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def abbreviate_name(full_name: str) -> str:
    if not full_name:
        return ""
    words = [w for w in full_name.split() if w]
    if len(words) <= 2:
        return " ".join(words)
    else:
        abbr = ".".join([w[0].upper() for w in words[:-2]])
        last_two = " ".join(words[-2:])
        return f"{abbr} {last_two}"

def clean_display_name(display_name: str) -> str:
    # If the display name has a numeric prefix like "801.LanVTN", strip the prefix
    import re
    num_prefix_match = re.match(r'^\d+\.(.*)$', display_name)
    if num_prefix_match:
        return num_prefix_match.group(1).strip()
    return display_name

def migrate():
    db = SessionLocalCustom()
    try:
        members = db.query(Member).all()
        print(f"Found {len(members)} members in local database.")
        updated_count = 0
        
        for m in members:
            old_display = m.display_name
            full_name = m.full_name
            
            # If full name is just the old display name with numeric prefix, clean it up
            cleaned_full = clean_display_name(full_name) if full_name else ""
            
            # Calculate new display name
            if cleaned_full:
                new_display = abbreviate_name(cleaned_full)
            else:
                new_display = clean_display_name(old_display)
                
            # Fallback if empty
            if not new_display:
                new_display = old_display
                
            if new_display != old_display:
                # Check for conflicts
                dup = db.query(Member).filter(Member.display_name == new_display, Member.id != m.id).first()
                if dup:
                    print(f"[Warning] Cannot update '{old_display}' to '{new_display}' because it already exists. Appending ID.")
                    new_display = f"{new_display} ({m.id})"
                
                m.display_name = new_display
                print(f"Updating: '{old_display}' -> '{new_display}'")
                updated_count += 1
                
        if updated_count > 0:
            db.commit()
            print(f"Successfully updated {updated_count} member display names in database!")
        else:
            print("All display names are already up to date!")
            
    except Exception as e:
        db.rollback()
        print(f"Error during migration: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    migrate()
