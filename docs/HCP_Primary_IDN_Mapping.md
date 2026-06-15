# HCP Primary IDN Mapping — Documentation

**Notebook:** `09.2_HCP_Primary_IDN_Mapping.ipynb`  
**Purpose:** For every HCP (doctor) in the ATTR space, identify their **Primary IDN** (main hospital system) and **Secondary IDN** using a ranked affiliation model.

> This notebook replaces three legacy notebooks: `09.1_D_IDN_HCP_NEW_FCTR`, `09.2_IDN_mapping`, and `09.3_Final_IDN_mapping`. It applies affiliation corrections earlier in the pipeline via the corrected affiliation table.

---

## Glossary

| Term | Meaning |
|------|---------|
| **HCP** | Healthcare Provider — the prescribing doctor |
| **IDN** | Integrated Delivery Network — a hospital system owning multiple accounts |
| **HCA** | Healthcare Account — individual hospital or clinic |
| **Factor** | Weight representing the proportion of an HCP's activity at a given IDN |
| **Primary IDN** | The most important IDN affiliation for an HCP |
| **Secondary IDN** | The second most important IDN affiliation |
| **CoE** | Center of Excellence — high-priority IDN flagged in a reference table |
| **ATTR** | Transthyretin amyloidosis — the disease market for WAINUA |
| **HSAT** | Highest-level IDN type in the hierarchy |

---

## Source tables

| Table | Used for |
|-------|---------|
| `lgu_eplontersen.hcp_hca_idn_corrected_affiliation_stage1` | HCP→IDN affiliations with factors (stage 1 corrected) |
| `lgu_eplontersen.hcp_hca_idn_corrected_affiliation_final` | Final corrected affiliations (includes ZIP + territory) |
| `lgu_eplontersen.d_IDNs_WITH_COE` | Reference list of IDNs that are Centers of Excellence |

---

## Output tables

| Table | Grain | Contents |
|-------|-------|---------|
| `d_idn_hcp_fctr_acct_stage1` | HCP × IDN | All HCPs with primary + secondary IDN ranked |
| `d_idn_hcp_fctr_acct` | HCP × IDN | ATTR universe only — used by Field DSM dashboard and SP demand pipeline |
| `d_idn_hcp_fctr_terr` | HCP × IDN × Territory | Same as above with HCA ZIP and territory info added |

---

## Step 1: Aggregate factors (Cell 2)

```sql
SELECT hcp_Az_Cust_id, IDN_ID, IDN_Name, IDN_Type, sum(factor) as factor
FROM hcp_hca_idn_corrected_affiliation_stage1
GROUP BY ALL
```

A single HCP can be linked to the same IDN through multiple HCAs.  
Summing factors collapses those into **one row per HCP + IDN** with a total weight.

---

## Step 2: Flag Centers of Excellence (Cell 4)

```sql
CASE WHEN IDN_ID = az_top_parent_id THEN 1 ELSE 0 END AS IDN_with_CoE_Flag
```

Left join with `d_IDNs_WITH_COE`.  
The CoE flag is used as a tiebreaker in the ranking step — CoE IDNs are preferred over non-CoE IDNs when other criteria are equal.

---

## Step 3: Rank IDNs per HCP (Cell 6)

Each IDN for an HCP is ranked using:

```sql
rank() OVER (
  PARTITION BY hcp_az_cust_id
  ORDER BY idn_type_hirchy ASC, factor DESC, IDN_with_CoE_Flag DESC, IDN_id ASC
)
```

### IDN type hierarchy

| Rank | IDN Type | Meaning |
|------|---------|---------|
| 1 | `HSAT` | Highest-level health system |
| 2 | `top_parent` | Top parent organization |
| 3 | `parent` | Mid-level parent |
| 4 | `HCA` | Individual account |
| 5 | Other | Anything else |

### Tiebreakers (applied in order)

1. **Higher factor** — more activity = higher priority
2. **CoE flag = 1** — prestigious systems preferred
3. **Lower IDN_ID** — alphabetical/numeric tiebreaker for determinism

