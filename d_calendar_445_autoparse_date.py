# Databricks notebook source
# MAGIC %md
# MAGIC # Retail 4-4-5 Calendar Builder
# MAGIC
# MAGIC ## What this notebook does
# MAGIC Builds a **retail 4-4-5 fiscal calendar** dimension table from a standard
# MAGIC source calendar (`d_calendar_day`) and writes it to a target Delta table.
# MAGIC
# MAGIC The 4-4-5 calendar is a retail accounting convention where each quarter is
# MAGIC split into two 4-week months and one 5-week month (4 + 4 + 5 = 13 weeks per
# MAGIC quarter, 52 weeks per year). Every 5–6 years a 53rd week is added to keep the
# MAGIC fiscal calendar aligned with the solar year; that extra week is absorbed by
# MAGIC November in the 4-4-5 grouping.
# MAGIC
# MAGIC ## Steps
# MAGIC 1. **Anchor generation** — for each fiscal year, compute the Friday nearest to
# MAGIC    January 1 of the following year. That Friday is the fiscal year-end.
# MAGIC    The fiscal year start is always the day after the prior year-end.
# MAGIC    Weeks-in-year (52 or 53) fall out automatically from the gap between
# MAGIC    consecutive year-end Fridays (364 days = 52 weeks; 371 days = 53 weeks).
# MAGIC 2. **Stamp each calendar day** with its retail year, the retail-year anchor,
# MAGIC    and its `week_in_yr` (1..52 or 1..53).
# MAGIC 3. **4-4-5 month assignment** — bucket each week into one of 12 retail months
# MAGIC    using fixed week cutoffs. November absorbs the extra week in 53-week years.
# MAGIC 4. **Derive month + week boundaries** (Saturday start / Friday end).
# MAGIC 5. **Week-of-month** — rank weeks within each standard calendar month.
# MAGIC 6. **Final projection** into the published schema and write.
# MAGIC 7. **QC checks** — verify 52/53-week totals, 12 months per year, Sat–Fri weeks.

# COMMAND ----------

__author__ = 'ZS Associates'
"""
######################################################
Module Information
######################################################
Table Name          : d_calendar_445
Purpose             : Builds a retail 4-4-5 fiscal calendar dimension table.
                      Fiscal year ends are determined by the Friday nearest to
                      January 1 of the following year (NRF standard). A sparse
                      override table handles known deviations from this rule.
                      Overrides are loaded at runtime from a CSV config file —
                      no hardcoded values in this notebook.
                      Weeks-in-year (52 or 53) are derived automatically from
                      the gap between consecutive year-end Fridays.
Input Parameters    : Schema and table configuration via Databricks widgets.
                      Override CSV path via widget "override_csv_path".
Output              : d_calendar_445 — one row per calendar date with retail year,
                      retail month, retail week, and boundary date columns
Last changed on     : 22 June 2026
Last changed by     : ZS Associates
Reason for change   : Override table now loaded from CSV config (autoparse_date)
######################################################
"""

# COMMAND ----------

from datetime import date, timedelta
from pyspark.sql import functions as F
from pyspark.sql.window import Window
import csv
import logging
import sys

# COMMAND ----------

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
handler = logging.StreamHandler(sys.stdout)
formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
handler.setFormatter(formatter)
if not logger.handlers:
    logger.addHandler(handler)

# COMMAND ----------

dbutils.widgets.text("lh_catalog_name",             "us_comm_lakehouse_dev")
dbutils.widgets.text("lh_source_schema_name",        "gold_dimensions")
dbutils.widgets.text("lh_source_table_name",         "d_calendar_day")
dbutils.widgets.text("lh_target_schema_name",        "gold_dimensions")
dbutils.widgets.text("lh_target_table_name",         "d_calendar_445")
dbutils.widgets.text("lh_calendar_table_name",       "d_calendar_445")
dbutils.widgets.text("run_id",                       "")
dbutils.widgets.text("override_csv_path",
                     "/Volumes/us_commercial_catalog_prod/lgu_lupus/ad_hoc/fiscal_year_overrides.csv")

# COMMAND ----------

