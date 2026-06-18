# Databricks notebook source
# MAGIC %md
# MAGIC # Retail 4-4-5 Calendar Builder (Databricks)
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
# MAGIC 1. **Anchor generation** — for each fiscal year, find the Saturday nearest to
# MAGIC    January 1. This may fall in late December of the prior year. The number of
# MAGIC    weeks in a fiscal year (52 or 53) is derived from the gap between consecutive
# MAGIC    anchors (364 days = 52 weeks; 371 days = 53 weeks).
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
                      Fiscal year anchors use the Saturday nearest to January 1
                      (standard retail convention). Weeks-in-year (52 or 53) are
                      derived automatically from the gap between consecutive anchors.
Input Parameters    : Schema and table configuration via Databricks widgets
Output              : d_calendar_445 — one row per calendar date with retail year,
                      retail month, retail week, and boundary date columns
Last changed on     : 17 June 2026
Last changed by     : ZS Associates
Reason for change   : Initial build
######################################################
"""

# COMMAND ----------

from datetime import date, timedelta
from pyspark.sql import functions as F
from pyspark.sql.window import Window
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
dbutils.widgets.text("lh_source_system_table_name",  "d_source_system")
dbutils.widgets.text("lh_calendar_table_name",       "d_calendar_445")
dbutils.widgets.text("run_id",                       "")

# COMMAND ----------

lh_catalog_name            = dbutils.widgets.get("lh_catalog_name")
lh_source_schema_name      = dbutils.widgets.get("lh_source_schema_name")
lh_source_table_name       = dbutils.widgets.get("lh_source_table_name")
lh_target_schema_name      = dbutils.widgets.get("lh_target_schema_name")
lh_target_table_name       = dbutils.widgets.get("lh_target_table_name")
lh_calendar_table_name     = dbutils.widgets.get("lh_calendar_table_name")
run_id                     = dbutils.widgets.get("run_id")

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
# MAGIC `FISCAL_YEAR_END_OVERRIDES` is a sparse deviation log for years where the
# MAGIC published fiscal calendar departs from the algorithm. Only the year-end date
# MAGIC is overridden — week counts and all downstream values recompute automatically.
# MAGIC Changing one year-end date fixes that year and its neighbour with no cascade.
# MAGIC
# MAGIC **Known deviation: fiscal 2012**
# MAGIC The algorithm gives Dec 28, 2012 as year-end for 2011, then Jan 4, 2013 for 2012
# MAGIC (making 2012 a 53-week year). The published calendar uses Dec 28, 2012 as the
# MAGIC year-end for 2012 instead (making 2012 a 52-week year and 2013 a 53-week year).
# MAGIC
# MAGIC How to add future overrides:
# MAGIC 1. Run the notebook and compare computed year-end to the published year-end.
# MAGIC 2. For any deviating year, add one entry: `{year: published_year_end_date}`.
# MAGIC 3. Re-run — the neighbouring year auto-corrects.

# COMMAND ----------

# ---------------------------------------------------------------------------
# Fiscal year-end override table
# ---------------------------------------------------------------------------
# Format:  { fiscal_year (int) : fiscal_year_end_date (date, always a Friday) }
#
# Add an entry only when the published calendar deviates from the
# "Friday nearest to Jan 1 of the next year" algorithm.
#
# Each entry fixes exactly one year-end date. Both the overridden year and
# the following year recompute their week counts automatically.
# ---------------------------------------------------------------------------
FISCAL_YEAR_END_OVERRIDES = {
    2012: date(2012, 12, 28),   # algorithm gives 2013-01-04 (53-wk 2012);
                                # published calendar uses 2012-12-28 (52-wk 2012, 53-wk 2013)
}


def fiscal_year_end(year):
    """
    Return the last day (Friday) of fiscal year `year`.

    Checks FISCAL_YEAR_END_OVERRIDES first. If an entry exists, that date
    is returned directly. Otherwise the standard rule is applied:
    the Friday nearest to January 1 of year+1.

    When January 1 of year+1 falls on a Saturday the nearest Friday is
    December 31; on a Sunday, December 30; these cases start the NEXT
    fiscal year in late December rather than early January.

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
# Year-end anchors drive everything:
#   - fy_end(Y-1) is computed first, then fiscal year Y runs from
#     [fy_end(Y-1) + 1 day] through [fy_end(Y)].
#   - weeks_in_year = (fy_end(Y) - fy_end(Y-1)).days // 7
#     364 days → 52 weeks, 371 days → 53 weeks.
#
# Need fy_end for (start_year - 1) through end_year to bracket all years.
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
    logger.info(f"  {yr}: {start_dt} → {end_dt}  ({wks} weeks)  [{source}]")

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
#   COUNT(DISTINCT week_445_end_date)  AS total_weeks,
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
# -- Expected: 0 rows (every year-end is exactly 1 day before the next year-start)
