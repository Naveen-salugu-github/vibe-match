# Field DSM SPSD Dashboard — Documentation

**Notebook:** `Field DSM SPSD dashboard`  
**Product:** WAINUA (eplontersen) — ATTR Market  
**Purpose:** Build SP and SD demand tables at the patient, HCP, HCA, IDN, territory, and district level to power the Field DSM dashboard and FSIP (sales incentive) allocation.

---

## Glossary

| Term | Meaning |
|------|---------|
| **SP** | Specialty Pharmacy — dispenses medicine directly to patients |
| **SD** | Specialty Distributor — ships medicine to pharmacies/hospitals |
| **HCP** | Healthcare Provider (prescribing doctor) |
| **HCA** | Healthcare Account (hospital/clinic/infusion center) |
| **IDN** | Integrated Delivery Network — a hospital system owning multiple HCAs |
| **DSM** | District Sales Manager |
| **Geo Alignment** | Monthly table mapping ZIP codes → territory → district → region |
| **FSIP** | Field Sales Incentive Plan — determines rep bonus allocation |
| **Demand** | Units actually dispensed to patients |
| **Shipment** | Units shipped from distributor to pharmacy/hospital |
| **NDC** | National Drug Code identifying specific drug forms |

---

## Products in scope

| NDC | Product Name |
|-----|-------------|
| `00310940001` | WAINUA PEN |
| `00310942001` | WAINUA PFS |

**Market filter:** `ATTR MARKET`  
**Diagnosis codes:** `E85.1, E85.2, E85.4, E85.8, E85.9` (ATTR variants)  
**Sales teams:** `BBU_ATTR`, `BBU_ATTR_PR`, `BBU_ATTR_1A`

---

## Source tables

| Variable | Table | Used for |
|----------|-------|---------|
| `sp_table` | `f_ship_rfrl_sp_cust_prod_payr_wk` | SP dispenses and referrals |
| `sd_table` | `f_ship_sls_sd_cust_prod_wk` | SD shipments and sales |
| HCP demographics | `lgu_eplontersen.d_hcp_specialty_dimension` | Doctor name, ZIP, specialty |
| IDN mapping | `lgu_eplontersen.d_idn_hcp_fctr_acct` | Doctor → IDN affiliation |
| Affiliations | `lgu_eplontersen.hcp_hca_idn_corrected_affiliation_final` | HCA → IDN mapping |
| Geo alignment | `lg_targeting.stp_geoalignment_<MMMYYYY>` | ZIP → territory/district |
| SP metrics | `lgu_eplontersen.sp_metrics` | Referral status flags |
| FSIP allocation | `r_alloc_fsip` | Territory allocation % per account |

---

## Geo Alignment — auto-fallback logic

```
Try: current month table (e.g. stp_geoalignment_Jun2026)
If not available → use previous month (e.g. stp_geoalignment_May2026)
```

Prevents pipeline failure when the new month's alignment hasn't been published yet.

---

## Output tables

| Table | Grain | Description |
|-------|-------|-------------|
| `sp_hcp_date` | Patient × HCP × Day | SP demand with territory and IDN |
| `sd_hca_idn` | HCA × Day | SD demand and shipment with IDN and territory |
| `spsd_districtlevel_daily` | District × Day | Combined SP+SD demand for dashboard |
| `sd_sp_hcp_hca_idn` | HCP/HCA × Week | Combined SP+SD weekly with IDN affiliations |
| `sp_referrals_demands` | Patient × HCP × Month | Referral outcomes (approved, denied, discontinued, triaged) |
| `fsip_alloc` | Account × Week | Demand allocated to territories by FSIP % |

---

## Section 4: SP Demand Table — `sp_hcp_date`

**Source:** `sp_table`  
**Filters:** `mkt_nm = 'ATTR MARKET'`, `medvntx_ind = 'N'`, `file_typ IN ('DISPENSE','SALES')`, `flex_1 = 1586979`, NDC in scope

### Steps

1. **Aggregate dispenses** — sum `qty_disp` per patient (`sp_pat_id`) + doctor (`az_cust_id`) + day, computing week end date.
2. **Enrich with HCP ZIP** — join `d_hcp_specialty_dimension` for doctor ZIP code.
3. **Add IDN affiliation** — join `d_idn_hcp_fctr_acct` for Primary IDN ID/Name/Type.
4. **Add payer type** — decode `src_pay_typ` to CASH / COMMERCIAL / MEDICARE / MEDICAID / OTHER GOVT.
5. **Add first dispense date** — `min(ship_dt)` per patient.
6. **Add territory** — join geo alignment on ZIP → region, district, territory.

### Output schema (key columns)

| Column | Description |
|--------|-------------|
| `Product` | WAINUA PEN or WAINUA PFS |
| `sp_pat_id` | Patient identifier |
| `az_cust_id` | Doctor identifier |
| `ship_dt` | Dispense date |
| `wk_end_dt` | Week ending date |
| `Month` | Month (first day) |
| `SP_demand_units` | Units dispensed |
| `diag_cd` | Diagnosis code |
| `pay_type` | Payer category |
| `PRIMARY_IDN_ID/Name` | Hospital system |
| `region_name`, `district_name`, `terr_id`, `terr_name` | Sales territory hierarchy |

---

## Section 5: SD Demand Table — `sd_hca_idn`

**Source:** `sd_table`  
**Filters:** `mkt_nm = 'ATTR MARKET'`, NDC in scope

### Two demand measures

| Measure | Filter | Meaning |
|---------|--------|---------|
| `SD_DEMAND_UNITS` | `src_dedupe_ind = 'N'` | Units sold by distributor |
| `SD_SHIPMENT_UNITS_TO_SP` | `src_dedupe_ind = 'Y'` | Units forwarded from distributor to SP |

