# Voucher / Billing Module — Complete Blueprint

A self-contained technical specification of the entire voucher (billing) module: data model, sign convention, REST API, backend service contract, frontend architecture, and step-by-step execution flow. Use this as a build guide to replicate the system from scratch.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Database Schema (DDL)](#2-database-schema-ddl)
3. [Sign Convention — The Core Rule](#3-sign-convention--the-core-rule)
4. [REST API Surface](#4-rest-api-surface)
5. [Request / Response Shapes](#5-request--response-shapes)
6. [Backend Service Contract](#6-backend-service-contract)
7. [Voucher Creation — Step-by-Step Flow](#7-voucher-creation--step-by-step-flow)
8. [Update & Delete Flow](#8-update--delete-flow)
9. [Frontend Architecture](#9-frontend-architecture)
10. [Tables Touched (Read/Write Matrix)](#10-tables-touched-readwrite-matrix)
11. [Atomicity & Transactions](#11-atomicity--transactions)
12. [Reusable Infrastructure](#12-reusable-infrastructure)
13. [Build Order](#13-build-order)
14. [Concrete Worked Examples](#14-concrete-worked-examples)

---

## 1. Architecture Overview

The whole module follows a **Tally-style double-entry accounting model**. Every voucher is:

```
1 Header (vch_details)
  ↓ contains
N Ledger entries (ledger_entries) — Dr/Cr signed; sum per voucher = 0
  ↓ if Sales/Purchase, the goods row contains
N Inventory entries (inventory_entries) — items with signed qty/amount
  ↓ if item is batch-tracked
N Batch rows (batch)

PLUS optional bill references (bill_allocation) attached to the party row
```

**Key architectural choices:**

- **One `customer` table for everything** — customers, banks, GST ledgers, Sales A/c, Purchase A/c, expenses. The `billbybill` flag (`'Yes'` = Sundry Debtor / customer; `'No'` = other ledger) and `ledgergroup` foreign key separate them.
- **Inventory hangs off the Sales/Purchase ledger entry**, not the voucher header. Matches Tally exactly.
- **Sign convention** is data-driven via `vchtype.deemed_positive`. Sales/Debit-Note → `YES` (party Dr, goods Cr). Purchase/Credit-Note → `NO` (party Cr, goods Dr).
- **Bill allocation** uses signed `amount`. Open balance per `(ledger, billname)` = `SUM(amount)`. When it hits zero, the bill is settled.

---

## 2. Database Schema (DDL)

### 2.1 Master tables (stable, edited rarely)

```sql
-- All ledgers live here: customers, banks, GST, Sales, Purchase, expenses.
CREATE TABLE customer (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    company         VARCHAR(255) NOT NULL,
    ledgergroup     INT NULL,                          -- FK → ledgergroup.id
    billbybill      ENUM('Yes','No') DEFAULT 'Yes',    -- 'Yes' = Sundry Debtor (customer); 'No' = other ledger
    opening_balance DECIMAL(14,2) DEFAULT 0,
    opening_balance_type ENUM('Dr','Cr') DEFAULT 'Dr',
    -- contact fields (mobile, email, gstin, address1/2/3, pincode...)
    INDEX idx_company (company),
    INDEX idx_ledgergroup (ledgergroup)
);

-- Hierarchical group masters (Sundry Debtors, Sales A/c, Bank, GST Duties, etc.)
CREATE TABLE ledgergroup (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    parent_id   INT NULL,                              -- self-ref
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_parent (parent_id)
);

-- Voucher types: Sales, Purchase, Receipt, Payment, Journal, Contra, etc.
CREATE TABLE vchtype (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    parent_id       INT NULL,                          -- self-ref: child types under Sales etc.
    deemed_positive ENUM('YES','NO') NULL,             -- YES = Party Dr / Goods Cr; NO = Purchase-side
    is_system       TINYINT(1) NOT NULL DEFAULT 0,
    INDEX idx_parent (parent_id)
);

-- Inventory item masters
CREATE TABLE items (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    item_name         VARCHAR(255) NOT NULL,
    batch             ENUM('Yes','No') DEFAULT 'No',   -- 'Yes' → batch tracking required
    gst               DECIMAL(5,2) DEFAULT 0,
    hsn               VARCHAR(50) NULL,
    tally_flavour_id  INT NULL,
    item_group_id     INT NULL,
    category_id       INT NULL,
    opening_qty       DECIMAL(10,3) DEFAULT 0,
    opening_rate      DECIMAL(10,2) DEFAULT 0,
    opening_value     DECIMAL(15,2) DEFAULT 0,
    INDEX idx_name (item_name)
);

CREATE TABLE item_groups     (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), parent_id INT NULL);
CREATE TABLE item_categories (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), parent_id INT NULL);
```

### 2.2 Transaction tables (every voucher writes to all)

```sql
-- VOUCHER HEADER — one row per voucher
CREATE TABLE vch_details (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    vch_type_id     INT NULL,                          -- FK → vchtype.id
    vch_no          VARCHAR(100) NULL,                 -- unique per (vch_type_id, vch_no)
    vch_date        DATE NULL,
    party_ledger_id INT NOT NULL,                     -- FK → customer.id
    amount          DECIMAL(14,2) NOT NULL DEFAULT 0,  -- grand total
    remark          TEXT NULL,
    created_by      VARCHAR(100) NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_type (vch_type_id),
    INDEX idx_date (vch_date),
    INDEX idx_party (party_ledger_id)
);

-- LEDGER ENTRIES — one row per Dr/Cr line. Sum per vch_id = 0
CREATE TABLE ledger_entries (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    vch_id      INT NOT NULL,
    ledger_id   INT NULL,                              -- FK → customer.id
    amount      DECIMAL(14,2) NOT NULL DEFAULT 0,      -- SIGNED: +Dr, -Cr
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_vch (vch_id),
    INDEX idx_ledger (ledger_id),
    FOREIGN KEY (vch_id) REFERENCES vch_details(id) ON DELETE CASCADE
);

-- INVENTORY ENTRIES — items hanging off the Sales/Purchase ledger row
CREATE TABLE inventory_entries (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    led_id     INT NOT NULL,                           -- FK → ledger_entries.id (the goods row)
    item_id    INT NOT NULL,                           -- FK → items.id
    qty        DECIMAL(10,3) DEFAULT 1,                -- SIGNED: -ve = stock out, +ve = stock in
    rate       DECIMAL(14,2) DEFAULT 0,
    amount     DECIMAL(14,2) DEFAULT 0,                -- SIGNED, mirrors qty
    gst_rate   DECIMAL(5,2) DEFAULT 0,
    INDEX idx_led (led_id),
    INDEX idx_item (item_id),
    FOREIGN KEY (led_id) REFERENCES ledger_entries(id) ON DELETE CASCADE
);

-- BATCH — per-item batch tracking
CREATE TABLE batch (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    vch_id       INT NOT NULL,
    inventory_id INT NULL,                             -- FK → inventory_entries.id
    item_id      INT NOT NULL,
    batch_name   VARCHAR(255) NULL,                    -- NULL = non-batch item (auto-row)
    qty          DECIMAL(10,3) DEFAULT 1,              -- SIGNED, mirrors inventory_entries.qty
    rate         DECIMAL(14,2) DEFAULT 0,
    amount       DECIMAL(14,2) DEFAULT 0,
    INDEX idx_vch (vch_id),
    INDEX idx_inv (inventory_id),
    INDEX idx_item (item_id)
);

-- BILL ALLOCATION — bill references for receipt/payment matching
CREATE TABLE bill_allocation (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    vchid        INT NOT NULL,
    ledentry_id  INT NULL,                             -- FK → ledger_entries.id (the party row)
    ledger       INT NULL,                             -- denormalized: party customer.id
    billname     VARCHAR(255) NULL,                    -- NULL = "On Account" (no bill ref)
    amount       DECIMAL(14,2) DEFAULT 0,              -- SIGNED. Sum per (ledger, billname) = open balance
    INDEX idx_vchid (vchid),
    INDEX idx_billname (billname),
    INDEX idx_ledger (ledger)
);
```

### 2.3 Invariants (business rules enforced via code)

- `SUM(ledger_entries.amount) per vch_id = 0` — double-entry balanced.
- `inventory_entries.led_id` always points to the **Sales/Purchase ledger entry** (never the party row).
- `batch.qty` and `inventory_entries.qty` match in sign and total.
- `bill_allocation.ledger` is denormalized for fast pending-balance queries.

---

## 3. Sign Convention — The Core Rule

The whole module follows this single rule, driven by `vchtype.deemed_positive`:

| `deemed_positive` | Use case | Party row | Goods row | Inventory `qty`/`amount` |
|---|---|---|---|---|
| `YES` | **Sales**, **Debit Note** | **Dr (+grandTotal)** | **Cr (−subtotal)** | **−** (stock out) |
| `NO` | **Purchase**, **Credit Note** | **Cr (−grandTotal)** | **Dr (+subtotal)** | **+** (stock in) |
| _null_ | — fallback → `YES` | — | — | — |

User-supplied tax/charge ledgers (CGST, SGST, IGST, freight, discount) are written as `amount × sign` where:

```
sign = (deemed_positive === YES) ? -1 : +1
```

This guarantees the voucher balances. For **Receipt / Payment / Journal / Contra** (no items), the user enters all ledger amounts directly with their own signs; the service writes them as-is (no transformation).

---

## 4. REST API Surface

All endpoints require JWT auth + `@RequireAnyPermission({ entity: 'activities', action: ... })`.

### Master endpoints

| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/api/vch-types` | List voucher types (with parents) | view |
| POST/PUT/DEL | `/api/vch-types[/:id]` | CRUD voucher types | edit |
| GET | `/api/items` | List items (with flavour/group/category) | view |
| POST/PUT/DEL | `/api/items[/:id]` | CRUD items | edit |
| GET | `/api/items/groups` | List item groups | view |
| GET | `/api/items/categories` | List item categories | view |
| GET | `/api/items/flavours` | Distinct flavours | view |
| GET | `/api/ledger-groups` | Tree of ledger groups | view |
| GET | `/api/other-ledgers` | Customers where `ledgergroup != 26` (banks, GST, expenses) | view |
| POST/PUT/DEL | `/api/other-ledgers[/:id]` | CRUD other ledgers | edit |
| GET | `/api/customers/autocomplete?q=` | Sundry-Debtor party search | view |
| GET | `/api/customers/ledger-search?q=` | All-ledger search | view |

### Voucher endpoints

| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| **POST** | **`/api/vouchers`** | **Create voucher** | create |
| GET | `/api/vouchers?page=&limit=&vch_type=&search=&date_from=&date_to=` | List | view |
| GET | `/api/vouchers/:id` | Detail (header + ledger entries + inventory + batches + bill refs) | view |
| **PUT** | **`/api/vouchers/:id`** | **Update (delete-and-reinsert)** | edit |
| **DELETE** | **`/api/vouchers/:id`** | **Delete cascade** | delete |
| GET | `/api/vouchers/next-no?vch_type_id=` | Auto-suggest next vch_no (e.g. `S-007`) | view |
| GET | `/api/vouchers/pending-refs?customer_id=&direction=Cr` | Open bill refs for receipt/payment | view |
| GET | `/api/vouchers/serials?customer_id=&flavour_id=` | Tally serials owned by party | view |
| GET | `/api/vouchers/daybook?date=` | All vouchers on a date with Dr/Cr split | view |

---

## 5. Request / Response Shapes

### 5.1 Create payload

```ts
POST /api/vouchers

{
  vch_type_id: 4,                  // optional but recommended
  vch_no: "S-001",                 // optional; auto-derived via /next-no if blank
  vch_date: "2026-04-30",
  party_ledger_id: 1646,           // REQUIRED → customer.id
  remark: "Sale of laptop",
  is_igst: false,                  // controls CGST/SGST vs IGST split (frontend hint)

  items: [                         // empty/missing → "journal mode"
    {
      item_id: 12,
      qty: 2,
      rate: 50000,
      amount: 100000,              // qty × rate
      gst_rate: 18,
      cgst_amount: 9000,
      sgst_amount: 9000,
      igst_amount: 0,
      batch_rows: [                // optional; required if items.batch='Yes'
        { batch_name: "B1", qty: 2, rate: 50000, amount: 100000 }
      ]
    }
  ],

  ledgers: [                       // tax/charge ledgers; signs handled server-side
    { ledger_id: 8001, amount: 9000 },   // CGST
    { ledger_id: 8002, amount: 9000 }    // SGST
  ],

  bill_allocation: [               // optional
    { type: "New", refno: "INV-001", amount: 118000, direction: "Dr" }
  ]
}
```

Response:

```json
{ "success": true, "data": { "id": 170 }, "message": "Voucher created successfully" }
```

### 5.2 findById response

```ts
GET /api/vouchers/:id

{
  success: true,
  data: {
    ...vch_details_row,
    party_name: "ACME Corp",
    ledgerEntries: [
      {
        ...ledger_entries_row,
        ledger_name: "ACME Corp",
        inventoryEntries: [          // present only on goods row
          {
            ...inventory_entries_row,
            item_name: "Laptop X1",
            gst_rate: 18,
            batchRows: [
              { batch_name: "B1", qty: 2, rate: 50000, amount: 100000 }
            ]
          }
        ]
      }
    ],
    billAllocations: [
      { billname: "INV-001", amount: 118000, ledger: 1646 }
    ]
  }
}
```

### 5.3 Pending refs response

```ts
GET /api/vouchers/pending-refs?customer_id=1646

{
  success: true,
  data: [
    { billname: "INV-001", amount: 50000, vch_date: "2026-04-15", vch_no: "S-001", direction: "Dr" },
    { billname: "On Acct (S-002)", amount: 12000, vch_date: "2026-04-20", vch_no: "S-002", direction: "Dr" }
  ]
}
```

---

## 6. Backend Service Contract

```ts
class VouchersService {
  // ── Reads ──
  findAll(page, limit, filters)             // paginated list with party + type names
  findById(id)                              // header + nested entries + bill refs
  getDaybook(date)                          // one day with Dr/Cr split per voucher
  getNextVoucherNo(vchTypeId)               // → "<prefix>-<NNN>" e.g. "S-007"
  getPendingRefs(customerId, direction)     // open bills (named) + on-account, signed
  getSerials(customerId, flavourId?)        // tally serials minus already-sold

  // ── Writes ──
  create(data)                              // see step-by-step flow below
  update(id, data)                          // delete-and-reinsert children + UPDATE header
  deleteVoucher(id)                         // hard delete with explicit child cleanup
}
```

---

## 7. Voucher Creation — Step-by-Step Flow

### Phase 1: Page mount (one-time master data load)

| Step | What | Endpoint → Query | Tables read |
|---|---|---|---|
| 1 | Load voucher types | `GET /api/vch-types` → `SELECT * FROM vchtype ORDER BY name` | **vchtype** |
| 2 | Load items | `GET /api/items` → `SELECT i.*, sm.name AS flavour, ig.name AS group, ic.name AS category FROM items i LEFT JOIN singlemaster sm... LEFT JOIN item_groups ig... LEFT JOIN item_categories ic...` | **items, singlemaster, item_groups, item_categories** |
| 3 | Load all ledgers (CGST, SGST, IGST, banks, expenses) | `GET /api/other-ledgers` → `SELECT c.id, c.company, c.ledgergroup, lg.name FROM customer c LEFT JOIN ledgergroup lg WHERE c.ledgergroup != 26` | **customer, ledgergroup** |

### Phase 2: User picks voucher type

| Step | What | Endpoint → Query | Tables read |
|---|---|---|---|
| 4 | Auto-suggest next voucher number | `GET /api/vouchers/next-no?vch_type_id=X` → reads `vchtype` for prefix, then `vch_details` for last `vch_no` | **vchtype, vch_details** |

### Phase 3: User types party name

| Step | What | Endpoint → Query | Tables read |
|---|---|---|---|
| 5 | Autocomplete party | `GET /api/customers/autocomplete?q=...` → `SELECT id, company, ... FROM customer WHERE company LIKE ? AND ledgergroup = 26 LIMIT 10` | **customer** |
| 5b | All-ledger search (toggle) | `GET /api/customers/ledger-search?q=...` | **customer, ledgergroup** |

### Phase 4: User picks an item with a flavour (Sales/Purchase only)

| Step | What | Endpoint → Query | Tables read |
|---|---|---|---|
| 6 | Distinct serials owned by party for that flavour | `GET /api/vouchers/serials?customer_id=X&flavour_id=Y` → `SELECT DISTINCT td.tallyserial FROM tallydetails td WHERE td.customerid = ? AND td.tallyflavor = ?` minus already-sold from `batch` | **tallydetails, batch** |

### Phase 5: User opens "Bill Refs" picker (Receipt/Payment)

| Step | What | Endpoint → Query | Tables read |
|---|---|---|---|
| 7 | Pending bill refs for the party | `GET /api/vouchers/pending-refs?customer_id=X` → grouped query over `bill_allocation` joined to `vch_details` with `HAVING ABS(SUM) > 0.01` | **bill_allocation, vch_details** |

### Phase 6: Submit — `POST /api/vouchers`

#### 6.1 Pre-flight reads (validation + sign convention)

| Step | Operation | Query | Tables read |
|---|---|---|---|
| A | Duplicate check | `SELECT COUNT(*) FROM vch_details WHERE vch_no = ? AND vch_type_id = ?` | **vch_details** |
| B | Read sign convention | `SELECT v.name, v.deemed_positive, p.name AS parent_name, p.deemed_positive AS parent_deemed FROM vchtype v LEFT JOIN vchtype p ON v.parent_id = p.id WHERE v.id = ?` | **vchtype** |
| C | Look up goods ledger (Sales / Purchase) | `SELECT id FROM customer WHERE company = ? LIMIT 1` | **customer** |

#### 6.2 Writes — Inventory voucher (Sales / Purchase / Debit Note / Credit Note)

For a voucher with **N items, M tax ledgers, K bill refs**:

| Step | Table | INSERTs | Notes |
|---|---|---|---|
| 1 | `vch_details` | 1 | Header — `vch_type_id`, `vch_no`, `vch_date`, `party_ledger_id`, `grandTotal`, `remark`, `created_by` |
| 2 | `ledger_entries` | 1 | **Party row** at `+grandTotal` (Sales) or `−grandTotal` (Purchase). Captures `partyLedEntryId` |
| 3 | `ledger_entries` | 1 | **Goods row** (Sales/Purchase ledger) at `−subtotal` (Sales) or `+subtotal` (Purchase). Captures `goodsLedId` — inventory hangs here |
| 4 | `inventory_entries` | N | One per item: `(led_id=goodsLedId, item_id, qty*sign, rate, amount*sign, gst_rate)`. `sign = -1` for Sales (out), `+1` for Purchase (in) |
| 5 | `batch` | ≥N | One per item — even non-batch items get an auto-row with `batch_name=NULL` |
| 6 | `ledger_entries` | M | Tax/charge rows — `(ledger_id, amount * sign)` |
| 7 | `bill_allocation` | K | One per bill ref — `(vchid, ledentry_id=partyLedEntryId, ledger=party_ledger_id, billname, signedAmount)` |

**Total inserts:** `1 + 2 + N + N + M + K`. Example: 3 items / 2 GST / 1 ref = **12 rows**.

**Pseudocode:**

```ts
// 1. Validate uniqueness
if (data.vch_no) {
  const dup = await db.queryOne('SELECT COUNT(*) cnt FROM vch_details WHERE vch_no = ? AND vch_type_id = ?',
                                 [data.vch_no, data.vch_type_id]);
  if (dup.cnt > 0) throw new BadRequestException(`Voucher number "${data.vch_no}" already exists`);
}

// 2. Compute totals
const subtotal   = sum(items.amount);
const ledgersSum = sum(abs(ledgers.amount));
const grandTotal = subtotal + ledgersSum;

// 3. Insert header
const { insertId: vchId } = await db.execute(
  'INSERT INTO vch_details (vch_type_id, vch_no, vch_date, party_ledger_id, amount, remark, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
  [vch_type_id, vch_no, vch_date, party_ledger_id, grandTotal, remark, created_by]
);

// 4. Read sign convention
const vt = await db.queryOne(
  `SELECT v.deemed_positive, p.name AS parent_name, p.deemed_positive AS parent_deemed
   FROM vchtype v LEFT JOIN vchtype p ON v.parent_id = p.id WHERE v.id = ?`,
  [vch_type_id]
);
const dp = vt?.deemed_positive ?? vt?.parent_deemed ?? 'YES';
const effectivePositive = dp === 'YES';
const goodsLedgerName = vt?.parent_name?.toLowerCase().includes('purchase') ? 'Purchase' : 'Sales';

// 5. Look up goods ledger
const goodsLedger = await db.queryOne('SELECT id FROM customer WHERE company = ? LIMIT 1', [goodsLedgerName]);
const goodsLedgerId = goodsLedger?.id ?? null;

// 6. Insert party + goods ledger entries
let partyLedEntryId, goodsLedId;
if (effectivePositive) {
  partyLedEntryId = (await db.execute('INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)',
                                       [vchId, party_ledger_id, +grandTotal])).insertId;
  goodsLedId = (await db.execute('INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)',
                                  [vchId, goodsLedgerId, -subtotal])).insertId;
} else {
  partyLedEntryId = (await db.execute('INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)',
                                       [vchId, party_ledger_id, -grandTotal])).insertId;
  goodsLedId = (await db.execute('INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)',
                                  [vchId, goodsLedgerId, +subtotal])).insertId;
}

// 7. Inventory + batch
const sign = effectivePositive ? -1 : +1;
for (const item of data.items) {
  const { insertId: invId } = await db.execute(
    'INSERT INTO inventory_entries (led_id, item_id, qty, rate, amount, gst_rate) VALUES (?, ?, ?, ?, ?, ?)',
    [goodsLedId, item.item_id, item.qty * sign, item.rate, item.amount * sign, item.gst_rate ?? 0]
  );
  if (item.batch_rows?.length) {
    for (const b of item.batch_rows) {
      await db.execute('INSERT INTO batch (vch_id, inventory_id, item_id, batch_name, qty, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [vchId, invId, item.item_id, b.batch_name, b.qty * sign, b.rate, b.amount * sign]);
    }
  } else {
    // Non-batch item: single auto-row with batch_name=NULL
    await db.execute('INSERT INTO batch (vch_id, inventory_id, item_id, batch_name, qty, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)',
                      [vchId, invId, item.item_id, null, item.qty * sign, item.rate, item.amount * sign]);
  }
}

// 8. User-supplied tax/charge ledgers
for (const led of data.ledgers ?? []) {
  if (!led.ledger_id || !led.amount) continue;
  await db.execute('INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)',
                    [vchId, led.ledger_id, led.amount * sign]);
}

// 9. Bill allocation
const baseSign = effectivePositive ? +1 : -1;
for (const ba of data.bill_allocation ?? []) {
  if (!ba.amount) continue;
  let signedAmt;
  if (ba.direction === 'Cr')      signedAmt = -Math.abs(ba.amount);
  else if (ba.direction === 'Dr') signedAmt = +Math.abs(ba.amount);
  else if (ba.type === 'Agr.')    signedAmt = -Math.abs(ba.amount) * baseSign;
  else                            signedAmt = +Math.abs(ba.amount) * baseSign;

  await db.execute('INSERT INTO bill_allocation (vchid, ledentry_id, ledger, billname, amount) VALUES (?, ?, ?, ?, ?)',
                    [vchId, partyLedEntryId, party_ledger_id, ba.refno || null, signedAmt]);
}

return { id: vchId };
```

#### 6.3 Writes — Journal voucher (Receipt / Payment / Journal / Contra)

No inventory:

| Step | Table | INSERTs | Notes |
|---|---|---|---|
| 1 | `vch_details` | 1 | Header. `amount` = sum of positive amounts in `ledgers[]` |
| 2 | `ledger_entries` | L | One per `data.ledgers[]` row, signed amount as supplied. Captures `partyLedEntryId` for the row matching `party_ledger_id` |
| 3 | `bill_allocation` | K | Bill refs against the party row |

**Total inserts:** `1 + L + K`.

**Pseudocode:**

```ts
if (!data.items || data.items.length === 0) {
  const drTotal = sum(filter(ledgers, l => l.amount > 0).amount);

  const { insertId: vchId } = await db.execute(
    'INSERT INTO vch_details (vch_type_id, vch_no, vch_date, party_ledger_id, amount, remark, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [vch_type_id, vch_no, vch_date, party_ledger_id, drTotal, remark, created_by]
  );

  let partyLedEntryId = null;
  for (const led of data.ledgers ?? []) {
    if (!led.ledger_id || !led.amount) continue;
    const r = await db.execute('INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)',
                                [vchId, led.ledger_id, led.amount]);
    if (led.ledger_id === party_ledger_id && partyLedEntryId === null) {
      partyLedEntryId = r.insertId;
    }
  }

  for (const ba of data.bill_allocation ?? []) {
    if (!ba.amount) continue;
    const signedAmt = ba.direction === 'Cr' ? -Math.abs(ba.amount)
                    : ba.direction === 'Dr' ? +Math.abs(ba.amount)
                    : ba.type === 'Agr.'    ? -Math.abs(ba.amount)
                    :                          +Math.abs(ba.amount);
    await db.execute('INSERT INTO bill_allocation (vchid, ledentry_id, ledger, billname, amount) VALUES (?, ?, ?, ?, ?)',
                      [vchId, partyLedEntryId, party_ledger_id, ba.refno || null, signedAmt]);
  }

  return { id: vchId };
}
```

---

## 8. Update & Delete Flow

### 8.1 Update — delete children + reinsert + UPDATE header

```ts
async update(id, data) {
  // Delete in FK-safe order
  await db.execute('DELETE FROM bill_allocation WHERE vchid = ?', [id]);
  await db.execute('DELETE FROM batch WHERE vch_id = ?', [id]);
  await db.execute(
    'DELETE FROM inventory_entries WHERE led_id IN (SELECT id FROM ledger_entries WHERE vch_id = ?)',
    [id]
  );
  await db.execute('DELETE FROM ledger_entries WHERE vch_id = ?', [id]);

  // UPDATE header
  await db.execute('UPDATE vch_details SET vch_type_id=?, vch_no=?, vch_date=?, party_ledger_id=?, amount=?, remark=? WHERE id=?',
                    [...recomputed values, id]);

  // Re-run all the INSERT steps from create() with vchId = id
}
```

### 8.2 Delete — explicit cascade

```ts
async deleteVoucher(id) {
  await db.execute('DELETE FROM bill_allocation WHERE vchid = ?', [id]);
  await db.execute('DELETE FROM batch WHERE vch_id = ?', [id]);
  await db.execute(
    'DELETE FROM inventory_entries WHERE led_id IN (SELECT id FROM ledger_entries WHERE vch_id = ?)',
    [id]
  );
  await db.execute('DELETE FROM ledger_entries WHERE vch_id = ?', [id]);
  await db.execute('DELETE FROM vch_details WHERE id = ?', [id]);
}
```

(FK CASCADE handles inventory/ledger automatically, but explicit deletes make it safe regardless of FK config.)

---

## 9. Frontend Architecture

### 9.1 State shape (Vouchers page)

```ts
// ── Master data (loaded once on mount) ──
allVchTypes:    VchType[]
products:       Item[]                    // items with flavour/group/category
allLedgers:     Customer[]                // other-ledgers (CGST, SGST, banks…)
taxLedgerIds:   { cgst, sgst, igst }      // pre-resolved IDs

// ── Selection ──
selectedParentId:   number | null         // top-level voucher type (Sales/Purchase/...)
voucherType:        string                // child type name
voucherNo:          string                // auto-generated
voucherDate:        string

// ── Party ──
partyLedgerId:      number | null
partyDisplay:       string
customerSearch:     string                // debounced autocomplete query
customerSuggestions: Customer[]

// ── Items grid ──
rows: ItemRow[]    // { item_id, flavour_id, qty, rate, amount, gst_rate,
                   //   cgst_amount, sgst_amount, igst_amount, batch_rows }
isIgst: boolean    // toggles CGST/SGST vs IGST split

// ── Tax ledger inputs (auto-computed from item GST, summed) ──
ledgerInputs: { [ledger_id]: number }

// ── Bill allocation ──
billRefs:    { type, refno, amount, direction }[]
pendingRefs: PendingRef[]

// ── Edit mode ──
editId: number | null
```

### 9.2 Effect choreography

```
mount
  → load vchTypes
  → set default Sales
  → load items
  → load otherLedgers
  → resolve tax ledger IDs

selectedParentId changes
  → set voucherType to first child

voucherType changes (and !editId)
  → call /vouchers/next-no
  → set voucherNo

editId set (from /daybook navigate state)
  → call /vouchers/:id
  → hydrate all state

customerSearch (debounced 300ms)
  → call /customers/autocomplete
  → suggestions

party + flavour set
  → call /vouchers/serials
  → suggest serial numbers per row

party + (Receipt/Payment) → user opens "Bill Refs" picker
  → call /vouchers/pending-refs

rows change
  → recompute amount = qty * rate
  → recompute GST based on item.gst + isIgst flag
  → update ledgerInputs
```

### 9.3 Submit handler

```ts
async function onSubmit() {
  const payload = {
    vch_type_id, vch_no, vch_date, party_ledger_id, remark, is_igst,
    items: rows.map(r => ({
      item_id: r.item_id,
      qty: r.qty, rate: r.rate, amount: r.amount,
      gst_rate: r.gst_rate,
      cgst_amount: r.cgst_amount, sgst_amount: r.sgst_amount, igst_amount: r.igst_amount,
      batch_rows: r.batch_rows  // null if item.batch='No'
    })),
    ledgers: Object.entries(ledgerInputs)
      .filter(([_, v]) => v !== 0)
      .map(([id, amt]) => ({ ledger_id: +id, amount: amt })),
    bill_allocation: billRefs
  };

  const res = editId
    ? await vouchersApi.update(editId, payload)
    : await vouchersApi.create(payload);

  if (res.success) {
    showSuccess('Saved');
    navigate('/billing/daybook');
  }
}
```

---

## 10. Tables Touched (Read/Write Matrix)

| Phase | Table | Read | Write |
|---|---|:---:|:---:|
| Page load | vchtype | ✓ | |
| Page load | items | ✓ | |
| Page load | singlemaster | ✓ | |
| Page load | item_groups | ✓ | |
| Page load | item_categories | ✓ | |
| Page load | customer | ✓ | |
| Page load | ledgergroup | ✓ | |
| Type pick | vchtype, vch_details | ✓ | |
| Party type | customer | ✓ | |
| Item flavour | tallydetails, batch | ✓ | |
| Bill refs popup | bill_allocation, vch_details | ✓ | |
| **Submit** | **vch_details** | ✓ (dup check) | ✓ |
| Submit | vchtype | ✓ (sign) | |
| Submit | customer | ✓ (goods ledger) | |
| **Submit** | **ledger_entries** | | ✓ |
| **Submit** | **inventory_entries** | | ✓ (if items) |
| **Submit** | **batch** | | ✓ (if items) |
| **Submit** | **bill_allocation** | | ✓ (if refs) |

**Tables NEVER touched** during voucher creation: `bills`, `bill_items`, `bill_payments`, `billing`, `payment`, `cloud_activities`, `expensepayment`, `billingcompany`, `billingitem`. (All legacy or unrelated.)

---

## 11. Atomicity & Transactions

The reference implementation runs each `INSERT` as a separate statement. **In your replica, wrap the whole flow in a transaction:**

```ts
async create(data) {
  const conn = await this.db.beginTransaction();
  try {
    // ... all INSERTs use conn ...
    await conn.commit();
    return { id: vchId };
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}
```

Same for `update()` and `deleteVoucher()`. Otherwise a partial voucher can be left in DB if a later step fails.

---

## 12. Reusable Infrastructure

| Concern | Implementation |
|---|---|
| **JWT auth + RBAC** | `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermission` / `@RequireAnyPermission` decorators on every route |
| **DB layer** | `DbService` wrapping `mysql2/promise` with `query()`, `queryOne()`, `execute()`, `beginTransaction()` |
| **Auto-migrations** | Each service implements `OnModuleInit` and runs idempotent `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` checks (column-existence guarded via `INFORMATION_SCHEMA`) |
| **API client** | Single `fetchApi()` helper with JWT bearer header, organized into per-domain objects (`vouchersApi`, `itemsApi`, `customersApi`, `vchTypeApi`, `otherLedgerApi`…) |
| **Toast** | `useToast()` hook for success/error feedback |
| **Forms** | Plain React state — no form library — debounced effects for autocomplete |

---

## 13. Build Order

1. **DB schema** — apply DDL above; seed `ledgergroup`, `vchtype`, a few items.
2. **Backend skeleton** — NestJS + DbService + JWT auth + permission guards.
3. **CRUD services**: `LedgerGroupsService`, `VchTypesService`, `ItemsService`, `OtherLedgersService`.
4. **VouchersService — read methods first**: `findAll`, `findById`, `getNextVoucherNo`, `getPendingRefs`, `getDaybook`, `getSerials`.
5. **VouchersService.create()** — exact flow from §7, wrapped in a transaction.
6. **VouchersService.update()** + **deleteVoucher()** — same transactional safety.
7. **Frontend masters** — boring CRUD pages for vch types, ledgers, items, etc.
8. **Frontend Vouchers page** — the only complex screen, build it last with all the choreography from §9.
9. **Daybook page** — read-only, displays one day with Dr/Cr per voucher.

---

## 14. Concrete Worked Examples

### 14.1 Sales voucher: 2 laptops at ₹50,000 each, 18% GST, intra-state

**Input:**
- `vch_type_id = 1` (Sales, `deemed_positive = YES`)
- `party_ledger_id = 1646` (ACME Corp)
- `items = [{ item_id: 12, qty: 2, rate: 50000, amount: 100000, gst_rate: 18, cgst_amount: 9000, sgst_amount: 9000, igst_amount: 0, batch_rows: null }]`
- `ledgers = [{ ledger_id: 8001, amount: 9000 }, { ledger_id: 8002, amount: 9000 }]` (CGST, SGST)
- `bill_allocation = [{ type: "New", refno: "INV-001", amount: 118000, direction: "Dr" }]`

**Computed:**
- `subtotal   = 100,000`
- `ledgersSum = 18,000`
- `grandTotal = 118,000`
- `effectivePositive = true` → `sign = -1`

**Inserts:**

```
vch_details      (1, 'S-001', 2026-04-30, 1646, 118000, 'Laptop sale')             → vchId=170

ledger_entries   (170, 1646, +118000)                                              → partyLedEntryId=501
ledger_entries   (170,  Sales_id=42, -100000)                                      → goodsLedId=502

inventory_entries(502, 12, -2, 50000, -100000, 18)                                 → invId=301
batch            (170, 301, 12, NULL, -2, 50000, -100000)

ledger_entries   (170, 8001, -9000)   -- CGST   (9000 * -1)
ledger_entries   (170, 8002, -9000)   -- SGST   (9000 * -1)

bill_allocation  (170, 501, 1646, 'INV-001', +118000)   -- direction='Dr'
```

**Verification:** `SUM(ledger_entries.amount WHERE vch_id=170) = 118000 - 100000 - 9000 - 9000 = 0` ✓

### 14.2 Receipt voucher against the bill above

**Input:**
- `vch_type_id = 5` (Receipt, no `deemed_positive` — journal mode)
- `party_ledger_id = 1646`
- `items = []`
- `ledgers = [{ ledger_id: 1646, amount: -118000 }, { ledger_id: 7000 /* Bank */, amount: +118000 }]`
- `bill_allocation = [{ type: "Agr.", refno: "INV-001", amount: 118000, direction: "Cr" }]`

**Inserts:**

```
vch_details      (5, 'R-001', 2026-05-15, 1646, 118000, 'Receipt vs INV-001')      → vchId=171

ledger_entries   (171, 1646, -118000)                                              → partyLedEntryId=503
ledger_entries   (171, 7000, +118000)

bill_allocation  (171, 503, 1646, 'INV-001', -118000)   -- direction='Cr'
```

**Open balance for INV-001:** `+118000 (from Sales) + (-118000) (from Receipt) = 0` → bill is settled, no longer appears in `pending-refs`.

---

**End of document.** This is everything you need to replicate the voucher module from scratch.


---

# 15. Complete Source Code Listings

Everything below is the actual production source code, inlined for direct copy-paste. File paths shown match the original layout.

---

## 15.1 Backend — `src/database/db.service.ts`

```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mysql from 'mysql2/promise';

@Injectable()
export class DbService implements OnModuleInit {
  private pool: mysql.Pool;

  constructor(private configService: ConfigService) { }

  async onModuleInit() {
    this.pool = mysql.createPool({
      host: this.configService.get('DB_HOST', 'localhost'),
      port: this.configService.get<number>('DB_PORT', 3306),
      user: this.configService.get('DB_USERNAME', 'root'),
      password: this.configService.get('DB_PASSWORD', 'password'),
      database: this.configService.get('DB_DATABASE', 'abs_cloud'),
      waitForConnections: true,
      connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '50', 10), // SCALABLE: Increased limit
      timezone: '+05:30', // Indian Standard Time (Asia/Kolkata)
      dateStrings: true,
    });
    
    console.log(`[DbService] Connecting to ${this.configService.get('DB_HOST')}:${this.configService.get('DB_PORT')} DB: ${this.configService.get('DB_DATABASE')}`);

    // Set session timezone to Indian Standard Time for all connections
    this.pool.on('connection', (connection) => {
      connection.query("SET time_zone = '+05:30'");
    });

    // Test connection
    try {
      const conn = await this.pool.getConnection();
      conn.release();
    } catch (error) {
      console.error('❌ MySQL Connection Failed:', error.message);
    }
  }

  // Transaction Wrapper
  async withTransaction<T>(operation: (conn: mysql.PoolConnection) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await operation(conn);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  // Execute SELECT query - returns rows (using prepared statements)
  async query<T = any>(sql: string, params: any[] = [], conn?: mysql.PoolConnection): Promise<T[]> {
    try {
      const [rows] = await (conn || this.pool).query(sql, params);
      return rows as T[];
    } catch (error) {
      throw this.handleError(error, sql);
    }
  }

  // Execute standard query (not prepared) - useful for LIMIT/OFFSET with some drivers/versions
  async queryStandard<T = any>(sql: string, params: any[] = [], conn?: mysql.PoolConnection): Promise<T[]> {
    try {
      const [rows] = await (conn || this.pool).query(sql, params);
      return rows as T[];
    } catch (error) {
      throw this.handleError(error, sql);
    }
  }

  // Execute INSERT/UPDATE/DELETE - returns result info
  async execute(sql: string, params: any[] = [], conn?: mysql.PoolConnection): Promise<mysql.ResultSetHeader> {
    try {
      const [result] = await (conn || this.pool).query(sql, params);
      return result as mysql.ResultSetHeader;
    } catch (error) {
      throw this.handleError(error, sql);
    }
  }

  // Get single row
  async queryOne<T = any>(sql: string, params: any[] = [], conn?: mysql.PoolConnection): Promise<T | null> {
    const rows = await this.query<T>(sql, params, conn);
    return rows.length > 0 ? rows[0] : null;
  }

  private handleError(error: any, sql: string) {
    const errorInfo = {
      code: error.code || 'UNKNOWN',
      message: error.message,
      sql: sql.substring(0, 100),
      solution: this.getSolution(error.code),
    };


    const customError = new Error(error.message);
    (customError as any).dbError = errorInfo;
    return customError;
  }

  private getSolution(code: string): string {
    const solutions: Record<string, string> = {
      'ER_DUP_ENTRY': 'This record already exists. Try using a different value.',
      'ER_NO_REFERENCED_ROW': 'Referenced record not found. Check if parent record exists.',
      'ER_ROW_IS_REFERENCED': 'Cannot delete. This record is being used elsewhere.',
      'ER_BAD_NULL_ERROR': 'Required field is missing. Please fill all required fields.',
      'ER_ACCESS_DENIED_ERROR': 'Database access denied. Check credentials in .env file.',
      'ECONNREFUSED': 'Cannot connect to database. Make sure MySQL is running.',
    };
    return solutions[code] || 'Please check the error details and try again.';
  }
}
```

## 15.2 Backend — `src/decorators/permissions.decorator.ts`

```ts
import { SetMetadata } from '@nestjs/common';
import { UserPermissions } from '../services/users.service';

export const PERMISSIONS_KEY = 'permissions';

export interface RequiredPermission {
  entity: keyof UserPermissions;
  action: string;
}

export const RequirePermission = (entity: keyof UserPermissions, action: string) =>
  SetMetadata(PERMISSIONS_KEY, { entity, action });

export const RequireAnyPermission = (...permissions: RequiredPermission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
```

## 15.3 Backend — `src/guards/jwt-auth.guard.ts`

```ts
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../services/users.service';
import { AuthService } from '../services/auth.service';
import { DbService } from '../database/db.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private usersService: UsersService,
    private authService: AuthService,
    private db: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get('JWT_SECRET'),
      });

      // Standardize user identifier resolution
      const userId = payload.sub || payload.userId;
      const sessionId = payload.sessionId;

      if (!userId) {
        throw new UnauthorizedException('Invalid token payload');
      }

      // Fetch user to check status
      const user = await this.usersService.findById(userId);

      if (!user || user.status === 'inactive') {
        throw new UnauthorizedException('User not found or account inactive');
      }

      // Centralized session validation
      const isValid = await this.authService.validateSession(userId, sessionId);

      if (!isValid) {
        throw new UnauthorizedException('Session expired or invalid. Please login again.');
      }

      // Preserve token mappings (adminId, adminName, sessionId, deviceType) that
      // were generated at login. sessionId lets logout target only this device.
      request.user = {
        ...user,
        adminId: payload.adminId,
        adminName: payload.adminName,
        sessionId: payload.sessionId,
        deviceType: payload.deviceType,
      };
      
      return true;
    } catch (e: any) {
      // Expected auth failures (stale session, expired token, inactive user)
      // do not need a stack trace — the client gets 401 and re-authenticates.
      if (e instanceof UnauthorizedException) throw e;

      // Truly unexpected (DB error, malformed JWT, signature mismatch, etc.)
      console.error(`[AUTH GUARD] Unexpected auth failure:`, e.stack || e.message);
      const msg = e?.name === 'TokenExpiredError' ? 'Token expired' : (e?.message || 'Invalid token');
      throw new UnauthorizedException(msg);
    }
  }

  private extractToken(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
```

## 15.4 Backend — `src/guards/permissions.guard.ts`

```ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, RequiredPermission } from '../decorators/permissions.decorator';
import { User } from '../services/users.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermission = this.reflector.getAllAndOverride<RequiredPermission | RequiredPermission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermission) {
      return true; // No permission required
    }

    const { user }: { user: User } = context.switchToHttp().getRequest();

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Admin bypass
    if (user.role?.toLowerCase() === 'admin') {
      return true;
    }

    // Check permission
    const permissionsToCheck = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission];
    
    const hasPermission = permissionsToCheck.some(req => {
      const { entity, action } = req;
      return (user.permissions[entity] as any)?.[action];
    });

    if (!hasPermission) {
      throw new ForbiddenException(`You do not have permission to perform this action`);
    }

    return true;
  }
}
```

## 15.5 Backend — `src/services/ledger-group.service.ts`

```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { DbService } from '../database/db.service';

@Injectable()
export class LedgerGroupService implements OnModuleInit {
    constructor(private db: DbService) {}

    async onModuleInit() {
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS ledgergroup (
                id        INT AUTO_INCREMENT PRIMARY KEY,
                name      VARCHAR(255) NOT NULL,
                parent_id INT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_name (name),
                INDEX idx_parent (parent_id)
            )
        `);
    }

    async findAll() {
        return this.db.query<any>(`
            SELECT lg.id, lg.name, lg.parent_id,
                   p.name AS parent_name
            FROM ledgergroup lg
            LEFT JOIN ledgergroup p ON lg.parent_id = p.id
            ORDER BY lg.name ASC
        `);
    }

    async create(data: { name: string; parent_id?: number | null }) {
        const result = await this.db.execute(
            'INSERT INTO ledgergroup (name, parent_id) VALUES (?, ?)',
            [data.name, data.parent_id || null],
        );
        return { id: result.insertId, ...data };
    }

    async update(id: number, data: { name?: string; parent_id?: number | null }) {
        const fields: string[] = [];
        const params: any[] = [];
        if (data.name !== undefined)      { fields.push('name = ?');      params.push(data.name); }
        if (data.parent_id !== undefined) { fields.push('parent_id = ?'); params.push(data.parent_id || null); }
        if (!fields.length) return;
        params.push(id);
        await this.db.execute(`UPDATE ledgergroup SET ${fields.join(', ')} WHERE id = ?`, params);
    }

    async delete(id: number) {
        await this.db.execute('DELETE FROM ledgergroup WHERE id = ?', [id]);
    }
}
```

## 15.6 Backend — `src/controllers/ledger-group.controller.ts`

```ts
import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LedgerGroupService } from '../services/ledger-group.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission } from '../decorators/permissions.decorator';

@ApiTags('Ledger Groups')
@Controller('api/ledger-groups')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class LedgerGroupController {
    constructor(private ledgerGroupService: LedgerGroupService) {}

    @Get()
    @ApiOperation({ summary: 'Get all ledger groups' })
    @RequirePermission('ledger_groups', 'view')
    async findAll() {
        const data = await this.ledgerGroupService.findAll();
        return { success: true, data };
    }

    @Post()
    @ApiOperation({ summary: 'Create ledger group' })
    @RequirePermission('ledger_groups', 'create')
    async create(@Body() body: { name: string; parent_id?: number | null }) {
        const item = await this.ledgerGroupService.create(body);
        return { success: true, data: item, message: 'Ledger group created' };
    }

    @Put(':id')
    @ApiOperation({ summary: 'Update ledger group' })
    @RequirePermission('ledger_groups', 'edit')
    async update(@Param('id') id: string, @Body() body: { name?: string; parent_id?: number | null }) {
        await this.ledgerGroupService.update(parseInt(id, 10), body);
        return { success: true, message: 'Ledger group updated' };
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete ledger group' })
    @RequirePermission('ledger_groups', 'delete')
    async remove(@Param('id') id: string) {
        await this.ledgerGroupService.delete(parseInt(id, 10));
        return { success: true, message: 'Ledger group deleted' };
    }
}
```

## 15.7 Backend — `src/services/vchtype.service.ts`

```ts
import { Injectable, OnModuleInit, ForbiddenException } from '@nestjs/common';
import { DbService } from '../database/db.service';

const SEED_DATA = [
  { name: 'Contra',      deemed_positive: null },
  { name: 'Credit Note', deemed_positive: 'NO' },
  { name: 'Debit Note',  deemed_positive: 'YES' },
  { name: 'Journal',     deemed_positive: null },
  { name: 'Payment',     deemed_positive: null },
  { name: 'Purchase',    deemed_positive: 'NO' },
  { name: 'Receipt',     deemed_positive: null },
  { name: 'Sales',       deemed_positive: 'YES' },
];

@Injectable()
export class VchTypeService implements OnModuleInit {
    constructor(private db: DbService) {}

    async onModuleInit() {
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS vchtype (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                name            VARCHAR(255) NOT NULL,
                parent_id       INT NULL,
                deemed_positive ENUM('YES','NO') NULL DEFAULT NULL,
                is_system       TINYINT(1) NOT NULL DEFAULT 0,
                created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_name   (name),
                INDEX idx_parent (parent_id)
            )
        `);

        // Add is_system column if it doesn't exist (for existing installs)
        const [colCheck] = await this.db.query<any>(
            `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vchtype' AND COLUMN_NAME = 'is_system'`
        );
        if ((colCheck?.cnt ?? 0) === 0) {
            await this.db.execute(`ALTER TABLE vchtype ADD COLUMN is_system TINYINT(1) NOT NULL DEFAULT 0`);
        }

        // Seed only if table is empty
        const [row] = await this.db.query<any>('SELECT COUNT(*) as cnt FROM vchtype');
        if ((row?.cnt ?? 0) === 0) {
            for (const item of SEED_DATA) {
                await this.db.execute(
                    'INSERT INTO vchtype (name, parent_id, deemed_positive, is_system) VALUES (?, NULL, ?, 1)',
                    [item.name, item.deemed_positive],
                );
            }
            // Set parent_id = self for root types (matches Tally convention)
            await this.db.execute('UPDATE vchtype SET parent_id = id WHERE parent_id IS NULL');
        } else {
            // Ensure existing seed rows are marked as system
            await this.db.execute(
                `UPDATE vchtype SET is_system = 1 WHERE name IN (${SEED_DATA.map(() => '?').join(',')})`,
                SEED_DATA.map(s => s.name),
            );
        }
    }

    async findAll() {
        return this.db.query<any>(`
            SELECT v.id, v.name, v.parent_id, v.deemed_positive, v.is_system,
                   p.name AS parent_name
            FROM vchtype v
            LEFT JOIN vchtype p ON v.parent_id = p.id AND v.parent_id != v.id
            ORDER BY v.name ASC
        `);
    }

    async create(data: { name: string; parent_id?: number | null; deemed_positive?: 'YES' | 'NO' | null }) {
        const result = await this.db.execute(
            'INSERT INTO vchtype (name, parent_id, deemed_positive, is_system) VALUES (?, ?, ?, 0)',
            [data.name, data.parent_id || null, data.deemed_positive || null],
        );
        return { id: result.insertId, ...data };
    }

    async update(id: number, data: { name?: string; parent_id?: number | null; deemed_positive?: 'YES' | 'NO' | null }) {
        const existing = await this.db.queryOne<any>('SELECT is_system FROM vchtype WHERE id = ?', [id]);
        if (existing?.is_system) throw new ForbiddenException('System voucher types cannot be edited');

        const fields: string[] = [];
        const params: any[] = [];
        if (data.name !== undefined)            { fields.push('name = ?');            params.push(data.name); }
        if (data.parent_id !== undefined)       { fields.push('parent_id = ?');       params.push(data.parent_id || null); }
        if (data.deemed_positive !== undefined) { fields.push('deemed_positive = ?'); params.push(data.deemed_positive || null); }
        if (!fields.length) return;
        params.push(id);
        await this.db.execute(`UPDATE vchtype SET ${fields.join(', ')} WHERE id = ?`, params);
    }

    async delete(id: number) {
        const existing = await this.db.queryOne<any>('SELECT is_system FROM vchtype WHERE id = ?', [id]);
        if (existing?.is_system) throw new ForbiddenException('System voucher types cannot be deleted');
        await this.db.execute('DELETE FROM vchtype WHERE id = ?', [id]);
    }
}
```

## 15.8 Backend — `src/controllers/vchtype.controller.ts`

```ts
import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { VchTypeService } from '../services/vchtype.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission } from '../decorators/permissions.decorator';

@ApiTags('Voucher Types')
@Controller('api/vchtypes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class VchTypeController {
    constructor(private vchTypeService: VchTypeService) {}

    @Get()
    @ApiOperation({ summary: 'Get all voucher types' })
    @RequirePermission('vch_types', 'view')
    async findAll() {
        const data = await this.vchTypeService.findAll();
        return { success: true, data };
    }

    @Post()
    @ApiOperation({ summary: 'Create voucher type' })
    @RequirePermission('vch_types', 'create')
    async create(@Body() body: { name: string; parent_id?: number | null; deemed_positive?: 'YES' | 'NO' | null }) {
        const item = await this.vchTypeService.create(body);
        return { success: true, data: item, message: 'Voucher type created' };
    }

    @Put(':id')
    @ApiOperation({ summary: 'Update voucher type' })
    @RequirePermission('vch_types', 'edit')
    async update(
        @Param('id') id: string,
        @Body() body: { name?: string; parent_id?: number | null; deemed_positive?: 'YES' | 'NO' | null }
    ) {
        await this.vchTypeService.update(parseInt(id, 10), body);
        return { success: true, message: 'Voucher type updated' };
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete voucher type' })
    @RequirePermission('vch_types', 'delete')
    async remove(@Param('id') id: string) {
        await this.vchTypeService.delete(parseInt(id, 10));
        return { success: true, message: 'Voucher type deleted' };
    }
}
```

## 15.9 Backend — `src/services/other-ledger.service.ts`

```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { DbService } from '../database/db.service';

const SUNDRY_DEBTORS_ID = 26;

@Injectable()
export class OtherLedgerService implements OnModuleInit {
    constructor(private db: DbService) {}

    async onModuleInit() {
        await this.db.execute(`ALTER TABLE customer ADD COLUMN opening_balance DECIMAL(15,2) DEFAULT 0`).catch(() => {});
        await this.db.execute(`ALTER TABLE customer ADD COLUMN opening_balance_type ENUM('Dr','Cr') DEFAULT 'Dr'`).catch(() => {});
    }

    async findAll() {
        return this.db.query<any>(`
            SELECT c.id, c.company, c.ledgergroup,
                   lg.name AS ledgergroup_name,
                   c.opening_balance, c.opening_balance_type
            FROM customer c
            LEFT JOIN ledgergroup lg ON c.ledgergroup = lg.id
            WHERE c.ledgergroup != ${SUNDRY_DEBTORS_ID}
              AND c.ledgergroup IS NOT NULL
            ORDER BY c.company ASC
        `);
    }

    async create(data: { company: string; ledgergroup: number; opening_balance?: number; opening_balance_type?: string }) {
        const result = await this.db.execute(
            `INSERT INTO customer (company, ledgergroup, status, billbybill, opening_balance, opening_balance_type)
             VALUES (?, ?, 'Active', 'No', ?, ?)`,
            [data.company, data.ledgergroup, data.opening_balance ?? 0, data.opening_balance_type ?? 'Dr'],
        );
        return { id: result.insertId, ...data };
    }

    async update(id: number, data: { company?: string; ledgergroup?: number; opening_balance?: number; opening_balance_type?: string }) {
        const fields: string[] = [];
        const params: any[] = [];
        if (data.company !== undefined)               { fields.push('company = ?');               params.push(data.company); }
        if (data.ledgergroup !== undefined)           { fields.push('ledgergroup = ?');           params.push(data.ledgergroup); }
        if (data.opening_balance !== undefined)       { fields.push('opening_balance = ?');       params.push(data.opening_balance); }
        if (data.opening_balance_type !== undefined)  { fields.push('opening_balance_type = ?');  params.push(data.opening_balance_type); }
        if (!fields.length) return;
        params.push(id);
        await this.db.execute(`UPDATE customer SET ${fields.join(', ')} WHERE id = ?`, params);
    }

    async delete(id: number) {
        // Only allow deleting non-Sundry-Debtor records
        await this.db.execute(
            `DELETE FROM customer WHERE id = ? AND ledgergroup != ${SUNDRY_DEBTORS_ID}`,
            [id],
        );
    }
}
```

## 15.10 Backend — `src/controllers/other-ledger.controller.ts`

```ts
import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OtherLedgerService } from '../services/other-ledger.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission } from '../decorators/permissions.decorator';

@ApiTags('Other Ledgers')
@Controller('api/other-ledgers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class OtherLedgerController {
    constructor(private otherLedgerService: OtherLedgerService) {}

    @Get()
    @ApiOperation({ summary: 'Get all other ledgers' })
    @RequirePermission('other_ledgers', 'view')
    async findAll() {
        const data = await this.otherLedgerService.findAll();
        return { success: true, data };
    }

    @Post()
    @ApiOperation({ summary: 'Create other ledger' })
    @RequirePermission('other_ledgers', 'create')
    async create(@Body() body: { company: string; ledgergroup: number }) {
        const item = await this.otherLedgerService.create(body);
        return { success: true, data: item, message: 'Ledger created' };
    }

    @Put(':id')
    @ApiOperation({ summary: 'Update other ledger' })
    @RequirePermission('other_ledgers', 'edit')
    async update(@Param('id') id: string, @Body() body: { company?: string; ledgergroup?: number }) {
        await this.otherLedgerService.update(parseInt(id, 10), body);
        return { success: true, message: 'Ledger updated' };
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete other ledger' })
    @RequirePermission('other_ledgers', 'delete')
    async remove(@Param('id') id: string) {
        await this.otherLedgerService.delete(parseInt(id, 10));
        return { success: true, message: 'Ledger deleted' };
    }
}
```

## 15.11 Backend — `src/services/items.service.ts`

```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { DbService } from '../database/db.service';

@Injectable()
export class ItemsService implements OnModuleInit {
    constructor(private db: DbService) {}

    async onModuleInit() {
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                item_name VARCHAR(255) NOT NULL,
                tally_flavour_id INT DEFAULT NULL,
                batch ENUM('Yes','No') DEFAULT 'No',
                gst DECIMAL(5,2) DEFAULT 0,
                hsn VARCHAR(50) DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_name (item_name)
            )
        `);

        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS item_groups (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                parent_id INT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // Add parent_id to existing item_groups table
        await this.db.execute(`ALTER TABLE item_groups ADD COLUMN parent_id INT DEFAULT NULL`).catch(() => {});

        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS item_categories (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                parent_id INT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // Add category_id to items
        await this.db.execute(`ALTER TABLE items ADD COLUMN category_id INT DEFAULT NULL`).catch(() => {});

        // Add tally_flavour_id column if missing (migration from old VARCHAR column)
        const [newCol] = await this.db.query<any>(
            `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'items' AND COLUMN_NAME = 'tally_flavour_id'`
        );
        if ((newCol?.cnt ?? 0) === 0) {
            await this.db.execute(`ALTER TABLE items ADD COLUMN tally_flavour_id INT DEFAULT NULL`);
        }

        // Drop old tally_flavour VARCHAR column if it still exists
        const [oldCol] = await this.db.query<any>(
            `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'items' AND COLUMN_NAME = 'tally_flavour'`
        );
        if ((oldCol?.cnt ?? 0) > 0) {
            await this.db.execute(`ALTER TABLE items DROP COLUMN tally_flavour`).catch(() => {});
        }

        // Feature 1: item_group_id column
        await this.db.execute(`ALTER TABLE items ADD COLUMN item_group_id INT NULL`).catch(() => {});

        // Feature 3: opening balance columns
        await this.db.execute(`ALTER TABLE items ADD COLUMN opening_qty DECIMAL(10,3) DEFAULT 0`).catch(() => {});
        await this.db.execute(`ALTER TABLE items ADD COLUMN opening_rate DECIMAL(10,2) DEFAULT 0`).catch(() => {});
        await this.db.execute(`ALTER TABLE items ADD COLUMN opening_value DECIMAL(15,2) DEFAULT 0`).catch(() => {});

        // Ensure nullable columns for opening entries (vch_id IS NULL = opening entry)
        await this.db.execute(`ALTER TABLE inventory_entries MODIFY COLUMN led_id INT NULL`).catch(() => {});
        await this.db.execute(`ALTER TABLE batch MODIFY COLUMN vch_id INT NULL`).catch(() => {});
    }

    async getFlavours() {
        return this.db.query<{ id: number; name: string }>(
            `SELECT id, name FROM singlemaster WHERE type = 'TallyFlavor' ORDER BY name ASC`
        );
    }

    // ── Item Groups ──
    async getGroups(): Promise<any[]> {
        return this.db.query<any>(
            `SELECT g.id, g.name, g.parent_id, p.name AS parent_name
             FROM item_groups g
             LEFT JOIN item_groups p ON p.id = g.parent_id
             ORDER BY g.name`
        );
    }

    async createGroup(name: string, parentId?: number | null): Promise<any> {
        const result = await this.db.execute(
            'INSERT INTO item_groups (name, parent_id) VALUES (?, ?)',
            [name, parentId || null]
        );
        return { id: result.insertId, name, parent_id: parentId || null };
    }

    async updateGroup(id: number, name: string, parentId?: number | null): Promise<void> {
        await this.db.execute(
            'UPDATE item_groups SET name=?, parent_id=?, updated_at=NOW() WHERE id=?',
            [name, parentId || null, id]
        );
    }

    async deleteGroup(id: number): Promise<void> {
        await this.db.execute('DELETE FROM item_groups WHERE id=?', [id]);
    }

    // ── Item Categories ──
    async getCategories(): Promise<any[]> {
        return this.db.query<any>(
            `SELECT c.id, c.name, c.parent_id, p.name AS parent_name
             FROM item_categories c
             LEFT JOIN item_categories p ON p.id = c.parent_id
             ORDER BY c.name`
        );
    }

    async createCategory(name: string, parentId?: number | null): Promise<any> {
        const result = await this.db.execute(
            'INSERT INTO item_categories (name, parent_id) VALUES (?, ?)',
            [name, parentId || null]
        );
        return { id: result.insertId, name, parent_id: parentId || null };
    }

    async updateCategory(id: number, name: string, parentId?: number | null): Promise<void> {
        await this.db.execute(
            'UPDATE item_categories SET name=?, parent_id=?, updated_at=NOW() WHERE id=?',
            [name, parentId || null, id]
        );
    }

    async deleteCategory(id: number): Promise<void> {
        await this.db.execute('DELETE FROM item_categories WHERE id=?', [id]);
    }

    async create(data: {
        item_name: string;
        tally_flavour_id?: number | null;
        batch?: string;
        gst?: number;
        hsn?: string;
        item_group_id?: number | null;
        category_id?: number | null;
        opening_qty?: number;
        opening_rate?: number;
        opening_value?: number;
    }) {
        const result = await this.db.execute(
            `INSERT INTO items (item_name, tally_flavour_id, batch, gst, hsn, item_group_id, category_id, opening_qty, opening_rate, opening_value)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.item_name,
                data.tally_flavour_id || null,
                data.batch || 'No',
                data.gst || 0,
                data.hsn || null,
                data.item_group_id || null,
                data.category_id || null,
                data.opening_qty || 0,
                data.opening_rate || 0,
                data.opening_value || 0,
            ],
        );
        return { id: result.insertId, ...data };
    }

    async findAll() {
        return this.db.query<any>(
            `SELECT i.*, sm.name AS flavour_name, ig.name AS group_name, ic.name AS category_name
             FROM items i
             LEFT JOIN singlemaster sm ON i.tally_flavour_id = sm.id
             LEFT JOIN item_groups ig ON ig.id = i.item_group_id
             LEFT JOIN item_categories ic ON ic.id = i.category_id
             ORDER BY i.item_name ASC`
        );
    }

    async update(id: number, data: {
        item_name?: string;
        tally_flavour_id?: number | null;
        batch?: string;
        gst?: number;
        hsn?: string;
        item_group_id?: number | null;
        category_id?: number | null;
        opening_qty?: number;
        opening_rate?: number;
        opening_value?: number;
    }) {
        const fields: string[] = [];
        const params: any[] = [];
        if (data.item_name !== undefined)        { fields.push('item_name = ?');        params.push(data.item_name); }
        if (data.tally_flavour_id !== undefined) { fields.push('tally_flavour_id = ?'); params.push(data.tally_flavour_id || null); }
        if (data.batch !== undefined)            { fields.push('batch = ?');            params.push(data.batch); }
        if (data.gst !== undefined)              { fields.push('gst = ?');              params.push(data.gst); }
        if (data.hsn !== undefined)              { fields.push('hsn = ?');              params.push(data.hsn); }
        if (data.item_group_id !== undefined)    { fields.push('item_group_id = ?');    params.push(data.item_group_id || null); }
        if (data.category_id !== undefined)      { fields.push('category_id = ?');      params.push(data.category_id || null); }
        if (data.opening_qty !== undefined)      { fields.push('opening_qty = ?');      params.push(data.opening_qty); }
        if (data.opening_rate !== undefined)     { fields.push('opening_rate = ?');     params.push(data.opening_rate); }
        if (data.opening_value !== undefined)    { fields.push('opening_value = ?');    params.push(data.opening_value); }
        if (fields.length === 0) return;
        params.push(id);
        await this.db.execute(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`, params);
    }

    async delete(id: number) {
        await this.db.execute('DELETE FROM items WHERE id = ?', [id]);
    }

    // ── Opening Entries (vch_id IS NULL = opening, no voucher) ──
    async getOpeningBatches(itemId: number): Promise<any[]> {
        return this.db.query<any>(
            `SELECT b.* FROM batch b
             JOIN inventory_entries ie ON b.inventory_id = ie.id
             WHERE ie.item_id = ? AND b.vch_id IS NULL
             ORDER BY b.id`,
            [itemId]
        );
    }

    async saveOpeningBatches(itemId: number, batches: { batch_name: string; qty: number; rate: number; amount: number }[]): Promise<void> {
        // Remove existing opening entries (vch_id IS NULL) for this item
        await this.db.execute(
            `DELETE b FROM batch b
             JOIN inventory_entries ie ON b.inventory_id = ie.id
             WHERE ie.item_id = ? AND b.vch_id IS NULL`,
            [itemId]
        );
        await this.db.execute(
            `DELETE FROM inventory_entries WHERE item_id = ? AND led_id IS NULL`,
            [itemId]
        );

        if (!batches.length) return;

        const totalQty = batches.reduce((s, b) => s + b.qty, 0);
        const totalAmt = batches.reduce((s, b) => s + b.amount, 0);
        const avgRate  = totalQty > 0 ? totalAmt / totalQty : 0;

        const invResult = await this.db.execute(
            `INSERT INTO inventory_entries (led_id, item_id, qty, rate, amount) VALUES (NULL, ?, ?, ?, ?)`,
            [itemId, totalQty, avgRate, totalAmt]
        );
        const invId = invResult.insertId;

        for (const b of batches) {
            await this.db.execute(
                `INSERT INTO batch (vch_id, inventory_id, item_id, batch_name, qty, rate, amount) VALUES (NULL, ?, ?, ?, ?, ?, ?)`,
                [invId, itemId, b.batch_name || null, b.qty, b.rate, b.amount]
            );
        }
    }
}
```

## 15.12 Backend — `src/controllers/items.controller.ts`

```ts
import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ItemsService } from '../services/items.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequireAnyPermission } from '../decorators/permissions.decorator';

@ApiTags('Items')
@Controller('api/items')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ItemsController {
    constructor(private itemsService: ItemsService) {}

    @Get('flavours')
    @ApiOperation({ summary: 'Get TallyFlavour options from singlemaster' })
    @RequireAnyPermission({ entity: 'items', action: 'view' })
    async getFlavours() {
        const data = await this.itemsService.getFlavours();
        return { success: true, data };
    }

    @Get('groups')
    @ApiOperation({ summary: 'Get item groups' })
    @RequireAnyPermission({ entity: 'items', action: 'view' })
    async getGroups() {
        return { success: true, data: await this.itemsService.getGroups() };
    }

    @Post('groups')
    @ApiOperation({ summary: 'Create item group' })
    @RequireAnyPermission({ entity: 'items', action: 'create' })
    async createGroup(@Body() body: { name: string; parent_id?: number | null }) {
        return { success: true, data: await this.itemsService.createGroup(body.name, body.parent_id) };
    }

    @Put('groups/:id')
    @ApiOperation({ summary: 'Update item group' })
    @RequireAnyPermission({ entity: 'items', action: 'edit' })
    async updateGroup(@Param('id') id: string, @Body() body: { name: string; parent_id?: number | null }) {
        await this.itemsService.updateGroup(parseInt(id), body.name, body.parent_id);
        return { success: true };
    }

    @Delete('groups/:id')
    @ApiOperation({ summary: 'Delete item group' })
    @RequireAnyPermission({ entity: 'items', action: 'delete' })
    async deleteGroup(@Param('id') id: string) {
        await this.itemsService.deleteGroup(parseInt(id));
        return { success: true };
    }

    @Get('categories')
    @ApiOperation({ summary: 'Get item categories' })
    @RequireAnyPermission({ entity: 'items', action: 'view' })
    async getCategories() {
        return { success: true, data: await this.itemsService.getCategories() };
    }

    @Post('categories')
    @ApiOperation({ summary: 'Create item category' })
    @RequireAnyPermission({ entity: 'items', action: 'create' })
    async createCategory(@Body() body: { name: string; parent_id?: number | null }) {
        return { success: true, data: await this.itemsService.createCategory(body.name, body.parent_id) };
    }

    @Put('categories/:id')
    @ApiOperation({ summary: 'Update item category' })
    @RequireAnyPermission({ entity: 'items', action: 'edit' })
    async updateCategory(@Param('id') id: string, @Body() body: { name: string; parent_id?: number | null }) {
        await this.itemsService.updateCategory(parseInt(id), body.name, body.parent_id);
        return { success: true };
    }

    @Delete('categories/:id')
    @ApiOperation({ summary: 'Delete item category' })
    @RequireAnyPermission({ entity: 'items', action: 'delete' })
    async deleteCategory(@Param('id') id: string) {
        await this.itemsService.deleteCategory(parseInt(id));
        return { success: true };
    }

    @Get(':id/opening-batches')
    @ApiOperation({ summary: 'Get opening batches for an item' })
    @RequireAnyPermission({ entity: 'items', action: 'view' })
    async getOpeningBatches(@Param('id') id: string) {
        return { success: true, data: await this.itemsService.getOpeningBatches(parseInt(id, 10)) };
    }

    @Post(':id/opening-batches')
    @ApiOperation({ summary: 'Save opening batches for an item' })
    @RequireAnyPermission({ entity: 'items', action: 'create' })
    async saveOpeningBatches(@Param('id') id: string, @Body() body: { batches: any[] }) {
        await this.itemsService.saveOpeningBatches(parseInt(id, 10), body.batches || []);
        return { success: true };
    }

    @Get()
    @ApiOperation({ summary: 'Get all items' })
    @RequireAnyPermission({ entity: 'items', action: 'view' })
    async findAll() {
        const data = await this.itemsService.findAll();
        return { success: true, data };
    }

    @Post()
    @ApiOperation({ summary: 'Create item' })
    @RequireAnyPermission({ entity: 'items', action: 'create' })
    async create(@Body() body: any) {
        const item = await this.itemsService.create(body);
        return { success: true, data: item, message: 'Item created successfully' };
    }

    @Put(':id')
    @ApiOperation({ summary: 'Update item' })
    @RequireAnyPermission({ entity: 'items', action: 'edit' })
    async update(@Param('id') id: string, @Body() body: any) {
        await this.itemsService.update(parseInt(id, 10), body);
        return { success: true, message: 'Item updated successfully' };
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete item' })
    @RequireAnyPermission({ entity: 'items', action: 'delete' })
    async remove(@Param('id') id: string) {
        await this.itemsService.delete(parseInt(id, 10));
        return { success: true, message: 'Item deleted successfully' };
    }
}
```

## 15.13 Backend — `src/services/vouchers.service.ts` ⭐ (the heart of it)

```ts
import { Injectable, OnModuleInit, BadRequestException } from '@nestjs/common';
import { DbService } from '../database/db.service';

/**
 * Voucher structure (matches Tally-like model):
 *
 * vch_details        id | vch_no | vch_date | vch_type | party_ledger_id | amount | created_by
 * ledger_entries     id | vch_id | ledger_id | amount   (signed: +Dr / -Cr)
 * inventory_entries  id | led_id | item_id   | qty | rate | amount         (led_id → ledger_entries.id)
 *
 * All ledger_id values → customer.id  (customers AND other ledgers live in customer table)
 * inventory_entries hangs off the Sales/Purchase ledger_entry, not the voucher directly.
 */

@Injectable()
export class VouchersService implements OnModuleInit {
    constructor(private db: DbService) {}

    async onModuleInit() {
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS vch_details (
                id               INT AUTO_INCREMENT PRIMARY KEY,
                vch_type         VARCHAR(100) NOT NULL,
                vch_type_id      INT            DEFAULT NULL,
                vch_no           VARCHAR(100)   DEFAULT NULL,
                vch_date         DATE           DEFAULT NULL,
                party_ledger_id  INT            NOT NULL,
                amount           DECIMAL(14,2)  NOT NULL DEFAULT 0,
                remark           TEXT           DEFAULT NULL,
                created_by       VARCHAR(100),
                created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_type   (vch_type),
                INDEX idx_date   (vch_date),
                INDEX idx_party  (party_ledger_id)
            )
        `);

        // Drop legacy vch_type text column — use vch_type_id (FK to vchtype) only
        const [vtypeCol] = await this.db.query<any>(
            `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vch_details' AND COLUMN_NAME = 'vch_type'`
        );
        if ((vtypeCol?.cnt ?? 0) > 0) {
            await this.db.execute(`ALTER TABLE vch_details DROP COLUMN vch_type`).catch(() => {});
        }
        // Add remark column if missing
        const [remarkCol] = await this.db.query<any>(
            `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vch_details' AND COLUMN_NAME = 'remark'`
        );
        if ((remarkCol?.cnt ?? 0) === 0) {
            await this.db.execute(`ALTER TABLE vch_details ADD COLUMN remark TEXT DEFAULT NULL`);
        }
        // Add vch_type_id column if missing
        const [vtCol] = await this.db.query<any>(
            `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vch_details' AND COLUMN_NAME = 'vch_type_id'`
        );
        if ((vtCol?.cnt ?? 0) === 0) {
            await this.db.execute(`ALTER TABLE vch_details ADD COLUMN vch_type_id INT DEFAULT NULL`);
        }

        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS ledger_entries (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                vch_id     INT           NOT NULL,
                ledger_id  INT           DEFAULT NULL,
                amount     DECIMAL(14,2) NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_vch    (vch_id),
                INDEX idx_ledger (ledger_id),
                FOREIGN KEY (vch_id) REFERENCES vch_details(id) ON DELETE CASCADE
            )
        `);

        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS inventory_entries (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                led_id     INT           NOT NULL,
                item_id    INT           NOT NULL,
                qty        DECIMAL(10,3) DEFAULT 1,
                rate       DECIMAL(14,2) DEFAULT 0,
                amount     DECIMAL(14,2) DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_led  (led_id),
                INDEX idx_item (item_id),
                FOREIGN KEY (led_id) REFERENCES ledger_entries(id) ON DELETE CASCADE
            )
        `);

        // Migration: add gst_rate to inventory_entries if missing
        await this.db.execute(`ALTER TABLE inventory_entries ADD COLUMN gst_rate DECIMAL(5,2) DEFAULT 0`).catch(() => {});

        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS batch (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                vch_id       INT           NOT NULL,
                inventory_id INT           DEFAULT NULL,
                item_id      INT           NOT NULL,
                batch_name   VARCHAR(255)  DEFAULT NULL,
                qty          DECIMAL(10,3) DEFAULT 1,
                rate         DECIMAL(14,2) DEFAULT 0,
                amount       DECIMAL(14,2) DEFAULT 0,
                created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_vch  (vch_id),
                INDEX idx_inv  (inventory_id),
                INDEX idx_item (item_id)
            )
        `);

        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS bill_allocation (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                vchid        INT           NOT NULL,
                ledentry_id  INT           DEFAULT NULL,
                ledger       INT           DEFAULT NULL,
                billname     VARCHAR(255)  DEFAULT NULL,
                amount       DECIMAL(14,2) DEFAULT 0,
                created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_vchid     (vchid),
                INDEX idx_ledentry  (ledentry_id),
                INDEX idx_billname  (billname),
                INDEX idx_ledger    (ledger)
            )
        `);

        // Migration: drop type column if exists
        const [baTypeCol] = await this.db.query<any>(
            `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bill_allocation' AND COLUMN_NAME = 'type'`
        );
        if ((baTypeCol?.cnt ?? 0) > 0) {
            await this.db.execute(`ALTER TABLE bill_allocation DROP COLUMN type`).catch(() => {});
        }

        // Migration: change ledger column from VARCHAR to INT (stores customer.id)
        const [baLedgerType] = await this.db.query<any>(
            `SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bill_allocation' AND COLUMN_NAME = 'ledger'`
        );
        if (baLedgerType?.DATA_TYPE && baLedgerType.DATA_TYPE.toLowerCase() !== 'int') {
            await this.db.execute(`ALTER TABLE bill_allocation MODIFY COLUMN ledger INT DEFAULT NULL`);
        }
    }

    /** Look up ledger_id from customer table by company name */
    private async lookupLedgerId(name: string): Promise<number | null> {
        const row = await this.db.queryOne<{ id: number }>(
            `SELECT id FROM customer WHERE company = ? LIMIT 1`,
            [name],
        );
        return row?.id ?? null;
    }

    async create(data: {
        vch_type_id?: number;
        vch_no?: string;
        vch_date?: string;
        remark?: string;
        party_ledger_id: number;
        created_by?: string;
        is_igst?: boolean;
        items: Array<{
            item_id: number;
            qty: number;
            rate: number;
            amount: number;
            gst_rate?: number;
            cgst_amount: number;
            sgst_amount: number;
            igst_amount: number;
            batch_rows?: Array<{ batch_name?: string; qty: number; rate: number; amount: number }> | null;
        }>;
        ledgers?: Array<{ ledger_id: number; amount: number }>; // user-defined, pre-filtered non-zero
        bill_allocation?: Array<{ type: string; refno: string; amount: number; direction?: string }>;
    }) {
        // Unique voucher number check (per vch_type_id)
        if (data.vch_no) {
            const [dup] = await this.db.query<any>(
                `SELECT COUNT(*) as cnt FROM vch_details
                 WHERE vch_no = ? AND vch_type_id = ?`,
                [data.vch_no, data.vch_type_id || null],
            );
            if ((dup?.cnt ?? 0) > 0) {
                throw new BadRequestException(`Voucher number "${data.vch_no}" already exists for this voucher type`);
            }
        }

        // Journal mode: Contra / Journal / Payment / Receipt — no inventory items
        if (!data.items || data.items.length === 0) {
            const drTotal = +(data.ledgers || [])
                .filter(l => (l.amount || 0) > 0)
                .reduce((s, l) => s + l.amount, 0).toFixed(2);

            const vchResult = await this.db.execute(
                `INSERT INTO vch_details (vch_type_id, vch_no, vch_date, party_ledger_id, amount, remark, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [data.vch_type_id || null, data.vch_no || null, data.vch_date || null,
                 data.party_ledger_id, drTotal, data.remark || null, data.created_by || null],
            );
            const vchId = vchResult.insertId;

            let partyLedEntryId: number | null = null;
            for (const led of data.ledgers || []) {
                if (!led.ledger_id || !led.amount) continue;
                const ledRes = await this.db.execute(
                    `INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`,
                    [vchId, led.ledger_id, led.amount],
                );
                // Capture the ledger_entries.id for the party row
                if (led.ledger_id === data.party_ledger_id && partyLedEntryId === null) {
                    partyLedEntryId = ledRes.insertId;
                }
            }

            if (data.bill_allocation && data.bill_allocation.length > 0) {
                for (const ba of data.bill_allocation) {
                    if (!ba.amount) continue;
                    // If explicit direction set: Cr=negative, Dr=positive; else fall back to type logic
                    const signedAmt = ba.direction
                        ? (ba.direction === 'Cr' ? -Math.abs(ba.amount) : Math.abs(ba.amount))
                        : (ba.type === 'Agr.' ? -Math.abs(ba.amount) : Math.abs(ba.amount));
                    await this.db.execute(
                        `INSERT INTO bill_allocation (vchid, ledentry_id, ledger, billname, amount) VALUES (?, ?, ?, ?, ?)`,
                        [vchId, partyLedEntryId, data.party_ledger_id, ba.refno || null, signedAmt],
                    );
                }
            }

            return { id: vchId };
        }

        const subtotal   = +data.items.reduce((s, i) => s + i.amount, 0).toFixed(2);
        const ledgersSum = +(data.ledgers || []).reduce((s, l) => s + Math.abs(l.amount || 0), 0).toFixed(2);
        const grandTotal = +(subtotal + ledgersSum).toFixed(2);

        // 1. Voucher header (vch_type column dropped — use vch_type_id only)
        const vchResult = await this.db.execute(
            `INSERT INTO vch_details (vch_type_id, vch_no, vch_date, party_ledger_id, amount, remark, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [data.vch_type_id || null, data.vch_no || null, data.vch_date || null, data.party_ledger_id, grandTotal, data.remark || null, data.created_by || null],
        );
        const vchId = vchResult.insertId;

        // 2. Sign logic via deemed_positive from vchtype table
        //    deemed_positive = YES → Party Dr (+), Goods Cr (-), inventory out (qty/amount negative)
        //    deemed_positive = NO  → Goods Dr (+), Party Cr (-), inventory in  (qty/amount positive)
        let deemedPositive: boolean | null = null;
        let goodsLedgerName = 'Sales';
        if (data.vch_type_id) {
            const vtRow = await this.db.queryOne<any>(
                `SELECT v.name, v.deemed_positive,
                 p.name AS parent_name, p.deemed_positive AS parent_deemed
                 FROM vchtype v
                 LEFT JOIN vchtype p ON v.parent_id = p.id AND v.parent_id != v.id
                 WHERE v.id = ?`, [data.vch_type_id]
            );
            const dp = vtRow?.deemed_positive || vtRow?.parent_deemed;
            if (dp === 'YES') deemedPositive = true;
            else if (dp === 'NO') deemedPositive = false;
            const pname = (vtRow?.parent_name || vtRow?.name || '').toLowerCase();
            goodsLedgerName = (pname.includes('purchase') || pname.includes('debit')) ? 'Purchase' : 'Sales';
        }

        const goodsLedgerId = await this.lookupLedgerId(goodsLedgerName);
        let goodsLedId: number | null = null;

        // Fallback: if deemed_positive not set, treat as Sales (positive)
        const effectivePositive = deemedPositive ?? true;

        let partyLedEntryId: number | null = null;

        if (effectivePositive === true) {
            // Party Dr (+) — always first
            const pr = await this.db.execute(
                `INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`,
                [vchId, data.party_ledger_id, +grandTotal],
            );
            partyLedEntryId = pr.insertId;
            // Goods Cr (-) — inventory hangs here
            const r = await this.db.execute(
                `INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`,
                [vchId, goodsLedgerId, -subtotal],
            );
            goodsLedId = r.insertId;

        } else {
            // Party Cr (-) — always first
            const pr = await this.db.execute(
                `INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`,
                [vchId, data.party_ledger_id, -grandTotal],
            );
            partyLedEntryId = pr.insertId;
            // Goods Dr (+) — inventory hangs here
            const r = await this.db.execute(
                `INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`,
                [vchId, goodsLedgerId, +subtotal],
            );
            goodsLedId = r.insertId;
        }

        // 3. Inventory entries + batch
        // deemed YES → stock out: qty & amount negative
        // deemed NO  → stock in:  qty & amount positive
        if (goodsLedId) {
            const sign = effectivePositive === true ? -1 : 1;
            for (const item of data.items) {
                const invResult = await this.db.execute(
                    `INSERT INTO inventory_entries (led_id, item_id, qty, rate, amount, gst_rate) VALUES (?, ?, ?, ?, ?, ?)`,
                    [goodsLedId, item.item_id, item.qty * sign, item.rate, item.amount * sign, item.gst_rate || 0],
                );
                const invId = invResult.insertId;

                // Insert batch records
                if (item.batch_rows && item.batch_rows.length > 0) {
                    for (const b of item.batch_rows) {
                        await this.db.execute(
                            `INSERT INTO batch (vch_id, inventory_id, item_id, batch_name, qty, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                            [vchId, invId, item.item_id, b.batch_name || null, b.qty * sign, b.rate, b.amount * sign],
                        );
                    }
                } else {
                    // Non-batch item: single auto entry
                    await this.db.execute(
                        `INSERT INTO batch (vch_id, inventory_id, item_id, batch_name, qty, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [vchId, invId, item.item_id, null, item.qty * sign, item.rate, item.amount * sign],
                    );
                }
            }
        }

        // 4. User ledger entries (CGST, SGST, IGST, etc.)
        if (data.ledgers && data.ledgers.length > 0) {
            const sign = effectivePositive === true ? -1 : 1;
            for (const led of data.ledgers) {
                if (!led.ledger_id || !led.amount) continue;
                await this.db.execute(
                    `INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`,
                    [vchId, led.ledger_id, led.amount * sign],
                );
            }
        }

        // 5. Bill allocation entries
        // Sign mirrors party ledger_entry:
        //   effectivePositive=true  (Sales/Debit Note)    → party Dr (+) → New=+, Agr.=−
        //   effectivePositive=false (Purchase/Credit Note) → party Cr (−) → New=−, Agr.=+
        if (data.bill_allocation && data.bill_allocation.length > 0) {
            const baseSign = effectivePositive ? 1 : -1;
            for (const ba of data.bill_allocation) {
                if (!ba.amount) continue;
                // If explicit direction set: Cr=negative, Dr=positive; else use type+baseSign logic
                const signedAmt = ba.direction
                    ? (ba.direction === 'Cr' ? -Math.abs(ba.amount) : Math.abs(ba.amount))
                    : (ba.type === 'Agr.'
                        ? -Math.abs(ba.amount) * baseSign
                        :  Math.abs(ba.amount) * baseSign);
                await this.db.execute(
                    `INSERT INTO bill_allocation (vchid, ledentry_id, ledger, billname, amount) VALUES (?, ?, ?, ?, ?)`,
                    [vchId, partyLedEntryId, data.party_ledger_id, ba.refno || null, signedAmt],
                );
            }
        }

        return { id: vchId };
    }

    async findAll(page = 1, limit = 20, filters?: {
        vch_type?: string;
        search?: string;
        date_from?: string;
        date_to?: string;
    }) {
        const conditions: string[] = [];
        const params: any[] = [];
        if (filters?.vch_type)  { conditions.push('COALESCE(p.name, vt.name) = ?'); params.push(filters.vch_type); }
        if (filters?.search)    { conditions.push('(v.vch_no LIKE ? OR c.company LIKE ?)'); params.push(`%${filters.search}%`, `%${filters.search}%`); }
        if (filters?.date_from) { conditions.push('v.vch_date >= ?');   params.push(filters.date_from); }
        if (filters?.date_to)   { conditions.push('v.vch_date <= ?');   params.push(filters.date_to); }

        const where  = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const offset = (page - 1) * limit;

        const [count] = await this.db.query<any>(
            `SELECT COUNT(*) as total FROM vch_details v
             LEFT JOIN customer c ON v.party_ledger_id = c.id
             LEFT JOIN vchtype vt ON v.vch_type_id = vt.id
             LEFT JOIN vchtype p ON vt.parent_id = p.id AND vt.parent_id != vt.id
             ${where}`, params,
        );

        const data = await this.db.query<any>(
            `SELECT v.*, c.company AS party_name,
             COALESCE(p.name, vt.name) AS vch_type_name, vt.name AS vch_subtype_name
             FROM vch_details v
             LEFT JOIN customer c ON v.party_ledger_id = c.id
             LEFT JOIN vchtype vt ON v.vch_type_id = vt.id
             LEFT JOIN vchtype p ON vt.parent_id = p.id AND vt.parent_id != vt.id
             ${where}
             ORDER BY v.created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset],
        );

        return { data, total: count?.total || 0, page, limit };
    }

    async getDaybook(date: string) {
        return this.db.query<any>(
            `SELECT v.id, v.vch_no, v.vch_date, v.remark,
                    c.company AS party_name,
                    COALESCE(p.name, vt.name) AS vch_type_name,
                    vt.name AS vch_subtype_name,
                    CASE WHEN ple.amount > 0 THEN ABS(ple.amount) ELSE 0 END AS dr_amount,
                    CASE WHEN ple.amount < 0 THEN ABS(ple.amount) ELSE 0 END AS cr_amount,
                    v.created_at
             FROM vch_details v
             LEFT JOIN customer c ON v.party_ledger_id = c.id
             LEFT JOIN vchtype vt ON v.vch_type_id = vt.id
             LEFT JOIN vchtype p ON vt.parent_id = p.id AND vt.parent_id != vt.id
             LEFT JOIN ledger_entries ple ON ple.vch_id = v.id AND ple.ledger_id = v.party_ledger_id
             WHERE DATE(v.vch_date) = ?
             ORDER BY v.created_at ASC`,
            [date],
        );
    }

    async deleteVoucher(id: number) {
        await this.db.execute(`DELETE FROM bill_allocation WHERE vchid = ?`, [id]);
        await this.db.execute(`DELETE FROM batch WHERE vchid = ?`, [id]);
        await this.db.execute(
            `DELETE FROM inventory_entries WHERE led_id IN (SELECT id FROM ledger_entries WHERE vch_id = ?)`, [id],
        );
        await this.db.execute(`DELETE FROM ledger_entries WHERE vch_id = ?`, [id]);
        await this.db.execute(`DELETE FROM vch_details WHERE id = ?`, [id]);
    }

    async findById(id: number) {
        const vch = await this.db.queryOne<any>(
            `SELECT v.*, c.company AS party_name
             FROM vch_details v
             LEFT JOIN customer c ON v.party_ledger_id = c.id
             WHERE v.id = ?`, [id],
        );
        if (!vch) return null;

        const ledgerEntries = await this.db.query<any>(
            `SELECT le.*, c.company AS ledger_name
             FROM ledger_entries le
             LEFT JOIN customer c ON le.ledger_id = c.id
             WHERE le.vch_id = ? ORDER BY le.id`, [id],
        );

        // Attach inventory + batch rows to their ledger entry
        for (const le of ledgerEntries) {
            le.inventoryEntries = await this.db.query<any>(
                `SELECT ie.*, i.item_name, i.gst AS gst_rate
                 FROM inventory_entries ie
                 LEFT JOIN items i ON ie.item_id = i.id
                 WHERE ie.led_id = ? ORDER BY ie.id`, [le.id],
            );
            for (const ie of le.inventoryEntries) {
                ie.batchRows = await this.db.query<any>(
                    `SELECT batch_name, qty, rate, amount FROM batch WHERE inventory_id = ? ORDER BY id`, [ie.id],
                );
            }
        }

        // Attach bill allocation entries
        const billAllocations = await this.db.query<any>(
            `SELECT billname, amount, ledger FROM bill_allocation WHERE vchid = ? ORDER BY id`, [id],
        );

        return { ...vch, ledgerEntries, billAllocations };
    }

    /** Generate next voucher number for a given vch_type_id.
     *  Format: <prefix><padded-number> e.g. S-001, P-001
     *  Prefix is derived from the type name (first letter). */
    async getNextVoucherNo(vchTypeId: number): Promise<string> {
        const vtRow = await this.db.queryOne<any>(
            `SELECT v.name, COALESCE(p.name, v.name) AS parent_name
             FROM vchtype v
             LEFT JOIN vchtype p ON v.parent_id = p.id AND v.parent_id != v.id
             WHERE v.id = ?`, [vchTypeId]
        );
        const typeName: string = (vtRow?.name || vtRow?.parent_name || 'V').trim();
        const prefix = typeName.charAt(0).toUpperCase();

        const last = await this.db.queryOne<{ vch_no: string }>(
            `SELECT vch_no FROM vch_details WHERE vch_type_id = ? AND vch_no IS NOT NULL
             ORDER BY id DESC LIMIT 1`, [vchTypeId]
        );

        let nextNum = 1;
        if (last?.vch_no) {
            const match = last.vch_no.match(/(\d+)$/);
            if (match) nextNum = parseInt(match[1], 10) + 1;
        }
        return `${prefix}-${String(nextNum).padStart(3, '0')}`;
    }

    /** Return open/pending bill references for a customer.
     *  direction='Cr' (default) — party on Cr side (Receipt/Payment) → show positive pending bills
     *  direction='Dr' — party on Dr side → show negative pending (credit notes) */
    async getPendingRefs(customerId: number, _direction?: 'Dr' | 'Cr'): Promise<{ billname: string; amount: number; vch_date: string; vch_no: string; direction: string }[]> {
        // Show ALL pending refs (both Dr and Cr) — positive = Dr, negative = Cr
        return this.db.query<any>(
            `SELECT billname, ABS(net_amount) AS amount, vch_date, vch_no,
                    CASE WHEN net_amount > 0 THEN 'Dr' ELSE 'Cr' END AS direction
             FROM (
                -- Named bills: any non-zero net balance
                SELECT
                    ba.billname,
                    SUM(ba.amount) AS net_amount,
                    MIN(v.vch_date) AS vch_date,
                    MIN(v.vch_no)   AS vch_no
                FROM bill_allocation ba
                JOIN vch_details v ON ba.vchid = v.id
                WHERE ba.ledger = ?
                  AND ba.billname IS NOT NULL AND ba.billname != ''
                GROUP BY ba.billname
                HAVING ABS(SUM(ba.amount)) > 0.01

                UNION ALL

                -- On Account entries: billname IS NULL, grouped by voucher
                SELECT
                    CONCAT('On Acct (', COALESCE(v.vch_no, v.id), ')') AS billname,
                    SUM(ba.amount) AS net_amount,
                    v.vch_date,
                    v.vch_no
                FROM bill_allocation ba
                JOIN vch_details v ON ba.vchid = v.id
                WHERE ba.ledger = ?
                  AND (ba.billname IS NULL OR ba.billname = '')
                GROUP BY ba.vchid
                HAVING ABS(SUM(ba.amount)) > 0.01
             ) AS combined
             ORDER BY vch_date DESC
             LIMIT 50`,
            [customerId, customerId],
        );
    }

    /** Return distinct serial numbers owned by this customer (from tallydetails).
     *  Optionally filtered by flavour. Excludes serials already sold via batch. */
    async getSerials(customerId: number, flavourId?: number): Promise<string[]> {
        const tdFilter = flavourId ? 'AND td.tallyflavor = ?' : '';
        const tdParams: any[] = [customerId];
        if (flavourId) tdParams.push(flavourId);

        const rows = await this.db.query<{ s: string }>(
            `SELECT DISTINCT td.tallyserial AS s
             FROM tallydetails td
             WHERE CAST(td.customerid AS UNSIGNED) = ?
               ${tdFilter}
               AND td.tallyserial IS NOT NULL AND td.tallyserial != ''
               AND td.tallyserial NOT IN (
                   SELECT DISTINCT b2.batch_name FROM batch b2
                   WHERE b2.batch_name IS NOT NULL AND b2.qty < 0
               )
             ORDER BY td.tallyserial ASC`,
            tdParams,
        );

        return rows.map(r => r.s);
    }

    /** Update an existing voucher: delete all child entries and re-insert. */
    async update(id: number, data: Parameters<VouchersService['create']>[0]) {
        // Delete old entries (cascade handles ledger/inventory/batch via FK)
        await this.db.execute(`DELETE FROM bill_allocation WHERE vchid = ?`, [id]);
        await this.db.execute(`DELETE FROM batch WHERE vch_id = ?`, [id]);
        await this.db.execute(
            `DELETE FROM inventory_entries WHERE led_id IN (SELECT id FROM ledger_entries WHERE vch_id = ?)`, [id],
        );
        await this.db.execute(`DELETE FROM ledger_entries WHERE vch_id = ?`, [id]);

        // Re-compute amounts same as create, then UPDATE header
        let grandTotal = 0;
        if (!data.items || data.items.length === 0) {
            grandTotal = +(data.ledgers || []).filter(l => (l.amount || 0) > 0).reduce((s, l) => s + l.amount, 0).toFixed(2);
        } else {
            const subtotal = +data.items.reduce((s, i) => s + i.amount, 0).toFixed(2);
            const ledgersSum = +(data.ledgers || []).reduce((s, l) => s + Math.abs(l.amount || 0), 0).toFixed(2);
            grandTotal = +(subtotal + ledgersSum).toFixed(2);
        }

        // Check duplicate vch_no (exclude self)
        if (data.vch_no) {
            const [dup] = await this.db.query<any>(
                `SELECT COUNT(*) as cnt FROM vch_details WHERE vch_no = ? AND vch_type_id = ? AND id != ?`,
                [data.vch_no, data.vch_type_id || null, id],
            );
            if ((dup?.cnt ?? 0) > 0) {
                throw new BadRequestException(`Voucher number "${data.vch_no}" already exists for this voucher type`);
            }
        }

        await this.db.execute(
            `UPDATE vch_details SET vch_type_id=?, vch_no=?, vch_date=?, party_ledger_id=?, amount=?, remark=? WHERE id=?`,
            [data.vch_type_id || null, data.vch_no || null, data.vch_date || null,
             data.party_ledger_id, grandTotal, data.remark || null, id],
        );

        // Re-insert all child entries using existing create logic (reuse by calling create with temp, then move)
        // Simpler: just call create internals directly via a helper that returns the new id — but since
        // we already updated the header, we need to insert child rows with the existing vch_id.
        // We'll call a private helper that takes vchId instead of inserting a new header.
        await this._insertChildEntries(id, grandTotal, data);
        return { id };
    }

    /** Insert ledger, inventory, batch, and bill_allocation rows for an existing vch_id. */
    private async _insertChildEntries(vchId: number, grandTotal: number, data: Parameters<VouchersService['create']>[0]) {
        // Journal mode
        if (!data.items || data.items.length === 0) {
            let partyLedEntryId: number | null = null;
            for (const led of data.ledgers || []) {
                if (!led.ledger_id || !led.amount) continue;
                const ledRes = await this.db.execute(
                    `INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`,
                    [vchId, led.ledger_id, led.amount],
                );
                if (led.ledger_id === data.party_ledger_id && partyLedEntryId === null) {
                    partyLedEntryId = ledRes.insertId;
                }
            }
            if (data.bill_allocation && data.bill_allocation.length > 0) {
                for (const ba of data.bill_allocation) {
                    if (!ba.amount) continue;
                    const signedAmt = ba.direction
                        ? (ba.direction === 'Cr' ? -Math.abs(ba.amount) : Math.abs(ba.amount))
                        : (ba.type === 'Agr.' ? -Math.abs(ba.amount) : Math.abs(ba.amount));
                    await this.db.execute(
                        `INSERT INTO bill_allocation (vchid, ledentry_id, ledger, billname, amount) VALUES (?, ?, ?, ?, ?)`,
                        [vchId, partyLedEntryId, data.party_ledger_id, ba.refno || null, signedAmt],
                    );
                }
            }
            return;
        }

        const subtotal = +data.items.reduce((s, i) => s + i.amount, 0).toFixed(2);

        let deemedPositive: boolean | null = null;
        let goodsLedgerName = 'Sales';
        if (data.vch_type_id) {
            const vtRow = await this.db.queryOne<any>(
                `SELECT v.name, v.deemed_positive,
                 p.name AS parent_name, p.deemed_positive AS parent_deemed
                 FROM vchtype v
                 LEFT JOIN vchtype p ON v.parent_id = p.id AND v.parent_id != v.id
                 WHERE v.id = ?`, [data.vch_type_id]
            );
            const dp = vtRow?.deemed_positive || vtRow?.parent_deemed;
            if (dp === 'YES') deemedPositive = true;
            else if (dp === 'NO') deemedPositive = false;
            const pname = (vtRow?.parent_name || vtRow?.name || '').toLowerCase();
            goodsLedgerName = (pname.includes('purchase') || pname.includes('debit')) ? 'Purchase' : 'Sales';
        }

        const goodsLedgerId = await this.lookupLedgerId(goodsLedgerName);
        const effectivePositive = deemedPositive ?? true;
        let partyLedEntryId: number | null = null;
        let goodsLedId: number | null = null;

        if (effectivePositive) {
            const pr = await this.db.execute(`INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`, [vchId, data.party_ledger_id, +grandTotal]);
            partyLedEntryId = pr.insertId;
            const r = await this.db.execute(`INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`, [vchId, goodsLedgerId, -subtotal]);
            goodsLedId = r.insertId;
        } else {
            const pr = await this.db.execute(`INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`, [vchId, data.party_ledger_id, -grandTotal]);
            partyLedEntryId = pr.insertId;
            const r = await this.db.execute(`INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`, [vchId, goodsLedgerId, +subtotal]);
            goodsLedId = r.insertId;
        }

        if (goodsLedId) {
            const sign = effectivePositive ? -1 : 1;
            for (const item of data.items) {
                const invResult = await this.db.execute(
                    `INSERT INTO inventory_entries (led_id, item_id, qty, rate, amount, gst_rate) VALUES (?, ?, ?, ?, ?, ?)`,
                    [goodsLedId, item.item_id, item.qty * sign, item.rate, item.amount * sign, item.gst_rate || 0],
                );
                const invId = invResult.insertId;
                if (item.batch_rows && item.batch_rows.length > 0) {
                    for (const b of item.batch_rows) {
                        await this.db.execute(
                            `INSERT INTO batch (vch_id, inventory_id, item_id, batch_name, qty, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                            [vchId, invId, item.item_id, b.batch_name || null, b.qty * sign, b.rate, b.amount * sign],
                        );
                    }
                } else {
                    await this.db.execute(
                        `INSERT INTO batch (vch_id, inventory_id, item_id, batch_name, qty, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [vchId, invId, item.item_id, null, item.qty * sign, item.rate, item.amount * sign],
                    );
                }
            }
        }

        if (data.ledgers && data.ledgers.length > 0) {
            const sign = effectivePositive ? -1 : 1;
            for (const led of data.ledgers) {
                if (!led.ledger_id || !led.amount) continue;
                await this.db.execute(`INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`, [vchId, led.ledger_id, led.amount * sign]);
            }
        }

        if (data.bill_allocation && data.bill_allocation.length > 0) {
            const baseSign = effectivePositive ? 1 : -1;
            for (const ba of data.bill_allocation) {
                if (!ba.amount) continue;
                const signedAmt = ba.direction
                    ? (ba.direction === 'Cr' ? -Math.abs(ba.amount) : Math.abs(ba.amount))
                    : (ba.type === 'Agr.' ? -Math.abs(ba.amount) * baseSign : Math.abs(ba.amount) * baseSign);
                await this.db.execute(
                    `INSERT INTO bill_allocation (vchid, ledentry_id, ledger, billname, amount) VALUES (?, ?, ?, ?, ?)`,
                    [vchId, partyLedEntryId, data.party_ledger_id, ba.refno || null, signedAmt],
                );
            }
        }
    }
}
```

## 15.14 Backend — `src/controllers/vouchers.controller.ts` ⭐

```ts
import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, BadRequestException, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { VouchersService } from '../services/vouchers.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequireAnyPermission } from '../decorators/permissions.decorator';

@ApiTags('Vouchers')
@Controller('api/vouchers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class VouchersController {
    constructor(private vouchersService: VouchersService) {}

    @Post()
    @ApiOperation({ summary: 'Create a voucher with ledger & inventory entries' })
    @RequireAnyPermission({ entity: 'activities', action: 'create' })
    async create(@Body() body: any, @Request() req: any) {
        console.log('[Voucher] create body:', JSON.stringify(body));
        const partyId = parseInt(body.party_ledger_id, 10);
        if (!partyId || isNaN(partyId)) throw new BadRequestException('party_ledger_id is required and must be a valid number');
        const createdBy = req.user?.id ?? req.user?.userId ?? null;
        const result = await this.vouchersService.create({
            ...body,
            created_by: createdBy,
        });
        return { success: true, data: result, message: 'Voucher created successfully' };
    }

    @Get()
    @ApiOperation({ summary: 'List vouchers with filters' })
    @RequireAnyPermission({ entity: 'activities', action: 'view' })
    async findAll(
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('vch_type') vch_type?: string,
        @Query('search') search?: string,
        @Query('date_from') date_from?: string,
        @Query('date_to') date_to?: string,
    ) {
        const result = await this.vouchersService.findAll(
            parseInt(page || '1', 10),
            parseInt(limit || '20', 10),
            { vch_type, search, date_from, date_to },
        );
        return { success: true, ...result };
    }

    @Get('pending-refs')
    @ApiOperation({ summary: 'Get open bill references for a customer' })
    @RequireAnyPermission({ entity: 'activities', action: 'view' })
    async getPendingRefs(
        @Query('customer_id') customerId: string,
        @Query('direction') direction?: string,
    ) {
        const cId = parseInt(customerId, 10);
        if (!cId) return { success: true, data: [] };
        const dir = direction === 'Dr' ? 'Dr' : 'Cr';
        const data = await this.vouchersService.getPendingRefs(cId, dir);
        return { success: true, data };
    }

    @Get('serials')
    @ApiOperation({ summary: 'Get distinct serial numbers for a customer + flavour' })
    @RequireAnyPermission({ entity: 'activities', action: 'view' })
    async getSerials(
        @Query('customer_id') customerId: string,
        @Query('flavour_id') flavourId: string,
    ) {
        const cId = parseInt(customerId, 10);
        if (!cId) return { success: true, data: [] };
        const fId = flavourId ? parseInt(flavourId, 10) : undefined;
        const data = await this.vouchersService.getSerials(cId, fId);
        return { success: true, data };
    }

    @Get('next-no')
    @ApiOperation({ summary: 'Get next auto-generated voucher number for a vch_type_id' })
    @RequireAnyPermission({ entity: 'activities', action: 'view' })
    async getNextNo(@Query('vch_type_id') vchTypeId: string) {
        const id = parseInt(vchTypeId, 10);
        if (!id) return { success: true, data: '' };
        const vch_no = await this.vouchersService.getNextVoucherNo(id);
        return { success: true, data: vch_no };
    }

    @Get('daybook')
    @ApiOperation({ summary: 'Get all vouchers for a specific date' })
    @RequireAnyPermission({ entity: 'activities', action: 'view' })
    async getDaybook(@Query('date') date: string) {
        const d = date || new Date().toISOString().split('T')[0];
        const data = await this.vouchersService.getDaybook(d);
        return { success: true, data };
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get voucher detail with ledger & inventory entries' })
    @RequireAnyPermission({ entity: 'activities', action: 'view' })
    async findOne(@Param('id') id: string) {
        const voucher = await this.vouchersService.findById(parseInt(id, 10));
        return { success: true, data: voucher };
    }

    @Put(':id')
    @ApiOperation({ summary: 'Update a voucher (re-inserts all child entries)' })
    @RequireAnyPermission({ entity: 'activities', action: 'edit' })
    async update(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Request() req: any) {
        const partyId = parseInt(body.party_ledger_id, 10);
        if (!partyId || isNaN(partyId)) throw new BadRequestException('party_ledger_id is required');
        const result = await this.vouchersService.update(id, { ...body, created_by: req.user?.id ?? null });
        return { success: true, data: result, message: 'Voucher updated successfully' };
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete a voucher and all its entries' })
    @RequireAnyPermission({ entity: 'activities', action: 'delete' })
    async remove(@Param('id', ParseIntPipe) id: number) {
        await this.vouchersService.deleteVoucher(id);
        return { success: true, message: 'Voucher deleted' };
    }
}
```

## 15.15 Backend — Customer autocomplete (excerpt from `src/services/customers.service.ts`)

Only the methods needed by the voucher screen are shown:

```ts
// Sundry-Debtor party autocomplete (used by Vouchers party picker)
async autocomplete(query: string, cloudGroupId?: string | null | 'BLOCK'): Promise<any[]> {
  if (!query || query.trim().length < 2) return [];
  if (cloudGroupId === 'BLOCK') return [];
  const searchWildcard = `%${query.trim()}%`;
  const params: any[] = [searchWildcard];
  let groupFilter = '';
  if (cloudGroupId) {
    groupFilter = 'AND c.cloud_group_id = ?';
    params.push(cloudGroupId);
  }
  return this.db.query(`
    SELECT c.id, c.company, c.cloud_group_id, c.subgroupid, c.\`group\`, c.ledgergroup,
           c.pincode, s.name AS state_name, c.billbybill
    FROM customer c
    LEFT JOIN pincode pv ON c.pincode = pv.pincode
    LEFT JOIN state s ON pv.stateid = s.id
    WHERE c.status IN ('Active', 'Not Our Customer')
      AND c.company LIKE ?
      ${groupFilter}
    ORDER BY c.company
    LIMIT 15
  `, params);
}

// All-ledger search (toggle "Show all ledgers" in Vouchers)
async searchAllLedgers(query: string): Promise<any[]> {
  if (!query || query.trim().length < 2) return [];
  return this.db.query(
    `SELECT id, company, ledgergroup, billbybill FROM customer WHERE company LIKE ? ORDER BY company LIMIT 30`,
    [`%${query.trim()}%`]
  );
}
```

Controller endpoints (excerpt from `src/controllers/customers.controller.ts`):

```ts
@Get('autocomplete')
@RequireAnyPermission(/* ... view-on-relevant-entities ... */)
async autocomplete(@Query('q') q: string, @Request() req: any) {
  // Optional group filter for non-admin users
  const groupFilter = req.user?.role === 'admin' ? null : (req.user?.cloud_group_id || 'BLOCK');
  const data = await this.customersService.autocomplete(q, groupFilter);
  return { success: true, data };
}

@Get('ledger-search')
@RequireAnyPermission(/* ... */)
async searchAllLedgers(@Query('q') q: string) {
  const data = await this.customersService.searchAllLedgers(q || '');
  return { success: true, data };
}
```

## 15.16 Frontend — `src/services/api.ts` (relevant excerpts)

Just the helper + the API objects needed by the voucher screen:

```ts
// === Setup ===
const API_BASE = process.env.REACT_APP_API_URL || (
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:5000/api'
    : '/api'
);

// JWT helpers
export const getToken = (): string | null => {
  const raw = localStorage.getItem('abs_token_data');
  if (!raw) return null;
  try { return JSON.parse(raw).token || null; } catch { return null; }
};
export const storeToken = (token: string) =>
  localStorage.setItem('abs_token_data', JSON.stringify({ token, lastActivity: Date.now() }));
export const clearToken = () => localStorage.removeItem('abs_token_data');

export class ApiError extends Error {
  constructor(public message: string, public status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

// Generic fetch wrapper with auth + 401 handling
async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    if (response.status === 401 && !endpoint.includes('/auth/login')) {
      clearToken();
      window.location.replace('/login');
    }
    throw new ApiError(error.message || `HTTP ${response.status}`, response.status);
  }
  return response.json();
}

// === API objects used by the Voucher screen ===

export const ledgerGroupApi = {
  getAll: () => fetchApi<{ success: boolean; data: any[] }>('/ledger-groups'),
  create: (data: { name: string; parent_id?: number | null }) =>
    fetchApi<{ success: boolean; data: any }>('/ledger-groups', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: { name?: string; parent_id?: number | null }) =>
    fetchApi<{ success: boolean }>(`/ledger-groups/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    fetchApi<{ success: boolean }>(`/ledger-groups/${id}`, { method: 'DELETE' }),
};

export const vchTypeApi = {
  getAll: () => fetchApi<{ success: boolean; data: any[] }>('/vchtypes'),
  create: (data: { name: string; parent_id?: number | null; deemed_positive?: 'YES'|'NO'|null }) =>
    fetchApi<{ success: boolean; data: any }>('/vchtypes', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: any) =>
    fetchApi<{ success: boolean }>(`/vchtypes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    fetchApi<{ success: boolean }>(`/vchtypes/${id}`, { method: 'DELETE' }),
};

export const otherLedgerApi = {
  getAll: () => fetchApi<{ success: boolean; data: any[] }>('/other-ledgers'),
  create: (data: any) =>
    fetchApi<{ success: boolean; data: any }>('/other-ledgers', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: any) =>
    fetchApi<{ success: boolean }>(`/other-ledgers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    fetchApi<{ success: boolean }>(`/other-ledgers/${id}`, { method: 'DELETE' }),
};

export const itemsApi = {
  getAll: () => fetchApi<{ success: boolean; data: any[] }>('/items'),
  getFlavours: () => fetchApi<{ success: boolean; data: { id: number; name: string }[] }>('/items/flavours'),
  getGroups: () => fetchApi<{ success: boolean; data: any[] }>('/items/groups'),
  getCategories: () => fetchApi<{ success: boolean; data: any[] }>('/items/categories'),
  create: (data: any) => fetchApi<{ success: boolean; data: any }>('/items', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: any) => fetchApi<{ success: boolean }>(`/items/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) => fetchApi<{ success: boolean }>(`/items/${id}`, { method: 'DELETE' }),
};

export const customersApi = {
  search: (q: string) => fetchApi<{ success: boolean; data: any[] }>(`/customers/autocomplete?q=${encodeURIComponent(q)}`),
  searchAllLedgers: (q: string) => fetchApi<{ success: boolean; data: any[] }>(`/customers/ledger-search?q=${encodeURIComponent(q)}`),
  // ... other customer endpoints not needed by voucher screen
};

export const vouchersApi = {
  create:  (data: any) => fetchApi<{ success: boolean; data: any; message: string }>('/vouchers', { method: 'POST', body: JSON.stringify(data) }),
  update:  (id: number, data: any) => fetchApi<{ success: boolean; data: any; message: string }>(`/vouchers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getById: (id: number) => fetchApi<{ success: boolean; data: any }>(`/vouchers/${id}`),
  getAll:  (params: { page?: number; limit?: number; vch_type?: string; search?: string; date_from?: string; date_to?: string }) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.append(k, String(v)); });
    return fetchApi<{ success: boolean; data: any[]; total: number }>(`/vouchers?${q.toString()}`);
  },
  deleteVoucher:  (id: number) => fetchApi<{ success: boolean }>(`/vouchers/${id}`, { method: 'DELETE' }),
  getDaybook:     (date: string) => fetchApi<{ success: boolean; data: any[] }>(`/vouchers/daybook?date=${date}`),
  getNextNo:      (vchTypeId: number) => fetchApi<{ success: boolean; data: string }>(`/vouchers/next-no?vch_type_id=${vchTypeId}`),
  getPendingRefs: (customerId: number, direction?: 'Dr'|'Cr') =>
    fetchApi<{ success: boolean; data: { billname: string; amount: number; vch_date: string; vch_no: string; direction: string }[] }>(
      `/vouchers/pending-refs?customer_id=${customerId}${direction ? `&direction=${direction}` : ''}`
    ),
  getSerials: (customerId: number, flavourId?: number) =>
    fetchApi<{ success: boolean; data: string[] }>(`/vouchers/serials?customer_id=${customerId}${flavourId ? `&flavour_id=${flavourId}` : ''}`),
};
```

## 15.17 Frontend — `src/pages/Vouchers.tsx` ⭐ (the full UI)

Complete React component for voucher creation / edit. Drop into your project, tweak imports for your own toast/auth contexts, and wire up the route.

```tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Plus, X, Save, UserPlus, Eye, EyeOff, ChevronDown } from 'lucide-react';
import { itemsApi, customersApi, vouchersApi, otherLedgerApi, vchTypeApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast/Toast';

const MY_STATE = 'Assam';

interface BatchRow {
  id: string;
  batch_name: string;
  qty: number;
  rate: number;
  amount: number;
  serialSearch?: string;
  serialOpen?: boolean;
}

interface LineItem {
  product_id: string;
  item_name: string;
  qty: number;
  rate: number;
  amount: number;
  gst_rate: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  line_total: number;
  batch_rows?: BatchRow[];
}

interface LedgerRow {
  id: string;           // local key
  ledger_id: number | null;
  ledger_name: string;
  amount: number;
  auto: boolean;        // true = CGST/SGST/IGST auto rows
  search: string;
  open: boolean;
}

interface JournalRow {
  id: string;
  drOrCr: 'Dr' | 'Cr';
  ledger_id: number | null;
  ledger_name: string;
  dr_amount: number;
  cr_amount: number;
  search: string;
  open: boolean;
  results: any[];
}

const emptyJournalRow = (): JournalRow => ({
  id: uid(), drOrCr: 'Dr', ledger_id: null, ledger_name: '',
  dr_amount: 0, cr_amount: 0, search: '', open: false, results: [],
});

const emptyLine = (): LineItem => ({
  product_id: '', item_name: '', qty: 1, rate: 0,
  amount: 0, gst_rate: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, line_total: 0,
});

const applyGst = (item: LineItem, amount: number, isIgst: boolean): LineItem => {
  let cgst_amount = 0, sgst_amount = 0, igst_amount = 0;
  if (isIgst) {
    igst_amount = +(amount * item.gst_rate / 100).toFixed(2);
  } else {
    cgst_amount = +(amount * (item.gst_rate / 2) / 100).toFixed(2);
    sgst_amount = +(amount * (item.gst_rate / 2) / 100).toFixed(2);
  }
  const line_total = +(amount + cgst_amount + sgst_amount + igst_amount).toFixed(2);
  return { ...item, amount, cgst_amount, sgst_amount, igst_amount, line_total };
};

const calcLine = (item: LineItem, isIgst: boolean): LineItem => {
  const amount = +(item.qty * item.rate).toFixed(2);
  return applyGst(item, amount, isIgst);
};

// When amount is edited directly: back-calculate rate = amount / qty
const calcLineFromAmount = (item: LineItem, isIgst: boolean, newAmount: number): LineItem => {
  const rate = item.qty > 0 ? +(newAmount / item.qty).toFixed(4) : item.rate;
  return applyGst({ ...item, rate }, newAmount, isIgst);
};

const uid = () => Math.random().toString(36).slice(2);

interface VchTypeItem {
  id: number;
  name: string;
  parent_id: number | null;
  parent_name: string | null;
  is_system: number;
}

const Vouchers: React.FC = () => {
  const { user } = useAuth();
  const { showSuccess, showError } = useToast();
  const location = useLocation();

  // Vch types
  const [allVchTypes, setAllVchTypes]       = useState<VchTypeItem[]>([]);
  const [selectedParentId, setSelectedParentId] = useState<number | null>(null);

  const [editId, setEditId] = useState<number | null>(null);
  const [voucherNo, setVoucherNo]     = useState('');
  const [voucherDate, setVoucherDate] = useState(new Date().toISOString().slice(0, 10));

  // Party
  const [partyId, setPartyId]               = useState('');
  const [partyDisplay, setPartyDisplay]     = useState('');
  const [partyState, setPartyState]         = useState('');
  const [isIgst, setIsIgst]               = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDrop, setShowCustomerDrop] = useState(false);
  const [customers, setCustomers]           = useState<any[]>([]);
  const customerRef                         = useRef<HTMLDivElement>(null);

  // Inline customer creation
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const blankCustForm = () => ({ company: '', mobile: '', gstin: '', email: '', pincode: '', address1: '', address2: '', area: '', state: '' });
  const [custForm, setCustForm] = useState(blankCustForm());

  // Items
  const [lines, setLines]       = useState<LineItem[]>([emptyLine()]);
  const [products, setProducts] = useState<any[]>([]);
  const [showGst, setShowGst]   = useState(false);

  // Ledger rows (auto + user)
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const [allLedgers, setAllLedgers] = useState<any[]>([]); // all from customer table (other ledgers)
  const [taxLedgerIds, setTaxLedgerIds] = useState<{ cgst: number|null; sgst: number|null; igst: number|null }>({ cgst: null, sgst: null, igst: null });

  const [submitting, setSubmitting] = useState(false);
  const [remark, setRemark]         = useState('');

  // Batch popup
  const [batchPopupIdx, setBatchPopupIdx] = useState<number | null>(null);
  const [batchDraft, setBatchDraft]       = useState<BatchRow[]>([]);
  const [batchSerials, setBatchSerials]   = useState<string[]>([]);
  const [batchNoFlavour, setBatchNoFlavour] = useState(false);

  // Bill allocation
  const [customerBillByBill, setCustomerBillByBill] = useState(false);
  const [billAllocOpen, setBillAllocOpen]           = useState(false);
  const [billAllocEntries, setBillAllocEntries]     = useState<{ id: string; type: 'New' | 'Agr.' | 'On Account'; refno: string; amount: number; direction?: string; refSearch?: string; refOpen?: boolean }[]>([]);
  const [pendingRefs, setPendingRefs]               = useState<{ billname: string; amount: number; vch_date: string; vch_no: string; direction: string }[]>([]);
  const [pendingRefsDir, setPendingRefsDir]         = useState<string>('Cr');

  // Derived: system parents and filtered child types
  const systemParents = allVchTypes.filter(t => t.is_system === 1);
  const childTypes    = allVchTypes.filter(t =>
    selectedParentId === null || t.parent_id === selectedParentId || t.id === selectedParentId
  );

  const [voucherType, setVoucherType] = useState('');

  // Purchase mode = Purchase or Debit Note → user types serial no.
  // Sales mode    = Sales or Credit Note   → user searches & selects existing serial no.
  const isPurchaseMode = (() => {
    const vt = voucherType.toLowerCase();
    const parent = (allVchTypes.find(t => t.id === selectedParentId)?.name || '').toLowerCase();
    return vt.includes('purchase') || vt.includes('debit') || parent.includes('purchase') || parent.includes('debit');
  })();

  // Journal mode = Contra / Journal / Payment / Receipt — no inventory, Dr/Cr ledger table
  const isJournalType = (() => {
    const parent = (allVchTypes.find(t => t.id === selectedParentId)?.name || '').toLowerCase();
    return parent.includes('contra') || parent.includes('journal') || parent.includes('payment') || parent.includes('receipt');
  })();

  // Journal rows state
  const [journalRows, setJournalRows] = useState<JournalRow[]>([emptyJournalRow(), emptyJournalRow()]);
  // Which journal row is the "party" (billbybill=Yes) — track ledger_id + amount + side
  const [journalParty, setJournalParty] = useState<{ ledger_id: number; amount: number; drOrCr: 'Dr' | 'Cr' } | null>(null);
  // When parent changes, reset voucherType to first child
  useEffect(() => {
    const first = allVchTypes.find(t => selectedParentId === null || t.parent_id === selectedParentId || t.id === selectedParentId);
    setVoucherType(first?.name ?? '');
  }, [selectedParentId, allVchTypes]);

  // Auto-generate voucher number when type changes (only for new vouchers, not editing)
  useEffect(() => {
    if (editId) return; // don't overwrite when editing
    const vtId = childTypes.find(t => t.name === voucherType)?.id || selectedParentId;
    if (!vtId) return;
    vouchersApi.getNextNo(vtId).then((r: any) => {
      if (r.success && r.data) setVoucherNo(r.data);
    }).catch(() => {});
  }, [voucherType, selectedParentId, editId]);

  // ----- Data loading -----
  useEffect(() => {
    vchTypeApi.getAll().then((r: any) => {
      if (r.success) {
        setAllVchTypes(r.data);
        // Default select first system parent
        // Default to Sales (preferred) or first system type
        const salesType = r.data.find((t: VchTypeItem) => t.is_system === 1 && t.name === 'Sales');
        const firstParent = salesType || r.data.find((t: VchTypeItem) => t.is_system === 1);
        if (firstParent) setSelectedParentId(firstParent.id);
      }
    }).catch(() => {});
    itemsApi.getAll().then(r => { if (r.success) setProducts(r.data); }).catch(() => {});
    // Load all ledger accounts from other-ledgers (non-sundry debtors: CGST, SGST, IGST, etc.)
    otherLedgerApi.getAll().then((r: any) => {
      const data: any[] = r.success ? r.data : (Array.isArray(r) ? r : []);
      setAllLedgers(data);
      // Pre-find tax ledger IDs by name
      const find = (name: string) => data.find((l: any) => (l.company || '').toUpperCase() === name)?.id ?? null;
      setTaxLedgerIds({ cgst: find('CGST'), sgst: find('SGST'), igst: find('IGST') });
    }).catch(() => {});
  }, []);

  // ── Load voucher for edit (from Daybook navigate state) ──
  useEffect(() => {
    const editRow = (location.state as any)?.editVoucher;
    if (!editRow?.id || allVchTypes.length === 0) return;

    vouchersApi.getById(editRow.id).then(res => {
      if (!res.success || !res.data) return;
      const v = res.data;
      setEditId(v.id);

      // 1. Voucher type
      const vt = allVchTypes.find(t => t.id === v.vch_type_id);
      if (vt) {
        const parentId = vt.parent_id && vt.parent_id !== vt.id ? vt.parent_id : vt.id;
        setSelectedParentId(parentId);
        setVoucherType(vt.name);
      }

      // 2. Header fields
      setVoucherNo(v.vch_no || '');
      setVoucherDate(v.vch_date ? v.vch_date.split('T')[0] : '');
      setRemark(v.remark || '');

      // 3. Party — also resolve state to set isIgst correctly
      setPartyId(String(v.party_ledger_id));
      setPartyDisplay(v.party_name || '');
      const partyLedger = allLedgers.find((l: any) => l.id === v.party_ledger_id);
      const partyStateName = partyLedger?.state || '';
      const editIgst = partyStateName ? partyStateName.toLowerCase() !== MY_STATE.toLowerCase() : false;
      setPartyState(partyStateName);
      setIsIgst(editIgst);

      // 4. Split ledger entries
      // Note: inventory hangs on the GOODS ledger entry (Purchase/Sales), NOT the party ledger entry
      const allEntries: any[] = v.ledgerEntries || [];
      // Find the entry that actually has inventory (could be Purchase/Sales row, not party row)
      const inventoryEntry = allEntries.find((le: any) => le.inventoryEntries?.length > 0);
      // Exclude both party entry AND goods/inventory entry (both are auto-managed by the system)
      const otherEntries: any[] = allEntries.filter((le: any) =>
        String(le.ledger_id) !== String(v.party_ledger_id) &&
        le.id !== inventoryEntry?.id
      );

      // 5. Item lines (from inventory entry) — including batch rows
      if (inventoryEntry?.inventoryEntries?.length) {
        setLines(inventoryEntry.inventoryEntries.map((ie: any) => {
          const base = {
            product_id: String(ie.item_id),
            item_name: ie.item_name || '',
            qty: Math.abs(Number(ie.qty)),
            rate: Number(ie.rate),
            amount: Math.abs(Number(ie.amount)),
            gst_rate: Number(ie.gst_rate) || 0,
            cgst_amount: 0,
            sgst_amount: 0,
            igst_amount: 0,
            line_total: Math.abs(Number(ie.amount)),
            batch_rows: (ie.batchRows || []).map((b: any) => ({
              batch_name: b.batch_name || '',
              qty: Math.abs(Number(b.qty)),
              rate: Number(b.rate),
              amount: Math.abs(Number(b.amount)),
            })),
          };
          return calcLine(base, editIgst);
        }));
      }

      // 6. Determine if journal type
      const parentName = (allVchTypes.find(t => t.id === (vt?.parent_id && vt.parent_id !== vt.id ? vt.parent_id : vt?.id))?.name || '').toLowerCase();
      const isJournal = ['contra','journal','payment','receipt'].some(k => parentName.includes(k) || vt?.name.toLowerCase().includes(k));

      if (isJournal) {
        // Journal rows: all ledger entries as Dr/Cr rows
        setJournalRows((v.ledgerEntries || []).map((le: any) => ({
          id: uid(),
          drOrCr: Number(le.amount) >= 0 ? 'Dr' as const : 'Cr' as const,
          ledger_id: le.ledger_id,
          ledger_name: le.ledger_name || '',
          dr_amount: Number(le.amount) > 0 ? Number(le.amount) : 0,
          cr_amount: Number(le.amount) < 0 ? Math.abs(Number(le.amount)) : 0,
          search: le.ledger_name || '',
          open: false,
          results: [],
        })));
        // Restore journalParty from party_ledger_id so bill allocation popup works
        const partyLe = (v.ledgerEntries || []).find((le: any) => String(le.ledger_id) === String(v.party_ledger_id));
        if (partyLe) {
          setJournalParty({
            ledger_id: Number(partyLe.ledger_id),
            amount: Math.abs(Number(partyLe.amount)),
            drOrCr: Number(partyLe.amount) >= 0 ? 'Dr' : 'Cr',
          });
          setCustomerBillByBill(true);
        }
      } else {
        // Ledger rows for normal mode: other entries — exclude auto-managed tax/roundoff rows
        const manualEntries = otherEntries.filter((le: any) =>
          !/cgst|sgst|igst|round/i.test(le.ledger_name || '')
        );
        if (manualEntries.length) {
          setLedgerRows(manualEntries.map((le: any) => ({
            id: uid(),
            ledger_id: le.ledger_id,
            ledger_name: le.ledger_name || '',
            amount: Math.abs(Number(le.amount)),
            auto: false,
            search: le.ledger_name || '',
            open: false,
          })));
        }
      }

      // 7. Bill allocations
      if (v.billAllocations?.length) {
        setBillAllocEntries(v.billAllocations.map((ba: any) => ({
          type: 'Agst Ref',
          refno: ba.billname || '',
          amount: Math.abs(Number(ba.amount)),
          direction: Number(ba.amount) >= 0 ? 'Dr' : 'Cr',
        })));
      }
    }).catch(() => {});
  }, [(location.state as any)?.editVoucher?.id, allVchTypes.length, allLedgers.length]);

  // Live party autocomplete
  useEffect(() => {
    if (customerSearch.length < 2) {
      setCustomers([]);
      setShowCustomerDrop(false);
      return;
    }
    const t = setTimeout(() => {
      customersApi.search(customerSearch).then((r: any) => {
        const list = Array.isArray(r) ? r : (r?.data || []);
        setCustomers(list);
        if (list.length > 0) setShowCustomerDrop(true);
      }).catch((e: any) => {
        console.warn('[CustomerSearch] failed:', e?.message || e);
        setCustomers([]);
      });
    }, 200);
    return () => clearTimeout(t);
  }, [customerSearch]);

  // Close party dropdown on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (customerRef.current && !customerRef.current.contains(e.target as Node)) setShowCustomerDrop(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // ----- Party selection -----
  const selectParty = async (c: any) => {
    setPartyDisplay(c.company);
    setPartyId(String(c.id));
    setCustomerSearch('');
    setShowCustomerDrop(false);

    // state_name comes directly from autocomplete (pincode JOIN in backend)
    let stateName = (typeof c?.state_name === 'string' && isNaN(Number(c.state_name)))
      ? c.state_name : '';

    // Fallback: pincodeApi lookup if autocomplete didn't include state
    if (!stateName && c?.pincode && String(c.pincode).replace(/\D/g,'').length === 6) {
      try {
        const { pincodeApi } = await import('../services/api');
        const pr = await pincodeApi.lookup(String(c.pincode).replace(/\D/g,''));
        if (pr?.state && isNaN(Number(pr.state))) stateName = pr.state;
      } catch {}
    }

    setPartyState(stateName);
    const igst = stateName ? stateName.toLowerCase() !== MY_STATE.toLowerCase() : false;
    setIsIgst(igst);
    setLines(prev => prev.map(l => calcLine(l, igst)));
    setCustomerBillByBill(c.billbybill === 'Yes');
    setBillAllocEntries([]);
  };

  // Recalculate lines when GST type changes
  useEffect(() => {
    setLines(prev => prev.map(l => calcLine(l, isIgst)));
  }, [isIgst]);

  // ----- Totals -----
  const subtotal   = +lines.reduce((s, l) => s + l.amount, 0).toFixed(2);
  const totalCgst  = +lines.reduce((s, l) => s + l.cgst_amount, 0).toFixed(2);
  const totalSgst  = +lines.reduce((s, l) => s + l.sgst_amount, 0).toFixed(2);
  const totalIgst  = +lines.reduce((s, l) => s + l.igst_amount, 0).toFixed(2);
  // Exclude roundoff row from rawTotal to avoid circular dependency
  const ledgerTotal  = ledgerRows.filter(r => r.id !== 'auto-roundoff').reduce((s, r) => s + (r.amount || 0), 0);
  const rawTotal     = +(subtotal + ledgerTotal).toFixed(2);
  const roundoffAmt  = +(Math.round(rawTotal) - rawTotal).toFixed(2);
  const grandTotal   = +(rawTotal + roundoffAmt).toFixed(2);

  // ----- Auto-sync GST ledger rows (CGST/SGST/IGST) -----
  useEffect(() => {
    setLedgerRows(prev => {
      // Keep user rows except roundoff (managed separately)
      const user = prev.filter(r => !r.auto && r.id !== 'auto-roundoff');
      const roundoffRow = prev.find(r => r.id === 'auto-roundoff');
      const auto: LedgerRow[] = [];

      if (!isIgst) {
        if (totalCgst > 0) auto.push({
          id: 'auto-cgst', ledger_id: taxLedgerIds.cgst, ledger_name: 'CGST',
          amount: totalCgst, auto: true, search: 'CGST', open: false,
        });
        if (totalSgst > 0) auto.push({
          id: 'auto-sgst', ledger_id: taxLedgerIds.sgst, ledger_name: 'SGST',
          amount: totalSgst, auto: true, search: 'SGST', open: false,
        });
      } else {
        if (totalIgst > 0) auto.push({
          id: 'auto-igst', ledger_id: taxLedgerIds.igst, ledger_name: 'IGST',
          amount: totalIgst, auto: true, search: 'IGST', open: false,
        });
      }

      const restored = auto.map(a => {
        const existing = prev.find(p => p.id === a.id);
        if (existing && existing.ledger_id && existing.ledger_id !== a.ledger_id) {
          return { ...a, ledger_id: existing.ledger_id, ledger_name: existing.ledger_name, search: existing.search };
        }
        return a;
      });

      // Preserve roundoff row position at the end
      return roundoffRow ? [...restored, ...user, roundoffRow] : [...restored, ...user];
    });
  }, [totalCgst, totalSgst, totalIgst, isIgst, taxLedgerIds]);

  // ----- Auto-sync Roundoff ledger row -----
  useEffect(() => {
    const roundoffLedger = allLedgers.find(l => /round/i.test(l.company || ''));
    setLedgerRows(prev => {
      const withoutRoundoff = prev.filter(r => r.id !== 'auto-roundoff');
      if (roundoffAmt === 0) return withoutRoundoff;
      const existing = prev.find(r => r.id === 'auto-roundoff');
      return [...withoutRoundoff, {
        id: 'auto-roundoff',
        ledger_id: existing?.ledger_id ?? (roundoffLedger?.id || null),
        ledger_name: existing?.ledger_name ?? (roundoffLedger?.company || 'Roundoff'),
        amount: roundoffAmt,
        auto: false,  // editable
        search: existing?.search ?? (roundoffLedger?.company || 'Roundoff'),
        open: false,
      }];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawTotal]);

  // ----- Line item updates -----
  const updateLine = useCallback((idx: number, field: keyof LineItem, value: any) => {
    setLines(prev => {
      const updated = [...prev];
      let line = { ...updated[idx], [field]: value };
      if (field === 'product_id') {
        const prod = products.find(p => String(p.id) === String(value));
        if (prod) { line.item_name = prod.item_name; line.gst_rate = Number(prod.gst) || 0; }
      }
      if (field === 'amount') {
        line = calcLineFromAmount(line, isIgst, Number(value) || 0);
      } else if (['product_id', 'qty', 'rate', 'gst_rate'].includes(field as string)) {
        line = calcLine(line, isIgst);
      }
      updated[idx] = line;
      return updated;
    });
  }, [products, isIgst]);

  const addRow    = () => setLines(p => [...p, emptyLine()]);
  const removeRow = (idx: number) => { if (lines.length > 1) setLines(p => p.filter((_, i) => i !== idx)); };

  // ----- Ledger row management -----
  const addLedgerRow = () => setLedgerRows(p => [...p, {
    id: uid(), ledger_id: null, ledger_name: '', amount: 0, auto: false, search: '', open: false,
  }]);

  const removeLedgerRow = (id: string) => setLedgerRows(p => p.filter(r => r.id !== id));

  const updateLedgerRow = (id: string, patch: Partial<LedgerRow>) =>
    setLedgerRows(p => p.map(r => r.id === id ? { ...r, ...patch } : r));

  const selectLedger = (rowId: string, l: any) =>
    updateLedgerRow(rowId, { ledger_id: l.id, ledger_name: l.company, search: l.company, open: false });

  // ----- Batch popup helpers -----
  const openBatchPopup = async (idx: number, overrideProductId?: string) => {
    const existing = lines[idx].batch_rows;
    const draft = existing?.length
      ? existing.map(r => ({ ...r, serialSearch: r.batch_name, serialOpen: false }))
      : [{ id: uid(), batch_name: '', qty: 1, rate: 0, amount: 0, serialSearch: '', serialOpen: false }];
    setBatchDraft(draft);
    setBatchPopupIdx(idx);
    setBatchSerials([]);

    // Sales/Credit Note: fetch existing serial nos for search-and-select
    // Purchase/Debit Note: user types manually — no fetch needed
    setBatchNoFlavour(false);
    if (!isPurchaseMode && partyId) {
      const resolvedProductId = overrideProductId ?? lines[idx].product_id;
      const prod = products.find((p: any) => String(p.id) === String(resolvedProductId));
      const flavourId = prod?.tally_flavour_id || undefined;
      if (!flavourId) {
        // Item has no flavour configured — cannot filter serials by product
        setBatchNoFlavour(true);
        setBatchSerials([]);
      } else {
        try {
          const res = await vouchersApi.getSerials(parseInt(partyId, 10), flavourId);
          if (res.success) setBatchSerials(res.data);
        } catch { setBatchSerials([]); }
      }
    }
  };

  const saveBatch = () => {
    if (batchPopupIdx === null) return;
    const valid = batchDraft.filter(r => r.qty > 0);
    const totalQty    = +valid.reduce((s, r) => s + r.qty, 0).toFixed(3);
    const totalAmount = +valid.reduce((s, r) => s + r.amount, 0).toFixed(2);
    const avgRate     = totalQty > 0 ? +(totalAmount / totalQty).toFixed(4) : 0;
    setLines(prev => {
      const updated = [...prev];
      const base = { ...updated[batchPopupIdx], qty: totalQty, rate: avgRate };
      const line = { ...calcLine(base, isIgst), batch_rows: valid };
      updated[batchPopupIdx] = line;
      return updated;
    });
    setBatchPopupIdx(null);
    setBatchDraft([]);
  };

  // ----- New customer -----
  const handleCreateCustomer = async () => {
    if (!custForm.company.trim()) { showError('Validation', 'Company name is required'); return; }
    if (!custForm.mobile.trim())  { showError('Validation', 'Mobile is required'); return; }
    setCreatingCustomer(true);
    try {
      const res = await customersApi.create({
        company: custForm.company.trim(), mobile: custForm.mobile.trim(),
        gstin: custForm.gstin.trim() || undefined, email: custForm.email.trim() || undefined,
        pincode: custForm.pincode.trim() || undefined, address1: custForm.address1.trim() || undefined,
        address2: custForm.address2.trim() || undefined, area: custForm.area.trim() || undefined,
        state: custForm.state.trim() || undefined, status: 'Active',
      });
      if (res.success && res.data) {
        setPartyDisplay(res.data.company || custForm.company);
        setPartyId(String(res.data.id));
        const st = res.data.state || custForm.state || '';
        setPartyState(st);
        setIsIgst(st ? st.toLowerCase() !== MY_STATE.toLowerCase() : false);
        setShowNewCustomer(false);
        setCustForm(blankCustForm());
        showSuccess('Created', 'Customer created');
      }
    } catch (e: any) { showError('Error', e.message || 'Failed'); }
    finally { setCreatingCustomer(false); }
  };

  // ----- Journal totals -----
  const journalDrTotal = +journalRows.filter(r => r.drOrCr === 'Dr').reduce((s, r) => s + r.dr_amount, 0).toFixed(2);
  const journalCrTotal = +journalRows.filter(r => r.drOrCr === 'Cr').reduce((s, r) => s + r.cr_amount, 0).toFixed(2);
  const journalBalanced = Math.abs(journalDrTotal - journalCrTotal) < 0.01;
  const effectiveGrandTotal = isJournalType
    ? (journalParty ? journalParty.amount : journalDrTotal)
    : grandTotal;

  // In journal mode, bill allocation required only if a party row has billbybill=Yes
  const journalBillByBill = isJournalType && journalParty !== null;

  // ----- Bill allocation helpers -----
  // Party direction determines sign of grand total
  // Journal: use journalParty.drOrCr | Normal: Purchase/Debit Note → Cr, Sales/Credit Note → Dr
  const partyDir: 'Dr' | 'Cr' = isJournalType
    ? (journalParty?.drOrCr ?? 'Cr')
    : (isPurchaseMode ? 'Cr' : 'Dr');
  const signedGrandTotal = partyDir === 'Dr' ? effectiveGrandTotal : -effectiveGrandTotal;

  // Signed sum: Cr entries = negative, Dr entries = positive
  const billAllocSigned = +billAllocEntries.reduce((s, e) => {
    const amt = Number(e.amount) || 0;
    return s + (e.direction === 'Cr' ? -amt : amt);
  }, 0).toFixed(2);

  // Balance = signedGrandTotal − billAllocSigned → 0 when fully allocated
  const billAllocBalance  = +(signedGrandTotal - billAllocSigned).toFixed(2);
  const billAllocTotal    = Math.abs(billAllocSigned); // absolute for display
  const billAllocBalanced = !(customerBillByBill || journalBillByBill) || Math.abs(billAllocBalance) < 0.01;

  const openBillAlloc = async () => {
    if (billAllocEntries.length === 0) {
      setBillAllocEntries([{ id: uid(), type: 'New', refno: voucherNo || '', amount: effectiveGrandTotal, direction: partyDir }]);
    }
    setBillAllocOpen(true);
    // For journal mode use the billbybill party row; otherwise use partyId
    const lookupId = isJournalType
      ? journalParty?.ledger_id
      : parseInt(partyId, 10);
    if (lookupId) {
      try {
        // Direction: Cr row = settling outstanding bills (show positive pending)
        //            Dr row = settling credit notes (show negative pending)
        const direction = isJournalType ? (journalParty?.drOrCr ?? 'Cr') : 'Cr';
        setPendingRefsDir(direction);
        const res = await vouchersApi.getPendingRefs(lookupId, direction);
        if (res.success) setPendingRefs(res.data);
      } catch { setPendingRefs([]); }
    }
  };

  // ----- Submit -----
  const handleSubmit = async () => {
    if (isJournalType) {
      const validRows = journalRows.filter(r => r.ledger_id && (r.dr_amount > 0 || r.cr_amount > 0));
      if (validRows.length === 0) { showError('Validation', 'Add at least one ledger entry'); return; }
      if (!journalBalanced) { showError('Validation', 'Dr total must equal Cr total'); return; }
      if (journalBillByBill && !billAllocBalanced) { showError('Validation', 'Complete bill allocation — total must equal Grand Total'); return; }

      const partyRow = journalParty
        ? (validRows.find(r => r.ledger_id === journalParty.ledger_id) || validRows[0])
        : (validRows.find(r => r.drOrCr === 'Dr') || validRows[0]);
      setSubmitting(true);
      try {
        const payload = {
          vch_type_id: (childTypes.find(t => t.name === voucherType)?.id || selectedParentId) || null,
          vch_no:          voucherNo || null,
          vch_date:        voucherDate || null,
          remark:          remark.trim() || null,
          party_ledger_id: partyRow.ledger_id!,
          items:           [],
          ledgers: validRows.map(r => ({
            ledger_id: r.ledger_id!,
            amount: r.drOrCr === 'Dr' ? r.dr_amount : -r.cr_amount,
          })),
          bill_allocation: journalBillByBill ? billAllocEntries.map(e => ({ type: e.type, refno: e.refno, amount: e.amount, direction: e.direction })) : undefined,
        };
        const res = editId
          ? await vouchersApi.update(editId, payload)
          : await vouchersApi.create(payload);
        if (res.success) {
          showSuccess('Saved', res.message || (editId ? 'Voucher updated' : 'Voucher created'));
          setEditId(null);
          setVoucherNo(''); setVoucherDate(new Date().toISOString().slice(0, 10));
          setRemark(''); setBillAllocEntries([]); setCustomerBillByBill(false);
          setJournalRows([emptyJournalRow(), emptyJournalRow()]);
          setJournalParty(null);
        }
      } catch (e: any) { showError('Error', e.message || 'Failed to save voucher'); }
      finally { setSubmitting(false); }
      return;
    }

    if (!partyId) { showError('Validation', 'Select a party — field must be green'); return; }
    if (lines.every(l => !l.product_id)) { showError('Validation', 'Add at least one item'); return; }
    if (!billAllocBalanced) { showError('Validation', 'Complete bill allocation — balance must reach zero'); return; }

    // Filter ledger rows: only non-zero amounts with a ledger selected
    const validLedgers = ledgerRows
      .filter(r => r.ledger_id && r.amount !== 0)
      .map(r => ({ ledger_id: r.ledger_id!, amount: r.amount }));


    setSubmitting(true);
    try {
      const payload = {
        vch_type_id: (childTypes.find(t => t.name === voucherType)?.id || selectedParentId) || null,
        vch_no:          voucherNo || null,
        vch_date:        voucherDate || null,
        remark:          remark.trim() || null,
        party_ledger_id: parseInt(partyId, 10),
        is_igst:         isIgst,
        items: lines.filter(l => l.product_id).map(l => ({
          item_id:     Number(l.product_id),
          qty:         l.qty,
          rate:        l.rate,
          amount:      l.amount,
          cgst_amount: l.cgst_amount,
          sgst_amount: l.sgst_amount,
          igst_amount: l.igst_amount,
          batch_rows:  l.batch_rows?.length
            ? l.batch_rows.map(b => ({ batch_name: b.batch_name || null, qty: b.qty, rate: b.rate, amount: b.amount }))
            : null,
        })),
        ledgers: validLedgers,
        bill_allocation: customerBillByBill ? billAllocEntries.map(e => ({ type: e.type, refno: e.refno, amount: e.amount, direction: e.direction })) : undefined,
      };

      const res = editId
        ? await vouchersApi.update(editId, payload)
        : await vouchersApi.create(payload);
      if (res.success) {
        showSuccess('Saved', res.message || (editId ? 'Voucher updated' : 'Voucher created'));
        setEditId(null);
        setLines([emptyLine()]); setVoucherNo('');
        setVoucherDate(new Date().toISOString().slice(0, 10));
        setPartyDisplay(''); setPartyId(''); setPartyState(''); setIsIgst(false);
        setLedgerRows([]); setRemark('');
        setCustomers([]); setBillAllocEntries([]); setCustomerBillByBill(false);
      }
    } catch (e: any) { showError('Error', e.message || 'Failed to save voucher'); }
    finally { setSubmitting(false); }
  };

  const fmt = (n: number) => n.toFixed(2);

  const ledgerOptions = (search: string) =>
    allLedgers.filter(l => (l.company || '').toLowerCase().includes(search.toLowerCase())).slice(0, 20);

  return (
    <div className="min-h-screen bg-gray-50 p-3 flex gap-3 items-start">
      {/* ── Right Sidebar: System (parent) Vch Types ── */}
      <div className="w-[140px] flex-shrink-0 bg-white rounded-lg shadow p-3 order-last">
        <p className="text-[10px] uppercase font-semibold text-gray-400 mb-2 tracking-wide">Vch Types</p>
        <div className="flex flex-col gap-1">
          {systemParents.map(p => (
            <button key={p.id} onClick={() => setSelectedParentId(p.id)}
              className={`w-full text-left text-sm px-2.5 py-1.5 rounded transition-colors ${
                selectedParentId === p.id
                  ? 'bg-blue-600 text-white font-medium'
                  : 'text-gray-700 hover:bg-blue-50'
              }`}>
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main Form ── */}
      <div className="bg-white rounded-lg shadow p-4 flex-1 min-w-0">
        <h1 className="text-lg font-semibold text-gray-800 mb-4">Vouchers</h1>

        {/* Header — Row 1: Type | No | spacer | Date (right) */}
        <div className="flex items-end gap-3 mb-2">
          <div className="w-[160px] flex-shrink-0">
            <label className="block text-[11px] text-gray-500 mb-0.5">Voucher Type</label>
            <select value={voucherType} onChange={e => setVoucherType(e.target.value)}
              className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400">
              {childTypes.length === 0
                ? <option value="">-- No types --</option>
                : childTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)
              }
            </select>
          </div>
          <div className="w-36 flex-shrink-0">
            <label className="block text-[11px] text-gray-500 mb-0.5">Voucher No</label>
            <input type="text" value={voucherNo} onChange={e => setVoucherNo(e.target.value)}
              placeholder="e.g. S-001"
              className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
          </div>
          <div className="flex-1" />
          <div className="w-[160px] flex-shrink-0">
            <label className="block text-[11px] text-gray-500 mb-0.5">Voucher Date</label>
            <input type="date" value={voucherDate} onChange={e => setVoucherDate(e.target.value)}
              className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
          </div>
        </div>

        {/* ══ Journal / Contra / Payment / Receipt Form ══ */}
        {isJournalType && (
          <div className="border border-gray-200 rounded mb-3">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-[11px] text-gray-500 uppercase">
                  <th className="py-2 px-2 text-left w-[28px]">#</th>
                  <th className="py-2 px-2 text-left w-[68px]">Type</th>
                  <th className="py-2 px-2 text-left">Ledger</th>
                  <th className="py-2 px-2 text-right w-[110px]">Dr Amount</th>
                  <th className="py-2 px-2 text-right w-[110px]">Cr Amount</th>
                  <th className="py-2 px-2 w-[30px]"></th>
                </tr>
              </thead>
              <tbody>
                {journalRows.map((row, idx) => (
                  <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="py-1 px-2 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="py-1 px-1">
                      <select value={row.drOrCr}
                        onChange={e => setJournalRows(p => p.map(r => r.id === row.id
                          ? { ...r, drOrCr: e.target.value as 'Dr' | 'Cr', dr_amount: 0, cr_amount: 0 }
                          : r))}
                        className="w-full border border-gray-200 rounded text-sm py-1 px-1 focus:outline-none focus:ring-1 focus:ring-blue-400">
                        <option value="Dr">Dr</option>
                        <option value="Cr">Cr</option>
                      </select>
                    </td>
                    <td className="py-1 px-1">
                      <div className="relative">
                        <input type="text" value={row.search}
                          onChange={e => {
                            const q = e.target.value;
                            setJournalRows(p => p.map(r => r.id === row.id
                              ? { ...r, search: q, ledger_id: null, ledger_name: '', open: q.length >= 2 }
                              : r));
                            if (q.length >= 2) {
                              customersApi.searchAllLedgers(q).then((res: any) => {
                                const list: any[] = res?.data || [];
                                setJournalRows(p => p.map(r => r.id === row.id ? { ...r, results: list, open: true } : r));
                              }).catch((err: any) => console.warn('[LedgerSearch]', err?.message || err));
                            }
                          }}
                          onFocus={() => {
                            if (row.search.length >= 2 && row.results.length > 0)
                              setJournalRows(p => p.map(r => r.id === row.id ? { ...r, open: true } : r));
                          }}
                          onBlur={() => setTimeout(() => setJournalRows(p => p.map(r => r.id === row.id ? { ...r, open: false } : r)), 150)}
                          placeholder="Search ledger..."
                          className={`w-full border rounded text-sm py-1 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400 ${row.ledger_id ? 'border-green-400 bg-green-50' : 'border-gray-200'}`}
                        />
                        {row.open && row.results.length > 0 && (
                          <div className="absolute z-20 left-0 right-0 bg-white border border-gray-200 rounded shadow-lg mt-0.5 max-h-44 overflow-y-auto">
                            {row.results.map((l: any) => (
                              <div key={l.id} onMouseDown={() => {
                                setJournalRows(p => p.map(r => r.id === row.id
                                  ? { ...r, ledger_id: l.id, ledger_name: l.company, search: l.company, open: false }
                                  : r));
                                // If this ledger has billbybill=Yes, mark it as journal party
                                if (l.billbybill === 'Yes') {
                                  const amt = row.drOrCr === 'Dr' ? row.dr_amount : row.cr_amount;
                                  setJournalParty({ ledger_id: l.id, amount: amt, drOrCr: row.drOrCr });
                                  setBillAllocEntries([]);
                                } else {
                                  // Clear party if previously this row was the party
                                  setJournalParty(p => p?.ledger_id === row.ledger_id ? null : p);
                                }
                              }} className="px-2 py-1.5 text-sm hover:bg-blue-50 cursor-pointer">
                                {l.company}
                                {l.billbybill === 'Yes' && <span className="ml-1 text-[10px] text-blue-400">bill-by-bill</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-1 px-1">
                      {row.drOrCr === 'Dr' ? (
                        <input type="number" step="any" value={row.dr_amount || ''}
                          onChange={e => {
                            const v = Number(e.target.value) || 0;
                            setJournalRows(p => p.map(r => r.id === row.id ? { ...r, dr_amount: v } : r));
                            if (journalParty?.ledger_id === row.ledger_id)
                              setJournalParty(p => p ? { ...p, amount: v } : null);
                          }}
                          onBlur={() => {
                            // Auto-open bill allocation when this is the party row and amount is set
                            if (journalParty?.ledger_id === row.ledger_id && row.dr_amount > 0) {
                              setBillAllocEntries([]);
                              setTimeout(() => openBillAlloc(), 50);
                            }
                          }}
                          className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400 font-medium text-gray-700" />
                      ) : <span className="block text-center text-gray-300">—</span>}
                    </td>
                    <td className="py-1 px-1">
                      {row.drOrCr === 'Cr' ? (
                        <input type="number" step="any" value={row.cr_amount || ''}
                          onChange={e => {
                            const v = Number(e.target.value) || 0;
                            setJournalRows(p => p.map(r => r.id === row.id ? { ...r, cr_amount: v } : r));
                            if (journalParty?.ledger_id === row.ledger_id)
                              setJournalParty(p => p ? { ...p, amount: v } : null);
                          }}
                          onBlur={() => {
                            // Auto-open bill allocation when this is the party row and amount is set
                            if (journalParty?.ledger_id === row.ledger_id && row.cr_amount > 0) {
                              setBillAllocEntries([]);
                              setTimeout(() => openBillAlloc(), 50);
                            }
                          }}
                          className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400 font-medium text-gray-700" />
                      ) : <span className="block text-center text-gray-300">—</span>}
                    </td>
                    <td className="py-1 px-1 text-center">
                      {journalRows.length > 1 && (
                        <button onClick={() => setJournalRows(p => p.filter(r => r.id !== row.id))}
                          className="text-red-400 hover:text-red-600"><X size={14} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-100">
                  <td colSpan={6} className="py-1 px-2">
                    <button onClick={() => setJournalRows(p => [...p, emptyJournalRow()])}
                      className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800">
                      <Plus size={12} /> Add Row
                    </button>
                  </td>
                </tr>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td colSpan={3} className="py-2 px-2 text-sm font-bold text-gray-800">
                    Grand Total
                    {!journalBalanced && (
                      <span className="ml-2 text-xs font-normal text-red-500">
                        (Dr {fmt(journalDrTotal)} ≠ Cr {fmt(journalCrTotal)})
                      </span>
                    )}
                    {journalBillByBill && (
                      <button onClick={openBillAlloc}
                        className={`ml-3 text-[11px] font-normal underline decoration-dotted ${billAllocBalanced ? 'text-green-600' : 'text-orange-500'}`}
                        title="Click to open bill allocation">
                        Bill Alloc {billAllocBalanced ? '✓' : `(${fmt(billAllocTotal)}/${fmt(effectiveGrandTotal)})`}
                      </button>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right text-sm font-bold">
                    <span className="text-blue-600">{fmt(journalDrTotal)}</span>
                  </td>
                  <td className="py-2 px-2 text-right text-sm font-bold text-gray-700">{fmt(journalCrTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* ══ Normal Sales / Purchase Form ══ */}
        {/* Header — Row 2: Customer Name */}
        <div ref={customerRef} className={`relative mb-4 max-w-md ${isJournalType ? 'hidden' : ''}`}>
          <label className="block text-[11px] text-gray-500 mb-0.5 flex items-center gap-2">
            Customer Name
            {partyId && partyState && (
              <span className="text-blue-500">({partyState} → {isIgst ? 'IGST' : 'CGST+SGST'})</span>
            )}
          </label>
          <div className="flex gap-1">
            <input type="text" value={partyDisplay}
              onChange={e => { setPartyDisplay(e.target.value); setCustomerSearch(e.target.value); setPartyId(''); setShowCustomerDrop(true); }}
              onFocus={() => {
                setShowCustomerDrop(true);
                if (partyDisplay.length >= 1 && customers.length === 0) {
                  customersApi.search(partyDisplay).then((r: any) => {
                    const list = Array.isArray(r) ? r : (r?.data || []);
                    setCustomers(list);
                  }).catch(() => {});
                }
              }}
              placeholder="Type to search customer..."
              className={`w-full border rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400 ${partyId ? 'border-green-400 bg-green-50' : 'border-gray-300'}`} />
            <button onClick={() => { setShowNewCustomer(true); setCustForm(f => ({ ...f, company: partyDisplay })); setShowCustomerDrop(false); }}
              title="New customer" className="flex-shrink-0 bg-green-500 hover:bg-green-600 text-white rounded px-2">
              <UserPlus size={14} />
            </button>
          </div>
          {showCustomerDrop && customers.length > 0 && (
            <div className="absolute z-20 w-full bg-white border border-gray-200 rounded shadow-lg max-h-48 overflow-y-auto mt-0.5">
              {customers.slice(0, 20).map((c: any) => (
                <div key={c.id} className="px-2 py-1.5 text-sm hover:bg-blue-50 cursor-pointer"
                  onClick={() => selectParty(c)}>
                  <span className="font-medium">{c.company}</span>
                  {c.mobile && <span className="text-xs text-gray-400 ml-2">{c.mobile}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Line Items Table — hidden for journal types */}
        <div className={`border border-gray-200 rounded mb-0 ${isJournalType ? 'hidden' : ''}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-[11px] text-gray-500 uppercase">
                  <th className="py-2 px-2 text-left w-[28px]">#</th>
                  <th className="py-2 px-2 text-left w-[280px]">Item</th>
                  <th className="py-2 px-2 text-right w-[72px]">Qty</th>
                  <th className="py-2 px-2 text-right w-[90px]">Rate</th>
                  <th className="py-2 px-2 text-right w-[100px]">
                    <span className="flex items-center justify-end gap-1">
                      Amount
                      <button onClick={() => setShowGst(v => !v)} className="text-gray-400 hover:text-blue-500" title={showGst ? 'Hide GST' : 'Show GST'}>
                        {showGst ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                    </span>
                  </th>
                  {showGst && <>
                    <th className="py-2 px-2 text-right w-[60px]">GST%</th>
                    {isIgst
                      ? <th className="py-2 px-2 text-right w-[80px]">IGST</th>
                      : <>
                          <th className="py-2 px-2 text-right w-[75px]">CGST</th>
                          <th className="py-2 px-2 text-right w-[75px]">SGST</th>
                        </>
                    }
                  </>}
                  <th className="py-2 px-2 w-[36px]"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={idx} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="py-1 px-2 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="py-1 px-1">
                      <select value={line.product_id} onChange={e => {
                        const prod = products.find((p: any) => String(p.id) === e.target.value);
                        updateLine(idx, 'product_id', e.target.value);
                        if (prod?.batch === 'Yes') {
                          // Pass productId explicitly so openBatchPopup doesn't read stale lines closure
                          setTimeout(() => openBatchPopup(idx, e.target.value), 0);
                        }
                      }}
                        className="w-full border border-gray-200 rounded text-sm py-1 px-1 focus:outline-none focus:ring-1 focus:ring-blue-400">
                        <option value="">-- Select Item --</option>
                        {products.map((p: any) => <option key={p.id} value={p.id}>{p.item_name}</option>)}
                      </select>
                      {line.batch_rows?.length ? (
                        <button onClick={() => openBatchPopup(idx)}
                          className="text-[10px] text-blue-500 hover:underline mt-0.5 block">
                          {line.batch_rows.length} serial(s) — edit
                        </button>
                      ) : null}
                    </td>
                    <td className="py-1 px-1">
                      <input type="number" step="any" value={line.qty || ''}
                        onChange={e => updateLine(idx, 'qty', e.target.value === '' ? 0 : Number(e.target.value))}
                        className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </td>
                    <td className="py-1 px-1">
                      <input type="number" step="any" value={line.rate || ''}
                        onChange={e => updateLine(idx, 'rate', e.target.value === '' ? 0 : Number(e.target.value))}
                        className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </td>
                    <td className="py-1 px-1">
                      <input type="number" step="any" value={line.amount || ''}
                        onChange={e => updateLine(idx, 'amount', e.target.value === '' ? 0 : Number(e.target.value))}
                        className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400 font-medium text-gray-700" />
                    </td>
                    {showGst && <>
                      <td className="py-1 px-2 text-right text-gray-500 text-xs">{line.gst_rate}%</td>
                      {isIgst
                        ? <td className="py-1 px-2 text-right text-orange-500 text-xs">{fmt(line.igst_amount)}</td>
                        : <>
                            <td className="py-1 px-2 text-right text-blue-500 text-xs">{fmt(line.cgst_amount)}</td>
                            <td className="py-1 px-2 text-right text-purple-500 text-xs">{fmt(line.sgst_amount)}</td>
                          </>
                      }
                    </>}
                    <td className="py-1 px-1 text-center">
                      {lines.length > 1 && (
                        <button onClick={() => removeRow(idx)} className="text-red-400 hover:text-red-600"><X size={14} /></button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-gray-100">
                  <td colSpan={10} className="py-1 px-2">
                    <button onClick={addRow} className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800">
                      <Plus size={12} /> Add Item
                    </button>
                  </td>
                </tr>
              </tbody>

              {/* tfoot: Item Total → Ledger rows → Grand Total — all aligned under Amount column */}
              {(() => {
                const trailingCols = showGst ? (isIgst ? 3 : 4) : 1;
                return (
                  <tfoot>
                    {/* Item Total */}
                    <tr className="border-t-2 border-gray-200 bg-gray-50">
                      <td colSpan={4} className="py-1.5 px-2 text-[11px] text-gray-500 uppercase font-semibold">Item Total</td>
                      <td className="py-1.5 px-2 text-right text-sm font-semibold text-gray-800">{fmt(subtotal)}</td>
                      <td colSpan={trailingCols} />
                    </tr>

                    {/* Ledger rows */}
                    {ledgerRows.map((row, rIdx) => (
                      <tr key={row.id} className="border-t border-gray-100">
                        <td className="py-1 px-2 text-gray-400 text-xs">{rIdx + 1}</td>
                        <td colSpan={3} className="py-1 px-2">
                          <div className="relative w-[280px]">
                            <div className="flex items-center border border-gray-200 rounded overflow-hidden">
                              <input type="text" value={row.search}
                                onChange={e => updateLedgerRow(row.id, { search: e.target.value, ledger_id: null, open: true })}
                                onFocus={() => updateLedgerRow(row.id, { open: true })}
                                onBlur={() => setTimeout(() => updateLedgerRow(row.id, { open: false }), 150)}
                                placeholder="Select ledger..."
                                className="flex-1 text-sm py-0.5 px-2 focus:outline-none min-w-0" />
                              <ChevronDown size={12} className="mr-1 text-gray-400 flex-shrink-0" />
                            </div>
                            {row.open && (
                              <div className="absolute z-20 w-full bg-white border border-gray-200 rounded shadow-lg mt-0.5 max-h-40 overflow-y-auto">
                                {ledgerOptions(row.search).map(l => (
                                  <div key={l.id} onMouseDown={() => selectLedger(row.id, l)}
                                    className="px-2 py-1.5 text-sm hover:bg-blue-50 cursor-pointer">{l.company}</div>
                                ))}
                                {ledgerOptions(row.search).length === 0 && (
                                  <div className="px-2 py-2 text-xs text-gray-400">No accounts found</div>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-1 px-2 text-right">
                          <input type="number" step="any" value={row.amount || ''}
                            onChange={e => updateLedgerRow(row.id, { amount: Number(e.target.value) || 0 })}
                            className="w-24 border border-gray-200 rounded text-sm py-0.5 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400 font-medium text-gray-700" />
                        </td>
                        <td colSpan={trailingCols} className="py-1 px-1">
                          {!row.auto && (
                            <button onClick={() => removeLedgerRow(row.id)} className="text-red-400 hover:text-red-600"><X size={13} /></button>
                          )}
                        </td>
                      </tr>
                    ))}

                    {/* Add Ledger row */}
                    <tr className="border-t border-gray-100">
                      <td colSpan={4 + 1 + trailingCols} className="py-1 px-2">
                        <button onClick={addLedgerRow}
                          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
                          <Plus size={12} /> Add Ledger
                        </button>
                      </td>
                    </tr>

                    {/* Grand Total */}
                    <tr className="border-t-2 border-gray-300 bg-gray-50">
                      <td colSpan={4} className="py-2 px-2 text-sm font-bold text-gray-800">Grand Total</td>
                      <td className="py-2 px-2 text-right">
                        {customerBillByBill ? (
                          <button onClick={openBillAlloc}
                            className={`text-base font-bold underline decoration-dotted ${billAllocBalanced ? 'text-green-600' : 'text-orange-500'}`}
                            title="Click to allocate bill">
                            {fmt(grandTotal)}
                          </button>
                        ) : (
                          <span className="text-base font-bold text-blue-600">{fmt(grandTotal)}</span>
                        )}
                      </td>
                      <td colSpan={trailingCols} />
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
          </div>
        </div>

        {/* Remark + Submit */}
        <div className="flex items-center gap-3 mt-3">
          <input type="text" value={remark} onChange={e => setRemark(e.target.value)}
            placeholder="Remark (optional)"
            className="flex-1 border border-gray-300 rounded text-sm py-2 px-3 focus:outline-none focus:ring-1 focus:ring-blue-400" />
          <button onClick={handleSubmit}
            disabled={submitting || !billAllocBalanced || (isJournalType && !journalBalanced)}
            title={
              isJournalType && !journalBalanced ? 'Dr total must equal Cr total' :
              !billAllocBalanced ? 'Complete bill allocation — balance must reach zero' : undefined
            }
            className="flex-shrink-0 flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded px-5 py-2">
            <Save size={16} />
            {submitting ? (editId ? 'Updating...' : 'Submitting...') : (editId ? 'Update Voucher' : 'Save Voucher')}
          </button>
        </div>
      </div>

      {/* Batch Entry Popup */}
      {batchPopupIdx !== null && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-xl">
            <div className="flex justify-between items-center px-4 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800 text-sm">
                Batch Entry — {lines[batchPopupIdx]?.item_name || 'Item'}
              </h3>
              <button onClick={() => setBatchPopupIdx(null)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            {!isPurchaseMode && batchNoFlavour && (
              <div className="mx-4 mt-3 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                Flavour not set for this item. Go to <strong>Items</strong> page and set the Tally Flavour — serials cannot be filtered without it.
              </div>
            )}
            <div className="p-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-gray-500 uppercase bg-gray-50">
                    <th className="py-1.5 px-2 text-left w-8">#</th>
                    <th className="py-1.5 px-2 text-left">Serial / Batch No.</th>
                    <th className="py-1.5 px-2 text-right w-20">Qty</th>
                    <th className="py-1.5 px-2 text-right w-24">Rate</th>
                    <th className="py-1.5 px-2 text-right w-28">Amount</th>
                    <th className="py-1.5 px-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {batchDraft.map((row, i) => (
                    <tr key={row.id} className="border-t border-gray-100">
                      <td className="py-1 px-2 text-gray-400 text-xs">{i + 1}</td>
                      <td className="py-1 px-1">
                        {isPurchaseMode ? (
                          /* Purchase / Debit Note — free text entry */
                          <input
                            type="text"
                            value={row.batch_name}
                            onChange={e => setBatchDraft(d => d.map(r => r.id === row.id ? { ...r, batch_name: e.target.value } : r))}
                            placeholder="Enter serial no."
                            className="w-full border border-gray-200 rounded text-sm py-1 px-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                        ) : (
                          /* Sales / Credit Note — search & select from customer's existing serials */
                          <div className="relative">
                            <input
                              type="text"
                              value={row.serialSearch ?? row.batch_name}
                              onChange={e => setBatchDraft(d => d.map(r => r.id === row.id
                                ? { ...r, serialSearch: e.target.value, batch_name: e.target.value, serialOpen: true }
                                : r))}
                              onFocus={() => setBatchDraft(d => d.map(r => r.id === row.id ? { ...r, serialOpen: true } : r))}
                              onBlur={() => setTimeout(() => setBatchDraft(d => d.map(r => r.id === row.id ? { ...r, serialOpen: false } : r)), 150)}
                              placeholder="Search serial no."
                              className="w-full border border-gray-200 rounded text-sm py-1 px-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                            {row.serialOpen && (
                              <div className="absolute z-30 left-0 right-0 bg-white border border-gray-200 rounded shadow-lg mt-0.5 max-h-40 overflow-y-auto">
                                {(() => {
                                  // Serials selected in OTHER rows of this popup
                                  const usedByOthers = new Set(
                                    batchDraft.filter(r => r.id !== row.id && r.batch_name).map(r => r.batch_name)
                                  );
                                  const visible = batchSerials.filter(s =>
                                    !usedByOthers.has(s) &&
                                    (!row.serialSearch || s.toLowerCase().includes((row.serialSearch || '').toLowerCase()))
                                  );
                                  return visible.length > 0 ? visible.map(s => (
                                    <div
                                      key={s}
                                      onMouseDown={() => setBatchDraft(d => d.map(r => r.id === row.id
                                        ? { ...r, batch_name: s, serialSearch: s, serialOpen: false }
                                        : r))}
                                      className="px-2 py-1.5 text-sm hover:bg-blue-50 cursor-pointer"
                                    >{s}</div>
                                  )) : (
                                    <div className="px-2 py-2 text-xs text-gray-400">
                                      {batchNoFlavour ? 'Set flavour for this item in Items page to filter serials' : batchSerials.length === 0 ? 'No serials found for this customer' : 'No match'}
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-1 px-1">
                        <input type="number" step="any" value={row.qty || ''}
                          onChange={e => {
                            const qty = Number(e.target.value) || 0;
                            setBatchDraft(d => d.map(r => r.id === row.id ? { ...r, qty, amount: +(qty * r.rate).toFixed(2) } : r));
                          }}
                          className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </td>
                      <td className="py-1 px-1">
                        <input type="number" step="any" value={row.rate || ''}
                          onChange={e => {
                            const rate = Number(e.target.value) || 0;
                            setBatchDraft(d => d.map(r => r.id === row.id ? { ...r, rate, amount: +(r.qty * rate).toFixed(2) } : r));
                          }}
                          className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </td>
                      <td className="py-1 px-1">
                        <input type="number" step="any" value={row.amount || ''}
                          onChange={e => {
                            const amount = Number(e.target.value) || 0;
                            setBatchDraft(d => d.map(r => r.id === row.id ? {
                              ...r,
                              amount,
                              rate: r.qty > 0 ? +(amount / r.qty).toFixed(4) : r.rate,
                            } : r));
                          }}
                          className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400 font-medium" />
                      </td>
                      <td className="py-1 px-1 text-center">
                        {batchDraft.length > 1 && (
                          <button onClick={() => setBatchDraft(d => d.filter(r => r.id !== row.id))}
                            className="text-red-400 hover:text-red-600"><X size={13} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={() => setBatchDraft(d => [...d, { id: uid(), batch_name: '', qty: 1, rate: 0, amount: 0, serialSearch: '', serialOpen: false }])}
                className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800 mt-2">
                <Plus size={12} /> Add Serial No.
              </button>
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50 rounded-b-lg">
              <div className="flex gap-4 text-xs text-gray-500">
                <span>Total Qty: <strong className="text-gray-800">{batchDraft.reduce((s, r) => s + r.qty, 0).toFixed(3)}</strong></span>
                <span>Total Amt: <strong className="text-gray-800">{batchDraft.reduce((s, r) => s + r.amount, 0).toFixed(2)}</strong></span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setBatchPopupIdx(null)}
                  className="px-4 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-100">Cancel</button>
                <button onClick={saveBatch}
                  className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Customer Modal */}
      {showNewCustomer && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">New Customer</h3>
              <button onClick={() => setShowNewCustomer(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-0.5">Company Name *</label>
                <input autoFocus type="text" value={custForm.company} onChange={e => setCustForm(f => ({ ...f, company: e.target.value }))}
                  placeholder="Full company name"
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Mobile *</label>
                <input type="text" value={custForm.mobile} onChange={e => setCustForm(f => ({ ...f, mobile: e.target.value }))}
                  placeholder="Phone number"
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">GST IN</label>
                <input type="text" value={custForm.gstin} onChange={e => setCustForm(f => ({ ...f, gstin: e.target.value.toUpperCase() }))}
                  placeholder="Optional"
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400 uppercase" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-0.5">Email</label>
                <input type="email" value={custForm.email} onChange={e => setCustForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="Optional"
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Pincode</label>
                <input type="text" value={custForm.pincode}
                  onChange={async e => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setCustForm(f => ({ ...f, pincode: v, area: '', state: '' }));
                    if (v.length === 6) {
                      try {
                        const { pincodeApi: pa } = await import('../services/api');
                        const res = await pa.lookup(v);
                        if (res.city) setCustForm(f => ({ ...f, area: res.city, state: res.state }));
                      } catch {}
                    }
                  }}
                  placeholder="6 digits"
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Address Line 1</label>
                <input type="text" value={custForm.address1} onChange={e => setCustForm(f => ({ ...f, address1: e.target.value }))}
                  placeholder="Building / Floor"
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Address Line 2</label>
                <input type="text" value={custForm.address2} onChange={e => setCustForm(f => ({ ...f, address2: e.target.value }))}
                  placeholder="Street / Area"
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">City (auto)</label>
                <input readOnly value={custForm.area}
                  className="w-full border border-gray-100 rounded text-sm py-1.5 px-2 bg-gray-50 text-gray-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">State (auto)</label>
                <input readOnly value={custForm.state}
                  className="w-full border border-gray-100 rounded text-sm py-1.5 px-2 bg-gray-50 text-gray-500" />
              </div>
            </div>
            <div className="px-4 pb-4">
              <button onClick={handleCreateCustomer} disabled={creatingCustomer}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded py-2">
                {creatingCustomer ? 'Creating...' : 'Create Customer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bill Allocation Popup */}
      {billAllocOpen && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
            <div className="flex justify-between items-center px-4 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800 text-sm">
                Bill Allocation — {isJournalType
                  ? (journalRows.find(r => r.ledger_id === journalParty?.ledger_id)?.ledger_name || '—')
                  : partyDisplay}
              </h3>
              <button onClick={() => setBillAllocOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            <div className="p-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-gray-500 uppercase bg-gray-50">
                    <th className="py-1.5 px-2 text-left w-8">#</th>
                    <th className="py-1.5 px-2 text-left w-28">Type</th>
                    <th className="py-1.5 px-2 text-left">Ref / Bill No.</th>
                    <th className="py-1.5 px-2 text-right w-28">Amount</th>
                    <th className="py-1.5 px-2 text-center w-12">Cr/Dr</th>
                    <th className="py-1.5 px-2 w-6"></th>
                  </tr>
                </thead>
                <tbody>
                  {billAllocEntries.map((entry, i) => (
                    <tr key={entry.id} className="border-t border-gray-100">
                      <td className="py-1 px-2 text-gray-400 text-xs">{i + 1}</td>
                      <td className="py-1 px-1">
                        <select value={entry.type}
                          onChange={e => setBillAllocEntries(d => {
                            const newType = e.target.value as any;
                            const currentBalance = +(signedGrandTotal - d.filter(r => r.id !== entry.id).reduce((s, r) => s + (r.direction === 'Cr' ? -(Number(r.amount)||0) : (Number(r.amount)||0)), 0)).toFixed(2);
                            const autoDir = currentBalance >= 0 ? 'Dr' : 'Cr';
                            const autoAmt = Math.abs(currentBalance);
                            return d.map(r => r.id === entry.id
                              ? newType === 'New'
                                ? { ...r, type: newType, amount: autoAmt, direction: autoDir }
                                : { ...r, type: newType }
                              : r);
                          })}
                          className="w-full border border-gray-200 rounded text-sm py-1 px-1 focus:outline-none focus:ring-1 focus:ring-blue-400">
                          <option value="New">New</option>
                          <option value="Agr.">Agr.</option>
                          <option value="On Account">On Account</option>
                        </select>
                      </td>
                      <td className="py-1 px-1">
                        {entry.type === 'On Account' ? (
                          <span className="text-xs text-gray-400 px-1">—</span>
                        ) : entry.type === 'New' ? (
                          <input type="text" value={entry.refno}
                            onChange={e => setBillAllocEntries(d => d.map(r => r.id === entry.id ? { ...r, refno: e.target.value } : r))}
                            placeholder="Reference / Bill No."
                            className="w-full border border-gray-200 rounded text-sm py-1 px-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        ) : (
                          /* Agr. — search & select from pending vouchers */
                          <div className="relative">
                            <input type="text"
                              value={entry.refSearch ?? entry.refno}
                              onChange={e => setBillAllocEntries(d => d.map(r => r.id === entry.id ? { ...r, refSearch: e.target.value, refno: e.target.value, refOpen: true } : r))}
                              onFocus={() => setBillAllocEntries(d => d.map(r => r.id === entry.id ? { ...r, refOpen: true } : r))}
                              onBlur={() => setTimeout(() => setBillAllocEntries(d => d.map(r => r.id === entry.id ? { ...r, refOpen: false } : r)), 150)}
                              placeholder="Search pending bill..."
                              className="w-full border border-gray-200 rounded text-sm py-1 px-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                            {entry.refOpen && (
                              <div className="absolute z-30 left-0 right-0 bg-white border border-gray-200 rounded shadow-lg mt-0.5 overflow-hidden" style={{minWidth:'360px'}}>
                                {/* Header */}
                                <div className="grid grid-cols-4 gap-0 bg-gray-100 border-b border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                                  <span>Bill No.</span>
                                  <span>Date</span>
                                  <span className="text-right">Amount</span>
                                  <span className="text-center">Cr/Dr</span>
                                </div>
                                <div className="max-h-48 overflow-y-auto">
                                  {pendingRefs
                                    .filter(p => !billAllocEntries.some(r => r.id !== entry.id && r.refno === p.billname))
                                    .filter(p => !entry.refSearch || p.billname.toLowerCase().includes((entry.refSearch || '').toLowerCase()))
                                    .map(p => {const dir = p.direction || (Number(p.amount) > 0 ? 'Dr' : 'Cr'); return (
                                      <div key={p.billname}
                                        onMouseDown={() => setBillAllocEntries(d => {
                                          const otherAllocated = d.filter(r => r.id !== entry.id).reduce((s, r) => s + (Number(r.amount) || 0), 0);
                                          const remaining = Math.max(0, effectiveGrandTotal - otherAllocated);
                                          const autoAmount = +Math.min(Number(p.amount), remaining).toFixed(2);
                                          const billDir = p.direction || (Number(p.amount) > 0 ? 'Dr' : 'Cr');
                                          const settleDir = billDir === 'Dr' ? 'Cr' : 'Dr'; // settling a Dr bill → Cr entry
                                          return d.map(r => r.id === entry.id
                                            ? { ...r, refno: p.billname, refSearch: p.billname, amount: autoAmount, direction: settleDir, refOpen: false }
                                            : r);
                                        })}
                                        className="grid grid-cols-4 gap-0 px-2 py-1.5 hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0">
                                        <span className="text-sm font-medium text-gray-800 truncate">{p.billname}</span>
                                        <span className="text-xs text-gray-500 self-center">{p.vch_date}</span>
                                        <span className="text-xs text-gray-800 font-medium text-right self-center">₹{Number(p.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        <span className={`text-xs font-semibold text-center self-center ${dir === 'Cr' ? 'text-green-600' : 'text-red-500'}`}>{dir}</span>
                                      </div>
                                    );})}

                                  {pendingRefs
                                    .filter(p => !billAllocEntries.some(r => r.id !== entry.id && r.refno === p.billname))
                                    .filter(p => !entry.refSearch || p.billname.toLowerCase().includes((entry.refSearch || '').toLowerCase()))
                                    .length === 0 && (
                                    <div className="px-2 py-2 text-xs text-gray-400">No pending bills found</div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-1 px-1">
                        <input type="number" step="any" value={entry.amount || ''}
                          onChange={e => setBillAllocEntries(d => d.map(r => r.id === entry.id ? { ...r, amount: Number(e.target.value) || 0 } : r))}
                          className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400 font-medium" />
                      </td>
                      <td className="py-1 px-1 text-center">
                        {(() => {
                          const dir = entry.direction
                            || pendingRefs.find(p => p.billname === entry.refno)?.direction;
                          return dir ? (
                            <button
                              onClick={() => setBillAllocEntries(d => d.map(r => r.id === entry.id ? { ...r, direction: r.direction === 'Cr' ? 'Dr' : 'Cr' } : r))}
                              className={`text-xs font-semibold px-1.5 py-0.5 rounded border ${dir === 'Cr' ? 'text-green-600 border-green-300 hover:bg-green-50' : 'text-red-500 border-red-300 hover:bg-red-50'}`}
                              title="Click to toggle Cr/Dr">
                              {dir}
                            </button>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          );
                        })()}
                      </td>
                      <td className="py-1 px-1 text-center">
                        {billAllocEntries.length > 1 && (
                          <button onClick={() => setBillAllocEntries(d => d.filter(r => r.id !== entry.id))}
                            className="text-red-400 hover:text-red-600"><X size={13} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={() => setBillAllocEntries(d => {
                const usedSigned = d.reduce((s, r) => s + (r.direction === 'Cr' ? -(Number(r.amount)||0) : (Number(r.amount)||0)), 0);
                const remaining = +(signedGrandTotal - usedSigned).toFixed(2);
                const autoDir = remaining >= 0 ? 'Dr' : 'Cr';
                return [...d, { id: uid(), type: 'New', refno: '', amount: Math.abs(remaining), direction: autoDir }];
              })}
                className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800 mt-2">
                <Plus size={12} /> Add Reference
              </button>
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50 rounded-b-lg">
              <div className="flex gap-4 text-xs">
                <span className="text-gray-500">Grand Total: <strong className="text-gray-800">{fmt(effectiveGrandTotal)}</strong> <span className="text-[10px] font-semibold text-gray-400">{signedGrandTotal >= 0 ? 'Dr.' : 'Cr.'}</span></span>
                <span className="text-gray-500">Allocated: <strong className={billAllocBalanced ? 'text-green-600' : 'text-orange-500'}>{fmt(Math.abs(billAllocSigned))}</strong> <span className={`text-[10px] font-semibold ${billAllocBalanced ? 'text-green-500' : 'text-orange-400'}`}>{billAllocSigned >= 0 ? 'Dr.' : 'Cr.'}</span></span>
                <span className="text-gray-500">Balance: <strong className={billAllocBalanced ? 'text-green-600' : 'text-red-500'}>{fmt(Math.abs(billAllocBalance))}</strong> <span className={`text-[10px] font-semibold ${billAllocBalanced ? 'text-green-500' : 'text-red-400'}`}>{billAllocBalance >= 0 ? 'Dr.' : 'Cr.'}</span></span>
              </div>
              <button onClick={() => setBillAllocOpen(false)}
                disabled={!billAllocBalanced}
                title={!billAllocBalanced ? 'Allocated total must equal Grand Total' : undefined}
                className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white rounded">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Vouchers;
```

## 15.18 Backend — NestJS module wiring (`src/app.module.ts` excerpt)

Register everything in your AppModule:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { DbService } from './database/db.service';

// Voucher-stack services
import { LedgerGroupService } from './services/ledger-group.service';
import { VchTypeService } from './services/vchtype.service';
import { OtherLedgerService } from './services/other-ledger.service';
import { ItemsService } from './services/items.service';
import { VouchersService } from './services/vouchers.service';
import { CustomersService } from './services/customers.service';
// Auth (omitted here — wire your own JWT auth + UsersService + AuthService)

// Controllers
import { LedgerGroupController } from './controllers/ledger-group.controller';
import { VchTypeController } from './controllers/vchtype.controller';
import { OtherLedgerController } from './controllers/other-ledger.controller';
import { ItemsController } from './controllers/items.controller';
import { VouchersController } from './controllers/vouchers.controller';
import { CustomersController } from './controllers/customers.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        signOptions: { expiresIn: process.env.JWT_EXPIRES_IN || '24h' },
      }),
    }),
  ],
  controllers: [
    LedgerGroupController, VchTypeController, OtherLedgerController,
    ItemsController, VouchersController, CustomersController,
  ],
  providers: [
    DbService,
    LedgerGroupService, VchTypeService, OtherLedgerService,
    ItemsService, VouchersService, CustomersService,
  ],
})
export class AppModule {}
```

## 15.19 Backend — `.env` template

```env
PORT=5000
JWT_SECRET=replace-with-long-random-string
JWT_EXPIRES_IN=24h
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=root
DB_DATABASE=abs_cloud
DB_CONNECTION_LIMIT=50
```

## 15.20 Backend — `package.json` deps (only what's needed for this module)

```json
{
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/config": "^3.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/jwt": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@nestjs/swagger": "^7.0.0",
    "mysql2": "^3.0.0",
    "reflect-metadata": "^0.1.13",
    "rxjs": "^7.0.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

## 15.21 Frontend — `package.json` deps (relevant only)

```json
{
  "dependencies": {
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "react-router-dom": "^6.0.0",
    "lucide-react": "^0.400.0"
  }
}
```

---

## 16. Quick-Start Checklist

1. **Database** — install MySQL 8.0, create empty database, set credentials.
2. **Backend** — `npm install` deps from §15.20, drop `.env` from §15.19, copy all backend files (§15.1–§15.15), wire `AppModule` (§15.18). Run `nest start --watch`. Tables auto-create on first boot via each service's `onModuleInit()`.
3. **Seed** — voucher types seed automatically (§15.7). Manually create at least one ledger group (e.g. "Sundry Debtors" with id=26) and a couple of customers + a Sales / Purchase / Bank ledger via the masters APIs.
4. **Frontend** — `npm install` deps from §15.21, drop `api.ts` (§15.16) and `Vouchers.tsx` (§15.17), add a route `/vouchers` pointing to it, ensure JWT login flow stores a token via `storeToken()`.
5. **Test** — open `/vouchers`, pick "Sales" type, search a customer, add an item, submit. Check DB:

   ```sql
   SELECT * FROM vch_details ORDER BY id DESC LIMIT 1;
   SELECT * FROM ledger_entries WHERE vch_id = <id>;        -- sum should be 0
   SELECT * FROM inventory_entries WHERE led_id IN (SELECT id FROM ledger_entries WHERE vch_id = <id>);
   SELECT * FROM batch WHERE vch_id = <id>;
   SELECT * FROM bill_allocation WHERE vchid = <id>;
   ```

6. **Verify Tally compatibility** — if you import this DB into Tally Prime via the right XML schema, it should round-trip cleanly because the data model matches.

---

**End of document.** Everything above is what you need — schema, code, contracts, and flow.
