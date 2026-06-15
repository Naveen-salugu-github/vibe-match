# SLE NSP Factors — Documentation

**Notebook:** `03.SLE_NSP_Factors`  
**Purpose:** Calculate NSP adjustment factors by comparing NSP sales volume to DDD sales volume, then publish monthly and weekly factor tables for downstream SLE/eLAAD models.

---

## Overview

NSP and DDD are two different data sources that measure product sales. They do not always align. This pipeline computes a **conversion factor** per product:

```
NSP Factor = NSP units ÷ DDD units
```

The factor answers: *“For a given product and time period, how much should DDD volume be scaled to align with NSP?”*

| Output table | Granularity | Description |
|---|---|---|
| `NSP_mthly_fact` | Month + product | Factor calculated from monthly NSP vs DDD volumes |
| `NSP_wkly_fact` | Week + product | Monthly factor applied to each week in that month |

---

## Products in scope

| Product | NSP product IDs | DDD product IDs |
|---|---|---|
| BENLYSTA IV | 650912, 650924 | 1335526, 1335669 |
| BENLYSTA SUBQ | 877743 | 1335620, 1335822 |
| SAPHNELO | 1441709 | 1438251 |

---

## Source tables

| Variable | Table |
|---|---|
| `NSP_mnthly` | `us_commercial_app_commons_prod.f_sls_nsp_mth` |
| `DDD_mnthly` | `us_commercial_catalog_prod.lg_salestooutlets.outlet_sales_md_mntly_anifro` |
| `DDD_wkly` | `us_commercial_catalog_prod.lg_salestooutlets.outlet_sales_md_wkly_anifro` |
| `cal_445` | `us_commercial_catalog_prod.lgu_lupus.kxwj051_445_calendar` |

---

## Unit conversion

Raw package counts are converted to equivalent units (`units_eq`) before aggregation:

| Product | Multiplier |
|---|---|
| BENLYSTA IV (650912 / 1335526) | × 0.4716 |
| BENLYSTA IV (650924 / 1335669) | × 0.1415 |
| BENLYSTA SUBQ | × 0.25 |
| SAPHNELO | × 1.0 |

NSP data is filtered to `trade_class_desc = 'COMBINED'`. DDD data excludes zero-unit rows.

---

## `NSP_mthly_fact` — Monthly factor logic

### Steps

1. **Aggregate NSP volume** — Group by `yr_mnth` and `Product`; sum converted `units_eq`.
2. **Aggregate DDD volume** — Same grouping from DDD monthly source.
3. **Compute factor** — `NSP_Factor_mthly = NSP_Units / DDD_Units` per month and product.
4. **Nov-2024 adjustment** — IQVIA applies an 80% factor to the atypical 5-week month in NSP. The pipeline reverses this: `units_eq = units_eq / 0.8` for `2024-11`.
5. **Fill gaps** — If a month/product has no computed factor, use the **most recent** factor for that product.
6. **Publish** — Write to `us_commercial_catalog_prod.LGU_LUPUS.NSP_mthly_fact`.

### Output schema

| Column | Type | Description |
|---|---|---|
| `date` | date | Last day of the month |
| `Product` | string | BENLYSTA IV, BENLYSTA SUBQ, or SAPHNELO |
| `NSP_Factor_mthly` | decimal | Monthly NSP-to-DDD conversion factor |

---

## `NSP_wkly_fact` — Weekly factor logic

Weekly factors are **not** recalculated from weekly NSP/DDD volumes. The monthly factor is propagated to every week in that month.

### Steps

1. Build `WeekMonthMapping` — Map each week to its corresponding month using the 4-4-5 calendar.
2. Join monthly factors (`Table34`) to weeks on `yr_mnth`.
3. Assign `NSP_Factor_wkly = NSP_Factor_mthly` for each week/product.
4. **Publish** — Write to `us_commercial_catalog_prod.LGU_LUPUS.NSP_wkly_fact`.

### Output schema

| Column | Type | Description |
|---|---|---|
| `week` | date | Week end date |
| `Product` | string | Product name |
| `NSP_Factor_wkly` | decimal | Monthly factor applied to this week |

---

## Data flow

```
NSP monthly sales ──┐
                    ├──► NSP ÷ DDD ──► NSP_mthly_fact
DDD monthly sales ──┘                        │
                                             ▼
                              Week-to-month mapping
                                             │
                                             ▼
                                    NSP_wkly_fact
```

---

## Downstream usage

Both factor tables feed the eLAAD refresh step. See [SLE_eLAAD_Process.md](./SLE_eLAAD_Process.md) for full details.

---

## Key notes

- **Monthly** = calculated from actual NSP vs DDD volume comparison.
- **Weekly** = monthly factor copied to each week; no separate weekly NSP/DDD calculation.
- **Missing months** are backfilled with the latest available factor per product.
- Tables are written in **overwrite** mode with Delta format.