---

## Step 4: Attach Primary and Secondary IDN (Cell 8)

Self-join on `primary_stage1`:
- `rank_idn_type = 1` → **PRIMARY IDN** columns
- `rank_idn_type = 2` → **SECONDARY IDN** columns

Every row in the table gets both sets of columns populated via left join.

### Output columns added

| Column | Description |
|--------|-------------|
| `PRIMARY_IDN_ID` | ID of the top-ranked IDN |
| `PRIMARY_IDN_Name` | Name of the primary IDN |
| `PRIMARY_IDN_Type` | Type (HSAT / top_parent / parent / HCA) |
| `SECND_IDN_ID` | ID of the second-ranked IDN |
| `SECND_IDN_Name` | Name of the secondary IDN |
| `SECND_IDN_Type` | Type of the secondary IDN |

---

## Step 5: Save account-level tables (Cells 11, 13)

### Stage 1 — All HCPs

```sql
create or replace table d_idn_hcp_fctr_acct_stage1 as select * from hcp_idn_actn
```

Contains all HCPs from the stage1 affiliation table — no market filter.

### Final — ATTR Universe only

```sql
create or replace table d_idn_hcp_fctr_acct as
select * from hcp_idn_actn
where hcp_az_cust_id in (
  select distinct hcp_az_cust_id from hcp_hca_idn_corrected_affiliation_final
)
```

Filtered to HCPs relevant to the ATTR market. **This is the table consumed by downstream notebooks.**

---

## Step 6: Territory-level table (Cells 15–18)

Reads from the **final** corrected affiliation table (includes `hca_zip`, `Territory_ID`, `Territory_name`), groups by HCP + IDN + territory, then joins in the Primary/Secondary IDN from `hcp_idn_actn`.

```sql
create or replace table d_idn_hcp_fctr_terr as select * from hcp_pri_sec
```

Adds territory info to the IDN mapping — used when territory-level attribution is needed alongside IDN.

---

## Data flow

```
hcp_hca_idn_corrected_affiliation_stage1
        │
  Sum factor per HCP + IDN
        │
  Join d_IDNs_WITH_COE → IDN_with_CoE_Flag
        │
  Rank IDNs per HCP:
    Priority: HSAT > top_parent > parent > HCA
    Tiebreak: factor↓  →  CoE↓  →  IDN_ID↑
        │
  Self-join rank=1 (Primary) + rank=2 (Secondary)
        │
        ├──► d_idn_hcp_fctr_acct_stage1   (all HCPs)
        │
        └──► d_idn_hcp_fctr_acct           (ATTR universe only)
                                                    ▲
hcp_hca_idn_corrected_affiliation_final             │
  (includes ZIP + Territory)                        │
        │                                           │
  Sum factor per HCP + IDN + Territory              │
  Join Primary/Secondary IDN ────────────────────────┘
        │
        └──► d_idn_hcp_fctr_terr   (with territory info)
```

---

## Where these tables are used downstream

| Table | Used in |
|-------|---------|
| `d_idn_hcp_fctr_acct` | `Field DSM SPSD dashboard` — SP demand enrichment (Cell 9, CMD 9) |
| `d_idn_hcp_fctr_acct` | `sp_referrals_demands` table build in Field DSM notebook |
| `d_idn_hcp_fctr_terr` | Territory-level IDN potential reporting |

---

## Key notes

- **Factor represents activity weight** — not a binary yes/no. An HCP can have partial affiliation across multiple IDNs.
- **Stage 1 vs Final:** Stage 1 is the intermediate (all HCPs); Final is filtered to ATTR universe. Downstream notebooks use the Final table.
- **IDN type hierarchy is business-defined** — HSAT and top_parent are preferred because they represent the broadest institutional relationship, which is most useful for account-based selling.
- **CoE flag as tiebreaker** — ensures high-value institutions are preferred when two IDNs have similar factor weights.
- Both `d_idn_hcp_fctr_acct` and `d_idn_hcp_fctr_terr` keep their original names intentionally to avoid breaking existing workflows.
