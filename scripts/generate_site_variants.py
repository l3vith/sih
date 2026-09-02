#!/usr/bin/env python3
"""Generate similar/dissimilar DDR variants for embedding explorer test.

A-17 is reference (Barail Upper sandstone, 26.123456,93.654321, partial returns).
Variants:
  A-08 Barail East       – very similar (same formation/events, 0.9km offset)
  A-12 Barail South      – similar deeper, losses + flow deviation
  A-21 Tipam North       – same basin, different formation Tipam, stuck pipe
  C-03 Cambay Shale      – distant basin, shale, gas kick
  D-05 Giruj Anticline   – intermediate (Giruj, no loss, cement issue)
"""
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "output" / "pdf"
OUT_DIR.mkdir(parents=True, exist_ok=True)

INK = colors.HexColor("#223A70")
CORAL = colors.HexColor("#E86B4D")
PALE = colors.HexColor("#F2F6F8")
LINE = colors.HexColor("#C9D5DF")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="DDRTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=22, leading=26, textColor=INK, spaceAfter=18))
styles.add(ParagraphStyle(name="DDRSection", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=13, leading=16, textColor=INK, spaceBefore=10, spaceAfter=6))
styles.add(ParagraphStyle(name="DDRBody", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.5, leading=12, textColor=colors.HexColor("#27364C")))
styles.add(ParagraphStyle(name="DDRIssue", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=8.5, leading=12, textColor=CORAL))