lh_catalog_name            = dbutils.widgets.get("lh_catalog_name")
lh_source_schema_name      = dbutils.widgets.get("lh_source_schema_name")
lh_source_table_name       = dbutils.widgets.get("lh_source_table_name")
lh_target_schema_name      = dbutils.widgets.get("lh_target_schema_name")
lh_target_table_name       = dbutils.widgets.get("lh_target_table_name")
lh_calendar_table_name     = dbutils.widgets.get("lh_calendar_table_name")
run_id                     = dbutils.widgets.get("run_id")
override_csv_path          = dbutils.widgets.get("override_csv_path")

# COMMAND ----------

source_calendar_df = (
    spark
    .table(f"{lh_catalog_name}.{lh_source_schema_name}.{lh_source_table_name}")
    .filter(F.col("active_indicator") == "Y")
)

run_id = dbutils.widgets.get("run_id")

# COMMAND ----------

# MAGIC %md
# MAGIC ### 1. Generate retail-year anchors
# MAGIC
# MAGIC #### Base rule
# MAGIC Every fiscal year ends on the **Friday nearest to January 1 of the following year**.
# MAGIC The fiscal year start is always the day after the previous year's end.
# MAGIC Weeks run in 7-day blocks (Saturday → Friday) from that start date.
# MAGIC
# MAGIC #### Why 53-week years emerge automatically
# MAGIC A 52-week year is 364 days — 1 day short of a normal year. That shortfall
# MAGIC accumulates until the nearest Friday to the next January 1 sits a full week
# MAGIC later than 364 days, giving a 53-week year. No explicit decision is made:
# MAGIC weeks-in-year = gap between consecutive year-end Fridays / 7.
# MAGIC If the gap is 364 days → 52 weeks. If 371 days → 53 weeks.
# MAGIC
# MAGIC #### Override mechanism
# MAGIC `FISCAL_YEAR_END_OVERRIDES` is loaded at runtime from a CSV config file.
# MAGIC The CSV has two columns: `year` (int) and `year_end_date` (YYYYMMDD string).
# MAGIC Only the year-end date is overridden — week counts and all downstream values
# MAGIC recompute automatically. To add a future override, add one row to the CSV
# MAGIC and re-run. No code change needed.
# MAGIC
# MAGIC **CSV format example:**
# MAGIC ```
# MAGIC year,year_end_date
# MAGIC 2012,20121228
# MAGIC ```
# MAGIC
# MAGIC **Known deviation: fiscal 2012**
# MAGIC Without override: algorithm gives `2013-01-04` as fiscal 2012 year-end → 53-week 2012.
# MAGIC Published calendar uses `2012-12-28` → 52-week 2012, 53-week 2013.

# COMMAND ----------

def load_fiscal_year_end_overrides(csv_path):
    """
    Read a CSV config file and return a dict of fiscal year-end overrides.

    CSV format (two columns, header required):
        year,year_end_date
        2012,20121228

    Column rules:
      - year          : 4-digit integer fiscal year (e.g. 2012)
      - year_end_date : date in YYYYMMDD format (e.g. 20121228)
                        Must always be a Friday (the last day of that fiscal year).

    Returns:
        dict[int, date]  e.g. {2012: date(2012, 12, 28)}

    Skips blank lines and lines where either column is empty.
    Raises ValueError for any row that cannot be parsed.
    """
    overrides = {}

    with open(csv_path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)

        for line_num, row in enumerate(reader, start=2):   # start=2: row 1 is header
            raw_year     = row.get("year", "").strip()
            raw_date     = row.get("year_end_date", "").strip()

            if not raw_year and not raw_date:
                continue                                    # skip blank rows

            if not raw_year or not raw_date:
                raise ValueError(
                    f"Line {line_num}: both 'year' and 'year_end_date' are required. "
                    f"Got year={raw_year!r}, year_end_date={raw_date!r}"
                )

            # Parse year
            try:
                fiscal_year = int(raw_year)
            except ValueError:
                raise ValueError(
                    f"Line {line_num}: 'year' must be a 4-digit integer, got {raw_year!r}"
                )

            # Parse year_end_date — accepts YYYYMMDD (8 digits, no separators)
            if len(raw_date) != 8 or not raw_date.isdigit():
                raise ValueError(
                    f"Line {line_num}: 'year_end_date' must be YYYYMMDD (8 digits), "
                    f"got {raw_date!r}"
                )
            yr  = int(raw_date[0:4])
            mon = int(raw_date[4:6])
            day = int(raw_date[6:8])

            try:
                end_date = date(yr, mon, day)
            except ValueError as exc:
                raise ValueError(
                    f"Line {line_num}: 'year_end_date' {raw_date!r} is not a valid "
                    f"calendar date — {exc}"
                )

            overrides[fiscal_year] = end_date
            logger.info(
                f"  Override loaded: fiscal {fiscal_year} -> year-end {end_date} "
                f"(parsed from '{raw_date}')"
            )

    return overrides


