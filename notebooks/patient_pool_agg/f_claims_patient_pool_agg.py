# Databricks notebook source
# DBTITLE 1,Imports & Logger
__author__ = 'ZS Associates'

# ######################################################
# Notebook           : f_claims_patient_pool_agg
# Purpose            : Build patient-level Line of Therapy (LoT) aggregated table
#                      by reading from the base patient pool table (f_claims_patient_pool),
#                      computing distinct ACTIVE drug classes within a config-driven
#                      per-patient lookback window, then mapping class count ->
#                      therapy_subset (1L / 2L / 3L / 4L+).
#
#                      LOT = concurrent active therapy snapshot, NOT cumulative
#                      lifetime history. A patient currently on 2 classes is 2L
#                      regardless of how many classes they have ever tried.
#
# Input              : f_claims_patient_pool  (base patient pool table)
#                      d_claim_pat            (longitudinal flag dimension)
#                      config_claims_patient_pool (config table)
#
# Output             : f_claims_patient_pool_aggregated
#                      Grain : ONE row per patient per workstream
#                      Columns: workstream | patient_id | patient_pool_desc | therapy_subset
#
# Design (per Excel Design tab -- Claims Pat Pool):
#
#   Patient Universe:
#     - From f_claims_patient_pool filter for configured workstream and Treatment pool
#       [config-driven via lot_class_filter]
#     - Intersect with diagnosed patients from the same base table (Diagnosis pool)
#       [config-driven via dx_intersection_filter + dx_pool_filter]
#
#   Filter:
#     - Must be a longitudinal patient (pat_longitudinal_use_flg = 'Y')
#
#   LoT Calculation (per patient):
#     - 105-day lookback from most_recent_date (config-driven via lot_lookback)
#     - Each patient_pool active in the window counts as 1 class
#     - Mapping (config-driven via lot_label_mapping):
#         1  -> 1L
#         2  -> 2L
#         3  -> 3L
#         >4 -> 4L+
#
# Key differences from prior split-based version (f_patient_pool_agg_v3):
#   - Input changed from temporary_f_claims_patient_pool_universe_split_* tables
#     to the pre-built f_claims_patient_pool base table.
#   - Claim eligibility (claim_dspn / claim_sta) and source deduplication steps
#     are removed -- base table already contains only valid, paid, finalised data.
#   - most_recent_date (per patient per pool) replaces service_date for all
#     lookback and window computations.
#   - target_table_name default updated to f_claims_patient_pool_aggregated.
# ######################################################

import sys
import logging
from pyspark.sql import functions as F
from pyspark.sql.functions import (
    col, lit, when, coalesce, broadcast,
    countDistinct, max as spark_max,
    current_date, expr, upper, current_timestamp,
)
from functools import reduce
import datetime

logger = logging.getLogger("f_claims_patient_pool_agg")
logger.setLevel(logging.INFO)
if not logger.hasHandlers():
    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.INFO)
    ch.setFormatter(logging.Formatter('%(asctime)s %(levelname)s: %(message)s'))
    logger.addHandler(ch)

logger.info("f_claims_patient_pool_agg -- Dependencies imported and logger initialized.")

# COMMAND ----------

dbutils.widgets.removeAll()

# COMMAND ----------

# DBTITLE 1,Widget Defaults
# ==============================================================================
# WIDGET DEFAULTS -- for local / interactive runs
# Override via workflow parameters in production
# ==============================================================================

dbutils.widgets.text("catalog_name",      "us_comm_lakehouse_dev")
dbutils.widgets.text("gold_claim_schema", "gold_claims")
dbutils.widgets.text("config_table",      "config_claims_patient_pool")
dbutils.widgets.text("dim_patient_table", "d_claim_pat")
# Base patient pool table produced by f_claims_patient_pool notebook
dbutils.widgets.text("base_table_name",   "f_claims_patient_pool")
dbutils.widgets.text("target_table_name", "f_claims_patient_pool_aggregated")
dbutils.widgets.text("run_id",            "123321")

# COMMAND ----------

# DBTITLE 1,Read Widgets
catalog_name      = dbutils.widgets.get("catalog_name")
gold_claim_schema = dbutils.widgets.get("gold_claim_schema")
config_table      = dbutils.widgets.get("config_table")
dim_patient_table = dbutils.widgets.get("dim_patient_table")
base_table_name   = dbutils.widgets.get("base_table_name")
target_table_name = dbutils.widgets.get("target_table_name")
run_id            = dbutils.widgets.get("run_id")

# COMMAND ----------

# DBTITLE 1,Log Parameters
logger.info(f"catalog_name      = {catalog_name}")
logger.info(f"gold_claim_schema = {gold_claim_schema}")
logger.info(f"config_table      = {config_table}")
logger.info(f"dim_patient_table = {dim_patient_table}")
logger.info(f"base_table_name   = {base_table_name}")
logger.info(f"target_table_name = {target_table_name}")
logger.info(f"run_id            = {run_id}")

run_ts = current_timestamp()

# COMMAND ----------

# DBTITLE 1,Step 1 -- Read Process Config & Extract LoT Parameters
# ==============================================================================
# READ PROCESS CONFIG FROM CONFIG TABLE
#
# parameter_description values consumed by this notebook:
#
#   lot_enablement         -- workstream on/off flag            (parameter1 = 'Y'/'N')
#   lot_class_filter       -- treatment patient_pool values for LoT
#                             flex_value = patient_pool | parameter1 = patient_pool_desc
#                             attr1 = 'mx - dx' signals the diagnosis cohort path
#   lot_lookback           -- per-patient active therapy window in DAYS   (parameter1)
#                             Default: 105 days if absent
#   lookback_filter        -- global data scope in MONTHS       (rule_filter_value)
#                             Absence = NO date filter (not a default)
#   dx_intersection_filter -- 'Y' means patient must appear in BOTH treatment + diagnosis pool
#                             (parameter1 = 'Y'/'N')
#   dx_pool_filter         -- patient_pool_desc values identifying the diagnosis pool
#                             flex_value = patient_pool_desc to match
#   lot_label_mapping      -- active_class_count -> therapy_subset label
#                             flex_value = class count | parameter1 = label
#                             rule_filter_value = 'eq' or 'gte'
#
# Single .collect() per config type; all downstream derivations driven from these maps.
# ==============================================================================

