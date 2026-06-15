# NSP Projection — Documentation

**Notebook:** `10_NSP_Projection.ipynb`  
**Purpose:** Calculate conversion factors between eLAAD (patient claims), DDD (pharmacy sales), and NSP (national market sales) for ATTR drugs. These factors are used to project patient counts from observed claims to real-world market volume.

---

## Core concept

Three data sources measure the same market differently:

| Source | Measures | Limitation |
|--------|----------|-----------|
| **eLAAD** | Patient-level claims | Doesn't capture all channels — undercounts market |
| **DDD** | Pharmacy units sold | No patient detail; may miss some channels |
| **NSP** | National market units | Most complete market view; released later |

The notebook calculates:

```
elaad_ddd_fctr = eLAAD claims   ÷ DDD normalized units
elaad_nsp_fctr = eLAAD claims   ÷ NSP normalized units
ddd_nsp_fctr   = DDD norm units ÷ NSP normalized units
```

These factors tell you: **"For every unit sold in the market, what fraction is captured in eLAAD?"**

---

## Products in scope (ATTR market)

| Product | Type | Blocking factor |
|---------|------|----------------|
| WAINUA | AZ product | 1.0 (full coverage) |
| AMVUTTRA | Competitor | Time-varying (0.55 → 0.85 → 0.80) |
| ONPATTRO | Competitor | Time-varying (0.60 → 0.85) |
| VYNDAMAX / VYNDAQEL | Competitor | 0.90 |
| ATTRUBY | Competitor | Per data |

---

## Source tables

| Table | Used for |
|-------|---------|
| `lgu_eplontersen.f_attr_treatment_repo_table_final` | eLAAD ATTR patient claims base |
| `f_sls_nsp_mth` | NSP monthly sales by NDC |
| `outlet_sales_md_wkly_attr` | DDD weekly ATTR sales |
| `lgu_eplontersen.d_nsp_445_conversion` | 445 calendar — maps weeks to months |
| `lgu_eplontersen.d_nsp_ddd_conversion_factors` | Unit-per-claim normalization factors |
| `lgu_eplontersen.prod_ndc_list` | DDD product name → NDC mapping |
| `lgu_patientiq.d_rx_codes_attr` | NDC → brand family mapping |
| `lgu_eplontersen.d_IDNs_WITH_COE` | Reference CoE table |

---

## Output table

| Table | Grain | Contents |
|-------|-------|---------|
| `lgu_eplontersen.d_nsp_prjct_fctr` | Month × product family | All three factors + blocking factor |

---

## Step 1: Load eLAAD claim counts (Cells 11–12)

Count distinct claim IDs per NDC per month from `f_attr_treatment_repo_table_final`.

**VYNDAMAX/VYNDAQEL normalization:**
```
claim_count = claim_count × (day_supply / 30)
```
Normalizes to 30-day equivalent because these drugs have non-standard day supply, making raw claim counts non-comparable.

Uses `d_nsp_445_conversion` to roll up weekly eLAAD data → monthly.

---

## Step 2: Load NSP monthly units (Cell 9)

Pull `nsp_prch_units` per NDC per month from `f_sls_nsp_mth`.

Filters:
- NDC in `d_rx_codes_attr` (ATTR market NDCs only)
- `prod_lvl = 'CMF10'`
- `trade_class_desc NOT IN ('DRUG','COMBINED','PROVIDER')`

---

## Step 3: Load DDD monthly units (Cell 14)

Pull weekly DDD from `outlet_sales_md_wkly_attr`.
- Join `prod_ndc_list` to get NDC from DDD product name
- Join `d_nsp_445_conversion` to roll up to monthly

---

## Step 4: Normalize with Unit_Per_Claim_Factor (Cells 16–18)

```
ddd_units_norm = ddd_units × Unit_Per_Claim_Factor
nsp_units_norm = nsp_units × Unit_Per_Claim_Factor
```

`Unit_Per_Claim_Factor` from `d_nsp_ddd_conversion_factors` converts raw units (packs, vials) → claim-equivalent counts so all three sources are on the same scale.

---

## Step 5: Build common spine and join (Cells 20–22)

Cross join of all NDC codes × all eLAAD months → one row per NDC per month.  
Left join eLAAD, DDD, and NSP onto this spine.

Ensures all months appear even if one source is missing for that month.

---

## Step 6: Roll up to brand family and compute factors (Cell 25)

Join `d_rx_codes_attr` to map NDC → `prod_desc_lvl3` (brand family).  
Aggregate all NDCs in a family per month, then compute:

```
elaad_ddd_fctr = sum(claim_count) / sum(ddd_units_norm)
elaad_nsp_fctr = sum(claim_count) / sum(nsp_units_norm)
ddd_nsp_fctr   = sum(ddd_units_norm) / sum(nsp_units_norm)
```

---

## Step 7: Apply caps and blocking factors (Cell 28)