logger.info(f"Loading fiscal year-end overrides from: {override_csv_path}")
FISCAL_YEAR_END_OVERRIDES = load_fiscal_year_end_overrides(override_csv_path)
logger.info(f"Overrides loaded: {len(FISCAL_YEAR_END_OVERRIDES)} entries — {FISCAL_YEAR_END_OVERRIDES}")

# COMMAND ----------

def fiscal_year_end(year):
    """
    Return the last day (Friday) of fiscal year `year`.

    Checks FISCAL_YEAR_END_OVERRIDES first. If an entry exists, that date
    is returned directly. Otherwise the standard rule is applied:
    the Friday nearest to January 1 of year+1.

    The override value must be a Friday (the year-end date), NOT the year-start.

    Python weekday: Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6
    """
    if year in FISCAL_YEAR_END_OVERRIDES:
        return FISCAL_YEAR_END_OVERRIDES[year]

    jan1      = date(year + 1, 1, 1)   # January 1 of the NEXT calendar year
    dow       = jan1.weekday()
    days_back = (dow - 4) % 7          # days to the previous (or same) Friday
    days_fwd  = (4 - dow) % 7          # days to the next (or same) Friday
    if days_back <= days_fwd:
        return jan1 - timedelta(days=days_back)
    return jan1 + timedelta(days=days_fwd)


# Derive fiscal year range from the source calendar
start_year = (
    source_calendar_df
    .agg(F.min(F.col("calendar_year_number").cast("int")).alias("min_yr"))
    .first()[0]
)
end_year = (
    source_calendar_df
    .agg(F.max(F.col("calendar_year_number").cast("int")).alias("max_yr"))
    .first()[0]
)

# Build fiscal year rows: (year, start_date, end_date, weeks_in_year)
#
# fiscal year Y runs from [fiscal_year_end(Y-1) + 1 day] through [fiscal_year_end(Y)].
# weeks = (fiscal_year_end(Y) - fiscal_year_end(Y-1)).days // 7
# 364 days -> 52 weeks, 371 days -> 53 weeks.
fiscal_year_rows = []
for yr in range(start_year, end_year + 1):
    yr_end_date   = fiscal_year_end(yr)
    prev_end_date = fiscal_year_end(yr - 1)
    yr_start_date = prev_end_date + timedelta(days=1)
    weeks         = (yr_end_date - prev_end_date).days // 7
    fiscal_year_rows.append((yr, yr_start_date, yr_end_date, weeks))

retail_years_df = spark.createDataFrame(
    fiscal_year_rows,
    schema="rtl_yr INT, rtl_yr_strt_dt DATE, rtl_yr_end_dt DATE, weeks_in_yr INT"
)

# COMMAND ----------

# Log fiscal year anchors — mark which years used an override
logger.info("Fiscal year end dates (year-end anchor):")
for yr, start_dt, end_dt, wks in fiscal_year_rows[:20]:
    source = "OVERRIDE" if yr in FISCAL_YEAR_END_OVERRIDES else "computed"
    logger.info(f"  {yr}: {start_dt} -> {end_dt}  ({wks} weeks)  [{source}]")

# COMMAND ----------

# MAGIC %md
# MAGIC ### 2. Stamp each calendar day with retail year and week number

# COMMAND ----------

cal_assigned_df = (
    source_calendar_df.alias("c")
    .join(
        retail_years_df.alias("ry"),
        (F.col("c.calendar_date") >= F.col("ry.rtl_yr_strt_dt")) &
        (F.col("c.calendar_date") <= F.col("ry.rtl_yr_end_dt")),
        "inner"
    )
    .select(
        "c.calendar_date_id",
        "c.calendar_date",
        "c.calendar_date_description",
        "c.calendar_year_number",
        "c.month_start_date",
        "c.month_end_date",
        "c.month_short_name",
        "c.month_long_name",
        "c.week_start_date",
        "c.week_end_date",
        "ry.rtl_yr",
        "ry.rtl_yr_strt_dt",
        "ry.rtl_yr_end_dt",
        "ry.weeks_in_yr",
        ((F.datediff(F.col("c.calendar_date"), F.col("ry.rtl_yr_strt_dt")) / 7).cast("int") + 1).alias("week_in_yr"),
    )
)