try:
    logger.info(f"Step 1: Reading config: {catalog_name}.{gold_claim_schema}.{config_table}")

    temp_full_config_df = (
        spark.read.table(f"{catalog_name}.{gold_claim_schema}.{config_table}")
        .filter(col("table") == target_table_name)
    )

    # --------------------------------------------------------------------------
    # Enabled workstreams (lot_enablement = 'Y')
    # --------------------------------------------------------------------------
    enabled_workstream_rows = (
        temp_full_config_df
        .filter(
            (col("parameter_description") == "lot_enablement") &
            (upper(col("parameter1")) == "Y")
        )
        .select("workstream")
        .distinct()
        .collect()
    )

    workstreams = [r["workstream"] for r in enabled_workstream_rows]

    if not workstreams:
        raise ValueError(
            "No enabled workstreams found (lot_enablement = 'Y'). "
            "Verify config table for this table_name."
        )

    logger.info(f"Enabled workstreams: {workstreams}")

    seed_df = temp_full_config_df.filter(col("workstream").isin(workstreams))

    # --------------------------------------------------------------------------
    # lot_lookback -- per-patient active therapy window in DAYS
    # Sourced from parameter1; 105-day default applied at join time (Step 8).
    # --------------------------------------------------------------------------
    lot_lookback_rows = (
        seed_df
        .filter(col("parameter_description") == "lot_lookback")
        .select("workstream", col("parameter1").cast("int").alias("lot_lookback_days"))
        .collect()
    )
    lot_lookback_map = {r["workstream"]: r["lot_lookback_days"] for r in lot_lookback_rows}

    if not lot_lookback_map:
        logger.warning(
            "No lot_lookback config rows found. "
            "105-day default will be applied for all workstreams."
        )

    logger.info(f"lot_lookback_map (workstream -> days): {lot_lookback_map}")

    # --------------------------------------------------------------------------
    # lookback_filter -- global data scope in MONTHS
    # Sourced from rule_filter_value. KEY RULE: absence = NO date filter.
    # --------------------------------------------------------------------------
    lookback_filter_rows = (
        seed_df
        .filter(col("parameter_description") == "lookback_filter")
        .select("workstream", col("rule_filter_value").cast("int").alias("lookback_months"))
        .collect()
    )
    lookback_filter_map = {r["workstream"]: r["lookback_months"] for r in lookback_filter_rows}
    workstreams_with_no_lookback = [ws for ws in workstreams if ws not in lookback_filter_map]

    logger.info(f"lookback_filter_map (workstream -> months): {lookback_filter_map}")
    if workstreams_with_no_lookback:
        logger.warning(
            f"No lookback_filter config for {workstreams_with_no_lookback} -- "
            "ALL history will pass through for these workstreams (no date filter)."
        )

    # --------------------------------------------------------------------------
    # lot_class_filter -- treatment patient_pool -> patient_pool_desc mapping
    # flex_value = patient_pool | parameter1 = patient_pool_desc
    # --------------------------------------------------------------------------
    lot_class_config_df = (
        seed_df
        .filter(col("parameter_description") == "lot_class_filter")
        .select(
            col("workstream"),
            col("flex_value").alias("patient_pool"),
            col("parameter1").alias("patient_pool_desc"),
        )
    )

    valid_pools_rows = lot_class_config_df.select("workstream", "patient_pool").collect()
    valid_pools_df   = spark.createDataFrame(valid_pools_rows, ["workstream", "patient_pool"])

    # --------------------------------------------------------------------------
    # dx_intersection_filter -- workstreams requiring treated+diagnosed rule
    # --------------------------------------------------------------------------
    dx_intersection_rows = (
        seed_df
        .filter(col("parameter_description") == "dx_intersection_filter")
        .select("workstream", upper(col("parameter1")).alias("dx_intersection"))
        .collect()
    )
    dx_intersection_workstreams = [
        r["workstream"] for r in dx_intersection_rows if r["dx_intersection"] == "Y"
    ]
    logger.info(f"dx_intersection_workstreams: {dx_intersection_workstreams}")

    # --------------------------------------------------------------------------
    # dx_pool_filter -- diagnosis pool patient_pool_desc values per workstream
    # --------------------------------------------------------------------------
    dx_pool_rows = (
        seed_df
        .filter(col("parameter_description") == "dx_pool_filter")
        .select(col("workstream"), col("flex_value").alias("dx_patient_pool_desc"))
        .collect()
    )
    dx_pool_map = {}
    for r in dx_pool_rows:
        dx_pool_map.setdefault(r["workstream"], []).append(r["dx_patient_pool_desc"])

    # --------------------------------------------------------------------------
    # dx_path_workstreams -- workstreams using mx-dx (diagnosis cohort) path
    # attr1 = 'mx - dx' in config signals these workstreams produce diagnosis
    # cohort rows instead of LoT rows.
    # --------------------------------------------------------------------------
    dx_path_rows = (
        seed_df
        .filter(
            (col("parameter_description") == "lot_class_filter") &
            (upper(col("attr1")) == "MX - DX")
        )
        .select("workstream")
        .distinct()
        .collect()
    )
    dx_path_workstreams = [r["workstream"] for r in dx_path_rows]
    rx_path_workstreams = [ws for ws in workstreams if ws not in dx_path_workstreams]

    logger.info(f"rx_path_workstreams (LoT path)          : {rx_path_workstreams}")
    logger.info(f"dx_path_workstreams (Diagnosis Cohort)  : {dx_path_workstreams}")

    # --------------------------------------------------------------------------
    # lot_label_mapping -- active_class_count -> therapy_subset label
    # flex_value = class count | parameter1 = label | rule_filter_value = 'eq'/'gte'
    # Fallback: 1->1L, 2->2L, 3->3L, >=4->4L+
    # --------------------------------------------------------------------------
    lot_label_rows = (
        seed_df
        .filter(col("parameter_description") == "lot_label_mapping")
        .select(
            col("workstream"),
            col("flex_value").cast("int").alias("class_count"),
            col("parameter1").alias("therapy_label"),
            col("rule_filter_value").alias("match_type"),
        )
        .orderBy("workstream", "class_count")
        .collect()
    )
    lot_label_map = {}
    for r in lot_label_rows:
        lot_label_map.setdefault(r["workstream"], []).append(
            (r["class_count"], r["therapy_label"], r["match_type"])
        )

    if lot_label_map:
        logger.info(f"lot_label_map loaded from config: {lot_label_map}")
    else:
        logger.warning(
            "No lot_label_mapping rows found in config. "
            "Step 10 will fall back to hardcoded default (1->1L, 2->2L, 3->3L, 4+->4L+)."
        )

    logger.info("Step 1: Process config loaded successfully.")

