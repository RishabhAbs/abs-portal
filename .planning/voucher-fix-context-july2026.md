# Voucher Fix Context — July 2026

> **Purpose**: This document records the full context, analysis, and changes being made for two voucher-related fixes. Written so any AI assistant working in this codebase can understand what was done and why.

---

## Table of Contents
1. [Issue 1: Vouchers Without VCH NO. Not Clickable](#issue-1)
2. [Issue 2: Prefix/Suffix Effective Date Logic](#issue-2)
3. [Files Modified](#files-modified)
4. [Architecture Context](#architecture-context)

---

## <a id="issue-1"></a>Issue 1: Vouchers Without VCH NO. Not Clickable

### What the user reported
Many vouchers in the Daybook and other report pages show "—" in the VCH NO. column (because they have no voucher number assigned). These vouchers cannot be opened in edit or view mode because the "—" is not clickable.

### Root Cause Analysis

In 3 frontend pages, the VCH NO. column conditionally renders:
- **If `vch_no` exists** → a `<button>` with `onClick={() => openVoucher(id)}` 
- **If `vch_no` is null/empty** → a plain `<span className="text-slate-400">—</span>` with **NO click handler**

The `openVoucher` function navigates to `/billing/vouchers/edit/:id` and works by `id` (primary key), NOT by `vch_no`. So there's no technical reason to block opening — the voucher `id` is always available.

### Affected Pages & Exact Locations

#### 1. Daybook.tsx — Desktop Table (lines 431-437)
```tsx
// CURRENT — broken: no click when vch_no is empty
{row.vch_no ? (
  <button onClick={() => openVoucher(row.id)}
    className="text-blue-600 hover:text-blue-800 hover:underline font-medium">
    {row.vch_no}
  </button>
) : <span className="text-slate-400">—</span>}
```
**Note**: The Daybook mobile view (line 364) does NOT have this bug — it uses `onClick={() => openVoucher(row.id)}` directly on the row div, which always works.

The `openVoucher` function (line 188-190):
```tsx
const openVoucher = (id: number) => {
  navigate(`/billing/vouchers/edit/${id}`, canEditVoucher ? undefined : { state: { readOnly: true } });
};
```

#### 2. LedgerReport.tsx — TWO locations

**Mobile view (line 457)** — click is guarded by `vch_no`:
```tsx
onClick={() => first.vch_no && openVoucher(first.vch_id)}
```

**Desktop table (lines 541-550)** — only renders button when `vch_no` exists:
```tsx
{r.is_first && r.vch_no ? (
  <button onClick={() => openVoucher(r.vch_id)} ...>
    {r.vch_no}
  </button>
) : (r.is_first ? '—' : '')}
```

The `openVoucher` function (line 287-293):
```tsx
const openVoucher = (vchId: number) => {
  navigate(`/billing/vouchers/edit/${vchId}`, {
    state: { readOnly: !canEditVouchers },
  });
};
```

#### 3. PendingReview.tsx — Desktop Table (lines 407-413)
Same pattern as Daybook. BUT PendingReview also has an "Open" button in the Action column (line 472-477) that always works — so the issue is only in the VCH NO. column.

### Pages NOT affected
- **SalesRegister.tsx** (line 594-598) — Already correct! Always renders a button:
  ```tsx
  <button onClick={() => openVoucher(r.vch_id)} ...>
    {r.vch_no || '—'}
  </button>
  ```

### Fix Strategy
Make the VCH NO. cell always render a clickable `<button>`. When `vch_no` is empty, show "—" text but in a subtler style that becomes blue on hover to indicate clickability.

---

## <a id="issue-2"></a>Issue 2: Prefix/Suffix Effective Date Logic

### What the user reported
When creating Prefix/Suffix periods with Automatic or Manual numbering, and setting effective dates, the prefix/suffix and start number should only apply from the selected effective date to the next effective date.

### How the numbering system works

#### VchType Configuration (VchType.tsx + vchtype.service.ts)
Each voucher type can have:
- `numbering_mode`: 'manual' or 'automatic'
- `vch_width`: number of digits to zero-pad (e.g., 3 → "001")
- `numbering_periods[]`: Array of `{ applicable_from, start_no, period_type }`
- `prefix_periods[]`: Array of `{ applicable_from, particulars }`
- `suffix_periods[]`: Array of `{ applicable_from, particulars }`

These are stored in separate MySQL tables:
- `vchtype_numbering_period` — start number + period type per date
- `vchtype_prefix_period` — prefix text per date
- `vchtype_suffix_period` — suffix text per date

#### How next number is generated (vouchers.service.ts lines 2122-2188)

`getNextVoucherNo(vchTypeId, forDate?)`:

1. Gets `numbering_mode` and `vch_width` from `vchtype` table
2. Resolves effective prefix/suffix/start_no for the given date using `applicable_from <= ? ORDER BY applicable_from DESC LIMIT 1` (picks the most recent period that has started)
3. For `yearly` period type: filters vouchers by financial year start (Apr 1)
4. Finds the last `vch_no` from `vch_details` (`ORDER BY id DESC LIMIT 1`)
5. Tries to strip the current prefix/suffix from the last number and increment
6. If stripping fails (different prefix/suffix), falls back to `start_no`

### Current Problems

1. **Frontend doesn't pass `voucherDate`**: The API call `getNextNo(vchTypeId)` doesn't send the voucher date, so the backend always uses today's date. If creating a voucher for a past date, it uses the wrong period's prefix/suffix.

2. **Backend doesn't filter by period date range**: When finding the "last used" voucher number, the query only filters by:
   - Financial year start (for yearly period type)
   - NOT by the effective period's date range
   
   This means if period "A-" (Apr 1) transitions to "B-" (Jul 1), a voucher created on June 30 should look for the last "A-xxx" number, but the query might find "B-001" (if one was created for a July date) and fail to match the prefix, falling back to start_no unexpectedly.

3. **No upper date bound**: Even within the correct period, the query doesn't cap at the next period's `applicable_from`, so numbers from a future period could interfere.

### Call chain:

```
Frontend (Vouchers.tsx)
  → vouchersApi.getNextNo(vtId)         // NO date passed
    → GET /vouchers/next-no?vch_type_id=X   // NO for_date param
      → vouchers.controller.ts getNextNo()  // doesn't accept for_date
        → vouchers.service.ts getNextVoucherNo(id)  // defaults to today
          → queries vchtype_prefix_period, vchtype_suffix_period, vchtype_numbering_period
          → queries vch_details for last vch_no (date filter only for yearly)
```

### Fix Strategy

1. **Frontend API** (`api.ts`): Add optional `forDate` param to `getNextNo()`
2. **Frontend Vouchers.tsx**: Pass `voucherDate` in all 3 calls to `getNextNo()`, add `voucherDate` to useEffect dependency so date changes re-fetch
3. **Backend controller**: Accept `for_date` query parameter
4. **Backend service**: Filter `vch_details` query by effective period date range (`applicable_from` of current period → `applicable_from` of next period)

---

## <a id="files-modified"></a>Files Modified

| File | Issue | What Changed |
|------|-------|--------------|
| `frontend/src/pages/Daybook.tsx` | #1 | Lines 431-437: VCH NO. cell always clickable |
| `frontend/src/pages/LedgerReport.tsx` | #1 | Line 457: Remove vch_no guard on mobile click; Lines 541-550: VCH NO. cell always clickable |
| `frontend/src/pages/PendingReview.tsx` | #1 | Lines 407-413: VCH NO. cell always clickable |
| `frontend/src/services/api.ts` | #2 | Line 1056: Add `forDate` param to `getNextNo()` |
| `frontend/src/pages/Vouchers.tsx` | #2 | Lines 649, 1873, 2117: Pass `voucherDate` to `getNextNo()`; Line 656: Add `voucherDate` to useEffect deps |
| `backend/src/controllers/vouchers.controller.ts` | #2 | Line 104: Accept `for_date` query param |
| `backend/src/services/vouchers.service.ts` | #2 | Lines 2155-2172: Filter by effective period date range |

---

## <a id="architecture-context"></a>Architecture Context

### Frontend Stack
- React + TypeScript
- React Router (useNavigate, useSearchParams)
- TailwindCSS utility classes
- API layer in `frontend/src/services/api.ts`

### Backend Stack
- NestJS (TypeScript)
- MySQL database
- Controllers in `backend/src/controllers/`
- Services in `backend/src/services/`

### Key Database Tables
- `vchtype` — Voucher type definitions (name, numbering_mode, vch_width)
- `vchtype_numbering_period` — (vchtype_id, applicable_from, start_no, period_type)
- `vchtype_prefix_period` — (vchtype_id, applicable_from, particulars)
- `vchtype_suffix_period` — (vchtype_id, applicable_from, particulars)
- `vch_details` — Actual voucher records (id, vch_type_id, vch_no, vch_date, etc.)

### Key Functions
- `openVoucher(id)` — Navigates to `/billing/vouchers/edit/:id` (uses row `id`, NOT `vch_no`)
- `getNextVoucherNo(vchTypeId, forDate?)` — Backend service that generates the next auto-number
- `vouchersApi.getNextNo(vchTypeId, forDate?)` — Frontend API wrapper

### Why vouchers can have no VCH NO.
- Manual numbering mode: user may not have entered a number
- Import from Tally: some voucher types don't have numbering
- Draft/pending vouchers: saved without a number assigned

---

## Status (July 3, 2026)

**All changes completed and verified:**
- ✅ Frontend TypeScript compilation: **PASS** (zero errors)
- ✅ Backend TypeScript compilation: **PASS** (zero errors)
- ✅ All 7 files modified as planned
- ⏳ Manual testing pending (Daybook click, LedgerReport click, prefix/suffix date range)
