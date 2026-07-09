import re
from app.database import SessionLocal
from app.models.member import Member
from app.models.skill_master import Skill

RAW_DATA = """
*****I. Sales ******	
1.Minhpn	@minhuit911
6.Phil	@phile0920
8.Nhớlnha	@AnhNho66
9.Phátnt	@phatnguyeen
*****II. Presales ******	
2.Phướcpv	@nessivu
3.Hând	@handiep
4.Yêmh	@yemhoang96
5.Khôipm	@BlackDrag0n98
*****III. Technical ******	
7.Vypt	@vyvyzz13
10.Huyht	@ht_hyu
11.Hânlnl	@Linhhan0399
12.Vũnl	@vu_nguyen27
14.Túbda	@numm0204
15.Huấnnv	@huannv21
17.Sơnpn	@Sonngocpham
18.Thuậnlh	@thuanle0608
25.Chínhvđ	@duci59
28.Phátntu	@phatnguyentuan
*****IV. Intern L2******	
13.Tâylt	@lethitay
16.Dũngnh	@ru4ff
26.Phúlt	@letrieuphu
27.Duynđ	@duyisme_rynn
29.Anhpxt	@tunanhdapoet
30.Tàipv	@taipvan
31.Hiệplh	@hhieple03
32.Thànhndn	@thanh25324
33.Phươngvt	@tpunn00
*****IV. Intern L1 Tech******	
1.Phúcpth	
2.Quínm	
3.Thanhtt	
4.Lâmmht	
7.Namnp	
8.Thôngnx	
9.Phúcnh	
10.Anhnlq	
12.Nguyêntk	
13.Doanhvh	
14.Thắngln	
15.Nhấthd	
17.Dũngnvt	
18.Thạnhnđ	
20.Kiệtca	
*****V. Dev ******	
Sếp Thương	
Sếp Nhi	
Chị Trang	@Trang07
Thúy Hà	@thuyha06
Yến Nhi	@ynhi03
Chị Hiếu	@HieuNgo027
Chị Giang	@GiangHoangThuy
Anh Độ	@dotran000
Anh Thành	@Thanh_dco
Anh Hồng	@lz30o0 
Anh Nam	@Buinam_POP
Anh Sơn	@snguyencptit
Anh Thanh	@Edgar_Ng
*****VI.Marketing******	
16.Thiệnn	@thienng268
17.Thươngnv	@thuongw89
18.Maidt	@mmaidt
19.Huấndg	@huandinh2409
20. Thuậtn	@thuaatj1204
21. Dungdt	
22. Phúcb	@phuccao123
23. Hoàngt	@thoangg999
24. Quánm	@mavrickNG
*****VI.Intern L1******	
26.HuyNT	
27.Ybinhn	@ybinhquach
29.TienHT	@tien_tth
30.Thưnnm	
31.Duyêntt	
32.Uyểnpdp	
33.Thanhnd	
35.KhoaNN	
36.LongTD	
37.Longntk	
38.Quânlnm	
39.Thuậnpb	
40.Phongnv	
41.Phátngt	
42.Tấnnd	
43.Vinhttq	
44.Vyttt	
45.Thúcch	
46.Tienta	
47.VũDQ	
48.ThanhNC	
49.ThọTĐ	
50.SangPT	
51.NguyênNV	
52.ViệtPQ	
53.HoàngNM	
54.KhaiLM	
55.ThảoVTN	
56.TínHA	
57.AnhNTH	
58.HuyềnLTT	
59.HuyềnNTN	
60.ViệtND	
61.ThắngVT	
62.NamNP	
63.QuânLKM	
64.QuýNT	
65.HùngNP	
66.NhiBTT	
67.QuânVLH	
68.HoàngHNN	
69.TruyềnNT	
70.NamDV	
71.Anđđ	
72.TùngNT	
73.LoanĐTB	
74.GiangNT	
75.TrinhTTT	
76.NhưBTQ	
77.MyCT	
78.TrinhLTT	
79.HiếuLVM	
80.HuệTH	
81.VânNTH	
82.HuyĐNH	
83.HậuĐH	
84.PhươngNTT	
85.TrungNM	
86.AnhTNK	
87.BìnhCT	
88.PhươngNĐ	
89.HảiLV	
90.Vũ TVH	
91.NhựtNT	
92.KhuêNP	
93.NhậtLM	
94.TrangNT	
95.BèngHT	
96.LànhNTM	
97.ĐứcTX	
98.BìnhPV	
99.ĐoanTK	
*****VII.Freelancer******	
201.HoàT	
202.HiềnT	
203.Thái	
*****VIII. Back-Office******	
801.LanVTN	
"""

def parse_members():
    current_team = None
    parsed = []
    lines = RAW_DATA.strip().split('\n')
    for line in lines:
        line = line.strip()
        if not line:
            continue
        hdr_match = re.match(r'^\*+\s*(?:[I|V|X|L|C|D|M]+\.)?\s*(.*?)\s*\*+$', line)
        if hdr_match:
            current_team = hdr_match.group(1).strip()
            continue
        parts = line.split('\t')
        display_name = parts[0].strip()
        telegram_username = parts[1].strip() if len(parts) > 1 else ""
        if not display_name:
            continue
            
        num_prefix_match = re.match(r'^\d+\.(.*)$', display_name)
        if num_prefix_match:
            full_name = num_prefix_match.group(1).strip()
        else:
            full_name = display_name
            
        parsed.append({
            "display_name": display_name,
            "full_name": full_name,
            "telegram_username": telegram_username if telegram_username else None,
            "team": current_team
        })
    return parsed

def sync_and_prune():
    parsed = parse_members()
    allowed_display_names = {x["display_name"] for x in parsed}
    
    db = SessionLocal()
    try:
        print(f"Parsed {len(parsed)} allowed members from raw text.")
        added_count = 0
        updated_count = 0
        
        # 1. Upsert members from allowed list
        for item in parsed:
            member = db.query(Member).filter(Member.display_name == item["display_name"]).first()
            if member:
                member.full_name = item["full_name"]
                member.telegram_username = item["telegram_username"]
                member.team = item["team"]
                updated_count += 1
            else:
                member = Member(
                    display_name=item["display_name"],
                    full_name=item["full_name"],
                    telegram_username=item["telegram_username"],
                    team=item["team"]
                )
                db.add(member)
                added_count += 1
        db.flush()
        
        # 2. Prune members not in allowed list
        db_members = db.query(Member).all()
        deleted_count = 0
        for m in db_members:
            if m.display_name not in allowed_display_names:
                db.delete(m)
                deleted_count += 1
                
        db.commit()
        print(f"Success! Added: {added_count}, Updated: {updated_count}, Pruned: {deleted_count} members.")
    except Exception as e:
        db.rollback()
        print(f"Error during synchronization: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    sync_and_prune()
