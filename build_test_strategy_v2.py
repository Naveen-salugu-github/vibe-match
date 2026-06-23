# -*- coding: utf-8 -*-
"""
Generates SIT_d_calendar_445_Test_Strategy_v2.xlsx
Two sheets:
  1. Test Strategy  — 3 high-level strategies, pass/fail rolled up
  2. Test Cases     — 9 detailed test cases, each linked to a strategy
Run: python build_test_strategy_v2.py
"""

from openpyxl import Workbook
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
from openpyxl.utils import get_column_letter

# ---------------------------------------------------------------------------
# Palette
# ---------------------------------------------------------------------------
NAVY       = "1F3864"
MID_BLUE   = "2E75B6"
LIGHT_BLUE = "D9E1F2"
ALT1       = "EBF3FB"
ALT2       = "FFFFFF"
PASS_BG    = "C6EFCE";  PASS_FG = "276221"
FAIL_BG    = "FFC7CE";  FAIL_FG = "9C0006"
AMBER_BG   = "FFEB9C";  AMBER_FG = "9C6500"
MONO_BG    = "F2F2F2"
BORDER_C   = "B8CCE4"

def _fill(hex_):  return PatternFill("solid", fgColor=hex_)
def _font(bold=False, color="000000", size=10, italic=False, mono=False):
    name = "Courier New" if mono else "Calibri"
    return Font(bold=bold, color=color, size=size, italic=italic, name=name)
def _border():
    s = Side(style="thin", color=BORDER_C)
    return Border(left=s, right=s, top=s, bottom=s)
def _align(h="left", wrap=True):
    return Alignment(horizontal=h, vertical="top", wrap_text=wrap)
def _center(wrap=False):
    return Alignment(horizontal="center", vertical="center", wrap_text=wrap)

def hdr(ws, row, col, val, bg=NAVY, fg="FFFFFF", size=10, bold=True, h="center"):
    c = ws.cell(row=row, column=col, value=val)
    c.fill = _fill(bg);  c.font = _font(bold=bold, color=fg, size=size)
    c.border = _border(); c.alignment = _align(h=h, wrap=True) if h!="center" else _center(wrap=True)
    return c

def cell(ws, row, col, val, bg=ALT2, bold=False, h="left", size=10, fg="000000", mono=False):
    c = ws.cell(row=row, column=col, value=val)
    c.fill = _fill(bg);  c.font = _font(bold=bold, color=fg, size=size, mono=mono)
    c.border = _border(); c.alignment = _align(h=h, wrap=True) if h!="center" else _center(wrap=True)
    return c

def banner(ws, row, col1, col2, val, bg=MID_BLUE, fg="FFFFFF", size=11):
    ws.merge_cells(start_row=row, start_column=col1, end_row=row, end_column=col2)
    c = ws.cell(row=row, column=col1, value=val)
    c.fill = _fill(bg);  c.font = _font(bold=True, color=fg, size=size)
    c.border = _border(); c.alignment = _center(wrap=False)
    return c

