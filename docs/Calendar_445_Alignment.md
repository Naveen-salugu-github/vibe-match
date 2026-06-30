# 4-4-5 Calendar Alignment — Problem, Root Cause & Solution

---

## Problem

When comparing monthly aggregations from our pipeline against other teams' reports, the **same week of sales data was being attributed to different months**.

For example:
- Week ending **December 2, 2016**
  - Our pipeline → **November 2016**
  - Other teams (test_1 / test_2) → **December 2016**

This caused monthly NSP factors, TRx projections, and SOB percentages to be **not comparable** across teams for affected periods.

### Affected periods
| Period | Weeks affected |
|---|---|
| December 2016 – November 2018 | 24 weeks |
| December 2022 – November 2024 | 24 weeks |
| **Total** | **48 weeks** |

Periods outside these windows were fully aligned (0 mismatches).

---

## Investigation

### Step 1 — Schema comparison
Our calendar (`r_calendar_445`) and the company standard (`445_test_1`, `445_test_2`) have different structures:

| | `r_calendar_445` | `445_test_1` / `445_test_2` |
|---|---|---|
| Grain | One row per **day** | One row per **week** |
| Week column | `week_445_end_date` | `Week_End` |
| Month column | `month_445_short_name` + `year_445_name` | `Month` (calendar month-end date) |

### Step 2 — Week count per year
Running a week count per fiscal year revealed a clear pattern:

| Year | Our weeks | test_2 weeks | Status |
|------|-----------|-------------|--------|
| 2011 | **53** | 52 | ⚠ Differ |
| 2013 | 52 | **53** | ⚠ Differ |
| 2016 | **53** | 52 | ⚠ Differ |
| 2018 | 52 | **53** | ⚠ Differ |
| 2022 | **53** | 52 | ⚠ Differ |
| 2024 | 52 | **53** | ⚠ Differ |
| All others | 52 | 52 | ✅ Same |

Both calendars have the same **total weeks** across any 6-year cycle — they just place the extra (53rd) week in different years.

### Step 3 — Fiscal year start dates
Querying the first week start date of each fiscal year confirmed the exact rule each calendar uses:

| Year | test_2 starts | Our starts | Same? |
|------|--------------|------------|-------|
| 2016 | Jan 2, 2016 | Jan 2, 2016 | ✅ |
| 2017 | **Dec 31, 2016** | Jan 7, 2017 | ❌ |
| 2018 | **Dec 30, 2017** | Jan 6, 2018 | ❌ |
| 2022 | Jan 1, 2022 | Jan 1, 2022 | ✅ |
| 2023 | **Dec 31, 2022** | Jan 7, 2023 | ❌ |
| 2024 | **Dec 30, 2023** | Jan 6, 2024 | ❌ |

The divergence happens specifically when **January 1 falls on a Sunday or Monday** — that's when the two rules pick different Saturdays.

---

## Root Cause

Both calendars are valid 4-4-5 implementations, but they use **different rules for picking the fiscal year start date**.

### Our `r_calendar_445`
> **Rule: First Saturday on or after January 1**

The fiscal year always starts in January. The 53rd week is absorbed when 52 weeks from the current start would still land inside the same calendar year.

### `445_test_1` / `445_test_2` (company standard — NRF convention)
> **Rule: Saturday nearest to January 1**

The fiscal year starts on whichever Saturday is closest to January 1. When January 1 falls on a Sunday or Monday, the nearest Saturday is in late December of the prior year — so the fiscal year starts in December.

### Why this causes a cascade
When our calendar adds a 53rd week to fiscal 2016:
1. Fiscal 2016 becomes 53 weeks long in our calendar, 52 in test_2
2. Our November 2016 absorbs the extra week → ends December 2, 2016 (5 weeks)
3. test_2 November 2016 has 4 weeks → ends November 25, 2016
4. The week of November 26 – December 2 is **November in ours**, **December in test_2**
5. Every subsequent month is offset by 1 until test_2's next 53-week year re-syncs them (~2 years later)

### The self-correction
The two calendars alternate 53-week years. When test_2 gets its 53-week year (2013, 2018, 2024), it absorbs the extra week the same way, re-aligning both calendars. This is why the drift is always temporary (~2 years) and why 2025–2026 are fully aligned.

---

## Solution

### Option chosen: Rebuild calendar using NRF rule

A new notebook `r_calendar_445_adjusted_test2_style.py` was created. It is identical to the original except for **one change** — the anchor generation logic in Cell 11.

#### What changed

**Original logic (Cell 11):**
```python
# Walk forward 364 days; add 53rd week if candidate lands in same calendar year
anchors = [(anchor_dt.year, anchor_dt)]
while anchors[-1][0] <= end_year:
    yr, strt = anchors[-1]
    candidate = strt + timedelta(days=364)
    next_strt = strt + timedelta(days=371 if candidate.year == yr else 364)
    anchors.append((yr + 1, next_strt))
```

