# Projected NBRx Patient Counts — Documentation

**Notebook:** `01.Projected NBRx Patient Counts.py`  
**Purpose:** Calculate weekly and monthly **SOB Projection Factors** that scale eLAAD patient-level claims data to total market-level volume, enabling projected NBRx patient counts.

---

## Core concept

Two data sources describe sales differently:

| Source | What it measures | Limitation |
|--------|-----------------|------------|
| **DDD** | Total market volume (mg sold) | No patient-level detail |
| **eLAAD** | Individual patient claims | Doesn't capture all market channels |

The notebook computes:

```
Projection Factor = DDD (SLE-adjusted MG) ÷ eLAAD (observed LAAD MG)
```

Downstream notebooks multiply eLAAD patient counts by this factor to project the **true market size**.

---

## `sobFlag` — pipeline mode switch

```python
sobFlag = False   # default
```

| Value | Behavior |
|-------|---------|
| `False` | Apply hardcoded **1.2×** factor to Benlysta SC Retail DDD |
| `True` | Use live NSP CSV to compute DDD→NSP projection ratio dynamically |

Currently always `False`. The 1.2 factor was validated from a 3-month analysis in 2022 (IV factor = 1.03, SC factor = 1.17; 1.2 used as conservative round-up). **Needs automation in future.**

---

## Products in scope

BENLYSTA, SAPHNELO, and competitor biologics:  
RITUXAN, STELARA, ORENCIA, OLUMIANT, RUXIENCE, TRUXIMA, RIABNI

Channel split: `RETAIL` vs `NON_RETAIL` (based on `sub_category_code` list)  
Form split: `IV` vs `SC` (based on product name keywords: PRF, VIAL, IV, TAB, etc.)

---

## Source tables

| Variable | Table | Used for |
|----------|-------|---------|
| `ddd_wkly_table` | `outlet_sales_md_wkly_anifro` | Weekly DDD raw |
| `ddd_mnthly_table` | `outlet_sales_md_mntly_anifro` | Monthly DDD raw |
| `elaad_df` | `kwxc045_immunology_bagging_table` | eLAAD patient claims (SLE only) |
| `elaad_all_pat_df` | `kwxc045_immunology_bagging_table_all_pat` | All patients (for SLE factor calc) |

### Static files (S3)

| File | Path | Used when |
|------|------|-----------|
| NSP monthly data | `s3://.../NSP Data for LAAD Factor Calc.csv` | `sobFlag = True` only |
| DDD 4-4-5 calendar | `s3://.../DDD 445 Calendar.csv` | Always — maps weeks to months |

> **Note:** Both are static S3 files. The 445 calendar is used on every run. The NSP CSV is only used when `sobFlag = True` (currently inactive).

---

## Output tables

| Table | Grain | Description |
|-------|-------|-------------|
| `DDD_wkly` | Week × product × form × channel | Processed weekly DDD in MG |
| `DDD_mnthly` | Month × product × form × channel | Processed monthly DDD in MG |
| `DDD_wkly_ben_split` | Week × product | Benlysta IV/SC split proportions (Non-Retail) |
| `DDD_mnthly_ben_split` | Month × product | Same, monthly |
| `sle_fctr_wkly_eLAAD` | Week × product × form | Weekly SLE patient proportion factor |
| `sle_fctr_mnthly_eLAAD` | Month × product × form | Monthly SLE patient proportion factor |
| `SOB_PROJECTION_FACTOR_WEEKLY` | Week × product × form × channel | Weekly projection factor (form level) |
| `SOB_PROJECTION_FACTOR_TOT_WEEKLY` | Week × product × channel | Weekly projection factor (product level) |
| `SOB_PROJECTION_FACTOR_MONTHLY` | Month × product × form × channel | Monthly projection factor (form level) |
| `SOB_PROJECTION_FACTOR_TOT_MONTHLY` | Month × product × channel | Monthly projection factor (product level) |

---

## Section 1: DDD Data Processing

### DDD MG calculation

```
DDD_MG = units × mg_strength
```

`mg_strength` is extracted from the product name using regex (e.g. `BENLYSTA 200MG` → 200).  
Special case: `ORENCIA SYRPRF 87.5MG.7ML` → 87.5 (hardcoded override for regex failure).

### 445 Calendar join

Weekly DDD is joined to the 445 calendar on `week_end` → assigns `YR_MNTH` (month) to each week.  
Monthly DDD is then aggregated by summing `DDD_MG` per month per product per form per channel.