# ---------------------------------------------------------------------------
# Data definitions
# ---------------------------------------------------------------------------
STRATEGIES = [
    {
        "id":          "TS-01",
        "name":        "Date Boundary Validation",
        "description": (
            "Validates that every fiscal week starts on Saturday and ends on Friday, "
            "that consecutive fiscal years have no day-level gaps, and that fiscal year "
            "start / end dates are correct and contiguous."
        ),
        "scope":       "week_445_start_date, week_445_end_date, year boundary integrity",
        "test_cases":  ["DC-02", "DC-03", "DC-05"],
        "priority":    "High",
        "rationale":   (
            "Incorrect week boundaries would corrupt weekly TRx / NRx trending. "
            "A single gap between fiscal years would break all period-over-period calculations."
        ),
    },
    {
        "id":          "TS-02",
        "name":        "52 / 53 Week Count Validation",
        "description": (
            "Validates that every fiscal year contains exactly 52 or 53 weeks and exactly "
            "12 retail months, that all fiscal years in the range are present, and that "
            "the full calendar date spine has no missing days."
        ),
        "scope":       "week_in_445_year, year_445_name, month_445_short_name, calendar_date",
        "test_cases":  ["DC-04", "DC-06", "DC-07"],
        "priority":    "High",
        "rationale":   (
            "A 53-week year occurs every ~5-6 years (NRF standard). Missing or miscounted "
            "weeks would shift monthly aggregations and break fiscal period close reporting."
        ),
    },
    {
        "id":          "TS-03",
        "name":        "Column Population & Uniqueness",
        "description": (
            "Validates that all 20 output columns are fully populated (no NULLs, no empty "
            "strings), that no fully duplicate rows exist, and that the composite business "
            "key (9 key columns) is unique across the table."
        ),
        "scope":       "All 20 columns — completeness, full-row deduplication, composite key uniqueness",
        "test_cases":  ["DC-01", "DC-08", "DC-09"],
        "priority":    "High",
        "rationale":   (
            "NULLs in date or name columns would silently drop rows from downstream joins. "
            "Duplicates would double-count weekly Rx volumes in aggregated reports."
        ),
    },
]

# SQL snippets — placeholder keeps it readable in the cell
SQLS = {
    "DC-01": (
        "df = spark.table('d_calendar_445')\n"
        "null_counts = df.select([\n"
        "  sum(when(col(c).isNull(),1).otherwise(0)).alias(c)\n"
        "  for c in df.columns])\n"
        "display(null_counts)"
    ),
    "DC-02": (
        "SELECT\n"
        "  date_format(week_445_start_date,'EEE') AS week_start_dow,\n"
        "  date_format(week_445_end_date,  'EEE') AS week_end_dow,\n"
        "  COUNT(*) AS row_ct\n"
        "FROM d_calendar_445\n"
        "GROUP BY 1, 2"
    ),
    "DC-03": (
        "SELECT DISTINCT week_445_start_date, week_445_end_date,\n"
        "  DAYOFWEEK(week_445_start_date) AS start_dow,\n"
        "  DAYOFWEEK(week_445_end_date)   AS end_dow\n"
        "FROM d_calendar_445\n"
        "WHERE DAYOFWEEK(week_445_start_date) <> 7\n"
        "   OR DAYOFWEEK(week_445_end_date)   <> 6"
    ),
    "DC-04": (
        "SELECT year_445_name,\n"
        "  COUNT(DISTINCT week_445_end_date)    AS total_weeks,\n"
        "  COUNT(DISTINCT month_445_short_name) AS total_months\n"
        "FROM d_calendar_445\n"
        "GROUP BY year_445_name\n"
        "HAVING total_weeks NOT IN (52,53)\n"
        "    OR total_months <> 12"
    ),
    "DC-05": (
        "WITH yb AS (\n"
        "  SELECT year_445_name AS yr,\n"
        "    MIN(week_445_start_date) AS yr_start,\n"
        "    MAX(week_445_end_date)   AS yr_end\n"
        "  FROM d_calendar_445 GROUP BY year_445_name)\n"
        "SELECT a.yr, a.yr_end, b.yr_start,\n"
        "  DATEDIFF(b.yr_start, a.yr_end) AS gap_days\n"
        "FROM yb a JOIN yb b ON b.yr = a.yr + 1\n"
        "WHERE DATEDIFF(b.yr_start, a.yr_end) <> 1"
    ),
    "DC-06": (
        "SELECT\n"
        "  MAX(year_445_name)-MIN(year_445_name)+1 AS expected_years,\n"
        "  COUNT(DISTINCT year_445_name)           AS actual_years,\n"
        "  CASE WHEN MAX(year_445_name)-MIN(year_445_name)+1\n"
        "            = COUNT(DISTINCT year_445_name)\n"
        "       THEN 'PASS' ELSE 'FAIL'\n"
        "  END AS year_range_check\n"
        "FROM d_calendar_445"
    ),
    "DC-07": (
        "SELECT\n"
        "  DATEDIFF(MAX(calendar_date),MIN(calendar_date))+1 AS expected_days,\n"
        "  COUNT(DISTINCT calendar_date)                     AS actual_days,\n"
        "  CASE WHEN DATEDIFF(MAX(calendar_date),MIN(calendar_date))+1\n"
        "            = COUNT(DISTINCT calendar_date)\n"
        "       THEN 'PASS' ELSE 'FAIL'\n"
        "  END AS date_spine_check\n"
        "FROM d_calendar_445"
    ),
    "DC-08": (
        "SELECT COUNT(*) AS row_count, 'Total' AS label\n"
        "FROM d_calendar_445\n"
        "UNION ALL\n"
        "SELECT COUNT(*), 'Distinct'\n"
        "FROM (SELECT DISTINCT * FROM d_calendar_445)\n"
        "ORDER BY label"
    ),
    "DC-09": (
        "SELECT calendar_date_identifier, calendar_date,\n"
        "  year_445_name, month_445_long_name,\n"
        "  month_445_start_date, month_445_end_date,\n"
        "  week_in_445_year, week_445_start_date,\n"
        "  week_445_end_date, COUNT(*)\n"
        "FROM d_calendar_445\n"
        "GROUP BY 1,2,3,4,5,6,7,8,9\n"
        "HAVING COUNT(*) > 1"
    ),
}