except Exception as e:
    logger.error(f"Failed reading process config.\nError: {str(e)}")
    raise RuntimeError(f"Failed reading process config.\nError: {str(e)}")

# COMMAND ----------

# DBTITLE 1,Step 2 -- Read Base Patient Pool Table (f_claims_patient_pool)
# ==============================================================================
# READ FROM f_claims_patient_pool (base patient pool table)
#
# This table is pre-built by the f_claims_patient_pool notebook and contains
# ONE ROW PER (workstream, patient_id, patient_pool) with aggregated date fields:
#   most_recent_date -- latest service date for the patient in that pool
#   first_date       -- earliest service date for the patient in that pool
#
# Claim eligibility (claim_dspn / claim_sta) and source deduplication are NOT
# repeated here -- the base table already contains only valid, paid, finalised
# claim data that has been deduplicated across sources.
#
# Columns selected for downstream LoT computation:
#   workstream, patient_id, patient_pool, patient_pool_desc, most_recent_date
# ==============================================================================

try:
    logger.info(
        f"Step 2: Reading base patient pool table: "
        f"{catalog_name}.{gold_claim_schema}.{base_table_name}"
    )

    base_table = f"{catalog_name}.{gold_claim_schema}.{base_table_name}"

    base_pool_df = (
        spark.read.table(base_table)
        .select(
            col("workstream"),
            col("patient_id"),
            col("patient_pool"),
            col("patient_pool_desc"),
            col("most_recent_date"),
        )
        .filter(col("workstream").isin(workstreams))
    )

    base_pool_df.createOrReplaceTempView("vw_base_patient_pool")
    logger.info("Step 2: Base patient pool table loaded into temp view 'vw_base_patient_pool'.")

except Exception as e:
    logger.error(f"Failed at Step 2 (reading base table).\nError: {str(e)}")
    raise RuntimeError(f"Failed at Step 2 (reading base table).\nError: {str(e)}")

# COMMAND ----------

# DBTITLE 1,Step 3 -- Treatment Pool Filter (Workstream + Patient Pool)
# ==============================================================================
# FILTER TO TREATMENT POOLS as defined in lot_class_filter config.
#
# Inner join with valid_pools_df ensures only patient_pool values that are
# configured as treatment pools for a given workstream are retained.
#
# NOTE: Unlike the prior split-based version, there is NO claim eligibility
# filter (claim_dspn / claim_sta) and NO source filter or deduplication step
# here. The f_claims_patient_pool base table has already handled all of these.
# ==============================================================================

try:
    logger.info("Step 3: Applying workstream and treatment pool (lot_class_filter) filter.")

    temp_treatment_df = (
        spark.table("vw_base_patient_pool")
        .join(broadcast(valid_pools_df), on=["workstream", "patient_pool"], how="inner")
    )

    logger.info("Step 3: Treatment pool filter applied.")

except Exception as e:
    logger.error(f"Failed at Step 3 (treatment pool filter).\nError: {str(e)}")
    raise RuntimeError(f"Failed at Step 3 (treatment pool filter).\nError: {str(e)}")

# COMMAND ----------

# DBTITLE 1,Step 4 -- Inner Join Longitudinal Flag (d_claim_pat)
# ==============================================================================
# INNER JOIN d_claim_pat ON pat_longitudinal_use_flg = 'Y'
#
# Per design: "Must be a longitudinal patient (pat_longitudinal_use_flg = 'Y')"
# Patients absent from the dimension table or flagged 'N' are excluded entirely.
# ==============================================================================

try:
    logger.info("Step 4: Filtering to longitudinal patients via d_claim_pat inner join.")

    dim_pat_df = (
        spark.read.table(f"{catalog_name}.{gold_claim_schema}.{dim_patient_table}")
        .filter(upper(col("pat_longitudinal_use_flg")) == "Y")
        .select("patient_id")
        .distinct()
    )

    temp_longitudinal_df = (
        temp_treatment_df
        .join(broadcast(dim_pat_df), on="patient_id", how="inner")
    )

    logger.info("Step 4: Longitudinal patient filter applied.")

except Exception as e:
    logger.error(f"Failed at Step 4 (longitudinal join).\nError: {str(e)}")
    raise RuntimeError(f"Failed at Step 4 (longitudinal join).\nError: {str(e)}")

# COMMAND ----------

# DBTITLE 1,Step 5 -- Diagnosis Pool Intersection Filter (config-driven)
# ==============================================================================
# "Treated AND Diagnosed" business requirement (per design):
#   "Filter the above universe with distinct list of diagnosed patients from
#    workstream=HTN and patient pool='Diagnosis' from the base table
#    [Intersection of patients from second pool]"
#
# For workstreams configured with dx_intersection_filter = 'Y':
#   A patient must appear in BOTH:
#     (a) the treatment pool (retained from Step 3)
#     (b) the diagnosis pool in f_claims_patient_pool
#         (identified by patient_pool_desc values in dx_pool_filter config)
#
# Diagnosis pool patients are sourced directly from the base patient pool table,
# filtering on the configured diagnosis pool descriptors (e.g. 'Diagnosis Cohort').
# ==============================================================================

try:
    if dx_intersection_workstreams:
        logger.info(
            f"Step 5: Applying treated+diagnosed intersection for: {dx_intersection_workstreams}"
        )

        intersection_parts = []

        for ws in dx_intersection_workstreams:
            dx_desc_values = dx_pool_map.get(ws, [])
            if not dx_desc_values:
                logger.warning(
                    f"dx_intersection_filter = 'Y' for workstream '{ws}' but no "
                    "dx_pool_filter config rows found -- skipping intersection for this workstream."
                )
                intersection_parts.append(
                    temp_longitudinal_df.filter(col("workstream") == ws)
                )
                continue

            # Distinct diagnosed patient_ids from the base table for this workstream
            dx_patients_df = (
                spark.read.table(f"{catalog_name}.{gold_claim_schema}.{base_table_name}")
                .filter(col("workstream") == ws)
                .filter(col("patient_pool_desc").isin(dx_desc_values))
                .select("patient_id")
                .distinct()
            )

            # Inner join: keep only treatment rows for patients who are also diagnosed
            ws_intersected_df = (
                temp_longitudinal_df
                .filter(col("workstream") == ws)
                .join(broadcast(dx_patients_df), on="patient_id", how="inner")
            )

            logger.info(
                f"  Intersection applied for '{ws}' using dx_pool_desc: {dx_desc_values}"
            )
            intersection_parts.append(ws_intersected_df)

        # Workstreams not requiring intersection pass through unchanged
        non_intersection_ws = [ws for ws in workstreams if ws not in dx_intersection_workstreams]
        if non_intersection_ws:
            intersection_parts.append(
                temp_longitudinal_df.filter(col("workstream").isin(non_intersection_ws))
            )

        temp_longitudinal_df = reduce(lambda a, b: a.unionByName(b), intersection_parts)
        logger.info("Step 5: Diagnosis pool intersection filter complete.")

    else:
        logger.info("Step 5: No workstreams require dx intersection filter -- skipping.")