# COMMAND ----------

# MAGIC %md
# MAGIC ### 3. 4-4-5 month assignment
# MAGIC
# MAGIC Each week is assigned to one of 12 retail months using fixed week-number cutoffs.
# MAGIC In a 53-week year November receives an extra week (cutoff shifts from 47 to 48).
# MAGIC
# MAGIC ```
# MAGIC 52-week year:  Q4 = Oct(40-43)  Nov(44-47)  Dec(48-52)
# MAGIC 53-week year:  Q4 = Oct(40-43)  Nov(44-48)  Dec(49-53)
# MAGIC ```

# COMMAND ----------

nov_cutoff = F.when(F.col("weeks_in_yr") == 53, F.lit(48)).otherwise(F.lit(47))

cal_445_df = (
    cal_assigned_df.withColumn(
        "month_445_num",
        F.when(F.col("week_in_yr") <=  4,  1)   # Jan: weeks  1-4
         .when(F.col("week_in_yr") <=  8,  2)   # Feb: weeks  5-8
         .when(F.col("week_in_yr") <= 13,  3)   # Mar: weeks  9-13
         .when(F.col("week_in_yr") <= 17,  4)   # Apr: weeks 14-17
         .when(F.col("week_in_yr") <= 21,  5)   # May: weeks 18-21
         .when(F.col("week_in_yr") <= 26,  6)   # Jun: weeks 22-26
         .when(F.col("week_in_yr") <= 30,  7)   # Jul: weeks 27-30
         .when(F.col("week_in_yr") <= 34,  8)   # Aug: weeks 31-34
         .when(F.col("week_in_yr") <= 39,  9)   # Sep: weeks 35-39
         .when(F.col("week_in_yr") <= 43, 10)   # Oct: weeks 40-43
         .when(F.col("week_in_yr") <= nov_cutoff, 11)  # Nov: weeks 44-47/48
         .otherwise(12),                         # Dec: weeks 48/49-52/53
    )
    .withColumn(
        "week_445_start_date",
        F.expr("date_add(rtl_yr_strt_dt, (week_in_yr - 1) * 7)")
    )
    .withColumn(
        "week_445_end_date",
        F.expr("date_add(rtl_yr_strt_dt, week_in_yr * 7 - 1)")
    )
)

# COMMAND ----------

# MAGIC %md
# MAGIC ### 4. Derive 4-4-5 month boundaries

# COMMAND ----------

month_445_df = (
    cal_445_df
    .groupBy("rtl_yr", "month_445_num")
    .agg(
        F.min("calendar_date").alias("month_445_start_date"),
        F.max("calendar_date").alias("month_445_end_date"),
    )
    .orderBy("rtl_yr", "month_445_num")
)

# COMMAND ----------

# MAGIC %md
# MAGIC ### 5. Week-of-month (calendar-aligned)

# COMMAND ----------

week_of_month_df = (
    source_calendar_df
    .select("month_start_date", "week_start_date")
    .distinct()
    .orderBy("month_start_date", "week_start_date")
    .withColumn(
        "week_of_month",
        F.dense_rank().over(
            Window.partitionBy("month_start_date").orderBy("week_start_date")
        )
    )
)

# COMMAND ----------

# MAGIC %md
# MAGIC ### 6. Final projection

# COMMAND ----------

MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
MONTH_LONG  = ['January', 'February', 'March', 'April', 'May', 'June',
               'July', 'August', 'September', 'October', 'November', 'December']