TEST_CASES = [
    # TS-01
    {"id":"DC-02","strategy":"TS-01","category":"Consistency",
     "name":"Week DOW Sanity (String)",
     "objective":"Every week starts Saturday and ends Friday (string format, EEE).",
     "type":"SQL","priority":"Medium",
     "expected":"1 row: [Sat, Fri, 9496]","actual":"1 row: [Sat, Fri, 9496]","pass_fail":"PASS",
     "notes":"Locale-dependent. Informational — DC-03 is authoritative."},
    {"id":"DC-03","strategy":"TS-01","category":"Consistency",
     "name":"Week Boundary Integrity (Numeric DAYOFWEEK)",
     "objective":"Every week starts Saturday (DOW=7) and ends Friday (DOW=6) — locale-independent.",
     "type":"SQL","priority":"High",
     "expected":"0 rows","actual":"0 rows","pass_fail":"PASS",
     "notes":"Preferred over DC-02. Fails on any non-Sat/Fri week boundary."},
    {"id":"DC-05","strategy":"TS-01","category":"Structural Integrity",
     "name":"No Gaps Between Fiscal Years",
     "objective":"Each fiscal year ends exactly 1 day before the next starts.",
     "type":"SQL","priority":"High",
     "expected":"0 rows","actual":"0 rows","pass_fail":"PASS",
     "notes":"Works with DC-06: DC-06 confirms years present, DC-05 confirms no day gaps."},
    # TS-02
    {"id":"DC-04","strategy":"TS-02","category":"Structural Integrity",
     "name":"Fiscal Year Week & Month Count",
     "objective":"Every fiscal year has exactly 52 or 53 weeks and exactly 12 retail months.",
     "type":"SQL","priority":"High",
     "expected":"0 rows","actual":"0 rows","pass_fail":"PASS",
     "notes":"Recommend COUNT(DISTINCT month_445_start_date) instead of short_name to avoid abbreviation collision."},
    {"id":"DC-06","strategy":"TS-02","category":"Completeness",
     "name":"Fiscal Year Range Completeness",
     "objective":"All fiscal years from MIN to MAX are present — no missing years.",
     "type":"SQL","priority":"High",
     "expected":"expected_years = actual_years -> PASS","actual":"26 = 26 -> PASS","pass_fail":"PASS",
     "notes":"Confirms 26 contiguous fiscal years (~9,496 rows / 365.25 = 26 years)."},
    {"id":"DC-07","strategy":"TS-02","category":"Completeness",
     "name":"Date Spine Completeness",
     "objective":"Every calendar day from MIN to MAX calendar_date is present.",
     "type":"SQL","priority":"High",
     "expected":"expected_days = actual_days -> PASS","actual":"9496 = 9496 -> PASS","pass_fail":"PASS",
     "notes":"Strongest completeness check. Implicitly confirms calendar_date is the natural PK."},
    # TS-03
    {"id":"DC-01","strategy":"TS-03","category":"Completeness",
     "name":"Null Check (All 20 Columns)",
     "objective":"No NULL values in any of the 20 output columns.",
     "type":"PySpark","priority":"High",
     "expected":"All 20 columns return 0","actual":"All 20 columns = 0","pass_fail":"PASS",
     "notes":"Does not catch empty strings or sentinel values (-1, 9999). Recommend adding range checks (DC-10)."},
    {"id":"DC-08","strategy":"TS-03","category":"Uniqueness",
     "name":"Full-Row Duplicate Check",
     "objective":"Total row count equals count of fully distinct rows across all 20 columns.",
     "type":"SQL","priority":"High",
     "expected":"Total = Distinct (both 9496)","actual":"Total = 9496, Distinct = 9496","pass_fail":"PASS",
     "notes":"Add ORDER BY label for audit readability."},
    {"id":"DC-09","strategy":"TS-03","category":"Uniqueness",
     "name":"Key-Based Duplicate Check",
     "objective":"No duplicate rows on the 9-column composite business key.",
     "type":"SQL","priority":"High",
     "expected":"0 rows","actual":"0 rows","pass_fail":"PASS",
     "notes":"Diagnostic locator when DC-08 fails. DC-07 implicitly confirms calendar_date as natural PK."},
]