except Exception as e:
    logger.error(f"Failed at Step 5 (dx intersection filter).\nError: {str(e)}")
    raise RuntimeError(f"Failed at Step 5 (dx intersection filter).\nError: {str(e)}")

# COMMAND ----------

# DBTITLE 1,Step 6 -- Diagnosis Cohort Path (mx - dx workstreams)
# ==============================================================================
# For workstreams where attr1 = 'mx - dx' in config (dx_path_workstreams):
#   These do NOT go through LoT calculation (Steps 7-10).
#   Instead, each distinct patient in the diagnosis pool is output with:
#     therapy_subset    = NULL  (no LoT -- this is a diagnosis cohort row)
#     patient_pool_desc = as sourced from the base table / config
#
# The diagnosis cohort rows collected here are unioned into the final output
# at Step 12 alongside LoT rows.
# ==============================================================================

try:
    if dx_path_workstreams:
        logger.info(f"Step 6: Building diagnosis cohort rows for: {dx_path_workstreams}")

        dx_cohort_df = (
            temp_longitudinal_df
            .filter(col("workstream").isin(dx_path_workstreams))
            .select("workstream", "patient_id", "patient_pool_desc")
            .distinct()
            .withColumn("therapy_subset", lit(None).cast("string"))
        )

        logger.info(f"Step 6: Diagnosis cohort rows prepared for {dx_path_workstreams}.")
    else:
        dx_cohort_df = None
        logger.info("Step 6: No mx-dx workstreams configured -- diagnosis path skipped.")

    # Scope LoT pipeline to rx-path workstreams only from this point forward
    if rx_path_workstreams:
        temp_longitudinal_df = temp_longitudinal_df.filter(
            col("workstream").isin(rx_path_workstreams)
        )
    else:
        logger.warning(
            "No rx_path_workstreams after separating dx path -- LoT steps will be empty."
        )

except Exception as e:
    logger.error(f"Failed at Step 6 (diagnosis cohort path).\nError: {str(e)}")
    raise RuntimeError(f"Failed at Step 6 (diagnosis cohort path).\nError: {str(e)}")

# COMMAND ----------

# DBTITLE 1,Step 7 -- Global Scope Window (lookback_filter months, config-driven)
# ==============================================================================
# APPLY CONFIG-DRIVEN GLOBAL SCOPE WINDOW
#
# For each rx_path_workstream:
#   - If lookback_filter config exists, retain only rows where
#     most_recent_date >= current_date - lookback_months
#   - If absent, pass all history through (no date filter)
#
# Using most_recent_date (latest service date per patient per pool) from the
# base table instead of individual service_date rows.
#
# KEY RULE: absence of config row = NO date filter, not a 36-month default.
# ==============================================================================

try:
    logger.info("Step 7: Applying config-driven global scope window (lookback_filter).")

    ws_with_lookback    = [ws for ws in rx_path_workstreams if ws     in lookback_filter_map]
    ws_without_lookback = [ws for ws in rx_path_workstreams if ws not in lookback_filter_map]

    filtered_parts = []

    if ws_with_lookback:
        lookback_rows_list = [(ws, lookback_filter_map[ws]) for ws in ws_with_lookback]
        lookback_df = spark.createDataFrame(
            lookback_rows_list, ["workstream", "lookback_months"]
        )
        filtered_with_lookback = (
            temp_longitudinal_df
            .filter(col("workstream").isin(ws_with_lookback))
            .join(broadcast(lookback_df), on="workstream", how="inner")
            .filter(
                col("most_recent_date") >= expr("add_months(current_date(), -lookback_months)")
            )
            .drop("lookback_months")
        )
        filtered_parts.append(filtered_with_lookback)

    if ws_without_lookback:
        logger.warning(
            f"Workstreams {ws_without_lookback} have no lookback_filter config -- "
            "passing full history through (no date filter)."
        )
        filtered_parts.append(
            temp_longitudinal_df.filter(col("workstream").isin(ws_without_lookback))
        )

    if not filtered_parts:
        logger.warning(
            "No rx_path data to process through lookback filter -- LoT output will be empty."
        )
        temp_date_scoped_df = spark.createDataFrame([], temp_longitudinal_df.schema)
    else:
        temp_date_scoped_df = reduce(lambda a, b: a.unionByName(b), filtered_parts)

    logger.info("Step 7: Global lookback_filter step complete.")

except Exception as e:
    logger.error(f"Failed at Step 7 (global lookback filter).\nError: {str(e)}")
    raise RuntimeError(f"Failed at Step 7 (global lookback filter).\nError: {str(e)}")

# COMMAND ----------

# DBTITLE 1,Step 8 -- Per-Patient Active Therapy Window (max_rx_dt / min_rx_dt)
# ==============================================================================
# GROUP BY workstream + patient_id -> compute personal LoT window boundaries:
#
#   max_rx_dt = MAX(most_recent_date) across all active treatment pools
#   min_rx_dt = max_rx_dt - lot_lookback_days  (window start date)
#
# Per design: "For each patient, a 105-day lookback is calculated from their
# most recent fill date -- Config driven lookback"
#
# most_recent_date from the base table represents the latest service date for
# a patient in a given patient pool (pre-aggregated in f_claims_patient_pool).
# lot_lookback_days sourced from config per workstream (105-day default).
# ==============================================================================