### Cap at 1
```
if elaad_ddd_fctr > 1 → set to 1
if elaad_nsp_fctr > 1 → set to 1
```
A factor > 1 is impossible (eLAAD can't see more than the market).

### Blocking factor (hardcoded business adjustments)

| Product | Period | `blocking_fctr` |
|---------|--------|-----------------|
| VYNDAMAX | Always | 0.90 |
| AMVUTTRA | Before Feb 2024 | 0.55 |
| AMVUTTRA | Feb 2024 – Mar 2025 | 0.85 |
| AMVUTTRA | Apr 2025+ | 0.80 |
| ONPATTRO | Before Feb 2024 | 0.60 |
| ONPATTRO | Feb 2024+ | 0.85 |
| WAINUA | Always | 1.0 |

The blocking factor is a business-level coverage adjustment applied on top of the calculated factor.

---

## Step 8: Manual period overrides (Cell 31)

Additional one-time overrides for Sep 2023 – Jan 2024:

| Product | `elaad_nsp_fctr` override |
|---------|--------------------------|
| AMVUTTRA | 0.70 |
| ONPATTRO | 0.83 |

Applied to address a known data anomaly in that period.

---

## Step 9: Partial month handling (Cells 33–36)

### Problem

eLAAD refreshes more frequently than NSP. The most recent month in eLAAD may not yet have NSP data → `elaad_nsp_fctr` would be null or unreliable.

### Detection

```
adj_mnth = months in last 12 of eLAAD that are NOT in last 12 of NSP
adj_mnth_cnt = count of adj_mnth × -1
```

### Fix

If `adj_mnth_cnt > 0`:
- **Partial month** → use `elaad_nsp_fctr` and `blocking_fctr` from N months prior (where N = number of partial months)
- **All other months** → use actual computed values

If `adj_mnth_cnt = 0`: use `Final_NSP_projection` as-is.

---

## Step 10: Save final table (Cell 44)

```sql
CREATE OR REPLACE TABLE d_nsp_prjct_fctr AS
SELECT date_format(mnth, "yyyy-MM-dd") AS mnth,
       prod_family, claim_count, ddd_units_norm, nsp_units_norm,
       elaad_ddd_fctr, elaad_nsp_fctr, blocking_fctr
FROM fin_nsp
```

---

## Output schema

| Column | Description |
|--------|-------------|
| `mnth` | Month (YYYY-MM-DD, first of month) |
| `prod_family` | Brand family (e.g. WAINUA FAMILY, AMVUTTRA FAMILY) |
| `claim_count` | eLAAD claims that month |
| `ddd_units_norm` | DDD units normalized to claim-equivalent |
| `nsp_units_norm` | NSP units normalized to claim-equivalent |
| `elaad_ddd_fctr` | eLAAD / DDD ratio (capped at 1) |
| `elaad_nsp_fctr` | eLAAD / NSP ratio (capped at 1, partial-month adjusted) |
| `blocking_fctr` | Business coverage adjustment per product/period |

---

## Data flow

```
eLAAD claims             DDD weekly               NSP monthly
(f_attr_treatment        (outlet_sales_md         (f_sls_nsp_mth)
 _repo_table_final)       _wkly_attr)                    │
       │                       │                   Filter ATTR NDCs
 Count claims/mnth       Roll up via 445                 │
 Normalize VYNDAMAX      calendar                        │
       │                       │                         │
       │               × Unit_Per_Claim_Factor    × Unit_Per_Claim_Factor
       │                = ddd_units_norm           = nsp_units_norm
       │                       │                         │
       └────── Common spine (NDC × month) ───────────────┘
                               │
                     Roll up to brand family
                               │
              elaad_ddd_fctr = eLAAD / DDD_norm
              elaad_nsp_fctr = eLAAD / NSP_norm
              ddd_nsp_fctr   = DDD_norm / NSP_norm
                               │
              Cap at 1 + apply blocking_fctr
                               │
              Manual period overrides (Sep–Feb 2024)
                               │
              Partial month check → borrow from prior months
                               │
                   d_nsp_prjct_fctr (Delta)
```

---

## Key notes

- **Unit_Per_Claim_Factor** is critical — without it DDD/NSP units and eLAAD claims are not comparable scales.
- **Blocking factors are hardcoded** with dated comments — changes require code updates, not config changes.
- **Rolling 3-month smoothing** is noted as `YET TO IMPLEMENT` in the notebook (Cells 38–42, commented out).
- **Partial month logic runs automatically** — no manual trigger needed; detects the gap by comparing eLAAD and NSP month lists.
- **WAINUA always gets blocking_fctr = 1.0** — AZ's own product has full assumed coverage.
- Output table name `d_nsp_prjct_fctr` is distinct from the NSP factors in `NSP_mthly_fact` (SLE notebooks) — these are ATTR-market factors, not SLE factors.