def p(v, s="DDRBody"): return Paragraph(str(v), styles[s])
def section(t): return Paragraph(t, styles["DDRSection"])
def table(rows, widths, header=False):
    data = [[p(c) for c in r] for r in rows]
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    st = [("GRID",(0,0),(-1,-1),0.45,LINE),("BACKGROUND",(0,0),(-1,-1),PALE),("VALIGN",(0,0),(-1,-1),"MIDDLE"),("LEFTPADDING",(0,0),(-1,-1),7),("RIGHTPADDING",(0,0),(-1,-1),7),("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5)]
    if header: st += [("BACKGROUND",(0,0),(-1,0),INK),("TEXTCOLOR",(0,0),(-1,0),colors.white)]
    t.setStyle(TableStyle(st)); return t

def footer(c, doc):
    c.saveState(); c.setStrokeColor(LINE); c.line(0.65*inch,0.52*inch,7.85*inch,0.52*inch)
    c.setFillColor(colors.HexColor("#66758A")); c.setFont("Helvetica",7)
    c.drawString(0.65*inch,0.33*inch,"NWIS DEMO DATASET - SYNTHETIC OPERATIONAL RECORD")
    c.drawRightString(7.85*inch,0.33*inch,f"Page {doc.page}"); c.restoreState()

def build_ddr(path: Path, spec: dict):
    doc = SimpleDocTemplate(str(path), pagesize=letter, rightMargin=0.65*inch, leftMargin=0.65*inch, topMargin=0.62*inch, bottomMargin=0.7*inch)
    story = []
    story += [Paragraph("DAILY DRILLING REPORT (DDR)", styles["DDRTitle"]), section("WELL IDENTIFICATION & METADATA")]
    story += [table([
        ["Well Name:", spec["well_name"], "Report Date:", spec["report_date"]],
        ["API / UWI:", spec["api"], "Report No:", spec["report_no"]],
        ["Latitude:", spec["latitude"], "Spud Date:", spec["spud"]],
        ["Longitude:", spec["longitude"], "Operator:", spec["operator"]],
        ["Lease/Block:", spec["lease"], "Rig Name:", spec["rig"]],
    ], [1.15*inch,2.55*inch,1.15*inch,2.35*inch])]
    story += [section("OPERATIONS SUMMARY & DEPTH TRACKING"), table([
        ["Current MD (m):", spec["md"], "Midnight MD (m):", spec["mid_md"]],
        ["Current TVD (m):", spec["tvd"], "Progress (m):", spec["progress"]],
        ["Avg ROP (m/hr):", spec["rop"], "Rotating Hours:", spec["rot_hours"]],
        ["Formation:", spec["formation"], "Hole section:", spec["hole"]],
    ], [1.35*inch,2.35*inch,1.35*inch,2.15*inch])]
    story += [section("CHRONOLOGICAL TIME LOG (24-HOUR PROFILE)"), table([["From","To","Hrs","Code","Operational Description"]] + spec["timelog"], [.58*inch,.58*inch,.5*inch,.58*inch,4.9*inch], True)]
    story += [section("DRILLING FLUID PROPERTIES"), table([
        ["Mud Type:", spec["mud_type"], "Mud Weight (SG):", spec["mw"]],
        ["Viscosity (s/qt):", spec["visc"], "PV / YP:", spec["pvyp"]],
        ["Oil/Water Ratio:", spec["ow"], "Chlorides (mg/L):", spec["chl"]],
    ], [1.35*inch,2.35*inch,1.35*inch,2.15*inch])]
    story += [PageBreak(), Paragraph("DDR CONTINUATION - RISK & OFFSET WELL INTELLIGENCE", styles["DDRTitle"]), section("FORMATION / HYDROCARBON INDICATORS")]
    story += [table([["Interval (m)","Formation","Observed condition","Risk interpretation"]] + spec["formation_table"], [1.1*inch,1.35*inch,2.45*inch,2.3*inch], True)]
    story += [section("OPERATIONAL EVENTS EXTRACTED FOR NWIS"), table([["Time","Event","Depth (m)","Severity","Mitigation / lesson learned"]] + spec["events"], [.55*inch,1.4*inch,.75*inch,.7*inch,3.8*inch], True)]
    story += [section("DIRECTIONAL SURVEY & NEARBY WELL CONTEXT"), table([["Survey MD (m)","Inclination","Azimuth","TVD (m)","Offset well / separation"]] + spec["survey"], [1.2*inch,1.05*inch,1.0*inch,.9*inch,2.05*inch], True)]
    story += [section("NWIS DECISION NOTE"), Paragraph(f"<b>Recommendation:</b> {spec['decision']}", styles["DDRIssue"])]
    story += [Spacer(1,12), section("CASING / CEMENTING PREVIEW")]
    story += [table([["Planned casing","Setting depth","Cement objective","Watch item"]] + spec["casing"], [1.3*inch,1.25*inch,2.45*inch,2.15*inch], True)]
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(f"Wrote {path}  {spec['well_name']} {spec['formation']} {spec['latitude']},{spec['longitude']}")

# Reference A-17 already exists; we generate its 5 cousins
specs = [
    dict(
        filename="NWIS_DDR_A08_DEMO.pdf", well_name="A-08 / Barail East", report_date="2026-09-01", api="OIL-A08-2026-011", report_no="Day 12", spud="2026-08-18",
        latitude="26.145821 N", longitude="93.702451 E", lease="Barail East / Block 12", operator="Oil India Limited", rig="BoreMax Rig 5",
        md="2,811", mid_md="2,760", tvd="2,386", progress="51", rop="11.9", rot_hours="14.2", formation="Barail - Upper sandstone", hole="8.5 in directional",
        mud_type="Oil-Based Mud (OBM)", mw="1.34", visc="52", pvyp="21 / 17", ow="80 / 20", chl="66,000",
        timelog=[["06:00","09:00","3.0","P","Rig up and test BHA; circulate."],["09:00","16:30","7.5","D","Drill 8.5 in from 2,760 m to 2,805 m through Upper Barail; partial returns noted."],["16:30","19:00","2.5","NPT","Check shakers for losses; add LCM pill."],["19:00","02:30","7.5","D","Drill to 2,811 m; maintain 1.34 SG, monitor pit."],["02:30","06:00","3.5","P","Circulate and condition mud."]],
        formation_table=[["2,760 - 2,805","Upper Barail","Sandstone; light losses 2-4 bbl/hr","Loss circulation watch"],["2,805 - 2,811","Barail","Partial returns sustained","High loss correlation with A-17"],["2,811 - 2,860","Lower Barail","Tight, low ROP","Monitor torque"]],
        events=[["18:22","Partial returns","2,795","High","Add LCM; reduce ECD; correlate with A-17 @ 2,805 m."],["19:05","High flow deviation","2,802","Medium","Pit gain 3 bbl; flow check vs A-17."] ,["16:45","NPT - LCM pill","2,800","Low","Pump 20 bbl LCM, record 2.5 h NPT."]],
        survey=[["2,760","31.1 deg","144.0 deg","2,348","A-17 / 0.9 km"],["2,795","32.5 deg","145.0 deg","2,372","A-12 / 1.6 km"],["2,811","33.1 deg","145.8 deg","2,386","A-21 / 2.1 km"]],
        decision="Hold 1.34 SG through Upper Barail; do not increase MW without LCM. Excellent analogue to A-17 – anticipate 15-min partial returns window.",
        casing=[["7 in liner","3,050 m","Isolate Lower Barail","Same loss window as A-17"],["TOC target","2,420 m","Protect Upper Barail","LCM before cement"]],
    ),
    dict(
        filename="NWIS_DDR_A12_DEMO.pdf", well_name="A-12 / Barail South", report_date="2026-08-30", api="OIL-A12-2026-009", report_no="Day 11", spud="2026-08-17",
        latitude="26.083112 N", longitude="93.581204 E", lease="Barail South / Block 12", operator="Oil India Limited", rig="BoreMax Rig 5",
        md="2,902", mid_md="2,845", tvd="2,455", progress="57", rop="13.1", rot_hours="15.5", formation="Barail - Upper sandstone", hole="8.5 in directional",
        mud_type="Oil-Based Mud (OBM)", mw="1.36", visc="56", pvyp="23 / 19", ow="80 / 20", chl="70,000",
        timelog=[["06:00","08:00","2.0","P","Circulate; test MWD."],["08:00","15:30","7.5","D","Drill 8.5 in from 2,845 m to 2,890 m; losses 5-8 bbl/hr."],["15:30","18:00","2.5","NPT","Pump LCM, reduce flow 280 gpm."],["18:00","03:00","9.0","D","Drill to 2,902 m; high flow deviation at 2,818 m."],["03:00","06:00","3.0","P","Circulate bottoms-up; pit watch."]],
        formation_table=[["2,760 - 2,805","Upper Barail","Fractured sand; losses","Loss circulation watch"],["2,805 - 2,902","Barail","Severe partial returns, flow +4 bbl","High loss correlation with A-08/A-17"],["2,902 - 2,950","Lower Barail","Fractured","Monitor ECD"]],
        events=[["19:48","Partial returns","2,805","High","Reduce ECD; maintain 1.36 SG."],["20:20","High flow deviation","2,818","Medium","Flow check; compare pit vs A-17/A-08."],["15:45","NPT - LCM + reduced rate","2,880","Low","Pump LCM, cut rate, 2.5 h NPT."]],
        survey=[["2,780","31.4 deg","144.2 deg","2,366","A-17 / 0.9 km"],["2,805","33.0 deg","145.1 deg","2,386","A-17 / 1.8 km"],["2,902","34.5 deg","146.2 deg","2,455","A-21 / 1.1 km"]],
        decision="Very similar to A-17/A-08 but deeper 2,902 m and slightly higher MW 1.36. Losses persisted longer – use A-08 LCM design as template.",
        casing=[["7 in liner","3,050 m","Isolate Lower Barail","Losses may compromise returns"],["TOC target","2,420 m","Protect upper","Condition mud"]],
    ),
    dict(
        filename="NWIS_DDR_A21_DEMO.pdf", well_name="A-21 / Tipam North", report_date="2026-08-28", api="OIL-A21-2026-007", report_no="Day 10", spud="2026-08-15",
        latitude="26.201445 N", longitude="93.784112 E", lease="Tipam North / Block 14", operator="Oil India Limited", rig="BoreMax Rig 3",
        md="2,418", mid_md="2,375", tvd="2,102", progress="43", rop="9.2", rot_hours="12.8", formation="Tipam - Upper sand", hole="12.25 in",
        mud_type="Water-Based Mud (WBM)", mw="1.18", visc="44", pvyp="15 / 10", ow="—", chl="12,000",
        timelog=[["06:00","10:00","4.0","P","Run BHA for Tipam; circulate."],["10:00","16:00","6.0","D","Drill 12.25 in Tipam sand 2,375-2,400 m; no losses."],["16:00","20:00","4.0","D","Stuck pipe warning at 2,418 m; overpull 12 klb, torque 8 kNm."],["20:00","04:00","8.0","NPT","Work string, backream; 4 h NPT stuck."],["04:00","06:00","2.0","P","Circulate; hole cleaning."]],
        formation_table=[["2,320 - 2,400","Tipam Upper sand","Unconsolidated sand, cavings","Stuck pipe watch"],["2,400 - 2,418","Tipam","Pack-off tendency","Monitor torque/drag"],["2,418 - 2,500","Tipam Lower","Shale stringer","Mud lubricity"]],
        events=[["18:30","Stuck pipe tendency","2,418","High","Backream, reduce WOB; stuck at 2,418 m."],["19:10","High torque","2,410","Medium","Torque 8→12 kNm; add lubricant."],["20:15","NPT - stuck","2,418","Low","Work pipe 4 h, free."]],
        survey=[["2,350","18.2 deg","132.4 deg","2,080","A-17 / 2.6 km"],["2,400","19.1 deg","133.0 deg","2,095","A-08 / 2.9 km"],["2,418","19.8 deg","133.8 deg","2,102","A-12 / 2.2 km"]],
        decision="Different formation (Tipam) – no loss, dominant stuck pipe mechanism. Not an analogue for Barail loss; use for negative control.",
        casing=[["9 5/8 in","2,500 m","Isolate Tipam","Cavings risk"],["TOC target","1,900 m","Surface","—"]],
    ),
    dict(
        filename="NWIS_DDR_C03_CAMBAY.pdf", well_name="C-03 / Cambay Shale", report_date="2026-07-15", api="OIL-C03-2026-003", report_no="Day 08", spud="2026-07-02",
        latitude="23.192311 N", longitude="72.421805 E", lease="Cambay / Block 9", operator="Oil India Limited", rig="Jai Hind Rig 2",
        md="1,845", mid_md="1,802", tvd="1,812", progress="43", rop="14.5", rot_hours="10.2", formation="Cambay Shale", hole="8.5 in",
        mud_type="Water-Based Mud (WBM)", mw="1.12", visc="38", pvyp="12 / 8", ow="—", chl="28,000",
        timelog=[["06:00","11:00","5.0","P","Displacement; check gas."],["11:00","17:00","6.0","D","Drill Cambay shale 1,802-1,835 m; gas 1,200 units."],["17:00","19:00","2.0","D","Gas kick at 1,845 m; shut-in, 45 psi SIDPP."],["19:00","02:00","7.0","NPT","Kill weight 1.18, circulate kick."],["02:00","06:00","4.0","P","Condition mud; monitor."]],
        formation_table=[["1,800 - 1,835","Cambay Shale","Fissile shale, gas shows","Gas kick watch"],["1,835 - 1,845","Cambay Shale","Overpressured, kick","Well control"],["1,845 - 1,900","Cambay Shale","Normalised","Monitor"]],
        events=[["17:40","Gas kick","1,845","High","SIDPP 45 psi; increase MW to 1.18, circulate."],["18:10","High gas","1,835","Medium","Gas 1,200→2,800 units; flow check."],["19:30","NPT - well control","1,845","Low","Kill mud, 7 h NPT."]],
        survey=[["1,820","8.1 deg","45.2 deg","1,795","C-01 / 1.2 km"],["1,835","8.5 deg","45.8 deg","1,808","C-02 / 2.0 km"],["1,845","8.9 deg","46.1 deg","1,812","C-04 / 1.5 km"]],
        decision="Far-field analogue – Cambay shale gas kick, opposite mechanism to Barail loss. Should embed far from Barail cluster.",
        casing=[["7 in","1,950 m","Isolate Cambay","Gas risk"],["TOC target","1,200 m","—","—"]],
    ),
    dict(
        filename="NWIS_DDR_D05_GIRUJ.pdf", well_name="D-05 / Giruj Anticline", report_date="2026-08-20", api="OIL-D05-2026-005", report_no="Day 09", spud="2026-08-10",
        latitude="26.421112 N", longitude="93.912445 E", lease="Giruj / Block 7", operator="Oil India Limited", rig="BoreMax Rig 2",
        md="2,050", mid_md="2,010", tvd="1,985", progress="40", rop="10.8", rot_hours="11.5", formation="Giruj Formation", hole="12.25 in",
        mud_type="Water-Based Mud (WBM)", mw="1.22", visc="48", pvyp="16 / 11", ow="—", chl="18,000",
        timelog=[["06:00","09:00","3.0","P","MWD check; circulate."],["09:00","15:00","6.0","D","Drill Giruj sand 2,010-2,040 m; no loss."],["15:00","19:00","4.0","D","Cement channelling at 2,050 m; returns low."],["19:00","03:00","8.0","NPT","Cement squeeze; 5 h NPT."],["03:00","06:00","3.0","P","Condition."]],
        formation_table=[["1,950 - 2,040","Giruj","Moderately consolidated","Cement risk"],["2,040 - 2,050","Giruj","Channelling","Cement squeezes"],["2,050 - 2,100","Giruj Base","Tight","—"]],
        events=[["16:20","Cement channelling","2,050","High","Low returns; cement squeeze required."],["17:00","Partial losses","2,045","Medium","Loss 2 bbl/hr, unrelated to Barail fracture."],["19:20","NPT - cement","2,050","Low","Squeeze 5 h."]],
        survey=[["2,010","15.5 deg","128.2 deg","1,945","D-02 / 0.8 km"],["2,040","16.0 deg","129.0 deg","1,970","D-04 / 1.4 km"],["2,050","16.4 deg","129.5 deg","1,985","A-17 / 3.1 km"]],
        decision="Giruj – intermediate distance; cement issue, not Barail fracture loss. Should sit between Barail cluster and Cambay/Tipam.",
        casing=[["9 5/8 in","2,100 m","Giruj","Cement"],["TOC target","1,500 m","—","—"]],
    ),
]

for spec in specs:
    out = OUT_DIR / spec["filename"]
    build_ddr(out, spec)

# copy to public for vite serve
import shutil
pub = ROOT / "public"
for p in OUT_DIR.glob("NWIS_DDR_*.pdf"):
    shutil.copy(p, pub / p.name)
    print(f"copied {p.name} -> public/")