try:
    logger.info("Step 8: Computing per-patient max_rx_dt and min_rx_dt (LoT window).")

    lot_lookback_rows_list = [
        (ws, days) for ws, days in lot_lookback_map.items() if ws in rx_path_workstreams
    ]
    lot_lookback_df = spark.createDataFrame(
        lot_lookback_rows_list, ["workstream", "lot_lookback_days"]
    )

    temp_patient_window_df = (
        temp_date_scoped_df
        .groupBy("workstream", "patient_id")
        .agg(spark_max("most_recent_date").alias("max_rx_dt"))
        .join(broadcast(lot_lookback_df), on="workstream", how="left")
        .withColumn(
            "lot_lookback_days",
            coalesce(col("lot_lookback_days"), lit(105))
        )
        .withColumn(
            "min_rx_dt",
            expr("date_sub(max_rx_dt, lot_lookback_days)")
        )
        .drop("lot_lookback_days")
    )

    logger.info("Step 8: Per-patient LoT window (max_rx_dt, min_rx_dt) computed.")

except Exception as e:
    logger.error(f"Failed at Step 8 (LoT window computation).\nError: {str(e)}")
    raise RuntimeError(f"Failed at Step 8 (LoT window computation).\nError: {str(e)}")

# COMMAND ----------

# DBTITLE 1,Step 9 -- Active Drug Classes Within Window (COUNT DISTINCT patient_pool)
# ==============================================================================
# Join pool-level rows to per-patient window keeping only pools where:
#   most_recent_date >= min_rx_dt  AND  most_recent_date <= max_rx_dt
#
# A pool is ACTIVE in the window if the patient's latest fill for that pool
# falls within [min_rx_dt, max_rx_dt].
#
# active_class_count = COUNT(DISTINCT patient_pool)
#
# Per design: "Each class/patient pool counts as 1."
#   - Multiple fills within the same class still count as 1.
#   - FDC (fixed-dose combination) NDCs count as multiple classes intentionally.
# ==============================================================================

try:
    logger.info(
        "Step 9: Counting distinct active drug classes within per-patient LoT window."
    )

    pool_a   = temp_date_scoped_df.alias("pool_a")
    window_a = temp_patient_window_df.alias("window_a")

    temp_active_classes_df = (
        pool_a
        .join(
            window_a,
            on=[
                col("pool_a.workstream")      == col("window_a.workstream"),
                col("pool_a.patient_id")       == col("window_a.patient_id"),
                col("pool_a.most_recent_date") >= col("window_a.min_rx_dt"),
                col("pool_a.most_recent_date") <= col("window_a.max_rx_dt"),
            ],
            how="inner",
        )
        .groupBy(
            col("pool_a.workstream"),
            col("pool_a.patient_id"),
        )
        .agg(
            countDistinct(col("pool_a.patient_pool")).alias("active_class_count")
        )
    )

    logger.info("Step 9: Active drug class count (active_class_count) computed per patient.")

except Exception as e:
    logger.error(f"Failed at Step 9 (active class count).\nError: {str(e)}")
    raise RuntimeError(f"Failed at Step 9 (active class count).\nError: {str(e)}")

# COMMAND ----------

# DBTITLE 1,Step 10 -- Assign LoT Label (therapy_subset) [Config-Driven]
# ==============================================================================
# Map active_class_count -> therapy_subset using lot_label_mapping from config.
#
# Config drives the mapping via lot_label_map (extracted in Step 1):
#   match_type = 'eq'  -> exact CASE branch
#   match_type = 'gte' -> catch-all OTHERWISE branch
#
# Per design mapping (default):
#   1  -> 1L
#   2  -> 2L
#   3  -> 3L
#   >4 -> 4L+
#
# Fallback: if no lot_label_mapping config rows exist, hardcoded 1L/2L/3L/4L+.
# ==============================================================================

try:
    logger.info("Step 10: Mapping active_class_count -> therapy_subset (config-driven).")

    def build_lot_label_expr(rules):
        """
        Build a Spark Column CASE expression from a list of
        (class_count, therapy_label, match_type) tuples.

        'eq'  rules are applied first in ascending class_count order.
        'gte' rule  is applied last as the catch-all otherwise branch.
        If no rules are provided, returns the hardcoded default expression.

        Note: otherwise_label captured before list mutation to avoid IndexError
        on single-gte-rule config.
        """
        if not rules:
            return (
                when(col("active_class_count") == 1, lit("1L"))
                .when(col("active_class_count") == 2, lit("2L"))
                .when(col("active_class_count") == 3, lit("3L"))
                .otherwise(lit("4L+"))
            )

        eq_rules  = sorted([(c, l) for c, l, m in rules if m == "eq"],  key=lambda x: x[0])
        gte_rules = sorted([(c, l) for c, l, m in rules if m == "gte"], key=lambda x: x[0])

        otherwise_label = (
            gte_rules[-1][1] if gte_rules
            else (eq_rules[-1][1] if eq_rules else None)
        )

        if eq_rules:
            expr_chain = when(col("active_class_count") == eq_rules[0][0], lit(eq_rules[0][1]))
            for class_count, label in eq_rules[1:]:
                expr_chain = expr_chain.when(
                    col("active_class_count") == class_count, lit(label)
                )
        elif gte_rules:
            expr_chain = when(
                col("active_class_count") >= gte_rules[0][0], lit(gte_rules[0][1])
            )
            gte_rules = gte_rules[1:]
        else:
            return when(lit(True), lit(None).cast("string"))

        for class_count, label in gte_rules:
            expr_chain = expr_chain.when(
                col("active_class_count") >= class_count, lit(label)
            )

        if otherwise_label:
            return expr_chain.otherwise(lit(otherwise_label))
        return expr_chain.otherwise(lit(None).cast("string"))

    if lot_label_map:
        lot_parts = []
        for ws, rules in lot_label_map.items():
            if ws not in rx_path_workstreams:
                continue
            ws_expr = build_lot_label_expr(rules)
            lot_parts.append(
                temp_active_classes_df
                .filter(col("workstream") == ws)
                .withColumn("therapy_subset", ws_expr)
            )

        covered_ws   = list(lot_label_map.keys())
        uncovered_ws = [ws for ws in rx_path_workstreams if ws not in covered_ws]
        if uncovered_ws:
            logger.warning(
                f"Workstreams {uncovered_ws} have no lot_label_mapping config -- "
                "applying hardcoded default (1->1L, 2->2L, 3->3L, 4+->4L+)."
            )
            fallback_expr = build_lot_label_expr([])
            lot_parts.append(
                temp_active_classes_df
                .filter(col("workstream").isin(uncovered_ws))
                .withColumn("therapy_subset", fallback_expr)
            )

        temp_lot_df = (
            reduce(lambda a, b: a.unionByName(b), lot_parts)
            if lot_parts
            else temp_active_classes_df.withColumn(
                "therapy_subset", lit(None).cast("string")
            )
        )
    else:
        logger.warning("Applying hardcoded LoT label fallback for all workstreams.")
        temp_lot_df = temp_active_classes_df.withColumn(
            "therapy_subset", build_lot_label_expr([])
        )

    logger.info("Step 10: therapy_subset column derived.")