**New logic (Cell 11 in adjusted file):**
```python
def nearest_sat_to_jan1(year):
    """Saturday nearest to January 1 — NRF 4-4-5 standard."""
    jan1 = date(year, 1, 1)
    dow = jan1.weekday()           # Mon=0 … Sat=5, Sun=6
    days_back = (dow - 5) % 7     # days back to previous Saturday
    days_fwd  = (5 - dow) % 7     # days forward to next Saturday
    if days_back <= days_fwd:
        return jan1 - timedelta(days=days_back)
    return jan1 + timedelta(days=days_fwd)

# One anchor per year — derived directly, not walked forward
anchors = [(yr, nearest_sat_to_jan1(yr)) for yr in range(start_year, end_year + 2)]

# weeks_in_year comes from gap between consecutive anchors (364→52, 371→53)
year_rows = [
    (yr, strt, anchors[i+1][1] - timedelta(days=1), (anchors[i+1][1] - strt).days // 7)
    for i, (yr, strt) in enumerate(anchors[:-1])
]
```

#### What did NOT change
- 4-4-5 month assignment (weeks 1–4 = Jan, 5–8 = Feb, … 44–47/48 = Nov, rest = Dec)
- November absorbs the extra week in 53-week years (`nov_cutoff = 48`)
- All output columns and schema
- Write logic

---

## Verification queries

After running the adjusted notebook, validate with these two queries:

```sql
-- Query 1: Fiscal year starts and week counts should all show OK
WITH adj AS (
  SELECT DISTINCT year_445_name AS yr,
    MIN(week_445_start_date) AS adj_start,
    COUNT(DISTINCT week_445_end_date) AS adj_weeks
  FROM us_comm_lakehouse_dev.gold_dimensions.r_calendar_445_adjusted_test2_style
  GROUP BY year_445_name
),
t2 AS (
  SELECT Year AS yr,
    MIN(Week_End) - INTERVAL 6 DAYS AS t2_start,
    COUNT(DISTINCT Week_End) AS t2_weeks
  FROM us_comm_lakehouse_dev.gold_dimensions.445_test_2
  GROUP BY Year
)
SELECT a.yr, a.adj_start, a.adj_weeks, t.t2_start, t.t2_weeks,
  CASE WHEN a.adj_start = t.t2_start AND a.adj_weeks = t.t2_weeks
       THEN 'OK' ELSE '*** MISMATCH ***' END AS status
FROM adj a JOIN t2 t ON a.yr = t.yr
ORDER BY a.yr;
```

```sql
-- Query 2: Month assignment mismatches — should return 0 rows
WITH adj_weekly AS (
  SELECT DISTINCT week_445_end_date AS week_end,
    CONCAT(year_445_name, '-',
      CASE month_445_short_name
        WHEN 'Jan' THEN '01' WHEN 'Feb' THEN '02' WHEN 'Mar' THEN '03'
        WHEN 'Apr' THEN '04' WHEN 'May' THEN '05' WHEN 'Jun' THEN '06'
        WHEN 'Jul' THEN '07' WHEN 'Aug' THEN '08' WHEN 'Sep' THEN '09'
        WHEN 'Oct' THEN '10' WHEN 'Nov' THEN '11' WHEN 'Dec' THEN '12'
      END) AS adj_yr_mnth
  FROM us_comm_lakehouse_dev.gold_dimensions.r_calendar_445_adjusted_test2_style
)
SELECT a.week_end, a.adj_yr_mnth,
  SUBSTRING(CAST(t2.Month AS STRING), 1, 7) AS t2_yr_mnth
FROM adj_weekly a
JOIN us_comm_lakehouse_dev.gold_dimensions.445_test_2 t2 ON a.week_end = t2.Week_End
WHERE a.adj_yr_mnth <> SUBSTRING(CAST(t2.Month AS STRING), 1, 7)
ORDER BY a.week_end;
-- Expected: 0 rows
```

---

## Summary

| | Detail |
|---|---|
| **Problem** | 48 weeks in 2016–2018 and 2022–2024 assigned to wrong month |
| **Root cause** | Two different fiscal year-start rules: "first Saturday ≥ Jan 1" vs "Saturday nearest to Jan 1" |
| **Impact** | Monthly NSP factors, TRx projections, SOB % not comparable with other teams for affected periods |
| **Current data (2025+)** | Fully aligned — no action needed for live pipeline |
| **Fix** | New file `r_calendar_445_adjusted_test2_style.py` — one function changed, everything else identical |
| **Next trigger** | Without the fix, next drift would occur around 2027–2028 |
