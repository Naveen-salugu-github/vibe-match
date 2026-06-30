# SP + A360 Mapping — Documentation

**Notebook:** `SP + A360 Mapping.ipynb`  
**Output Table:** `us_commercial_catalog_prod.lgu_eplontersen.sp_a360_mapping`  
**Purpose:** Link patients between two separate systems — AstraZeneca's A360 patient services portal and the Specialty Pharmacy (SP) tracking system — so that a single patient can be followed end-to-end from initial service request through to drug dispensing.

---

## The core problem this solves

The same WAINUA (ATTR) patient appears in **two systems with two different IDs**:

| System | Patient ID format | What it tracks |
|--------|------------------|----------------|
| **A360 (Access360)** | `PEP_ID-XXXXXXX` | Service requests — prior auth, insurance, pharmacy coordination |
| **SP (Specialty Pharmacy)** | `SP_ID` (e.g. from Orsini) | Referral receipt, dispensing, shipping status |

Without this mapping, you can't answer: "Did this A360 patient ever get their drug dispensed?" or "For this SP shipment, what was the original service request?"

---

## Glossary

| Term | Meaning |
|------|---------|
| **A360** | Access360 — AstraZeneca's patient services hub for ATTR (WAINUA) |
| **SP** | Specialty Pharmacy — handles drug triage, PA, and dispensing |
| **SP_ID** | Specialty pharmacy internal patient identifier |
| **PEP_ID** | A360 patient identifier (format: `PEP_ID-5XXXXXX`) |
| **Affiliate_ID** | The patient's PEP_ID as stored in the SP status file |
| **Direct match** | SP record has Affiliate_ID that equals the A360 PEP_ID |
| **Fuzzy match** | No ID match but same HCP + referral date within ±2 days |
| **uniq_pat_id** | Composite key: `{patient_id_numeric}-{sp_pat_id}` |
| **data_src** | Indicates how the match was made: `direct_match`, `fuzzy_match`, `sp_only`, `a360_only` |
| **CoE** | Center of Excellence |

---

## Input files

| Source | Path | Contents |
|--------|------|---------|
| `A360.csv` | `/Volumes/us_commercial_catalog_prod/lgu_eplontersen/new_sp_a360/A360.csv` | Fresh A360 service request data — one row per service request per patient |
| `AstraZenecaStatus_Summary_Daily_MMDDYY.csv` | Same Volumes path | Latest SP status file — dynamically picked by most recent date in filename |
| `sp_metrics` | `lgu_eplontersen.sp_metrics` | SP metrics enrichment — provides MIN_REFERRAL_DT and referral HCP where SP status file data is missing |
| `hcp_demog` | `lg_reference.hcp_demog` | Maps NPI → `hcp_az_cust_id` for SP file enrichment |
| `a_360_combined` | `lgu_eplontersen.a_360_combined` | Cumulative A360 history (earliest service request per patient per HCP) |

---

## Output tables

| Table | Description |
|-------|-------------|
| `a_360_recent` | Just-loaded fresh A360 data (overwritten each run, backup saved to `a_360_recent_bck`) |
| `a_360_combined` | Cumulative A360 history: `MIN(Service_Request_Created_Date)` per `(hcp_az_id, patient_id)` |
| **`sp_a360_mapping`** | **Final output** — full SP↔A360 mapping enriched with HCP, territory, IDN, and CoE |

---

## Step-by-step logic

### Step 1 — Load and refresh A360 data (Cells 1–9)

1. Load `A360.csv` from Volumes.
2. Parse `Service_Request_Created_Date` from `MM/dd/yyyy` string → clean date column.
3. Backup `a_360_recent` → `a_360_recent_bck`, then overwrite `a_360_recent` with new data.
4. Extract distinct `(hcp_az_id, patient_id, Service_Request_Created_Date)` from the new data and standardize the `patient_id` format (extract numeric part, prepend `PEP_ID-`).
5. Union with existing `a_360_combined` (cumulative history), then group and keep `MIN(Service_Request_Created_Date)` per `(hcp_az_id, patient_id)`.
6. Overwrite `a_360_combined` — this is the running all-time history table.

> **Entry point note (Cell 10 comment):** If A360 table is already up to date, skip to Cell 11 and run only the SP + mapping sections.

