# SLE eLAAD Process — Documentation

**Notebook:** `03.SLE_NSP_Factors` (CMD 21–28)  
**Purpose:** Refresh NSP factor columns in the existing eLAAD factor tables without rebuilding the full eLAAD dataset.

---

## Overview

eLAAD factor tables already exist with other SLE metrics. This step **replaces** the old `NSP_Factor` columns with newly calculated values from `NSP_mthly_fact` and `NSP_wkly_fact`.

```
NSP_mthly_fact ──► sle_fctr_mnthly_eLAAD
NSP_wkly_fact  ──► sle_fctr_wkly_eLAAD
```

No new NSP math happens here — it is a **join and overwrite**.

---

## Tables

| Role | Monthly | Weekly |
|---|---|---|
| NSP factor source | `LGU_LUPUS.NSP_mthly_fact` | `LGU_LUPUS.NSP_wkly_fact` |
| eLAAD base table | `LGU_LUPUS.sle_fctr_mnthly_eLAAD` | `LGU_LUPUS.sle_fctr_wkly_eLAAD` |
| Final output | `LGU_LUPUS.sle_fctr_mnthly_eLAAD` | `LGU_LUPUS.sle_fctr_wkly_eLAAD` |

Full path prefix: `us_commercial_catalog_prod`

---

## Monthly process

### Step 1 — Load base eLAAD, drop old NSP column

```sql
SELECT * FROM sle_fctr_mnthly_eLAAD
-- drop column: NSP_Factor_mthly
```

Removes stale NSP values before attaching fresh ones.

### Step 2 — Reshape NSP factors for eLAAD keys

`NSP_mthly_fact` products are remapped to match eLAAD naming:

| NSP `Product` | `product_name` | `IV_SC_Cat` |
|---|---|---|
| BENLYSTA IV | BENLYSTA | IV |
| BENLYSTA SUBQ | BENLYSTA | SC |
| SAPHNELO | SAPHNELO | IV |

`date` → `YR_MNTH` (first 7 chars, e.g. `2024-03`).

### Step 3 — Join and publish

```sql
SELECT a.*, b.NSP_Factor_mthly
FROM sle_fctr_mnthly_eLAAD a
LEFT JOIN NSP_mthly_fact b
  ON a.product_name  = b.product_name
 AND a.YR_MNTH       = b.YR_MNTH
 AND a.IV_SC_Cat     = b.IV_SC_Cat
```

Result is written back to `sle_fctr_mnthly_eLAAD` (Delta, overwrite).

---

## Weekly process

Same pattern as monthly.

### Step 1 — Load base eLAAD, drop old NSP column

```sql
SELECT * FROM sle_fctr_wkly_eLAAD
-- drop column: NSP_Factor_wkly
```

### Step 2 — Reshape NSP weekly factors

| NSP `Product` | `product_name` | `IV_SC_Cat` |
|---|---|---|
| BENLYSTA IV | BENLYSTA | IV |
| BENLYSTA SUBQ | BENLYSTA | SC |
| SAPHNELO | SAPHNELO | IV |

`week` → `week_end`.

### Step 3 — Join and publish

```sql
SELECT a.*, b.NSP_Factor_wkly
FROM sle_fctr_wkly_eLAAD a
LEFT JOIN NSP_wkly_fact b
  ON a.product_name  = b.product_name
 AND a.week_end      = b.week_end
 AND a.IV_SC_Cat     = b.IV_SC_Cat
```

Result is written back to `sle_fctr_wkly_eLAAD` (Delta, overwrite).

---

## Join keys summary

| Grain | Join on |
|---|---|
| Monthly | `product_name` + `YR_MNTH` + `IV_SC_Cat` |
| Weekly | `product_name` + `week_end` + `IV_SC_Cat` |

`LEFT JOIN` keeps all eLAAD rows; NSP factor is `NULL` where no match exists.

---

## Data flow

```
                    ┌─────────────────────────┐
                    │  sle_fctr_mnthly_eLAAD  │
                    │  (drop old NSP column)  │
                    └───────────┬─────────────┘
                                │ LEFT JOIN
NSP_mthly_fact ─────────────────┘
                                ▼
                    ┌─────────────────────────┐
                    │  sle_fctr_mnthly_eLAAD  │  ← overwrite
                    └─────────────────────────┘

                    ┌─────────────────────────┐
                    │   sle_fctr_wkly_eLAAD   │
                    │  (drop old NSP column)  │
                    └───────────┬─────────────┘
                                │ LEFT JOIN
NSP_wkly_fact ──────────────────┘
                                ▼
                    ┌─────────────────────────┐
                    │   sle_fctr_wkly_eLAAD   │  ← overwrite
                    └─────────────────────────┘
```

---

## Key notes

- eLAAD tables are **not rebuilt from scratch** — only the NSP factor column is refreshed.
- Product names differ between NSP and eLAAD; the `CASE` logic bridges that gap.
- Weekly eLAAD uses factors from `NSP_wkly_fact`, which are monthly values copied to each week.
- Both outputs use **overwrite** mode with `overwriteSchema = true`.

---

## Related

See [SLE_NSP_Factors.md](./SLE_NSP_Factors.md) for how `NSP_mthly_fact` and `NSP_wkly_fact` are calculated upstream.