except Exception as e:
    logger.error(f"Failed at Step 10 (therapy_subset mapping).\nError: {str(e)}")
    raise RuntimeError(f"Failed at Step 10 (therapy_subset mapping).\nError: {str(e)}")

# COMMAND ----------

# DBTITLE 1,Step 11 -- Attach patient_pool_desc from Config
# ==============================================================================
# patient_pool_desc is sourced from CONFIG (lot_class_filter), not from claims.
# Output grain is ONE ROW PER PATIENT -- patient_pool is NOT in the final output.
#
# Duplicate detection: if config has conflicting patient_pool_desc rows for the
# same workstream, a WARNING is logged before dropDuplicates picks one.
# ==============================================================================

try:
    logger.info("Step 11: Attaching patient_pool_desc from config.")

    ws_desc_df = (
        lot_class_config_df
        .select("workstream", "patient_pool_desc")
        .distinct()
    )

    ws_desc_counts = (
        ws_desc_df
        .groupBy("workstream")
        .agg(countDistinct("patient_pool_desc").alias("desc_count"))
        .filter(col("desc_count") > 1)
        .collect()
    )
    if ws_desc_counts:
        conflict_ws = [r["workstream"] for r in ws_desc_counts]
        logger.warning(
            f"Multiple patient_pool_desc values found in config for workstreams {conflict_ws}. "
            "One will be picked non-deterministically. Review lot_class_filter config rows."
        )

    ws_desc_df = ws_desc_df.dropDuplicates(["workstream"])

    temp_final_pre_select_df = (
        temp_lot_df
        .join(broadcast(ws_desc_df), on="workstream", how="left")
    )

    logger.info("Step 11: patient_pool_desc attached from config.")

except Exception as e:
    logger.error(f"Failed at Step 11 (patient_pool_desc join).\nError: {str(e)}")
    raise RuntimeError(f"Failed at Step 11 (patient_pool_desc join).\nError: {str(e)}")

# COMMAND ----------

# DBTITLE 1,Step 12 -- Union Diagnosis Cohort + Final Select & Write
# ==============================================================================
# OUTPUT COLUMNS:
#   workstream        | string    -- therapeutic area identifier
#   patient_id        | string    -- unique patient identifier
#   patient_pool_desc | string    -- descriptor from config or 'Diagnosis Cohort'
#   therapy_subset    | string    -- '1L'/'2L'/'3L'/'4L+' for LoT rows; NULL for dx rows
#   ins_dt            | timestamp -- audit: pipeline run timestamp
#   run_id            | string    -- audit: pipeline run identifier
#
# Diagnosis cohort rows (dx_cohort_df from Step 6) are unioned here so both
# treatment LoT rows and diagnosis cohort rows land in one table.
#
# Zero-row guard: raises error if combined output is empty before write,
# preventing accidental deletion of existing partition data.
#
# WRITE STRATEGY:
#   replaceWhere scoped to enabled workstreams only (other partitions untouched)
#   Partitioned by workstream for downstream query performance
# ==============================================================================

try:
    logger.info("Step 12: Final select, union diagnosis rows, and write to target table.")

    target_table = f"{catalog_name}.{gold_claim_schema}.{target_table_name}"

    # Build LoT rows
    lot_output_df = (
        temp_final_pre_select_df
        .select(
            col("workstream").cast("string"),
            col("patient_id").cast("string"),
            coalesce(col("patient_pool_desc"), lit("UNKNOWN")).cast("string").alias("patient_pool_desc"),
            col("therapy_subset").cast("string"),
            F.current_timestamp().alias("ins_dt"),
            lit(run_id).cast("string").alias("run_id"),
        )
    )

    # Union diagnosis cohort rows if any dx_path_workstreams were processed
    if dx_cohort_df is not None:
        dx_output_df = (
            dx_cohort_df
            .select(
                col("workstream").cast("string"),
                col("patient_id").cast("string"),
                coalesce(col("patient_pool_desc"), lit("Diagnosis Cohort")).cast("string").alias("patient_pool_desc"),
                col("therapy_subset").cast("string"),
                F.current_timestamp().alias("ins_dt"),
                lit(run_id).cast("string").alias("run_id"),
            )
        )
        temp_final_df = lot_output_df.unionByName(dx_output_df)
        logger.info("Diagnosis cohort rows unioned into final output.")
    else:
        temp_final_df = lot_output_df

    # Zero-row guard -- never write an empty DataFrame over an existing partition
    output_count = temp_final_df.count()
    if output_count == 0:
        raise ValueError(
            "Zero rows in final output DataFrame. Aborting write to prevent accidental "
            "data loss on existing partition. Check f_claims_patient_pool base table and config."
        )
    logger.info(f"Output row count pre-write: {output_count}")

    replace_condition = " OR ".join([f"workstream = '{ws}'" for ws in workstreams])
    logger.info(f"replaceWhere condition: {replace_condition}")

    (
        temp_final_df
        .repartition("workstream")
        .write
        .format("delta")
        .mode("overwrite")
        .option("replaceWhere", replace_condition)
        .option("optimizeWrite", "true")
        .option("autoCompact", "true")
        .partitionBy("workstream")
        .saveAsTable(target_table)
    )

    logger.info(f"Data written to {target_table}.")
    logger.info("f_claims_patient_pool_agg -- Pipeline complete.")

except Exception as e:
    logger.error(f"Failed during final write.\nError: {str(e)}")
    raise RuntimeError(f"Failed during final write.\nError: {str(e)}")

# COMMAND ----------

