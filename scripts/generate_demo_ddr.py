from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
)

OUT = Path(__file__).resolve().parents[1] / "output" / "pdf" / "NWIS_DDR_A17_DEMO.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

INK = colors.HexColor("#223A70")
TEAL = colors.HexColor("#187C80")
CORAL = colors.HexColor("#E86B4D")
AMBER = colors.HexColor("#B8862C")
PALE = colors.HexColor("#F2F6F8")
LINE = colors.HexColor("#C9D5DF")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="DDRTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=22, leading=26, textColor=INK, spaceAfter=18))
styles.add(ParagraphStyle(name="DDRSection", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=13, leading=16, textColor=INK, spaceBefore=10, spaceAfter=6))
styles.add(ParagraphStyle(name="DDRBody", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.5, leading=12, textColor=colors.HexColor("#27364C")))
styles.add(ParagraphStyle(name="DDRIssue", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=8.5, leading=12, textColor=CORAL))

def p(value, style="DDRBody"):
    return Paragraph(str(value), styles[style])

def section(title):
    return Paragraph(title, styles["DDRSection"])

def table(rows, widths, header=False):
    data = [[p(cell, "DDRBody") for cell in row] for row in rows]
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    style = [
        ("GRID", (0, 0), (-1, -1), 0.45, LINE),
        ("BACKGROUND", (0, 0), (-1, -1), PALE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    if header:
        style += [
            ("BACKGROUND", (0, 0), (-1, 0), INK),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ]
    t.setStyle(TableStyle(style))
    return t

def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.line(0.65 * inch, 0.52 * inch, 7.85 * inch, 0.52 * inch)
    canvas.setFillColor(colors.HexColor("#66758A"))
    canvas.setFont("Helvetica", 7)
    canvas.drawString(0.65 * inch, 0.33 * inch, "NWIS DEMO DATASET - SYNTHETIC OPERATIONAL RECORD")
    canvas.drawRightString(7.85 * inch, 0.33 * inch, f"Page {doc.page}")
    canvas.restoreState()

doc = SimpleDocTemplate(str(OUT), pagesize=letter, rightMargin=0.65*inch, leftMargin=0.65*inch, topMargin=0.62*inch, bottomMargin=0.7*inch)
story = []
story += [Paragraph("DAILY DRILLING REPORT (DDR)", styles["DDRTitle"]), section("WELL IDENTIFICATION & METADATA")]
story += [table([
    ["Well Name:", "A-17 / Barail North", "Report Date:", "2026-09-02"],
    ["API / UWI:", "OIL-A17-2026-014", "Report No:", "Day 14"],
    ["Latitude:", "26.123456 N", "Spud Date:", "2026-08-19"],
    ["Longitude:", "93.654321 E", "Operator:", "Oil India Limited"],
    ["Lease/Block:", "Barail North / Block 12", "Rig Name:", "BoreMax Rig 5"],
], [1.15*inch, 2.55*inch, 1.15*inch, 2.35*inch])]
story += [section("OPERATIONS SUMMARY & DEPTH TRACKING"), table([
    ["Current MD (m):", "2,853", "Midnight MD (m):", "2,798"],
    ["Current TVD (m):", "2,418", "Progress (m):", "55"],
    ["Avg ROP (m/hr):", "12.6", "Rotating Hours:", "15.0"],
    ["Formation:", "Barail - Upper sandstone", "Hole section:", "8.5 in directional"],
], [1.35*inch, 2.35*inch, 1.35*inch, 2.15*inch])]
story += [section("CHRONOLOGICAL TIME LOG (24-HOUR PROFILE)"), table([
    ["From", "To", "Hrs", "Code", "Operational Description"],
    ["06:00", "08:30", "2.5", "P", "Service rig and functional test top drive system."],
    ["08:30", "17:00", "8.5", "D", "Drill 8.5 in directional profile from 2,798 m to 2,834 m."],
    ["17:00", "19:30", "2.5", "NPT", "Repair hydraulic leak on iron roughneck tool. Non-productive time."],
    ["19:30", "02:00", "6.5", "D", "Resume rotary drilling to 2,853 m. Partial returns observed at 2,805 m."],
    ["02:00", "06:00", "4.0", "P", "Circulate wellbore clean; verify bottoms-up gas and pit volume."],
], [.58*inch, .58*inch, .5*inch, .58*inch, 4.9*inch], True)]
story += [section("DRILLING FLUID PROPERTIES"), table([
    ["Mud Type:", "Oil-Based Mud (OBM)", "Mud Weight (SG):", "1.35"],
    ["Viscosity (s/qt):", "54", "PV / YP:", "22 / 18"],
    ["Oil/Water Ratio:", "80 / 20", "Chlorides (mg/L):", "68,000"],
], [1.35*inch, 2.35*inch, 1.35*inch, 2.15*inch])]
story += [PageBreak(), Paragraph("DDR CONTINUATION - RISK & OFFSET WELL INTELLIGENCE", styles["DDRTitle"]), section("FORMATION / HYDROCARBON INDICATORS")]
story += [table([
    ["Interval (m)", "Formation", "Observed condition", "Risk interpretation"],
    ["2,760 - 2,805", "Upper Barail", "Sandstone; intermittent losses", "Loss circulation watch"],
    ["2,805 - 2,853", "Barail", "Partial returns for 15 min", "High loss correlation with A-08"],
    ["2,853 - 2,900", "Lower Barail", "Gas trend increasing", "Monitor flow and pit gain"],
], [1.1*inch, 1.35*inch, 2.45*inch, 2.3*inch], True)]
story += [section("OPERATIONAL EVENTS EXTRACTED FOR NWIS"), table([
    ["Time", "Event", "Depth (m)", "Severity", "Mitigation / lesson learned"],
    ["19:48", "Partial returns", "2,805", "High", "Reduce ECD; maintain circulation; verify losses before increasing MW."],
    ["20:20", "High flow deviation", "2,818", "Medium", "Flow check; compare pit volume against offset-well behaviour."],
    ["17:35", "NPT - hydraulic leak", "2,831", "Low", "Repair iron roughneck; record 2.5 h NPT."],
], [.55*inch, 1.4*inch, .75*inch, .7*inch, 3.8*inch], True)]
story += [section("DIRECTIONAL SURVEY & NEARBY WELL CONTEXT"), table([
    ["Survey MD (m)", "Inclination", "Azimuth", "TVD (m)", "Offset well / separation"],
    ["2,780", "31.4 deg", "144.2 deg", "2,366", "A-08 / 0.9 km"],
    ["2,805", "33.0 deg", "145.1 deg", "2,386", "A-12 / 1.8 km"],
    ["2,853", "34.2 deg", "146.0 deg", "2,418", "A-21 / 2.6 km"],
], [1.2*inch, 1.05*inch, 1.0*inch, .9*inch, 2.05*inch], True)]
story += [section("NWIS DECISION NOTE"), Paragraph("<b>Recommendation:</b> Hold current mud weight at 1.35 SG through the Upper Barail loss-prone interval. If losses exceed 8 bbl/hr or flow-out divergence persists for two checks, pause ahead, circulate, and compare the A-08 loss event before progressing.", styles["DDRIssue"])]
story += [Spacer(1, 12), section("CASING / CEMENTING PREVIEW")]
story += [table([
    ["Planned casing", "Setting depth", "Cement objective", "Watch item"],
    ["7 in liner", "3,050 m", "Isolate Lower Barail", "Losses may compromise returns"],
    ["TOC target", "2,420 m", "Protect upper interval", "Condition mud before cementing"],
], [1.3*inch, 1.25*inch, 2.45*inch, 2.15*inch], True)]

doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
