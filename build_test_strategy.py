"""
Generates SIT_d_calendar_445_Test_Strategy.xlsx
Run: python build_test_strategy.py
"""

from openpyxl import Workbook
from openpyxl.styles import (
    PatternFill, Font, Alignment, Border, Side, GradientFill
)
from openpyxl.utils import get_column_letter
from openpyxl.formatting.rule import CellIsRule

# ── colour palette ──────────────────────────────────────────────────────────
C_HEADER_BG   = "1F3864"   # dark navy
C_HEADER_FG   = "FFFFFF"
C_CFG_BG      = "D9E1F2"   # light blue
C_CFG_LABEL   = "1F3864"
C_SECTION_BG  = "2E75B6"   # mid blue
C_SECTION_FG  = "FFFFFF"
C_ALT1        = "EBF3FB"   # alternating row tint
C_ALT2        = "FFFFFF"
C_PASS_BG     = "C6EFCE"   # green
C_PASS_FG     = "276221"
C_FAIL_BG     = "FFC7CE"   # red
C_FAIL_FG     = "9C0006"
C_MEDIUM_BG   = "FFEB9C"   # amber
C_MEDIUM_FG   = "9C6500"
C_BORDER      = "B8CCE4"

def fill(hex_):
    return PatternFill("solid", fgColor=hex_)

def font(bold=False, color="000000", size=10, italic=False):
    return Font(bold=bold, color=color, size=size, italic=italic,
                name="Calibri")

def border():
    s = Side(style="thin", color=C_BORDER)
    return Border(left=s, right=s, top=s, bottom=s)

def center(wrap=False):
    return Alignment(horizontal="center", vertical="center",
                     wrap_text=wrap)

def left(wrap=True):
    return Alignment(horizontal="left", vertical="top",
                     wrap_text=wrap)

def apply_header(ws, row, col, value, bg=C_HEADER_BG, fg=C_HEADER_FG,
                 bold=True, size=10, wrap=True):
    c = ws.cell(row=row, column=col, value=value)
    c.fill    = fill(bg)
    c.font    = font(bold=bold, color=fg, size=size)
    c.border  = border()
    c.alignment = center(wrap=wrap)
    return c

def apply_cell(ws, row, col, value, bg=C_ALT2, bold=False,
               align="left", size=10, fg="000000"):
    c = ws.cell(row=row, column=col, value=value)
    c.fill      = fill(bg)
    c.font      = font(bold=bold, color=fg, size=size)
    c.border    = border()
    c.alignment = left() if align == "left" else center(wrap=True)
    return c

