# Komodo Patient Journey — Documentation

**Notebook:** `(Updated) [Komodo] Patient Journey (2).ipynb`  
**Output Table:** `us_commercial_catalog_prod.lgu_eplontersen.komodo_pat_jrny_stage2`  
**Purpose:** Build a patient-level table with complete diagnosis history, treatment sequence, enrollment status, and phenotype classification for ATTR patients. Used for patient journey analysis, SOB reporting, and treatment pathway research.

---

## Glossary

| Term | Meaning |
|------|---------|
| **ATTR** | Transthyretin Amyloidosis — rare disease being studied |
| **hATTR** | Hereditary ATTR (genetic form) |
| **wtATTR** | Wild-type ATTR (non-genetic, age-related form) |
| **PN** | Polyneuropathy — nerve damage form of ATTR |
| **CM** | Cardiomyopathy — heart damage form of ATTR |
| **Silencer** | RNA-silencing drug class: WAINUA, AMVUTTRA, ONPATTRO |
| **Stabilizer** | TTR protein-stabilizing drug class: VYNDAMAX, ATTRUBY |
| **Add-On** | Patient is on BOTH Silencer and Stabilizer simultaneously |
| **Switch** | Patient moved from one drug class to the other |
| **Combo** | Started both classes within 91 days of each other |
| **Enrolled** | ≥80% of days between first ATTR dx and first treatment are in closed claims |
| **91-day threshold** | `within_same_period_threshold = 91` — events within this window treated as simultaneous |

---

## Static input files (3 CSVs)

| File | Path | Contents |
|------|------|---------|
| Diagnosis codes | `.../diag_code_patient_journey.csv` | Comorbidity ICD codes to track, with `az_grouping_1` labels |
| CPT codes | `.../cpt_codes_for_patient_journey.csv` | Procedure codes (tests, biopsies, etc.) |
| NDC codes | `.../ndc_codes_for_patient_journey.csv` | Drug NDC codes to track as treatments |

All loaded from Databricks Volumes.

---

## Source tables

| Table | Used for |
|-------|---------|
| `lg_claim.f_claim_mx_komodo_attr_v` | MX (medical) claims for ATTR patients |
| `lg_claim.f_claim_phcy_komodo_attr_v` | RX (pharmacy) claims — filtered to PAID + FINAL/STANDALONE |
| `lgu_eplontersen.komodo_raw_diagnosis_ATTR` | ATTR diagnosis codes per patient |
| `lgu_eplontersen.komodo_raw_treatments_ATTR` | Treatment claims per patient |
| `lgu_eplontersen.pt_rx_or_mx_enrt_komodo_am` | Enrollment (AND: both MX+RX) from Komodo Enrollment notebook |
| `lgu_eplontersen.pt_rx_or_mx_enrt_komodo_or` | Enrollment (OR: either MX or RX) |
| `us_commercial_app_commons_prod.d_claim_pat` | Patient state/demographics |

---

## Intermediate and output tables

| Table | Stage | Contents |
|-------|-------|---------|
| `additional_dx_data_pat_journey` | Intermediate | Comorbidity DX codes found in MX claims |
| `additional_procedure_data_pat_journey` | Intermediate | CPT procedures found in MX claims |
| `additional_treatment_data_pat_journey` | Intermediate | NDC treatments found in MX + RX claims |
| `additional_pat_journey_universe` | Intermediate | First service date per condition per patient (pivoted) |
| `komodo_first_diag_final` | Intermediate | First dates for all ATTR diagnosis dimensions + phenotype classification |
| `komodo_pat_jrny_stage1` | Intermediate | Joined diagnosis + treatment data, all patients |
| **`komodo_pat_jrny_stage2`** | **Final output** | Full patient journey with enrollment flags, all key columns |

---

## Step 1: Additional comorbidities (Cells 4–5)

Processes three code lists against MX and RX claims to find:

**DX data:** Comorbidity ICD codes in `diag_cd_array` of MX claims.  
Excludes conditions already in ATTR base set (ATTR, CM, PN, HF, AL, etc.).

**CPT data:** Procedure codes in MX claims matching the CPT list.

**NDC data:** Drug administrations (MX + RX) matching NDC codes, combined to `raw_additional_treatment_data`.