calendar_445_df = (
    cal_445_df.alias("c")
    .join(
        month_445_df.alias("m"),
        (F.col("c.rtl_yr")        == F.col("m.rtl_yr")) &
        (F.col("c.month_445_num") == F.col("m.month_445_num")),
        "left"
    )
    .join(
        week_of_month_df.alias("wom"),
        (F.col("c.month_start_date") == F.col("wom.month_start_date")) &
        (F.col("c.week_start_date")  == F.col("wom.week_start_date")),
        "left"
    )
    .select(
        F.col("c.calendar_date_id").alias("calendar_date_identifier"),
        F.col("c.calendar_date").alias("calendar_date"),
        F.col("c.calendar_date_description").alias("calendar_date_description"),
        F.col("c.month_short_name").alias("month_calendar_short_name"),
        F.col("c.month_long_name").alias("month_calendar_long_name"),
        F.col("c.month_start_date").alias("month_calendar_start_date"),
        F.col("c.month_end_date").alias("month_calendar_end_date"),
        F.col("c.calendar_year_number").alias("year_calendar_name"),
        F.col("wom.week_of_month"),
        F.element_at(F.array(*[F.lit(n) for n in MONTH_SHORT]), F.col("c.month_445_num")).alias("month_445_short_name"),
        F.element_at(F.array(*[F.lit(n) for n in MONTH_LONG]),  F.col("c.month_445_num")).alias("month_445_long_name"),
        F.col("m.month_445_start_date"),
        F.col("m.month_445_end_date"),
        F.col("c.rtl_yr").alias("year_445_name"),
        F.col("c.week_445_start_date"),
        F.col("c.week_445_end_date"),
        F.col("c.week_in_yr").alias("week_in_445_year"),
        F.date_format(F.col("c.calendar_date"), "EEE").alias("day_of_week_short_name"),
        F.lit("").alias("run_id"),
        F.current_timestamp().alias("ins_dt"),
    )
    .distinct()
)

# COMMAND ----------

final_df = calendar_445_df.select(
    "calendar_date_identifier",
    "calendar_date",
    "calendar_date_description",
    "week_of_month",
    "month_calendar_short_name",
    "month_calendar_long_name",
    "month_calendar_start_date",
    "month_calendar_end_date",
    "year_calendar_name",
    "month_445_short_name",
    "month_445_long_name",
    "month_445_start_date",
    "month_445_end_date",
    "year_445_name",
    "week_445_start_date",
    "week_445_end_date",
    "week_in_445_year",
    "day_of_week_short_name",
    "run_id",
    "ins_dt",
)

# COMMAND ----------

# MAGIC %md
# MAGIC ### 7. Write target table

# COMMAND ----------

final_df.write.mode("overwrite").saveAsTable(
    f"{lh_catalog_name}.{lh_target_schema_name}.{lh_target_table_name}"
)
logger.info(f"Completed: {lh_target_table_name} written successfully.")

# COMMAND ----------

# MAGIC %md
# MAGIC ### 8. QC checks — run after writing

# COMMAND ----------

# %sql
# -- Check 1: All fiscal years have exactly 52 or 53 weeks, and 12 retail months
# SELECT
#   year_445_name,
#   COUNT(DISTINCT week_445_end_date)    AS total_weeks,
#   COUNT(DISTINCT month_445_short_name) AS total_months
# FROM us_comm_lakehouse_dev.gold_dimensions.d_calendar_445
# GROUP BY year_445_name
# HAVING total_weeks NOT IN (52, 53) OR total_months <> 12
# ORDER BY year_445_name;
# -- Expected: 0 rows

# COMMAND ----------

# %sql
# -- Check 2: All weeks start on Saturday and end on Friday
# SELECT week_445_start_date, week_445_end_date,
#   DAYOFWEEK(week_445_start_date) AS start_dow,   -- 7 = Saturday
#   DAYOFWEEK(week_445_end_date)   AS end_dow       -- 6 = Friday
# FROM us_comm_lakehouse_dev.gold_dimensions.d_calendar_445
# WHERE DAYOFWEEK(week_445_start_date) <> 7
#    OR DAYOFWEEK(week_445_end_date)   <> 6
# LIMIT 10;
# -- Expected: 0 rows

# COMMAND ----------

# %sql
# -- Check 3: No gaps or overlaps between consecutive fiscal years
# WITH year_bounds AS (
#   SELECT DISTINCT
#     year_445_name            AS yr,
#     MIN(week_445_start_date) AS yr_start,
#     MAX(week_445_end_date)   AS yr_end
#   FROM us_comm_lakehouse_dev.gold_dimensions.d_calendar_445
#   GROUP BY year_445_name
# )
# SELECT a.yr, a.yr_end AS this_ends, b.yr_start AS next_starts,
#   DATEDIFF(b.yr_start, a.yr_end) AS gap_days
# FROM year_bounds a
# JOIN year_bounds b ON b.yr = a.yr + 1
# WHERE DATEDIFF(b.yr_start, a.yr_end) <> 1
# ORDER BY a.yr;
# -- Expected: 0 rows