# ── SQL snippets (shortened for the Excel cell; full SQL in SIT .py) ────────
SQLS = {
    "DC-01": (
        "df = spark.table('<catalog>.<schema>.d_calendar_445')\n"
        "null_counts_df = df.select([\n"
        "  sum(when(col(c).isNull(),1).otherwise(0)).alias(c)\n"
        "  for c in df.columns])\n"
        "display(null_counts_df)"
    ),
    "DC-02": (
        "SELECT\n"
        "  date_format(week_445_start_date,'EEE') AS week_start_dow,\n"
        "  date_format(week_445_end_date,  'EEE') AS week_end_dow,\n"
        "  COUNT(*) AS row_ct\n"
        "FROM <catalog>.<schema>.d_calendar_445\n"
        "GROUP BY 1, 2"
    ),
    "DC-03": (
        "SELECT DISTINCT\n"
        "  week_445_start_date,\n"
        "  week_445_end_date,\n"
        "  DAYOFWEEK(week_445_start_date) AS start_dow,\n"
        "  DAYOFWEEK(week_445_end_date)   AS end_dow\n"
        "FROM <catalog>.<schema>.d_calendar_445\n"
        "WHERE DAYOFWEEK(week_445_start_date) <> 7\n"
        "   OR DAYOFWEEK(week_445_end_date)   <> 6"
    ),
    "DC-04": (
        "SELECT year_445_name,\n"
        "  COUNT(DISTINCT week_445_end_date)    AS total_weeks,\n"
        "  COUNT(DISTINCT month_445_short_name) AS total_months\n"
        "FROM <catalog>.<schema>.d_calendar_445\n"
        "GROUP BY year_445_name\n"
        "HAVING total_weeks NOT IN (52,53) OR total_months <> 12"
    ),
    "DC-05": (
        "WITH year_bounds AS (\n"
        "  SELECT year_445_name AS yr,\n"
        "    MIN(week_445_start_date) AS yr_start,\n"
        "    MAX(week_445_end_date)   AS yr_end\n"
        "  FROM <catalog>.<schema>.d_calendar_445\n"
        "  GROUP BY year_445_name)\n"
        "SELECT a.yr, a.yr_end, b.yr_start,\n"
        "  DATEDIFF(b.yr_start, a.yr_end) AS gap_days\n"
        "FROM year_bounds a\n"
        "JOIN year_bounds b ON b.yr = a.yr + 1\n"
        "WHERE DATEDIFF(b.yr_start, a.yr_end) <> 1"
    ),
    "DC-06": (
        "SELECT\n"
        "  MAX(year_445_name)-MIN(year_445_name)+1 AS expected_years,\n"
        "  COUNT(DISTINCT year_445_name)           AS actual_years,\n"
        "  CASE WHEN MAX(year_445_name)-MIN(year_445_name)+1\n"
        "            = COUNT(DISTINCT year_445_name)\n"
        "       THEN 'PASS' ELSE 'FAIL' END AS year_range_check\n"
        "FROM <catalog>.<schema>.d_calendar_445"
    ),
    "DC-07": (
        "SELECT\n"
        "  DATEDIFF(MAX(calendar_date),MIN(calendar_date))+1 AS expected_days,\n"
        "  COUNT(DISTINCT calendar_date)                     AS actual_days,\n"
        "  CASE WHEN DATEDIFF(MAX(calendar_date),MIN(calendar_date))+1\n"
        "            = COUNT(DISTINCT calendar_date)\n"
        "       THEN 'PASS' ELSE 'FAIL' END AS date_spine_check\n"
        "FROM <catalog>.<schema>.d_calendar_445"
    ),
    "DC-08": (
        "SELECT COUNT(*) AS row_count, 'A' AS label\n"
        "FROM <catalog>.<schema>.d_calendar_445\n"
        "UNION ALL\n"
        "SELECT COUNT(*) AS row_count, 'B' AS label\n"
        "FROM (SELECT DISTINCT * FROM <catalog>.<schema>.d_calendar_445) t\n"
        "ORDER BY label"
    ),
    "DC-09": (
        "SELECT calendar_date_identifier, calendar_date,\n"
        "  year_445_name, month_445_long_name,\n"
        "  month_445_start_date, month_445_end_date,\n"
        "  week_in_445_year, week_445_start_date,\n"
        "  week_445_end_date, COUNT(*)\n"
        "FROM <catalog>.<schema>.d_calendar_445\n"
        "GROUP BY calendar_date_identifier, calendar_date,\n"
        "  year_445_name, month_445_long_name,\n"
        "  month_445_start_date, month_445_end_date,\n"
        "  week_in_445_year, week_445_start_date,\n"
        "  week_445_end_date\n"
        "HAVING COUNT(*) > 1"
    ),
}

