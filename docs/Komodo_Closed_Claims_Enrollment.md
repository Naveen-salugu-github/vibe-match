# Komodo Closed Claims — Enrollment Table Creation

**Notebook:** `Komodo Closed Claims Table Creation.ipynb`  
**Purpose:** Process Komodo Health patient insurance enrollment data into continuous enrollment episodes per patient, for 6 different coverage combinations (MX and/or RX). Used downstream to determine when a patient's claims data is reliable.

---

## Why enrollment data matters

In closed claims analysis, **no claim ≠ no treatment** unless the patient was actually enrolled during that period. These tables define exactly when each patient had active insurance coverage, so downstream notebooks can filter to **reliable observation windows** only.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Komodo** | Healthcare data vendor providing complete, adjudicated closed claims |
| **MX** | Medical claims — hospital or infusion-administered drug (`mdcl_claim_cls`) |
| **RX** | Pharmacy claims — retail/specialty pharmacy dispensing (`phcy_claim_cls`) |
| **Eligibility** | A period when a patient had active insurance coverage |
| **Enrollment episode** | One continuous stretch of insurance coverage |
| **45-day gap rule** | Gaps ≤ 45 days are treated as continuous enrollment (industry standard) |
| **qualified_gap_flag** | = 1 if gap > 45 days (true break); = 0 otherwise |

---

## Source table

```
us_commercial_catalog_prod.lg_claim.d_claim_pat_enrlt_komodo_attr_v
```

Komodo's ATTR-specific patient enrollment records. Each row is one eligibility period (start → end) for one patient.

Key columns:
- `pat_id` — patient identifier
- `eligy_strt_dt` — coverage start date
- `eligy_end_dt` — coverage end date
- `mdcl_claim_cls` — True if patient has medical claim class enrollment
- `phcy_claim_cls` — True if patient has pharmacy claim class enrollment

---

## Core algorithm (3 steps, repeated 6 times)

### Step 0 — Detect real breaks in coverage

```sql
lag(eligy_end_dt) OVER (PARTITION BY pat_id ORDER BY eligy_strt_dt) AS prev_eligy_end_dt
gap = datediff(eligy_strt_dt, prev_eligy_end_dt)

qualified_gap_flag =
  CASE
    WHEN prev_eligy_end_dt IS NULL          THEN 0  -- first record
    WHEN gap <= 45                          THEN 0  -- minor gap, treated as continuous
    ELSE                                         1  -- real break in coverage
  END
```

### Step 1 — Number each continuous episode

```sql
enrollment_episode = SUM(qualified_gap_flag) OVER (
  PARTITION BY pat_id
  ORDER BY eligy_strt_dt, eligy_end_dt
  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
)
```

Running sum of flags gives each continuous stretch a unique episode number per patient.

### Step 2 — Collapse to one row per episode

```sql
SELECT DISTINCT pat_id,
  MIN(eligy_strt_dt) OVER (PARTITION BY pat_id, enrollment_episode) AS overall_eligy_strt_dt,
  MAX(eligy_end_dt)  OVER (PARTITION BY pat_id, enrollment_episode) AS overall_eligy_end_dt
```

Compresses multiple overlapping/adjacent eligibility records into a single start–end span per episode.

---

## Six enrollment types

| Type | Filter condition | Business meaning |
|------|-----------------|-----------------|
| `_am` | `mdcl = True AND phcy = True` | Patient has BOTH medical AND pharmacy coverage |
| `_or` | `mdcl = True OR phcy = True` | Patient has EITHER type of coverage |
| `_mx_only` | `mdcl = True AND phcy = False` | Medical coverage only — no pharmacy |
| `_rx_only` | `mdcl = False AND phcy = True` | Pharmacy coverage only — no medical |
| `_mx` | `mdcl = True` | Any medical enrollment (regardless of pharmacy) |
| `_rx` | `phcy = True` | Any pharmacy enrollment (regardless of medical) |

---

## Output tables (18 total — 3 stages × 6 types)

### Stage tables (intermediate)

| Table | Description |
|-------|-------------|
| `pt_rx_or_mx_enrt_komodo_0_<type>` | Raw eligibility with gap and qualified_gap_flag |
| `pt_rx_or_mx_enrt_komodo_1_<type>` | Adds enrollment_episode number |

### Final tables (used downstream)

| Table | Coverage type |
|-------|--------------|
| `pt_rx_or_mx_enrt_komodo_am` | Both MX AND RX — strictest window |
| `pt_rx_or_mx_enrt_komodo_or` | Either MX OR RX — broadest window |
| `pt_rx_or_mx_enrt_komodo_mx_only` | Medical only |
| `pt_rx_or_mx_enrt_komodo_rx_only` | Pharmacy only |
| `pt_rx_or_mx_enrt_komodo_mx` | Any medical |
| `pt_rx_or_mx_enrt_komodo_rx` | Any pharmacy |

**All final tables share the same 3-column schema:**

| Column | Description |
|--------|-------------|
| `pat_id` | Patient identifier |
| `overall_eligy_strt_dt` | Start of continuous enrollment episode |
| `overall_eligy_end_dt` | End of continuous enrollment episode |

---

## Data flow (repeated for each of 6 enrollment types)

```
d_claim_pat_enrlt_komodo_attr_v
          │
  Filter by enrollment type
  (AND / OR / mx_only / rx_only / mx / rx)
          │
  Step 0: Detect gaps > 45 days → qualified_gap_flag
  → pt_rx_or_mx_enrt_komodo_0_<type>
          │
  Step 1: Cumsum of flags = episode number
  → pt_rx_or_mx_enrt_komodo_1_<type>
          │
  Step 2: Collapse → one row per patient per episode
  → pt_rx_or_mx_enrt_komodo_<type>  ✅
```

---

## Example: How episode numbering works

| pat_id | eligy_strt | eligy_end | gap | flag | episode |
|--------|-----------|----------|-----|------|---------|
| P001 | 2022-01-01 | 2022-06-30 | null | 0 | 0 |
| P001 | 2022-07-10 | 2022-12-31 | 10 | 0 | 0 (gap ≤ 45 → same episode) |
| P001 | 2023-03-01 | 2023-08-31 | 60 | 1 | 1 (gap > 45 → new episode) |

After Step 2:

| pat_id | overall_eligy_strt_dt | overall_eligy_end_dt |
|--------|----------------------|---------------------|
| P001 | 2022-01-01 | 2022-12-31 |
| P001 | 2023-03-01 | 2023-08-31 |

---

## Key notes

- **45-day gap threshold** is the industry-standard for continuous enrollment in claims analysis. Shorter gaps (job change, plan renewal lag, admin delay) are treated as continuous.
- **Six enrollment types** serve different downstream uses: IV drug analysis needs MX enrollment; SC/retail pharmacy analysis needs RX enrollment; combined analyses use the OR or AND flavors.
- **Stage 0 and Stage 1 tables are intermediate** — kept for auditability and debugging. Only the final collapsed tables are used downstream.
- All tables are created as Delta tables using `CREATE OR REPLACE`.
- Source is Komodo Health's ATTR-specific enrollment view (`_attr_v`), so data is pre-filtered to ATTR-relevant patients.