---

### Step 2 — Load and enrich SP status file (Cells 12–13)

1. **Dynamically pick the latest SP file**: scans the Volumes folder for files matching `AstraZenecaStatus_Summary_Daily_MMDDYY.csv` pattern, parses the date from the filename, and loads the most recent one. No hardcoded paths.
2. Parse date columns (`Referral_Date`, `Status_Date`).
3. Join to `hcp_demog` on `Physician_NPI` → adds `Physician_az_id` (AZ customer ID for the prescribing HCP).
4. **Enrich with sp_metrics**: for the same SP_ID, `COALESCE` the referral date and HCP from `sp_metrics` when the SP status file has missing data.
5. Standardize `Affiliate_ID` to `PEP_ID-XXXXXXX` format.

---

### Step 3 — Three-stage patient matching (Cells 15–18)

The matching runs in priority order. Each stage only handles patients NOT yet matched in a prior stage.

#### Stage 1 — Direct match (Cell 15)
```
SP.Affiliate_ID = A360.patient_id  (after standardizing format)
```
SP record explicitly carries the A360 patient ID. Most reliable match.  
→ `data_src = 'direct_match'`

#### Stage 2 — Fuzzy match (Cell 16)
For patients not in Stage 1, attempt a probabilistic match:
```
Same HCP (hcp_az_id = Physician_az_id)
AND SP.Referral_Date BETWEEN A360.Service_Request_Created_Date − 2 days
                         AND A360.Service_Request_Created_Date + 2 days
```
- Ranked by closest date difference (`row_number() OVER PARTITION BY sp_pat_id`).
- Both SP-side and A360-side rankings applied → enforces **1:1 mapping** (no one patient maps to multiple records).  
→ `data_src = 'fuzzy_match'`

#### Stage 3 — Unmatched remainder
- **SP-only** (Cell 17): SP patients with no A360 match → `patient_id = 'NA'`, `data_src = 'sp_only'`
- **A360-only** (Cell 18): A360 patients with no SP match → `sp_pat_id = 'NA'`, `data_src = 'a360_only'`

---

### Step 4 — Combine and create composite key (Cells 19–20)

Union all 4 match buckets:
```sql
direct_match UNION ALL fuzzy_match UNION ALL sp_only UNION ALL a360_only
```

Create `uniq_pat_id`:
```
uniq_pat_id = {patient_id_numeric} - {sp_pat_id}
-- e.g. "5497456-SP12345" for matched, "5497456-NA" for A360-only, "NA-SP12345" for SP-only
```

Create `Source` flag:
```
'SP'   if sp_pat_id != 'NA'   (patient has a specialty pharmacy record)
'A360' if sp_pat_id == 'NA'   (patient is in A360 only)
```

---

### Step 5 — Geo, IDN, and HCP enrichment (Cell 21)

For each patient in the mapping, join to:

| Enrichment | Join table | Adds |
|-----------|-----------|------|
| HCP details | `d_hcp_specialty_dimension_stage1` | `hcp_cust_name`, `npi`, `Specialty_desc`, `SPECIALTY_GROUP_1`, `zip` |
| Territory | `stp_geoalignment_{MMMyyyy}` (dynamic) | `terr_id`, `terr_name`, `dist_id`, `district_name`, `region_name` |
| IDN | `d_idn_hcp_fctr_acct_stage1` | `IDN_ID`, `IDN_Name`, `IDN_type` |
| IDN address | `hca_profile` | `idn_addr`, `idn_city`, `idn_state`, `idn_zip` |
| CoE | `d_IDNs_WITH_COE` | `coe_flag` (1/0) |
| SP dates | `status_file_upd` | `rx_rcv_dt` = earliest SP referral date |
| A360 dates | `a_360_combined` | `Service_Request_Created_Date` = earliest A360 service request date |

**Geo table dynamic logic:** tries current month's geo table; falls back to previous month if current doesn't exist.  
**Team filter:** only BBU_ATTR territory alignments are included (`team IN ('BBU_ATTR','BBU_ATTR_PR','BBU_ATTR_1A')`).

---

### Step 6 — QC checks (Cells 23–26)