# ── master test-case definition ──────────────────────────────────────────────
TEST_CASES = [
    {
        "id":         "DC-01",
        "category":   "Completeness",
        "name":       "Null Check",
        "objective":  "No NULL values in any of the 20 columns.",
        "type":       "PySpark",
        "expected":   "All 20 columns return 0",
        "actual":     "All 20 columns = 0",
        "pass_fail":  "PASS",
        "priority":   "High",
        "notes":      "Does not catch empty strings or sentinel values (e.g. -1, 9999).",
    },
    {
        "id":         "DC-02",
        "category":   "Consistency",
        "name":       "Week DOW Sanity (String)",
        "objective":  "Every week starts on Saturday and ends on Friday (string format).",
        "type":       "SQL",
        "expected":   "1 row: [Sat, Fri, 9496]",
        "actual":     "1 row: [Sat, Fri, 9496]",
        "pass_fail":  "PASS",
        "priority":   "Medium",
        "notes":      "Locale-dependent (English locale assumed). Informational — DC-03 is authoritative.",
    },
    {
        "id":         "DC-03",
        "category":   "Consistency",
        "name":       "Week Boundary Integrity (Numeric DOW)",
        "objective":  "Every week starts on Saturday (DAYOFWEEK=7) and ends on Friday (DAYOFWEEK=6).",
        "type":       "SQL",
        "expected":   "0 rows",
        "actual":     "0 rows",
        "pass_fail":  "PASS",
        "priority":   "High",
        "notes":      "Locale-independent. Preferred over DC-02.",
    },
    {
        "id":         "DC-04",
        "category":   "Structural Integrity",
        "name":       "Fiscal Year Week & Month Count",
        "objective":  "Every fiscal year has exactly 52 or 53 weeks and exactly 12 months.",
        "type":       "SQL",
        "expected":   "0 rows",
        "actual":     "0 rows",
        "pass_fail":  "PASS",
        "priority":   "High",
        "notes":      "Recommend COUNT(DISTINCT month_445_start_date) instead of short_name to avoid abbreviation collision.",
    },
    {
        "id":         "DC-05",
        "category":   "Structural Integrity",
        "name":       "No Gaps Between Fiscal Years",
        "objective":  "Each fiscal year ends exactly 1 day before the next starts.",
        "type":       "SQL",
        "expected":   "0 rows",
        "actual":     "0 rows",
        "pass_fail":  "PASS",
        "priority":   "High",
        "notes":      "Works in tandem with DC-06. DC-06 confirms all years present; DC-05 confirms no day-level gaps.",
    },
    {
        "id":         "DC-06",
        "category":   "Completeness",
        "name":       "Fiscal Year Range Completeness",
        "objective":  "All fiscal years from MIN to MAX are present — no missing years.",
        "type":       "SQL",
        "expected":   "expected_years = actual_years → PASS",
        "actual":     "26 = 26 → PASS",
        "pass_fail":  "PASS",
        "priority":   "High",
        "notes":      "Complements DC-05. Together they guarantee full fiscal year continuity.",
    },
    {
        "id":         "DC-07",
        "category":   "Completeness",
        "name":       "Date Spine Completeness",
        "objective":  "Every calendar day from MIN to MAX calendar_date is present.",
        "type":       "SQL",
        "expected":   "expected_days = actual_days → PASS",
        "actual":     "9496 = 9496 → PASS",
        "pass_fail":  "PASS",
        "priority":   "High",
        "notes":      "Strongest completeness check. Implicitly confirms calendar_date is the natural PK.",
    },
    {
        "id":         "DC-08",
        "category":   "Uniqueness",
        "name":       "Full-Row Duplicate Check",
        "objective":  "Total row count equals count of fully distinct rows (all 20 columns).",
        "type":       "SQL",
        "expected":   "A = B (both counts equal)",
        "actual":     "A = 9496, B = 9496",
        "pass_fail":  "PASS",
        "priority":   "High",
        "notes":      "Add ORDER BY label to improve audit readability.",
    },
    {
        "id":         "DC-09",
        "category":   "Uniqueness",
        "name":       "Key-Based Duplicate Check",
        "objective":  "No duplicate rows on the 9-column composite business key.",
        "type":       "SQL",
        "expected":   "0 rows",
        "actual":     "0 rows",
        "pass_fail":  "PASS",
        "priority":   "High",
        "notes":      "Diagnostic locator when DC-08 fails. DC-07 implicitly confirms calendar_date as natural PK.",
    },
]