Each is saved to a permanent Delta table, then unioned and pivoted:
```
pat_id | first_service_date_<condition_A> | first_service_date_<condition_B> | ...
```
→ `additional_pat_journey_universe`

---

## Step 2: ATTR diagnosis pivot (Cells 8–12)

### Specific hATTR code pivot

| ICD Code | Meaning |
|---------|---------|
| E85.0 | hATTR (non-specific) |
| E85.1 | hATTR with PN |
| E85.2 | hATTR with CM |
| E85.82 | wtATTR |

### Summary diagnosis columns

| Column | Formula |
|--------|---------|
| `dx_date_of_first_pn` | `least(E85.1, DPN, GPN)` |
| `dx_date_of_first_attr_cm` | `least(HF, AFIB_HT, CM)` |
| `dx_date_of_first_hattr` | `least(E85.0, E85.1, E85.2)` |
| `dx_date_of_first_wtattr` | `E85.82` |

All comorbidity columns renamed to `dx_date_of_first_<condition>`.

---

## Step 3: Phenotype classification (Cell 14) → `komodo_first_diag_final`

| Column | Values | Logic |
|--------|--------|-------|
| `dx_final_phenotype` | CM_Only / PN_Only / Mixed / Uncat | Based on presence of CM and/or PN date |
| `dx_PN_First` | Yes / No | PN date < CM date |
| `dx_Close_Diagnosis` | Yes / No | `abs(PN date - CM date) < 91 days` |

---

## Step 4: Treatment processing (Cell 16)

Source: `komodo_raw_treatments_ATTR` — PAID + FINAL/STANDALONE claims only.

### Drug class groupings

| Class | Brands |
|-------|--------|
| Silencer | WAINUA, AMVUTTRA, ONPATTRO |
| Stabilizer | ATTRUBY, VYNDAMAX |

### Key treatment columns

| Column | Description |
|--------|-------------|
| `<BRAND>_first_rx_date` | First date on each brand |
| `<BRAND>_recent_rx_date` | Most recent date on each brand |
| `SILENCER_first_rx_date` | Earliest first date across all Silencers |
| `STABILIZER_first_rx_date` | Earliest first date across all Stabilizers |
| `first_treatment_rx_date` | Earlier of Silencer and Stabilizer first dates |
| `rx_treatment_array` | Ordered list of brands patient was on |

### Treatment flags

| Flag | Logic |
|------|-------|
| `rx_treatment_flag` | `Yes` if any Silencer or Stabilizer date exists |
| `rx_silencer_only_flag` | `Yes` if Silencer exists AND Stabilizer is null |
| `rx_stablizer_only_flag` | `Yes` if Stabilizer exists AND Silencer is null |

### `first_treatment_rx` classification (91-day rule)

```
Silencer   → Silencer_date + 91 days < Stabilizer_date
Stabilizer → Stabilizer_date + 91 days < Silencer_date
Combo      → |Silencer_date - Stabilizer_date| ≤ 91 days
Untreated  → No treatment
```

---

## Step 5: Stage 1 table — `komodo_pat_jrny_stage1` (Cells 17–19)

Patient universe = `komodo_first_diag_final` UNION `stage1_rx` (all diagnosed + treated patients).

Joins:
- All `dx_` columns from diagnosis data
- All `rx_` columns from treatment data

---

## Step 6: Enrollment flags (Cells 21–22)

Joins enrollment tables (from Komodo Enrollment notebook) to calculate:

```
overlap_window     = first ATTR diagnosis → max(SILENCER_first_rx_date, STABILIZER_first_rx_date)
overlap_days       = days in window covered by insurance enrollment episode
overlap_percentage = overlap_days / total window days
Enrolled           = Yes if overlap_percentage ≥ 80%
```

Two flags created:

| Flag | Enrollment table used | Definition |
|------|----------------------|-----------|
| `Enrolled_and` | `pt_rx_or_mx_enrt_komodo_am` | Both MX AND RX coverage ≥ 80% |
| `Enrolled_or` | `pt_rx_or_mx_enrt_komodo_or` | Either MX OR RX coverage ≥ 80% |

---

## Step 7: Additional flags (Cells 23–26)

