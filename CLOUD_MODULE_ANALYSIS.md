# Cloud Module — Complete Analysis & Flaw Report

> Generated: 2026-03-03 | Covers: Server, Mapping, Billing Activity, Purchase Activity

---

## TABLE OF CONTENTS

1. [Database Schema](#1-database-schema)
2. [How Server Page Works](#2-server-page)
3. [How Mapping Page Works](#3-mapping-page)
4. [How Billing Activity (Sales) Works](#4-billing-activity-sales)
5. [How Purchase Activity Works](#5-purchase-activity)
6. [Data Flow Between Pages](#6-data-flow-between-pages)
7. [Flaws Found](#7-flaws-found)
8. [Summary of What Each Action Triggers](#8-summary-of-triggers)

---

## 1. DATABASE SCHEMA

### Tables

```
cloud_servers          — Server master data (IP, port, company, rate, expiry, billing mode/cycle)
cloud_mappings         — Links customers to servers (1 customer → many servers allowed)
cloud_activities       — All billing/purchase transactions (Sales & Purchase records)
customer               — Customer master data (company, contact, status, address)
customer_contact_details         — Contact phone numbers
customer_contact_mapping_data    — Links contacts to customers (many-to-many)
```

### Key Relationships

```
customer (1) ───────▶ (many) cloud_mappings (many) ◀─────── (1) cloud_servers
    │                         │
    │                         │ (effective_cycle, effective_mode,
    │                         │  effective_rate, effective_expiry)
    │                         │
    └────────────────▶ (many) cloud_activities
                              │
                              ├── record_nature = 'Sales'    → Billing Activity
                              └── record_nature = 'Purchase' → Purchase Activity
```

### Important Field Meanings

| Field | Table | Meaning |
|-------|-------|---------|
| `customer_domain_ip` | cloud_activities | Stores **customer ID** (numeric like "10954"), NOT an IP address |
| `server_name` | cloud_activities | Stores **server domain URL** (like `v48141.12114.tallyprimecloud.in`) that matches `cloud_servers.customer_ip` |
| `customer_ip` | cloud_servers | The domain/URL customers use to connect (e.g., `v48141.12114.tallyprimecloud.in`) |
| `server_ip` | cloud_servers | The actual server IP address |
| `effective_*` | cloud_mappings | Computed fields (rate/expiry/cycle/mode) — fallback hierarchy from mapping → activity → server |
| `group_id` | cloud_activities | Links Sales + Purchase records created together as a pair |
| `display_id` | cloud_activities | Human-readable ID like `ACT-001` (shared by linked Sales/Purchase pair) |

---

## 2. SERVER PAGE

### What it Shows

Each server card/row displays:
- **Direct from DB**: Server IP, Customer IP, Port, SOF No, Company, Admin Username, Password (decrypted), Status, Billing Mode, Billing Cycle, Purchase Rate, Server Expiry, Created Date
- **Backend Calculated**: Mapped count (subquery COUNT of cloud_mappings)
- **Frontend Calculated**: B.U. (Billing Units), P.U. (Purchase Units)

### How Data Flows

```
[Frontend] fetchServers()
    │
    ▼
[API] GET /api/servers?page=1&limit=50&search=...&filters...
    │
    ▼
[Backend] ServersService.findAll()
    │  → SELECT s.*, (SELECT COUNT(*) FROM cloud_mappings WHERE server_id = s.id) as customer_count
    │  → Decrypts admin_password_enc → admin_password
    │  → Returns paginated server list
    │
    ▼
[Frontend] Also fetches ALL activities (limit=1000) and ALL mappings (limit=1000) separately
    │
    ├── calcServerBU(serverId)  ← Uses local activities + mappings
    └── calcPurchaseUsersByServerId(serverId) ← Uses local activities
```

### B.U. Calculation (Server Page)

```
For each mapping on this server:
  1. Find all Sales activities matching this customer
     - Match by: customer_id OR customer_domain_ip OR customer_name
  2. Sort by activity_date ascending
  3. Find the LAST New/Renewal activity → base_units
  4. Sum all User activities ON or AFTER that base date → user_changes
  5. Mapping B.U. = base_units + user_changes

Server Total B.U. = Sum of all mappings' B.U.
```

### P.U. Calculation (Server Page)

```
1. Find all Purchase activities where server_name matches server's customer_ip OR server_ip
2. Sort by activity_date ascending
3. Find the LAST New/Renewal activity → base_units (purchase_units field)
4. Sum all User activities ON or AFTER that base date → user_changes
5. Server P.U. = base_units + user_changes
```

### Server Expiry Source

**Server expiry comes ONLY from Purchase activities.**

When a Purchase activity (New/Renewal) is created:
- `activities.service.ts:608` → `UPDATE cloud_servers SET server_expiry = ? WHERE id = ?`
- `activities.service.ts:635-654` → If no server_id provided, finds server via mapping lookup

When a Purchase activity is deleted:
- Finds the latest remaining Purchase activity for that server
- Updates server_expiry to that activity's expiry, or NULL if none remain

---

## 3. MAPPING PAGE

### What it Shows

Each mapping row displays:
- **Joined from DB**: Customer Name (from customer table), Server IP (from cloud_servers), Customer IP
- **Direct**: Serial No, Status, Mapped Date
- **Backend Computed (effective fields)**:
  - `effective_cycle` = mapping's billing_cycle OR server's billing_cycle
  - `effective_mode` = mapping's billing_mode OR server's billing_mode
  - `effective_rate` = mapping's billing_rate (if > 0) → OR latest Sales activity's last_bill_rate → OR server's purchase_rate → OR 0
  - `effective_expiry` = mapping's expiry_date → OR latest Sales activity's new_expiry_date → OR server's server_expiry
- **Frontend Calculated**: B.U. and P.U.

### How Data Flows

```
[Frontend] fetchMappings()
    │
    ▼
[API] GET /api/mappings?page=1&limit=50&server_id=...&search=...&filters...
    │
    ▼
[Backend] MappingsService.findAll()
    │  → SELECT m.*, s.server_ip, s.customer_ip, c.company as customer_name,
    │          m.effective_cycle, m.effective_mode, m.effective_rate, m.effective_expiry
    │    FROM cloud_mappings m
    │    JOIN cloud_servers s ON m.server_id = s.id
    │    JOIN customer c ON m.customer_id = c.id
    │
    ▼
[Frontend] Also fetches ALL activities (limit=1000) for B.U./P.U. calculations
```

### B.U. Calculation (Mapping Page — per mapping)

```
1. Find all Sales activities matching this customer AND this server
   - Customer match: customer_id OR customer_domain_ip OR customer_name
   - Server match: activity.server_name matches mapping's customer_ip OR server_ip
2. Sort by activity_date ascending
3. LAST New/Renewal = base_units
4. Sum User activities after base = user_changes
5. B.U. = base_units + user_changes
```

### P.U. Calculation (Mapping Page — per customer)

```
1. Find all Purchase activities matching this customer (by customer_domain_ip or customer_id)
2. Sort by activity_date ascending
3. LAST New/Renewal = base_units (purchase_units)
4. Sum User activities after base = user_changes
5. P.U. = base_units + user_changes
```

### Effective Fields — refreshEffectiveFields()

Called when:
- A new mapping is created
- A mapping is updated
- A Sales activity (New/Renewal) is created or updated

Logic (in `mappings.service.ts:469-518`):
```
For each target mapping:
  1. JOIN cloud_servers and customer to get fallback values
  2. Query latest Sales activity (New/Renewal) for this customer
  3. effective_cycle = mapping.billing_cycle OR server.billing_cycle
  4. effective_mode  = mapping.billing_mode  OR server.billing_mode
  5. effective_rate  = mapping.billing_rate (>0) OR activity.last_bill_rate OR server.purchase_rate
  6. effective_expiry = mapping.expiry_date OR activity.new_expiry_date OR server.server_expiry
  7. UPDATE cloud_mappings SET effective_* = ...
```

---

## 4. BILLING ACTIVITY (Sales)

### What it Shows

The Activities page with "Sales" tab active:
- Activity Date, Company, Server, Activity Type (New/Renewal/User), Bill Type (Tax Invoice/Credit Note)
- Structure (billing_cycle), Mode (D2D/M2M)
- Last Bill Rate, Billing Units, Bill Amount
- Start From, Expiry Date, SOF No, Date Diff

### How Creating a Sales Activity Works

```
[Frontend] User fills form → calls activitiesApi.calculate() first
    │
    ▼
[Backend] ActivitiesService.calculate()
    │  → Calculates: new_expiry_date, bill_amount, date_diff, formula_breakdown
    │  → For New/Renewal:
    │       D2D: expiry = start + cycle months (same date)
    │       M2M: expiry = end of (start month + cycle - 1) month
    │  → For User: inherits expiry from existing plan (co-terminus)
    │
    ▼
[Frontend] Shows calculated preview → User confirms → calls activitiesApi.create()
    │
    ▼
[Backend] ActivitiesService.create()
    │  1. Resolves customer_id if missing (from customer_name or customer_domain_ip)
    │  2. Generates display_id (ACT-xxx)
    │  3. Creates Sales record via createSingleActivity('Sales', data)
    │     - Checks for duplicate (same customer + date + type + nature) → UPDATE if found
    │     - Otherwise INSERT new record
    │  4. Calls syncUserCounts() → updates billed_users/purchase_users on mapping
    │  5. Calls syncMappingDetails() → updates mapping fields (cycle, mode, rate, expiry)
    │     - Also calls refreshEffectiveFields() internally
```

### Bill Amount Calculation

**D2D (Day to Day) — New/Renewal:**
```
bill_amount = billing_units × last_bill_rate × cycle_months
  where cycle_months = 1 (Monthly), 3 (Quarterly), 6 (Half-Yearly), 12 (Yearly)
```

**M2M (Month to Month) — New/Renewal:**
```
bill_amount = [{(rate / days_in_start_month) × remaining_days_in_start_month} + (rate × remaining_full_months)] × units
  where remaining_full_months = cycle - 1 (e.g., Yearly = 11, Quarterly = 2)
```

**User Type (both modes):**
```
amount_per_user = (rate × full_months) + (rate / days_in_end_month × remaining_days)
bill_amount = amount_per_user × units
```

### What Happens After Sales Activity Creation

1. `syncUserCounts()` → Calculates total billed_users and purchase_users from all activities for this customer, updates the mapping
2. `syncMappingDetails()` → Updates mapping's billing_cycle, billing_mode, billing_rate, expiry_date from this activity
3. `refreshEffectiveFields()` → Recomputes effective_* fields on the mapping
4. If Sales + Purchase created together (same group_id), Purchase record is created first

---

## 5. PURCHASE ACTIVITY

### What it Shows

The Activities page with "Purchase" tab active:
- Activity Date, Company, Server, Activity Type, Bill Type
- Structure (purchase_cycle), Mode (purchase_billing_mode)
- Purchase Rate, Purchase Units, Purchase Amount
- Start From (purchase_start_from), Expiry Date (purchase_expiry), SOF No

### How Creating a Purchase Activity Works

```
[Frontend] Same form as Sales but with Purchase fields
    │
    ▼
[Backend] ActivitiesService.create()
    │  1. Creates Purchase record via createSingleActivity('Purchase', data)
    │  2. Updates server_expiry on cloud_servers:
    │     - If server_id provided: direct update
    │     - If server_name provided: match by customer_ip or server_ip
    │     - If customer_id provided: find server via mapping lookup
    │  3. Calls syncUserCounts()
```

### Purchase Amount Calculation

Same formula structure as billing, but uses:
- `purchase_units` instead of `billing_units`
- `purchase_rate` instead of `last_bill_rate`
- `purchase_billing_mode` instead of `billing_mode`
- `purchase_cycle` instead of `billing_cycle`

### What Happens After Purchase Activity Creation

1. **Server expiry updated** → `cloud_servers.server_expiry = purchase_expiry`
2. `syncUserCounts()` → Updates purchase_users on mapping
3. Server page immediately reflects new expiry
4. Mapping page reflects new expiry via effective_expiry fallback chain

---

## 6. DATA FLOW BETWEEN PAGES

### When a Sales Activity is Created

```
cloud_activities (new Sales record)
    │
    ├──▶ cloud_mappings.billed_users     (via syncUserCounts)
    ├──▶ cloud_mappings.billing_cycle    (via syncMappingDetails)
    ├──▶ cloud_mappings.billing_mode     (via syncMappingDetails)
    ├──▶ cloud_mappings.billing_rate     (via syncMappingDetails)
    ├──▶ cloud_mappings.expiry_date      (via syncMappingDetails)
    ├──▶ cloud_mappings.effective_*      (via refreshEffectiveFields)
    │
    └──▶ Mapping page shows updated: Rate, Expiry, Cycle, Mode, B.U.
         Server page shows updated: B.U.
```

### When a Purchase Activity is Created

```
cloud_activities (new Purchase record)
    │
    ├──▶ cloud_servers.server_expiry     (direct update)
    ├──▶ cloud_mappings.purchase_users   (via syncUserCounts)
    │
    └──▶ Server page shows updated: Expiry, P.U.
         Mapping page shows updated: effective_expiry (if no Sales expiry exists)
```

### When a Mapping is Created

```
cloud_mappings (new record)
    │
    ├──▶ refreshEffectiveFields() runs → computes effective_* from activities + server
    │
    └──▶ Server page shows: Mapped count increases
         Mapping page shows: new row with effective fields populated
```

### When an Activity is Deleted

```
Sales Activity deleted:
    ├──▶ recalcMappingState() → finds latest remaining Sales activity, reverts mapping fields
    ├──▶ refreshEffectiveFields() → recomputes effective_*
    └──▶ syncUserCounts() → recalculates billed_users

Purchase Activity deleted:
    ├──▶ Finds latest remaining Purchase activity for server
    ├──▶ Updates server_expiry (to latest remaining, or NULL if none)
    └──▶ syncUserCounts() → recalculates purchase_users
```

---

## 7. FLAWS FOUND

### CRITICAL FLAWS

#### FLAW 1: Activities Limited to 1000 Records — B.U./P.U. Will Be Wrong

**Location**: `Mapping.tsx:255`, `Servers.tsx:168`

```typescript
const res = await activitiesApi.getAll({}, 1, 1000); // Fetch all for calculations
```

Both Servers and Mapping pages fetch only the first 1000 activities for B.U./P.U. calculations. If there are more than 1000 activities in the database, **some activities will be missing**, causing incorrect B.U. and P.U. values for some customers/servers.

**Impact**: As the system grows, B.U./P.U. numbers will silently become wrong.

**Fix**: Either:
- Move B.U./P.U. calculation to the backend (correct approach)
- Or fetch ALL activities without limit (bad for performance)

---

#### FLAW 2: Mapping Page Activities Fetch Skipped if Already Loaded

**Location**: `Mapping.tsx:252-253`

```typescript
const fetchActivities = async () => {
    if (localActivities.length > 0) return;  // ← SKIPS REFETCH!
```

If activities are loaded once, they never refresh. If a user creates a new activity in another tab and comes back to Mapping, the B.U./P.U. values will be stale until a full page reload.

**Impact**: Stale B.U./P.U. data after activity changes.

---

#### FLAW 3: Duplicate Activity Check Too Loose — Same Customer + Date + Type Overwrites

**Location**: `activities.service.ts:512-560`

```sql
SELECT id FROM cloud_activities
WHERE (customer_id = ? OR customer_domain_ip = ?)
AND activity_date = ?
AND activity_type = ?
AND record_nature = ?
```

If two different activities happen to have the same customer, date, type, and nature, the second one silently **OVERWRITES** the first instead of creating a new record. This means:
- Two "User" changes on the same date for the same customer → only the last one survives
- No server_name check in the duplicate detection → activities for different servers get merged

**Impact**: Data loss when creating multiple activities for the same customer on the same day.

---

#### FLAW 4: Server ID Generation Race Condition

**Location**: `servers.service.ts:188-192`

```typescript
const lastServer = await this.db.queryOne<{ id: string }>(`
    SELECT id FROM cloud_servers ORDER BY id DESC LIMIT 1
`);
const nextNum = lastServer ? parseInt(lastServer.id.replace('SRV', '')) + 1 : 1;
```

If two requests create servers simultaneously, they can generate the same ID (e.g., both get `SRV160`), causing one to fail or data corruption. Same issue exists for mapping IDs (`MAP` prefix) and activity display IDs (`ACT-` prefix).

**Impact**: Duplicate key errors under concurrent usage.

---

#### FLAW 5: customer_domain_ip Stores Customer IDs, Not IPs — Misleading Field Name

**Location**: Throughout `cloud_activities` table

The field `customer_domain_ip` actually stores customer IDs (like "10954"), not IP addresses. This caused major bugs:
- Previous B.U. matching logic used `includes()` to match `customer_domain_ip` against server IPs
- "10954" matched ":10954" in ports, causing false positives

**Status**: Partially fixed in previous session, but the field name remains misleading and could cause future confusion.

---

### MODERATE FLAWS

#### FLAW 6: Export Fetches All 10,000 Servers with Passwords

**Location**: `Servers.tsx:91`

```typescript
const res: any = await serversApi.getAll(1, 10000, appliedSearch);
```

The export function fetches up to 10,000 servers including decrypted admin passwords. This is:
1. A performance concern (large response)
2. A security risk — passwords exported to Excel files

**Impact**: Security risk and potential performance issues.

---

#### FLAW 7: Decrypted Passwords Sent to Frontend in List View

**Location**: `servers.service.ts:139-150`

```typescript
const data = rows.map(server => {
    let decryptedPassword = null;
    if (server.admin_password_enc) {
        decryptedPassword = decryptPassword(server.admin_password_enc);
    }
    return { ...server, admin_password_enc: decryptedPassword, admin_password: decryptedPassword };
});
```

Every `findAll` call decrypts and returns all passwords. Even the list view (which may just show a "Show/Hide" toggle) receives all passwords upfront. Ideally, passwords should only be returned on individual server detail requests.

**Impact**: Unnecessary exposure of sensitive data.

---

#### FLAW 8: refreshEffectiveFields Matches Activities by Customer Name (Not Server-Specific)

**Location**: `mappings.service.ts:497-504`

```sql
SELECT last_bill_rate, new_expiry_date
FROM cloud_activities
WHERE (customer_id = ? OR customer_name = ?)
    AND record_nature = 'Sales'
    AND activity_type IN ('New', 'Renewal')
ORDER BY activity_date DESC LIMIT 1
```

This query finds the latest Sales activity for a customer across ALL servers, not just the specific server in this mapping. If a customer is mapped to 2 servers with different rates, the effective_rate and effective_expiry could come from the wrong server's activity.

**Impact**: Wrong effective_rate/expiry for multi-server customers.

**Fix**: Add `AND (server_name = s.customer_ip OR server_name = s.server_ip)` to the query.

---

#### FLAW 9: B.U. Calculation on Server Page Doesn't Filter by Server

**Location**: `Servers.tsx:237-243`

```typescript
const customerActivities = localActivities
    .filter(a => {
        if (!a || a.record_nature !== 'Sales') return false;
        return (String(a.customer_id) === cid) ||
            (String(a.customer_domain_ip) === cid) ||
            (mapCustName && String(a.customer_name || '').toLowerCase() === mapCustName);
    })
```

When calculating B.U. for a server, it finds all Sales activities for each mapped customer — but doesn't filter by `server_name`. If a customer is mapped to Server A and Server B, Server A's B.U. will incorrectly include activities from Server B.

**Impact**: Inflated B.U. counts for servers with multi-server customers.

**Fix**: Add server_name matching (like Mapping page's `calcBillingUsersByMapping` does).

---

#### FLAW 10: Mapping Page P.U. Not Server-Specific

**Location**: `Mapping.tsx:326-351`

```typescript
const calcPurchaseUsers = (customerId: string): number => {
    const customerActivities = localActivities
        .filter(a => a && (String(a.customer_domain_ip) === cid || String(a.customer_id) === cid) && a.record_nature === 'Purchase')
```

P.U. is calculated per customer, not per customer+server combination. If a customer is mapped to 2 servers, both mappings show the combined P.U. from all servers.

**Impact**: Incorrect P.U. per mapping for multi-server customers.

---

#### FLAW 11: Revenue Summary Counts Both Sales and Purchase in Total

**Location**: `activities.service.ts:1060-1062`

```sql
SELECT SUM(bill_amount) as total FROM cloud_activities
```

The revenue summary sums `bill_amount` from ALL activities (both Sales and Purchase records). For linked pairs (same group_id), this potentially double-counts if both records have bill_amount values.

**Impact**: Potentially inflated revenue numbers.

---

#### FLAW 12: Customer ID Backfill Runs on Every Server Restart

**Location**: `mappings.service.ts:87-101`

```sql
UPDATE cloud_activities ca
JOIN customer c ON ca.customer_domain_ip = CAST(c.id AS CHAR)
SET ca.customer_id = c.id
WHERE ca.customer_id IS NULL ...
```

This migration query runs every time the backend starts. While it has a `WHERE ca.customer_id IS NULL` guard, it still scans the entire table on every restart.

**Impact**: Unnecessary DB load on startup. Should use a one-time migration flag.

---

### MINOR FLAWS

#### FLAW 13: Mapping Page Fetches All Customers/Servers on Dropdown Search

The customer and server dropdowns search the full table with `LIKE %search%`. For large datasets, this could be slow.

#### FLAW 14: Activity Display ID Generation Has Dead Retry Loop

**Location**: `activities.service.ts:421-437`

```typescript
while (attempt < 5) {
    // ... generates ID
    break;  // ← Always breaks on first attempt!
}
```

The retry loop for display ID generation always breaks on the first attempt, making the retry logic useless.

#### FLAW 15: console.log DEBUG Statements Left in Production

**Location**: Multiple places in `activities.service.ts`

```typescript
console.log('DEBUG: Calling syncUserCounts with', { ... });
console.log('DEBUG: Create Data Payload:', JSON.stringify(data));
```

Production code has many DEBUG console.log statements that should be removed or replaced with proper logging.

#### FLAW 16: Count Query in findAll Doesn't Include All JOINs

**Location**: `activities.service.ts:260-262`

```sql
let countQuery = `SELECT COUNT(*) as total FROM cloud_activities ca
    LEFT JOIN customer c ON ca.customer_id = c.id
    WHERE 1=1`;
```

The count query doesn't include the server JOINs that the main query has. If a future filter depends on server fields, the count would be wrong.

#### FLAW 17: getUnmappedCustomers Excludes ALL Mapped Customers

**Location**: `mappings.service.ts:455-462`

A customer mapped to Server A cannot be selected as "unmapped" to map to Server B. The query excludes any customer with ANY active mapping, even though the system supports multi-server mapping.

**Fix**: The query should exclude only customer+server pairs that already exist, not customers entirely.

---

## 8. SUMMARY OF TRIGGERS

### What Updates What

| Action | Updates |
|--------|---------|
| Create Sales Activity (New/Renewal) | → mapping.billed_users, mapping.billing_cycle/mode/rate/expiry, mapping.effective_* |
| Create Sales Activity (User) | → mapping.billed_users |
| Create Purchase Activity (New/Renewal) | → server.server_expiry, mapping.purchase_users |
| Create Purchase Activity (User) | → mapping.purchase_users |
| Delete Sales Activity | → mapping fields reverted to latest remaining, effective_* recalculated |
| Delete Purchase Activity | → server_expiry reverted to latest remaining (or NULL) |
| Create Mapping | → effective_* computed from activities + server |
| Update Mapping | → effective_* recomputed |
| Server Startup (onModuleInit) | → Backfills customer_id in activities, backfills server_expiry from purchase activities |

### Frontend Calculation Dependencies

| Page | Needs | Fetches |
|------|-------|---------|
| Server | B.U., P.U. | All activities (1000 limit), All mappings (1000 limit) |
| Mapping | B.U., P.U. per mapping | All activities (1000 limit) |
| Activities | Just displays data | Backend calculates amounts/dates |

---

## PRIORITY FIX LIST

1. **CRITICAL**: Move B.U./P.U. calculation to backend (Flaw 1, 9, 10)
2. **CRITICAL**: Fix duplicate activity detection to include server_name (Flaw 3)
3. **HIGH**: Fix refreshEffectiveFields to be server-specific (Flaw 8)
4. **HIGH**: Fix getUnmappedCustomers for multi-server support (Flaw 17)
5. **HIGH**: Don't send passwords in list view (Flaw 7)
6. **MEDIUM**: Fix Server page B.U. to filter by server (Flaw 9)
7. **MEDIUM**: Fix Mapping page activities cache (Flaw 2)
8. **MEDIUM**: Use database auto-increment for IDs (Flaw 4)
9. **LOW**: Remove debug console.logs (Flaw 15)
10. **LOW**: Fix display ID retry loop (Flaw 14)