# ── recommendations ──────────────────────────────────────────────────────────
RECS = [
    ("DC-04",  "Medium", "Replace COUNT(DISTINCT month_445_short_name) with COUNT(DISTINCT month_445_start_date)",
     "Abbreviation collision could mask month-count violations"),
    ("New DC-10", "Medium", "Add range validation: year_445_name BETWEEN 2000 AND 2030; week_in_445_year BETWEEN 1 AND 53",
     "Sentinel values (-1, 9999) pass null checks but corrupt weekly TRx/NRx aggregations"),
    ("New DC-11", "Medium", "Add empty-string check: TRIM(col) = '' on all string columns",
     "Empty strings are not NULL but are semantically invalid"),
    ("DC-08",  "Low",    "Add ORDER BY label to UNION ALL output",
     "Improves audit trail readability"),
    ("DC-02",  "Low",    "Demote to informational / non-blocking; DC-03 is authoritative",
     "Locale-dependency risk in CI/CD pipelines"),
]


def build_excel(out_path):
    wb = Workbook()
    ws = wb.active
    ws.title = "Test Strategy"

    # =========================================================================
    # TITLE BLOCK  (rows 1-3)
    # =========================================================================
    ws.merge_cells("A1:L1")
    title = ws["A1"]
    title.value     = "SIT Test Strategy — d_calendar_445"
    title.fill      = fill(C_HEADER_BG)
    title.font      = font(bold=True, color=C_HEADER_FG, size=16)
    title.alignment = center()

    meta = [
        ("B2", "Table Under Test",  "us_comm_lakehouse_dev.gold_dimensions.d_calendar_445"),
        ("B3", "Reviewed By",       "ZS Associates — DQ / ETL Architect"),
        ("F2", "Review Date",       "2026-06-23"),
        ("F3", "Total Test Cases",  "9"),
        ("I2", "Overall Status",    "✅ ALL 9 PASSED"),
        ("I3", "SIT Sign-Off",      "✅ APPROVED FOR PRODUCTION"),
    ]
    for cell_ref, label, value in meta:
        r = int(cell_ref[1:])
        c = ord(cell_ref[0]) - 64
        ws.cell(row=r, column=c, value=label).font   = font(bold=True, size=10, color=C_CFG_LABEL)
        ws.cell(row=r, column=c, value=label).fill   = fill(C_CFG_BG)
        ws.cell(row=r, column=c, value=label).border = border()
        ws.cell(row=r, column=c+1, value=value).font   = font(size=10)
        ws.cell(row=r, column=c+1, value=value).fill   = fill(C_ALT1)
        ws.cell(row=r, column=c+1, value=value).border = border()

    # =========================================================================
    # CONFIG BLOCK  (rows 5-10)
    # =========================================================================
    ws.merge_cells("A5:L5")
    sec = ws["A5"]
    sec.value     = "⚙  CONFIGURATION  —  Change values below to point at your environment"
    sec.fill      = fill(C_SECTION_BG)
    sec.font      = font(bold=True, color=C_SECTION_FG, size=11)
    sec.alignment = left(wrap=False)
    sec.border    = border()

    cfg_rows = [
        ("Catalog Name",        "us_comm_lakehouse_dev",
         "Catalog Name (UAT)",  "us_comm_lakehouse_uat"),
        ("Source Schema",       "gold_dimensions",
         "Target Schema",       "gold_dimensions"),
        ("Table Name",          "d_calendar_445",
         "Override CSV Path",   "/Volumes/.../fiscal_year_overrides.csv"),
        ("SIT Environment",     "DEV",
         "Run Triggered By",    "ZS Associates"),
        ("Expected Row Count",  "9496",
         "Expected Fiscal Years","26"),
    ]
    cfg_hdr_row = 6   # column-header row for config block
    cfg_start   = 7   # first data row for config block

    for col_idx, hdr_val in [(1,"Parameter"),(2,"Value (DEV)"),(4,"Parameter"),(5,"Value (UAT)")]:
        c = ws.cell(row=cfg_hdr_row, column=col_idx, value=hdr_val)
        c.fill   = fill(C_CFG_BG)
        c.font   = font(bold=True, color=C_CFG_LABEL)
        c.border = border()

    for i, (p1, v1, p2, v2) in enumerate(cfg_rows):
        r = cfg_start + i
        bg = C_ALT1 if i % 2 == 0 else C_ALT2
        for col_, val_, is_label in [(1,p1,True),(2,v1,False),(4,p2,True),(5,v2,False)]:
            c = ws.cell(row=r, column=col_, value=val_)
            c.fill      = fill(C_CFG_BG) if is_label else fill(bg)
            c.font      = font(bold=is_label, color=C_CFG_LABEL if is_label else "000000")
            c.border    = border()
            c.alignment = left(wrap=False)

    # =========================================================================
    # COLUMN HEADERS  (row 12)
    # =========================================================================
    COLS = [
        ("A", 10,  "#"),
        ("B", 14,  "Test Case ID"),
        ("C", 22,  "Category"),
        ("D", 30,  "Test Case Name"),
        ("E", 55,  "Test Objective"),
        ("F", 14,  "Type"),
        ("G", 14,  "Priority"),
        ("H", 55,  "SQL / Code"),
        ("I", 35,  "Expected Result"),
        ("J", 35,  "Actual Result"),
        ("K", 14,  "Pass / Fail"),
        ("L", 55,  "Observations / Notes"),
    ]
    TC_HDR_ROW = cfg_start + len(cfg_rows) + 1   # one blank row gap then headers
    for col_letter, width, header in COLS:
        col_idx = ord(col_letter) - 64
        ws.column_dimensions[col_letter].width = width
        apply_header(ws, TC_HDR_ROW, col_idx, header)

    ws.row_dimensions[TC_HDR_ROW].height = 30
    ws.freeze_panes = f"B{TC_HDR_ROW + 1}"

    # =========================================================================
    # TEST CASE ROWS
    # =========================================================================
    DATA_START = TC_HDR_ROW + 1
    for i, tc in enumerate(TEST_CASES):
        r   = DATA_START + i
        bg  = C_ALT1 if i % 2 == 0 else C_ALT2
        ws.row_dimensions[r].height = 80

        apply_cell(ws, r, 1,  i+1,            bg=bg, align="center")
        apply_cell(ws, r, 2,  tc["id"],        bg=bg, bold=True, align="center")
        apply_cell(ws, r, 3,  tc["category"],  bg=bg, align="center")
        apply_cell(ws, r, 4,  tc["name"],      bg=bg, bold=True)
        apply_cell(ws, r, 5,  tc["objective"], bg=bg)
        apply_cell(ws, r, 6,  tc["type"],      bg=bg, align="center")
        apply_cell(ws, r, 7,  tc["priority"],  bg=bg, align="center")

        # SQL cell — monospace-ish
        sql_cell = ws.cell(row=r, column=8,
                           value=SQLS.get(tc["id"], ""))
        sql_cell.fill      = fill("F2F2F2")
        sql_cell.font      = Font(name="Courier New", size=8, color="1F3864")
        sql_cell.border    = border()
        sql_cell.alignment = Alignment(horizontal="left", vertical="top",
                                       wrap_text=True)

        apply_cell(ws, r, 9,  tc["expected"],  bg=bg)
        apply_cell(ws, r, 10, tc["actual"],    bg=bg)

        # Pass/Fail cell — coloured
        pf = tc["pass_fail"]
        pf_bg = C_PASS_BG if pf == "PASS" else C_FAIL_BG
        pf_fg = C_PASS_FG if pf == "PASS" else C_FAIL_FG
        pf_cell = ws.cell(row=r, column=11, value=pf)
        pf_cell.fill      = fill(pf_bg)
        pf_cell.font      = font(bold=True, color=pf_fg, size=11)
        pf_cell.border    = border()
        pf_cell.alignment = center()

        apply_cell(ws, r, 12, tc["notes"], bg=bg)

    # =========================================================================
    # SUMMARY SECTION
    # =========================================================================
    sum_row = DATA_START + len(TEST_CASES) + 1

    ws.merge_cells(f"A{sum_row}:L{sum_row}")
    sr = ws[f"A{sum_row}"]
    sr.value     = "SUMMARY"
    sr.fill      = fill(C_SECTION_BG)
    sr.font      = font(bold=True, color=C_SECTION_FG, size=12)
    sr.alignment = center()
    sr.border    = border()

    passed = sum(1 for tc in TEST_CASES if tc["pass_fail"] == "PASS")
    failed = len(TEST_CASES) - passed

    summary_data = [
        ("Total Test Cases",    len(TEST_CASES)),
        ("Passed",              passed),
        ("Failed",              failed),
        ("Overall Result",
         "✅ ALL PASSED — APPROVED FOR PRODUCTION" if failed == 0
         else f"❌ {failed} FAILED — REVIEW REQUIRED"),
    ]
    for j, (label, value) in enumerate(summary_data):
        r   = sum_row + 1 + j
        bg  = C_PASS_BG if label == "Passed" else (
              C_FAIL_BG if label == "Failed"  else C_ALT1)
        ws.merge_cells(f"C{r}:F{r}")
        ws.merge_cells(f"G{r}:L{r}")
        lc = ws.cell(row=r, column=3, value=label)
        lc.fill      = fill(C_CFG_BG)
        lc.font      = font(bold=True, color=C_CFG_LABEL)
        lc.border    = border()
        lc.alignment = left(wrap=False)
        vc = ws.cell(row=r, column=7, value=value)
        vc.fill      = fill(bg)
        vc.font      = font(bold=(label == "Overall Result"), size=10)
        vc.border    = border()
        vc.alignment = left(wrap=False)

    # =========================================================================
    # RECOMMENDATIONS SECTION
    # =========================================================================
    rec_title_row = sum_row + 1 + len(summary_data) + 1

    ws.merge_cells(f"A{rec_title_row}:L{rec_title_row}")
    rt = ws[f"A{rec_title_row}"]
    rt.value     = "RECOMMENDATIONS  (non-blocking — next sprint)"
    rt.fill      = fill(C_SECTION_BG)
    rt.font      = font(bold=True, color=C_SECTION_FG, size=11)
    rt.alignment = center()
    rt.border    = border()

    rec_hdr = rec_title_row + 1
    for col_, hdr in [(1,"#"),(2,"Applies To"),(3,"Priority"),
                      (4,"Recommendation"),(8,"Pharma Impact")]:
        apply_header(ws, rec_hdr, col_, hdr, bg="2E75B6")
    ws.merge_cells(f"D{rec_hdr}:G{rec_hdr}")
    ws.merge_cells(f"H{rec_hdr}:L{rec_hdr}")

    for k, (applies, priority, rec, impact) in enumerate(RECS):
        r   = rec_hdr + 1 + k
        bg  = C_MEDIUM_BG if priority == "Medium" else C_ALT1
        ws.row_dimensions[r].height = 40
        apply_cell(ws, r, 1, k+1,      bg=bg, align="center")
        apply_cell(ws, r, 2, applies,  bg=bg, align="center")
        pr_cell = ws.cell(row=r, column=3, value=priority)
        pr_cell.fill      = fill(C_MEDIUM_BG if priority=="Medium" else C_ALT1)
        pr_cell.font      = font(bold=True,
                                 color=C_MEDIUM_FG if priority=="Medium" else "276221")
        pr_cell.border    = border()
        pr_cell.alignment = center(wrap=True)
        ws.merge_cells(f"D{r}:G{r}")
        ws.merge_cells(f"H{r}:L{r}")
        apply_cell(ws, r, 4, rec,    bg=bg)
        apply_cell(ws, r, 8, impact, bg=bg)

    # ── tab colour ───────────────────────────────────────────────────────────
    ws.sheet_properties.tabColor = "1F3864"

    wb.save(out_path)
    print(f"Saved: {out_path}")


if __name__ == "__main__":
    build_excel(r"c:\Users\91814\vibe-match\SIT_d_calendar_445_Test_Strategy.xlsx")