# ---------------------------------------------------------------------------
# Build workbook
# ---------------------------------------------------------------------------
def build():
    wb = Workbook()

    # =========================================================================
    # SHEET 1 — TEST STRATEGY
    # =========================================================================
    ws1 = wb.active
    ws1.title = "Test Strategy"
    ws1.sheet_properties.tabColor = NAVY

    # col widths
    for col, w in [("A",6),("B",12),("C",28),("D",42),("E",42),
                   ("F",28),("G",18),("H",12),("I",14),("J",14)]:
        ws1.column_dimensions[col].width = w

    # ── title
    banner(ws1, 1, 1, 10, "SIT Test Strategy Overview  —  d_calendar_445",
           bg=NAVY, fg="FFFFFF", size=15)
    ws1.row_dimensions[1].height = 36

    # ── meta row
    meta = [
        (1,"Table","us_comm_lakehouse_dev.gold_dimensions.d_calendar_445"),
        (4,"Review Date","2026-06-23"),
        (7,"Reviewed By","ZS Associates"),
    ]
    for col, lbl, val in meta:
        c = ws1.cell(row=2, column=col, value=lbl)
        c.fill=_fill(LIGHT_BLUE); c.font=_font(bold=True,color=NAVY); c.border=_border(); c.alignment=_center()
        c2 = ws1.cell(row=2, column=col+1, value=val)
        c2.fill=_fill(ALT1); c2.font=_font(); c2.border=_border(); c2.alignment=_center()

    ws1.row_dimensions[2].height = 20

    # ── spacer
    ws1.row_dimensions[3].height = 8

    # ── strategy column headers (row 4)
    STRAT_COLS = [
        (1,4,  "#"),
        (2,5,  "Strategy ID"),
        (3,6,  "Strategy Name"),
        (4,7,  "Description"),
        (5,8,  "Scope / Columns Tested"),
        (6,9,  "Linked Test Cases"),
        (7,10, "Rationale"),
        (8,11, "Priority"),
        (9,12, "Pass / Fail"),
        (10,12,"Overall Status"),
    ]
    HDR_COLS_S = [
        ("A","#",4), ("B","Strategy ID",12), ("C","Strategy Name",28),
        ("D","Description",42), ("E","Scope / Columns Tested",28),
        ("F","Linked Test Cases",18), ("G","Rationale",42),
        ("H","Priority",12), ("I","Pass / Fail",12), ("J","Overall Status",18),
    ]
    for col_l, lbl, _ in HDR_COLS_S:
        hdr(ws1, 4, ord(col_l)-64, lbl)
    ws1.row_dimensions[4].height = 28

    ws1.freeze_panes = "C5"

    # ── strategy rows
    STRAT_COLORS = [ALT1, ALT2, ALT1]
    for i, st in enumerate(STRATEGIES):
        r  = 5 + i
        bg = STRAT_COLORS[i]
        ws1.row_dimensions[r].height = 72

        linked = ", ".join(st["test_cases"])
        # derive pass/fail from test cases
        tc_ids  = st["test_cases"]
        results = [tc["pass_fail"] for tc in TEST_CASES if tc["id"] in tc_ids]
        pf      = "PASS" if all(x=="PASS" for x in results) else "FAIL"
        pf_bg   = PASS_BG if pf=="PASS" else FAIL_BG
        pf_fg   = PASS_FG if pf=="PASS" else FAIL_FG

        cell(ws1, r, 1, i+1,              bg=bg, h="center", bold=True)
        cell(ws1, r, 2, st["id"],         bg=bg, h="center", bold=True)
        cell(ws1, r, 3, st["name"],       bg=bg, bold=True)
        cell(ws1, r, 4, st["description"],bg=bg)
        cell(ws1, r, 5, st["scope"],      bg=bg)
        cell(ws1, r, 6, linked,           bg=bg, h="center")
        cell(ws1, r, 7, st["rationale"],  bg=bg)

        pr_c = ws1.cell(row=r, column=8, value=st["priority"])
        pr_c.fill=_fill(bg); pr_c.font=_font(bold=True); pr_c.border=_border(); pr_c.alignment=_center()

        pf_c = ws1.cell(row=r, column=9, value=pf)
        pf_c.fill=_fill(pf_bg); pf_c.font=_font(bold=True,color=pf_fg,size=11)
        pf_c.border=_border(); pf_c.alignment=_center()

        # overall status
        passed_n = sum(1 for x in results if x=="PASS")
        ov = f"All {passed_n}/{len(results)} passed" if pf=="PASS" else f"{len(results)-passed_n} FAILED"
        ov_c = ws1.cell(row=r, column=10, value=ov)
        ov_c.fill=_fill(pf_bg); ov_c.font=_font(bold=False,color=pf_fg); ov_c.border=_border(); ov_c.alignment=_center(wrap=True)

    # ── grand summary
    gs_row = 5 + len(STRATEGIES) + 1
    banner(ws1, gs_row, 1, 10, "GRAND SUMMARY", bg=NAVY, fg="FFFFFF", size=11)
    ws1.row_dimensions[gs_row].height = 22

    total_tc = len(TEST_CASES)
    passed_tc = sum(1 for tc in TEST_CASES if tc["pass_fail"]=="PASS")
    summary_items = [
        ("Total Strategies", len(STRATEGIES)),
        ("Total Test Cases",  total_tc),
        ("Passed",            passed_tc),
        ("Failed",            total_tc - passed_tc),
        ("Sign-Off",          "APPROVED FOR PRODUCTION" if passed_tc==total_tc else "REVIEW REQUIRED"),
    ]
    for j, (lbl, val) in enumerate(summary_items):
        r = gs_row + 1 + j
        bg = PASS_BG if lbl in ("Passed","Sign-Off") and (val == passed_tc or "APPROVED" in str(val)) \
             else (FAIL_BG if lbl == "Failed" and val > 0 else ALT1)
        ws1.merge_cells(start_row=r, start_column=3, end_row=r, end_column=5)
        ws1.merge_cells(start_row=r, start_column=6, end_row=r, end_column=10)
        lc = ws1.cell(row=r, column=3, value=lbl)
        lc.fill=_fill(LIGHT_BLUE); lc.font=_font(bold=True,color=NAVY); lc.border=_border(); lc.alignment=_center()
        vc = ws1.cell(row=r, column=6, value=str(val))
        vc.fill=_fill(bg); vc.font=_font(bold=(lbl=="Sign-Off")); vc.border=_border(); vc.alignment=_center()

    # =========================================================================
    # SHEET 2 — TEST CASES
    # =========================================================================
    ws2 = wb.create_sheet("Test Cases")
    ws2.sheet_properties.tabColor = MID_BLUE

    for col, w in [("A",5),("B",12),("C",12),("D",22),("E",30),
                   ("F",50),("G",12),("H",12),("I",50),
                   ("J",30),("K",30),("L",14),("M",45)]:
        ws2.column_dimensions[col].width = w

    # ── title
    banner(ws2, 1, 1, 13, "SIT Test Cases  —  d_calendar_445  (Linked to Test Strategy)",
           bg=NAVY, fg="FFFFFF", size=14)
    ws2.row_dimensions[1].height = 32

    # ── sub header showing strategy colour key
    for col_l, lbl, bg_ in [("A","TS-01: Date Boundaries",ALT1),
                             ("E","TS-02: Week Count",  "EAF4EA"),
                             ("I","TS-03: Column Population","FFF3E0")]:
        c = ws2.cell(row=2, column=ord(col_l)-64, value=lbl)
        c.fill=_fill(bg_); c.font=_font(bold=True,color=NAVY,size=9)
        c.border=_border(); c.alignment=_center()

    ws2.row_dimensions[2].height = 18

    # ── column headers (row 3)
    TC_HDRS = [
        "S.No","Test Case ID","Strategy ID","Category","Test Case Name",
        "Test Objective","Type","Priority","SQL / Code",
        "Expected Result","Actual Result","Pass / Fail","Observations / Notes"
    ]
    for ci, h_ in enumerate(TC_HDRS, start=1):
        hdr(ws2, 3, ci, h_)
    ws2.row_dimensions[3].height = 28
    ws2.freeze_panes = "D4"

    # ── strategy background map
    STRAT_BG = {"TS-01": ALT1, "TS-02": "EAF4EA", "TS-03": "FFF3E0"}

    for i, tc in enumerate(TEST_CASES):
        r   = 4 + i
        bg  = STRAT_BG.get(tc["strategy"], ALT2)
        ws2.row_dimensions[r].height = 90
        pf  = tc["pass_fail"]
        pf_bg = PASS_BG if pf=="PASS" else FAIL_BG
        pf_fg = PASS_FG if pf=="PASS" else FAIL_FG

        cell(ws2, r, 1,  i+1,              bg=bg, h="center", bold=True)
        cell(ws2, r, 2,  tc["id"],         bg=bg, h="center", bold=True)
        cell(ws2, r, 3,  tc["strategy"],   bg=bg, h="center", bold=True)
        cell(ws2, r, 4,  tc["category"],   bg=bg, h="center")
        cell(ws2, r, 5,  tc["name"],       bg=bg, bold=True)
        cell(ws2, r, 6,  tc["objective"],  bg=bg)
        cell(ws2, r, 7,  tc["type"],       bg=bg, h="center")
        cell(ws2, r, 8,  tc["priority"],   bg=bg, h="center")

        # SQL mono cell
        sc = ws2.cell(row=r, column=9, value=SQLS.get(tc["id"],""))
        sc.fill=_fill(MONO_BG); sc.font=_font(mono=True,size=8,color=NAVY)
        sc.border=_border(); sc.alignment=_align(h="left",wrap=True)

        cell(ws2, r, 10, tc["expected"],   bg=bg)
        cell(ws2, r, 11, tc["actual"],     bg=bg)

        pfc = ws2.cell(row=r, column=12, value=pf)
        pfc.fill=_fill(pf_bg); pfc.font=_font(bold=True,color=pf_fg,size=11)
        pfc.border=_border(); pfc.alignment=_center()

        cell(ws2, r, 13, tc["notes"], bg=bg)

    # ── test case summary at bottom
    sum_row = 4 + len(TEST_CASES) + 1
    banner(ws2, sum_row, 1, 13, "SUMMARY", bg=NAVY, fg="FFFFFF", size=11)
    ws2.row_dimensions[sum_row].height = 20

    total  = len(TEST_CASES)
    passed = sum(1 for tc in TEST_CASES if tc["pass_fail"]=="PASS")
    for strat in STRATEGIES:
        s_tcs    = [tc for tc in TEST_CASES if tc["strategy"]==strat["id"]]
        s_pass   = sum(1 for tc in s_tcs if tc["pass_fail"]=="PASS")
        s_pf     = "PASS" if s_pass==len(s_tcs) else "FAIL"
        s_pf_bg  = PASS_BG if s_pf=="PASS" else FAIL_BG
        s_pf_fg  = PASS_FG if s_pf=="PASS" else FAIL_FG
        r = sum_row + STRATEGIES.index(strat) + 1
        ws2.merge_cells(start_row=r, start_column=2, end_row=r, end_column=4)
        ws2.merge_cells(start_row=r, start_column=5, end_row=r, end_column=8)
        ws2.merge_cells(start_row=r, start_column=9, end_row=r, end_column=11)
        ws2.merge_cells(start_row=r, start_column=12, end_row=r, end_column=13)
        cell(ws2, r, 1,  STRATEGIES.index(strat)+1, bg=LIGHT_BLUE, h="center", bold=True)
        nc = ws2.cell(row=r, column=2,
                      value=f"{strat['id']} — {strat['name']}")
        nc.fill=_fill(LIGHT_BLUE); nc.font=_font(bold=True,color=NAVY); nc.border=_border(); nc.alignment=_center()
        cc = ws2.cell(row=r, column=5,
                      value=f"Test cases: {', '.join(strat['test_cases'])}  |  {s_pass}/{len(s_tcs)} passed")
        cc.fill=_fill(ALT1); cc.font=_font(); cc.border=_border(); cc.alignment=_center()
        rc = ws2.cell(row=r, column=9, value=f"Passed: {s_pass}  /  Failed: {len(s_tcs)-s_pass}")
        rc.fill=_fill(s_pf_bg); rc.font=_font(bold=True,color=s_pf_fg); rc.border=_border(); rc.alignment=_center()
        fc = ws2.cell(row=r, column=12, value=s_pf)
        fc.fill=_fill(s_pf_bg); fc.font=_font(bold=True,color=s_pf_fg,size=11); fc.border=_border(); fc.alignment=_center()

    # grand total row
    gt_row = sum_row + len(STRATEGIES) + 1
    ws2.merge_cells(start_row=gt_row, start_column=1, end_row=gt_row, end_column=11)
    ws2.merge_cells(start_row=gt_row, start_column=12, end_row=gt_row, end_column=13)
    gt_bg = PASS_BG if passed==total else FAIL_BG
    gt_fg = PASS_FG if passed==total else FAIL_FG
    gc = ws2.cell(row=gt_row, column=1,
                  value=f"GRAND TOTAL  |  {total} test cases  |  {passed} PASSED  |  {total-passed} FAILED")
    gc.fill=_fill(gt_bg); gc.font=_font(bold=True,color=gt_fg,size=11); gc.border=_border(); gc.alignment=_center()
    gf = ws2.cell(row=gt_row, column=12,
                  value="ALL PASSED" if passed==total else f"{total-passed} FAILED")
    gf.fill=_fill(gt_bg); gf.font=_font(bold=True,color=gt_fg,size=11); gf.border=_border(); gf.alignment=_center()

    # =========================================================================
    # Save
    # =========================================================================
    out = r"c:\Users\91814\vibe-match\SIT_d_calendar_445_Test_Strategy_v2.xlsx"
    wb.save(out)
    print(f"Saved: {out}")

if __name__ == "__main__":
    build()