### sobFlag = True — DDD→NSP scaling (inactive by default)

If enabled:
1. Join monthly DDD to NSP CSV on product + month + channel
2. Calculate rolling 3-month average of `DDD_MG` and `NSP_MG`
3. `DDD_NSP_ProjFact = NSP_MG_rolling / DDD_MG_rolling`
4. Multiply Benlysta DDD_MG by this factor

### Benlysta SC Retail 1.2 factor (sobFlag = False, always active)

```
DDD_MG (Benlysta SC Retail) = DDD_MG × 1.2
```

DDD captures ~85% of Benlysta SC Retail market. Factor 1.2 estimates the remaining coverage gap.  
Applied to both weekly and monthly tables.

---

## Section 2: SLE Factor Tables

**Source:** `elaad_all_pat_df` — all biologic patients in eLAAD (`class = 'BIO'`)

### SLE factor formula

```
SLE_fctr = (tot_pat_ct - LN_pat_ct - Other_pat_ct) / tot_pat_ct   [BENLYSTA]
SLE_fctr = 1.0                                                       [SAPHNELO]
```

| Flag | Meaning |
|------|---------|
| `SLE_FLG = 1` | Patient has SLE indication |
| `LN_FLG = 1` | Patient has Lupus Nephritis indication |
| Neither | Other indication |

Saphnelo is SLE-only by approval, so its factor is always 1.

**Output:** `sle_fctr_wkly_eLAAD`, `sle_fctr_mnthly_eLAAD`  
These tables are consumed by `07.TRx Equivalence for SOB.py` and other downstream notebooks.

---

## Section 3: Projection Factor Calculation

### Benlysta Non-Retail Apportionment

eLAAD reports Benlysta Non-Retail (MX channel) as a single combined number, not split by IV/SC.  
The notebook uses DDD IV/SC proportions to split it:

```
IV_proportion = Benlysta IV Non-Retail DDD_MG / (IV + SC)
SC_proportion = Benlysta SC Non-Retail DDD_MG / (IV + SC)

LAAD_MG (IV Non-Retail) = Total LAAD_MG (Non-Retail) × IV_proportion
LAAD_MG (SC Non-Retail) = Total LAAD_MG (Non-Retail) × SC_proportion
```

### Projection factor formula

```
DDD_SLE_MG = DDD_MG × SLE_fctr

PROJ_FACTOR = rolling_avg(DDD_SLE_MG) / rolling_avg(LAAD_MG)
```

| Grain | Rolling window |
|-------|---------------|
| Weekly | 5-week rolling average |
| Monthly | 3-month rolling average |

Rolling average smooths out week-to-week volatility in the ratio.

### Guardrails

| Product | Rule | Reason |
|---------|------|--------|
| BENLYSTA | Cap between **1 and 4** | Prevents unrealistic factors |
| SAPHNELO | Floor at **1** | Factor should never be < 1 |
| SAPHNELO ≥ 10 | Replace with **Benlysta IV factor** for same week/channel | Saphnelo is new — sparse data can cause extreme factors early on |

### Two output grains

| Grain | Products | Used for |
|-------|---------|----------|
| **Form level** | product + form (IV/SC) + channel | Detailed SOB reporting |
| **Product level** | product + channel only | High-level SOB reporting |

---

## Static file risk

Two static CSV files are read on every run from S3:

| File | Risk | Mitigation |
|------|------|-----------|
| `DDD 445 Calendar.csv` | Pipeline breaks if file moved/renamed | Load once to Delta table; maintain `cal_445` catalog table (already exists in NSP Factors notebook) |
| `NSP Data for LAAD Factor Calc.csv` | Only used if `sobFlag = True` — currently inactive | Low immediate risk; document path dependency |

---

## Key notes

- **Projection factor** scales eLAAD observations → total market. Not the same as the NSP factor (which scales DDD → NSP).
- **SLE factor** filters out non-SLE patients before computing the projection ratio.
- **Rolling window** (5-week / 3-month) smooths out volatility; a single-week ratio would be too noisy.
- **Benlysta SC 1.2 factor** is hardcoded and documented in the code as needing automation.
- **Saphnelo guardrail**: early market data is sparse, causing extreme factors. Benlysta IV is used as a stable substitute when Saphnelo ≥ 10.
- All tables written in Delta overwrite mode with schema overwrite enabled.