# DBTITLE 1,Unit Test 1 -- Sanity Checks
# MAGIC %sql
# MAGIC -- ==============================================================================
# MAGIC -- UNIT TEST 1: SANITY CHECKS
# MAGIC -- Row count, distinct patients, workstream coverage, therapy_subset distribution
# MAGIC -- ==============================================================================
# MAGIC
# MAGIC SELECT 'row_count' AS check_name,
# MAGIC   CAST(COUNT(*) AS STRING) AS check_value,
# MAGIC   CASE WHEN COUNT(*) > 0 THEN 'PASS' ELSE 'FAIL' END AS status
# MAGIC FROM us_comm_lakehouse_dev.gold_claims.f_claims_patient_pool_aggregated
# MAGIC UNION ALL
# MAGIC SELECT 'distinct_patients',
# MAGIC   CAST(COUNT(DISTINCT patient_id) AS STRING),
# MAGIC   CASE WHEN COUNT(DISTINCT patient_id) > 0 THEN 'PASS' ELSE 'FAIL' END
# MAGIC FROM us_comm_lakehouse_dev.gold_claims.f_claims_patient_pool_aggregated
# MAGIC UNION ALL
# MAGIC SELECT 'distinct_workstreams',
# MAGIC   CAST(COUNT(DISTINCT workstream) AS STRING),
# MAGIC   CASE WHEN COUNT(DISTINCT workstream) > 0 THEN 'PASS' ELSE 'FAIL' END
# MAGIC FROM us_comm_lakehouse_dev.gold_claims.f_claims_patient_pool_aggregated
# MAGIC UNION ALL
# MAGIC SELECT 'therapy_subset_values',
# MAGIC   CONCAT_WS(', ', COLLECT_SET(therapy_subset)), 'INFO'
# MAGIC FROM us_comm_lakehouse_dev.gold_claims.f_claims_patient_pool_aggregated
# MAGIC UNION ALL
# MAGIC SELECT 'max_ins_dt',
# MAGIC   CAST(MAX(ins_dt) AS STRING),
# MAGIC   CASE WHEN MAX(ins_dt) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
# MAGIC FROM us_comm_lakehouse_dev.gold_claims.f_claims_patient_pool_aggregated

# COMMAND ----------

# DBTITLE 1,Unit Test 2 -- Null Checks
# MAGIC %sql
# MAGIC -- ==============================================================================
# MAGIC -- UNIT TEST 2: NULL CHECKS
# MAGIC -- workstream, patient_id, patient_pool_desc must be non-null.
# MAGIC -- therapy_subset is allowed to be NULL for diagnosis cohort rows only.
# MAGIC -- ==============================================================================
# MAGIC
# MAGIC SELECT check_name, null_count,
# MAGIC   CASE WHEN null_count = 0 THEN 'PASS' ELSE 'FAIL' END AS status
# MAGIC FROM (
# MAGIC   SELECT 'workstream_nulls' AS check_name,
# MAGIC     SUM(CASE WHEN workstream IS NULL THEN 1 ELSE 0 END) AS null_count
# MAGIC   FROM us_comm_lakehouse_dev.gold_claims.f_claims_patient_pool_aggregated
# MAGIC   UNION ALL
# MAGIC   SELECT 'patient_id_nulls',
# MAGIC     SUM(CASE WHEN patient_id IS NULL THEN 1 ELSE 0 END)
# MAGIC   FROM us_comm_lakehouse_dev.gold_claims.f_claims_patient_pool_aggregated
# MAGIC   UNION ALL
# MAGIC   SELECT 'patient_pool_desc_nulls',
# MAGIC     SUM(CASE WHEN patient_pool_desc IS NULL THEN 1 ELSE 0 END)
# MAGIC   FROM us_comm_lakehouse_dev.gold_claims.f_claims_patient_pool_aggregated
# MAGIC   UNION ALL
# MAGIC   -- therapy_subset nulls expected for diagnosis cohort rows; reported as INFO
# MAGIC   SELECT 'therapy_subset_nulls (dx cohort rows expected)',
# MAGIC     SUM(CASE WHEN therapy_subset IS NULL THEN 1 ELSE 0 END)
# MAGIC   FROM us_comm_lakehouse_dev.gold_claims.f_claims_patient_pool_aggregated
# MAGIC )

# COMMAND ----------

# DBTITLE 1,Unit Test 3 -- Deduplication (1 row per patient per workstream)
# MAGIC %sql
# MAGIC -- ==============================================================================
# MAGIC -- UNIT TEST 3: DEDUPLICATION
# MAGIC -- Output grain = (workstream, patient_id): exactly ONE row per patient
# MAGIC -- ==============================================================================
# MAGIC
# MAGIC SELECT 'duplicate_patient_workstream' AS check_name,
# MAGIC   CAST(COUNT(*) AS STRING) AS duplicate_count,
# MAGIC   CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
# MAGIC FROM (
# MAGIC   SELECT workstream, patient_id, COUNT(*) AS cnt
# MAGIC   FROM us_comm_lakehouse_dev.gold_claims.f_claims_patient_pool_aggregated
# MAGIC   GROUP BY workstream, patient_id
# MAGIC   HAVING COUNT(*) > 1
# MAGIC )

# COMMAND ----------