| Flag | Logic |
|------|-------|
| `Add_On` | `SILENCER_first_rx ≤ STABILIZER_recent_rx AND STABILIZER_first_rx ≤ SILENCER_recent_rx` — overlapping periods |
| `Switch` | `SILENCER_recent_rx < STABILIZER_first_rx OR STABILIZER_recent_rx < SILENCER_first_rx` — no overlap |
| `<date>_plus90days` | +91 days added to 4 key dates for window analysis |
| `Patient_Journey` | Array of 8 events sorted chronologically: CM_Dx, PN_Dx, ATTR_Dx, Tx (+ 90-day versions) |

### Brand-level first treatment flags

| Column | Meaning |
|--------|---------|
| `first_attr_rx` | First brand ever used for ATTR |
| `first_silencer_rx` | First Silencer brand |
| `brand_first_between_amv_wai_rx` | Was AMVUTTRA or WAINUA first among siRNAs? |
| `brand_first_stabilizer_rx` | First Stabilizer brand |

---

## Final output — `komodo_pat_jrny_stage2` (Cell 27)

```sql
CREATE OR REPLACE TABLE komodo_pat_jrny_stage2 AS
SELECT * FROM stage2_final_view
WHERE Dx_Date_of_First_ATTR IS NOT NULL
```

Only patients with a confirmed ATTR diagnosis date are included.

---

## Key output columns summary

| Column group | Examples |
|-------------|---------|
| Diagnosis dates | `Dx_Date_of_First_ATTR`, `Dx_Date_of_first_PN`, `Dx_Date_of_First_ATTR_CM`, `Dx_Date_of_First_hATTR` |
| Diagnosis flags | `dx_final_phenotype`, `dx_PN_First`, `dx_Close_Diagnosis` |
| Treatment dates | `WAINUA_FAMILY_first_rx_date`, `SILENCER_first_rx_date`, `first_treatment_rx_date` |
| Treatment flags | `rx_treatment_flag`, `rx_silencer_only_flag`, `first_treatment_rx` |
| Brand sequence | `rx_treatment_array`, `first_attr_rx`, `first_silencer_rx` |
| Enrollment | `Enrolled_and`, `Enrolled_or` |
| Journey | `Patient_Journey`, `Add_On`, `Switch` |

---

## Data flow

```
CSV code lists (DX + CPT + NDC)    komodo_raw_diagnosis_ATTR
         │                                   │
  Find in MX/RX claims               ATTR diagnosis pivot
         │                           (per code + description)
  additional_pat_journey_universe             │
         │                           komodo_first_diag_final
         │                           (CM / PN / Mixed phenotype)
         └──────────────┬────────────────────┘
                        │
               komodo_pat_jrny_stage1
                        │
                        │    komodo_raw_treatments_ATTR
                        │           │
                        │   Silencer / Stabilizer flags
                        │   rx_treatment_array
                        │           │
               Join enrollment tables ──► Enrolled_and / Enrolled_or
                        │
               Add: Add_On / Switch / Patient_Journey
               Brand first flags (WAINUA vs AMVUTTRA etc.)
                        │
               komodo_pat_jrny_stage2  ✅
```

---

## Analysis objectives (from notebook)

1. Identify Mixed phenotype hATTR patients
2. Calculate % getting PN diagnosis before CM and vice versa
3. For CM-first patients: how many get a Stabilizer vs Silencer first?
4. What % of CM-first patients see therapy change, and when relative to PN diagnosis?
5. SOB: how did Wainua patients arrive (new, switch from AMVUTTRA, add-on from Stabilizer)?
6. Geographic breakdown of treatment patterns by state

---

## Key notes

- **91-day threshold** is used throughout — for "simultaneous" diagnosis, "Combo" treatment, and `Patient_Journey` window creation.
- **Enrolled_and is the stricter flag** — most analysis filters on `Enrolled_and = 'Yes'` to ensure complete claims visibility.
- **`rx_treatment_array`** preserves the sequence of brands, enabling analysis like "was WAINUA the 1st or 2nd brand for this patient?"
- **Three static CSVs** are required inputs — if paths change, the comorbidity section will fail.
- **Cells 29–55 are analytical/QC cells**, not pipeline outputs — they query `komodo_pat_jrny_stage2` and display results.
- This notebook depends on **Komodo Closed Claims Enrollment** notebook having run first (for `pt_rx_or_mx_enrt_komodo_am` and `_or` tables).
