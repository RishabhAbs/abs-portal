import React, { useState, useEffect, useCallback } from 'react';
import { billingApi, customersApi } from '../services/api';
import { useAuth } from '../context/AuthContext';

interface LineItem {
  product_id: string;
  product_name: string;
  remark: string;
  inc_rate: number;
  rate: number;
  qty: number;
  amount: number;
  commission: number;
  c_discount: number;
}

const emptyLine = (): LineItem => ({
  product_id: '',
  product_name: '',
  remark: '',
  inc_rate: 0,
  rate: 0,
  qty: 1,
  amount: 0,
  commission: 0,
  c_discount: 0,
});

const CloudBill: React.FC = () => {
  const { user } = useAuth();

  // Header
  const [voucher, setVoucher] = useState('Sales');
  const [billingCompany, setBillingCompany] = useState('');
  const [billingCompanyId, setBillingCompanyId] = useState<number | null>(null);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [taskAdd, setTaskAdd] = useState('No');
  const [refNo, setRefNo] = useState('');
  const [refDate, setRefDate] = useState('');

  // Line items
  const [items, setItems] = useState<LineItem[]>([emptyLine()]);

  // Summary
  const [discount, setDiscount] = useState(0);
  const [cgst, setCgst] = useState(0);
  const [sgst, setSgst] = useState(0);
  const [igst, setIgst] = useState(0);

  // Lookups
  const [billingCompanies, setBillingCompanies] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [bcDropdown, setBcDropdown] = useState(false);
  const [custDropdown, setCustDropdown] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  // Load lookups
  useEffect(() => {
    billingApi.getBillingCompanies().then(r => setBillingCompanies(r.data || [])).catch(() => {});
    customersApi.getDropdown().then((r: any) => setCustomers(r.data || [])).catch(() => {});
    billingApi.getProducts().then(r => setProducts(r.data || [])).catch(() => {});
  }, []);

  // Filtered billing companies
  const filteredBc = billingCompanies.filter(bc =>
    (bc.name || bc.company || '').toLowerCase().includes(billingCompany.toLowerCase())
  );

  // Filtered customers
  const filteredCust = customers.filter(c =>
    (c.company || '').toLowerCase().includes(customerSearch.toLowerCase())
  );

  // Auto-calc amount
  const updateItem = useCallback((idx: number, field: keyof LineItem, value: any) => {
    setItems(prev => {
      const next = [...prev];
      const item = { ...next[idx], [field]: value };
      if (field === 'rate' || field === 'qty') {
        item.amount = Number((item.rate * item.qty).toFixed(2));
      }
      next[idx] = item;
      return next;
    });
  }, []);

  const addRow = () => setItems(prev => [...prev, emptyLine()]);
  const removeRow = (idx: number) => setItems(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);

  // Subtotals
  const subtotalAmount = items.reduce((s, i) => s + i.amount, 0);
  const subtotalCommission = items.reduce((s, i) => s + Number(i.commission), 0);
  const subtotalCDiscount = items.reduce((s, i) => s + Number(i.c_discount), 0);
  const total = subtotalAmount - discount;
  const grandTotal = total + cgst + sgst + igst;

  const handleSubmit = async () => {
    if (!customerId) { setMessage('Please select a company'); return; }
    if (!invoiceNo) { setMessage('Invoice No is required'); return; }
    setSubmitting(true);
    setMessage('');
    try {
      const payload = {
        bill_type: 'Cloud',
        voucher,
        billing_company_id: billingCompanyId,
        billing_company: billingCompany,
        customer_id: customerId,
        invoice_no: invoiceNo,
        invoice_date: invoiceDate,
        task_add: taskAdd,
        ref_no: refNo,
        ref_date: refDate || null,
        items: items.map(i => ({
          product_id: i.product_id || null,
          product_name: i.product_name,
          remark: i.remark,
          inc_rate: i.inc_rate,
          rate: i.rate,
          qty: i.qty,
          amount: i.amount,
          commission: i.commission,
          c_discount: i.c_discount,
        })),
        subtotal_amount: subtotalAmount,
        subtotal_commission: subtotalCommission,
        subtotal_c_discount: subtotalCDiscount,
        discount,
        total,
        cgst,
        sgst,
        igst,
        grand_total: grandTotal,
      };
      const res = await billingApi.createBill(payload);
      if (res.success) {
        setMessage('Bill created successfully');
        // Reset
        setItems([emptyLine()]);
        setInvoiceNo('');
        setDiscount(0);
        setCgst(0);
        setSgst(0);
        setIgst(0);
        setCustomerId(null);
        setCustomerSearch('');
      } else {
        setMessage(res.message || 'Failed to create bill');
      }
    } catch (err: any) {
      setMessage(err?.message || 'Error creating bill');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = 'w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white';
  const labelCls = 'text-[11px] font-medium text-gray-500 mb-0.5';

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-7xl mx-auto bg-white rounded-lg shadow p-5">
        <h1 className="text-lg font-semibold text-gray-800 mb-4">Cloud Bill</h1>

        {message && (
          <div className={`mb-3 px-3 py-2 rounded text-sm ${message.includes('success') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {message}
          </div>
        )}

        {/* Row 1 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
          <div>
            <div className={labelCls}>Voucher</div>
            <select value={voucher} onChange={e => setVoucher(e.target.value)} className={inputCls}>
              <option value="Sales">Sales</option>
              <option value="Purchase">Purchase</option>
              <option value="DebitNote">DebitNote</option>
              <option value="CreditNote">CreditNote</option>
            </select>
          </div>
          <div className="relative">
            <div className={labelCls}>Billing Company</div>
            <input
              value={billingCompany}
              onChange={e => { setBillingCompany(e.target.value); setBcDropdown(true); }}
              onFocus={() => setBcDropdown(true)}
              onBlur={() => setTimeout(() => setBcDropdown(false), 150)}
              placeholder="Search..."
              className={inputCls}
            />
            {bcDropdown && filteredBc.length > 0 && (
              <div className="absolute z-20 w-full bg-white border border-gray-200 rounded shadow max-h-40 overflow-auto mt-0.5">
                {filteredBc.map(bc => (
                  <div
                    key={bc.id}
                    className="px-2 py-1 text-sm hover:bg-blue-50 cursor-pointer"
                    onMouseDown={() => {
                      setBillingCompany(bc.name || bc.company);
                      setBillingCompanyId(bc.id);
                      setBcDropdown(false);
                      // Fetch and populate line items for this billing company
                      billingApi.getBillingCompanyItems(bc.id).then(res => {
                        if (res.success && res.data && res.data.length > 0) {
                          const mapped: LineItem[] = res.data.map((bi: any) => ({
                            product_id: bi.productid ? String(bi.productid) : '',
                            product_name: bi.product_name || '',
                            remark: bi.remark || '',
                            inc_rate: Number(bi.inc_rate) || 0,
                            rate: Number(bi.rate) || 0,
                            qty: Number(bi.qty) || 1,
                            amount: Number(bi.amount) || 0,
                            commission: Number(bi.commission) || 0,
                            c_discount: Number(bi.c_discount) || 0,
                          }));
                          setItems(mapped);
                          setDiscount(0);
                          setCgst(0);
                          setSgst(0);
                          setIgst(0);
                        }
                      }).catch(() => {});
                    }}
                  >
                    {bc.name || bc.company}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <div className={labelCls}>Select Company</div>
            <input
              value={customerSearch}
              onChange={e => { setCustomerSearch(e.target.value); setCustDropdown(true); setCustomerId(null); }}
              onFocus={() => setCustDropdown(true)}
              onBlur={() => setTimeout(() => setCustDropdown(false), 150)}
              placeholder="Search customer..."
              className={inputCls}
            />
            {custDropdown && filteredCust.length > 0 && (
              <div className="absolute z-20 w-full bg-white border border-gray-200 rounded shadow max-h-40 overflow-auto mt-0.5">
                {filteredCust.slice(0, 50).map(c => (
                  <div
                    key={c.id}
                    className="px-2 py-1 text-sm hover:bg-blue-50 cursor-pointer"
                    onMouseDown={() => {
                      setCustomerSearch(c.company);
                      setCustomerId(c.id);
                      setCustDropdown(false);
                    }}
                  >
                    {c.company}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className={labelCls}>Invoice No</div>
            <input value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} className={inputCls} />
          </div>
          <div>
            <div className={labelCls}>Invoice Date</div>
            <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} className={inputCls} />
          </div>
        </div>

        {/* Row 2 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <div>
            <div className={labelCls}>Task Add</div>
            <select value={taskAdd} onChange={e => setTaskAdd(e.target.value)} className={inputCls}>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
          </div>
          <div>
            <div className={labelCls}>Ref No</div>
            <input value={refNo} onChange={e => setRefNo(e.target.value)} className={inputCls} />
          </div>
          <div>
            <div className={labelCls}>Ref Date</div>
            <input type="date" value={refDate} onChange={e => setRefDate(e.target.value)} className={inputCls} />
          </div>
        </div>

        {/* Line Items */}
        <div className="border border-gray-200 rounded mb-4">
          <div className="bg-gray-50 px-3 py-1.5 flex items-center justify-between border-b border-gray-200">
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Line Items</span>
            <button onClick={addRow} className="bg-green-500 hover:bg-green-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-lg leading-none font-bold">+</button>
          </div>
          <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="text-[11px] text-gray-500 font-medium">
                  <th className="text-left px-2 py-1.5 w-8">#</th>
                  <th className="text-left px-2 py-1.5 min-w-[150px]">Product</th>
                  <th className="text-left px-2 py-1.5 min-w-[160px]">Serial+Tally Expiry / Remark</th>
                  <th className="text-right px-2 py-1.5 w-24">Inc Rate</th>
                  <th className="text-right px-2 py-1.5 w-24">Rate</th>
                  <th className="text-right px-2 py-1.5 w-20">Qty</th>
                  <th className="text-right px-2 py-1.5 w-28">Amount</th>
                  <th className="text-right px-2 py-1.5 w-24">Commission</th>
                  <th className="text-right px-2 py-1.5 w-24">C Discount</th>
                  <th className="px-2 py-1.5 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} className="border-t border-gray-100 hover:bg-gray-50/50">
                    <td className="px-2 py-1 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="px-1 py-1">
                      <select
                        value={item.product_id}
                        onChange={e => {
                          const p = products.find(p => String(p.id) === e.target.value);
                          updateItem(idx, 'product_id', e.target.value);
                          updateItem(idx, 'product_name', p?.name || '');
                        }}
                        className="w-full border border-gray-200 rounded px-1.5 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                      >
                        <option value="">-- Select --</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <input
                        value={item.remark}
                        onChange={e => updateItem(idx, 'remark', e.target.value)}
                        className="w-full border border-gray-200 rounded px-1.5 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                        placeholder="Serial / Remark"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        value={item.inc_rate || ''}
                        onChange={e => updateItem(idx, 'inc_rate', Number(e.target.value))}
                        className="w-full border border-gray-200 rounded px-1.5 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        value={item.rate || ''}
                        onChange={e => updateItem(idx, 'rate', Number(e.target.value))}
                        className="w-full border border-gray-200 rounded px-1.5 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        value={item.qty || ''}
                        onChange={e => updateItem(idx, 'qty', Number(e.target.value))}
                        className="w-full border border-gray-200 rounded px-1.5 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                        min={1}
                      />
                    </td>
                    <td className="px-2 py-1 text-right text-sm font-medium text-gray-700">
                      {item.amount.toFixed(2)}
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        value={item.commission || ''}
                        onChange={e => updateItem(idx, 'commission', Number(e.target.value))}
                        className="w-full border border-gray-200 rounded px-1.5 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        value={item.c_discount || ''}
                        onChange={e => updateItem(idx, 'c_discount', Number(e.target.value))}
                        className="w-full border border-gray-200 rounded px-1.5 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button onClick={() => removeRow(idx)} className="text-red-400 hover:text-red-600 text-sm font-bold">&times;</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Summary */}
        <div className="flex justify-end mb-4">
          <div className="w-full max-w-md border border-gray-200 rounded">
            {/* Subtotal row with 3 sub-columns */}
            <div className="grid grid-cols-3 gap-0 border-b border-gray-100 bg-gray-50 text-[11px] font-medium text-gray-500 px-3 py-1">
              <div className="text-right">Amount</div>
              <div className="text-right">Commission</div>
              <div className="text-right">C Discount</div>
            </div>
            <div className="grid grid-cols-3 gap-0 border-b border-gray-200 px-3 py-1.5 text-sm font-semibold">
              <div className="text-right">{subtotalAmount.toFixed(2)}</div>
              <div className="text-right">{subtotalCommission.toFixed(2)}</div>
              <div className="text-right">{subtotalCDiscount.toFixed(2)}</div>
            </div>

            {/* Single-column rows */}
            <div className="divide-y divide-gray-100 text-sm">
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-gray-500 text-[11px] font-medium">Discount</span>
                <input
                  type="number"
                  value={discount || ''}
                  onChange={e => setDiscount(Number(e.target.value))}
                  className="w-28 border border-gray-200 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-gray-500 text-[11px] font-medium">Total</span>
                <span className="font-semibold">{total.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-gray-500 text-[11px] font-medium">CGST</span>
                <input
                  type="number"
                  value={cgst || ''}
                  onChange={e => setCgst(Number(e.target.value))}
                  className="w-28 border border-gray-200 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-gray-500 text-[11px] font-medium">SGST</span>
                <input
                  type="number"
                  value={sgst || ''}
                  onChange={e => setSgst(Number(e.target.value))}
                  className="w-28 border border-gray-200 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-gray-500 text-[11px] font-medium">IGST</span>
                <input
                  type="number"
                  value={igst || ''}
                  onChange={e => setIgst(Number(e.target.value))}
                  className="w-28 border border-gray-200 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
              <div className="flex items-center justify-between px-3 py-2 bg-blue-50 rounded-b font-bold text-blue-800">
                <span className="text-xs">Grand Total</span>
                <span>{grandTotal.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium text-sm px-6 py-2 rounded shadow"
          >
            {submitting ? 'Submitting...' : 'Submit Bill'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CloudBill;