# DBTITLE 1,Unit Test 4 -- LOV Checks (dynamic from config)
# MAGIC %sql
# MAGIC -- ==============================================================================
# MAGIC -- UNIT TEST 4: LIST OF VALUES
# MAGIC -- therapy_subset for LoT rows must be values configured in lot_label_mapping.
# MAGIC -- NULL therapy_subset is valid ONLY for diagnosis cohort rows.
# MAGIC -- ==============================================================================
# MAGIC
# MAGIC SELECT 'unexpected_therapy_subset_on_lot_row' AS check_name,
# MAGIC   CAST(COUNT(*) AS STRING) AS fail_count,
# MAGIC   CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
# MAGIC FROM us_comm_lakehouse_dev.gold_claims.f_claims_patient_pool_aggregated
# MAGIC WHERE therapy_subset NOT IN ('1L', '2L', '3L', '4L+')
# MAGIC   AND patient_pool_desc != 'Diagnosis Cohort'
# MAGIC   -- NOTE: update IN list if lot_label_mapping config defines different labels
# MAGIC UNION ALL
# MAGIC SELECT 'null_therapy_on_treatment_row',
# MAGIC   CAST(COUNT(*) AS STRING),
# MAGIC   CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
# MAGIC FROM us_comm_lakehouse_dev.gold_claims.f_claims_patient_pool_aggregated
# MAGIC WHERE therapy_subset IS NULL
# MAGIC   AND patient_pool_desc != 'Diagnosis Cohort'
# MAGIC UNION ALL
# MAGIC SELECT 'workstream_not_in_config',
# MAGIC   CAST(COUNT(*) AS STRING),
# MAGIC   CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
# MAGIC FROM (
# MAGIC   SELECT DISTINCT workstream
# MAGIC   FROM us_comm_lakehouse_dev.gold_claims.f_claims_patient_pool_aggregated
# MAGIC   WHERE workstream NOT IN (
# MAGIC     SELECT DISTINCT workstream
# MAGIC     FROM us_comm_lakehouse_dev.gold_claims.config_claims_patient_pool
# MAGIC     WHERE table = 'f_claims_patient_pool_aggregated'
# MAGIC       AND parameter_description = 'lot_enablement'
# MAGIC       AND UPPER(parameter1) = 'Y'
# MAGIC   )
# MAGIC )
# MAGIC UNION ALL
# MAGIC SELECT 'unknown_pool_desc_present',
# MAGIC   CAST(SUM(CASE WHEN patient_pool_desc = 'UNKNOWN' THEN 1 ELSE 0 END) AS STRING),
# MAGIC   CASE WHEN SUM(CASE WHEN patient_pool_desc = 'UNKNOWN' THEN 1 ELSE 0 END) = 0
# MAGIC        THEN 'PASS' ELSE 'WARN' END
# MAGIC FROM us_comm_lakehouse_dev.gold_claims.f_claims_patient_pool_aggregated

# COMMAND ----------

# DBTITLE 1,Unit Test 5 -- Business Logic (LoT snapshot, not cumulative)
# MAGIC %sql
# MAGIC -- ==============================================================================
# MAGIC -- UNIT TEST 5: BUSINESS LOGIC CHECKS
# MAGIC -- therapy_subset distribution for LoT rows only (excludes diagnosis cohort rows)
# MAGIC -- All tiers should be present for an active HTN workstream
# MAGIC -- ==============================================================================
# MAGIC
# MAGIC SELECT therapy_subset,
# MAGIC   COUNT(DISTINCT patient_id) AS patient_count,
# MAGIC   ROUND(COUNT(DISTINCT patient_id) * 100.0 / SUM(COUNT(DISTINCT patient_id)) OVER (), 2) AS pct,
# MAGIC   'INFO' AS status
# MAGIC FROM us_comm_lakehouse_dev.gold_claims.f_claims_patient_pool_aggregated
# MAGIC WHERE patient_pool_desc != 'Diagnosis Cohort'
# MAGIC GROUP BY therapy_subset
# MAGIC ORDER BY therapy_subset

# COMMAND ----------

# DBTITLE 1,Unit Test 6 -- Intersection Integrity (Treated + Diagnosed)
# MAGIC %sql
# MAGIC -- ==============================================================================
# MAGIC -- UNIT TEST 6: INTERSECTION INTEGRITY
# MAGIC -- For workstreams with dx_intersection_filter = 'Y', every patient in the
# MAGIC -- LoT output must also have at least one diagnosis pool row in the base table.
# MAGIC -- ==============================================================================
# MAGIC
# MAGIC SELECT 'treatment_patients_without_diagnosis' AS check_name,
# MAGIC   CAST(COUNT(*) AS STRING) AS fail_count,
# MAGIC   CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARN' END AS status
# MAGIC FROM (
# MAGIC   SELECT DISTINCT a.workstream, a.patient_id
# MAGIC   FROM us_comm_lakehouse_dev.gold_claims.f_claims_patient_pool_aggregated a
# MAGIC   WHERE a.patient_pool_desc != 'Diagnosis Cohort'
# MAGIC     AND a.workstream IN (
# MAGIC       SELECT DISTINCT workstream
# MAGIC       FROM us_comm_lakehouse_dev.gold_claims.config_claims_patient_pool
# MAGIC       WHERE table = 'f_claims_patient_pool_aggregated'
# MAGIC         AND parameter_description = 'dx_intersection_filter'
# MAGIC         AND UPPER(parameter1) = 'Y'
# MAGIC     )
# MAGIC ) lot_patients
# MAGIC LEFT JOIN (
# MAGIC   SELECT DISTINCT workstream, patient_id
# MAGIC   FROM us_comm_lakehouse_dev.gold_claims.f_claims_patient_pool_aggregated
# MAGIC   WHERE patient_pool_desc = 'Diagnosis Cohort'
# MAGIC ) dx_patients
# MAGIC   ON lot_patients.workstream = dx_patients.workstream
# MAGIC   AND lot_patients.patient_id = dx_patients.patient_id
# MAGIC WHERE dx_patients.patient_id IS NULL

# COMMAND ----------

# DBTITLE 1,Unit Test 7 -- Diagnosis Path Coverage
# MAGIC %sql
# MAGIC -- ==============================================================================
# MAGIC -- UNIT TEST 7: DIAGNOSIS PATH COVERAGE
# MAGIC -- For mx-dx workstreams, confirms diagnosis cohort rows are present in output.
# MAGIC -- therapy_subset must be NULL for all diagnosis cohort rows.
# MAGIC -- ==============================================================================
# MAGIC
# MAGIC SELECT 'diagnosis_cohort_rows_present' AS check_name,
# MAGIC   CAST(COUNT(DISTINCT patient_id) AS STRING) AS dx_patient_count,
# MAGIC   CASE WHEN COUNT(DISTINCT patient_id) > 0 THEN 'PASS' ELSE 'WARN' END AS status
# MAGIC FROM us_comm_lakehouse_dev.gold_claims.f_claims_patient_pool_aggregated
# MAGIC WHERE patient_pool_desc = 'Diagnosis Cohort'
# MAGIC UNION ALL
# MAGIC SELECT 'diagnosis_rows_with_unexpected_therapy_subset',
# MAGIC   CAST(COUNT(*) AS STRING),
# MAGIC   CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
# MAGIC FROM us_comm_lakehouse_dev.gold_claims.f_claims_patient_pool_aggregated
# MAGIC WHERE patient_pool_desc = 'Diagnosis Cohort'
# MAGIC   AND therapy_subset IS NOT NULL

# COMMAND ----------

# DBTITLE 1,Sample Output Preview
# MAGIC %sql
# MAGIC SELECT *
# MAGIC FROM us_comm_lakehouse_dev.gold_claims.f_claims_patient_pool_aggregated
# MAGIC LIMIT 20