| Check | Query | Purpose |
|-------|-------|---------|
| Duplicate `uniq_pat_id` | Count > 1 | Each composite key should be unique |
| Duplicate `sp_pat_id` | Count > 1 | Each SP patient should map to one row |
| Duplicate `patient_id` | Count > 1 | Each A360 patient should map to one row |
| Volume by source + month | Count distinct `uniq_pat_id` | Sanity check on patient counts by source over time |

---

### Step 7 — Save final table (Cell 28)

```sql
CREATE OR REPLACE TABLE us_commercial_catalog_prod.lgu_eplontersen.sp_a360_mapping
AS SELECT DISTINCT * FROM sp_a360_final
```

---

## Final output schema

| Column | Description |
|--------|-------------|
| `uniq_pat_id` | Composite key: `{patient_numeric}-{sp_pat_id}` |
| `patient_id` | A360 numeric patient ID (or `'NA'` if no A360 record) |
| `sp_pat_id` | SP system patient ID (or `'NA'` if no SP record) |
| `Source` | `'SP'` or `'A360'` |
| `data_src` | Match type: `direct_match`, `fuzzy_match`, `sp_only`, `a360_only` |
| `referral_dt` | Patient referral date (from SP or A360) |
| `hcp_az_id` | HCP AstraZeneca customer ID |
| `hcp_cust_name` | HCP name |
| `npi` | HCP NPI |
| `Specialty_desc`, `SPECIALTY_GROUP_1` | HCP specialty |
| `zip` | HCP zip code |
| `terr_id`, `terr_name` | Sales territory |
| `dist_id`, `district_name`, `region_name` | Sales geography |
| `IDN_ID`, `IDN_Name`, `IDN_type` | Primary IDN affiliation |
| `idn_addr`, `idn_city`, `idn_state`, `idn_zip` | IDN address |
| `coe_flag` | 1 if IDN is a Center of Excellence, 0 otherwise |
| `rx_rcv_dt` | Earliest SP referral date (when SP received the referral) |
| `Service_Request_Created_Date` | Earliest A360 service request date |

---

## Data flow

```
A360.csv (Volumes)                       AstraZenecaStatus_Summary_Daily_MMDDYY.csv
       │                                          │
Load + parse dates                     Load latest file (dynamic name pick)
       │                                 + join hcp_demog for az_id
       │                                 + coalesce with sp_metrics
       ▼                                          ▼
a_360_recent → a_360_combined            status_file_upd
(cumulative all-time history)            (enriched SP status)
       │                                          │
       └──────────────┬───────────────────────────┘
                      │
            ┌─────────▼──────────┐
            │  Stage 1: Direct   │ SP.Affiliate_ID = A360.patient_id
            └─────────┬──────────┘
                      │ unmatched remainder
            ┌─────────▼──────────┐
            │  Stage 2: Fuzzy    │ Same HCP + date within ±2 days (1:1)
            └─────────┬──────────┘
                      │ still unmatched
            ┌─────────▼──────────┐
            │  Stage 3: Leftovers│ sp_only + a360_only
            └─────────┬──────────┘
                      │
         Union all 4 → add uniq_pat_id + Source flag
                      │
         Enrich: HCP + Territory + IDN + CoE + dates
                      │
              sp_a360_mapping ✅
```

---

## Key notes

- **Backup pattern**: Before every overwrite, the existing table is backed up to a `_bck` table (`a_360_recent_bck`, `a_360_combined_bck`, `sp_a360_mapping_bck`). Safe to revert if needed.
- **The ±2 day fuzzy window** is a business rule — patients who submit an A360 request and get referred to a specialty pharmacy within 2 days are considered the same event.
- **1:1 enforcement**: The fuzzy match uses `row_number()` from both sides to ensure no patient is double-counted even if multiple candidates exist.
- **Dynamic geo table**: The geo alignment table name includes the current month. The notebook tries the current month first and falls back to the previous month if unavailable — same auto-fallback pattern as the Field DSM SPSD Dashboard notebook.
- **`a_360_combined` is cumulative**: Every run appends new A360 records and keeps the earliest `Service_Request_Created_Date` per patient-HCP pair. This preserves the full patient history across multiple loads.
- **Only BBU_ATTR teams** are included in the geo alignment join — this is WAINUA-specific.