### Steps

1. Build dimension spine (all unique account/date/NDC combos).
2. Calculate `SD_DEMAND_UNITS` from non-deduplicated rows.
3. Calculate `SD_SHIPMENT_UNITS_TO_SP` from deduplicated rows.
4. Full join all three, compute week end date and month.
5. Join affiliation table (Source = 'HCA') for HCA name, ZIP, IDN, territory.

### Output schema (key columns)

| Column | Description |
|--------|-------------|
| `Product` | WAINUA PEN or WAINUA PFS |
| `az_cust_id` | Distributor account ID |
| `rpt_dt` | Report date |
| `wk_end_dt` | Week end date |
| `SD_DEMAND_UNITS` | Demand units |
| `SD_SHIPMENT_UNITS_TO_SP` | Units sent to SP |
| `hca_cust_name` | Account name |
| `IDN_ID/Name/Type` | Hospital system info |
| `region_name`, `district_name`, `terr_id`, `terr_name` | Territory hierarchy |

---

## Section 6: District-Level SPSD Table — `spsd_districtlevel_daily`

Full outer join of `sd_hca_idn` and `sp_hcp_date` on `date + district + product`.

```
District daily row:
  SD_Demand       = sum(SD_DEMAND_UNITS) from sd_hca_idn
  SD_Shipment_to_SP = sum(SD_SHIPMENT_UNITS_TO_SP) from sd_hca_idn
  SP_Demand       = sum(SP_demand_units) from sp_hcp_date
```

**Used in:** Dashboard district-level demand view.

---

## Section 7: HCP/HCA Weekly Table — `sd_sp_hcp_hca_idn`

### Steps

1. **`sp_wk`** — weekly SP demand per HCP + Primary IDN, grouped from `sp_final`.
2. **`sd_wk`** — weekly SD demand per HCA + affiliation IDN, grouped from `all_hca_profile_IDN`.
3. **Full join** on `wk_end_dt + IDN + az_cust_id + ZIP + product`.

### Output columns

| Column | Description |
|--------|-------------|
| `SP_Demand` | Weekly SP units (HCP side) |
| `SD_Demand` | Weekly SD units (HCA side) |
| `Total` | SP_Demand + SD_Demand |
| `SP_SD` | Flag — `"SP"` or `"SD"` |
| `Final_IDN_ID/Name` | Resolved IDN for the row |

**Used in:** IDN Potential Dashboard, Monthly Deck, ad hoc IDN-level Wainua data.

---

## Section 8: SP Referrals Demand Table — `sp_referrals_demands`

Tracks the full referral outcome for every patient per doctor per month.

### Patient universe

Union of three sources to ensure no patient is missed:
- `sp_metrics` (referred patients)
- `sp_hcp_date` (dispensed patients)
- SP table DISCONTINUED patients

### Referral flags

| Flag | Meaning | Logic |
|------|---------|-------|
| `approved_flag` | Referral approved | From `sp_metrics` |
| `denied_flag` | Referral denied | From `sp_metrics` |
| `abandoned_flag` | Referral abandoned | From `sp_metrics` |
| `pending_flag` | Referral pending | From `sp_metrics` |
| `discontinued_flag` | Patient stopped | DISCONTINUED status is the **latest** status |
| `triaged_flag` | Patient triaged | TRIAGED status is the **latest** status |

**Key rule for discontinued/triaged:** Flag = 1 only if the status date is **after** any later non-discontinued/non-triaged status. This prevents false flags when a patient restarts.

### Output joins

Final `sp` table enriches with:
- IDN affiliation
- Doctor name
- Territory info
- Actual SP demand units

**Used in:** Referral Outcomes section of the HQ View in DSM dashboard.

---

## Section 9: FSIP Allocation — `fsip_alloc`

Allocates demand to territories using pre-defined allocation percentages per account.

```
Allocated demand = demand × coalesce(pct_alocn, 1.0)
```

- Source: `r_alloc_fsip` filtered to `brd_nm = 'WAINUA'` and `qrtr = 'Q4 2025'`
- If an account has no allocation entry → 100% assigned to ZIP-mapped territory
- Territory join on ZIP from geo alignment table

**Used in:** FSIP (sales incentive plan) calculations — determining how much of an account's volume counts toward each rep's bonus.

---

## Data flow

```
sp_table                     sd_table
(SP dispenses/referrals)     (SD shipments/sales)
       │                            │
  [normalize, enrich]         [normalize, enrich]
  [ZIP → territory]           [ZIP → territory]
  [IDN affiliation]           [HCA affiliation]
       │                            │
  sp_hcp_date               sd_hca_idn
  (patient×HCP×day)         (account×day)
       │                            │
       └──────────┬─────────────────┘
                  │
       ┌──────────┴──────────┐
       ▼                     ▼
spsd_districtlevel_daily   sd_sp_hcp_hca_idn
(district×day              (HCP/HCA×week
 dashboard view)            IDN-level view)
                                  │
                            fsip_alloc
                            (territory split
                             by FSIP %)

sp_table (referrals)
       │
  universe + outcome flags
  (approved, denied, discontinued, triaged)
       │
  sp_referrals_demands
  (HQ dashboard referral view)
```

---

## Key notes

- **Week end date** is calculated as: next Saturday from any given date, so all days in a week roll up to the same `wk_end_dt`.
- **Geo alignment is monthly** — auto-falls back to prior month if current month isn't published.
- **FSIP allocation** defaults to 100% if no allocation row exists for an account.
- `src_dedupe_ind` in SD table distinguishes true sales (`N`) from inter-channel transfers to SP (`Y`).
- `discontinued_flag` and `triaged_flag` use "latest status" logic — a patient who restarted is not counted as discontinued.
- All output tables use Delta format, overwrite mode.
