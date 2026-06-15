import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, X, Save } from 'lucide-react';
import { billingApi, customersApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast/Toast';

interface LineItem {
  type: string;
  serial: string;
  old_expiry: string;
  new_expiry: string;
  period: string;
  remarks: string;
  no_users: number;
  rate: number;
  amount: number;
}

const emptyLineItem = (): LineItem => ({
  type: '',
  serial: '',
  old_expiry: '',
  new_expiry: '',
  period: '',
  remarks: '',
  no_users: 1,
  rate: 0,
  amount: 0,
});

const TallyBill: React.FC = () => {
  const { user } = useAuth();
  const { showSuccess, showError } = useToast();

  // Header fields
  const [voucher, setVoucher] = useState('Sales');
  const [billingCompany, setBillingCompany] = useState('');
  const [billingCompanyId, setBillingCompanyId] = useState('');
  const [selectCompany, setSelectCompany] = useState('');
  const [selectCompanyId, setSelectCompanyId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);

  // Second row
  const [taskAdd, setTaskAdd] = useState('No');
  const [refNo, setRefNo] = useState('');
  const [refDate, setRefDate] = useState('');

  // Line items
  const [items, setItems] = useState<LineItem[]>([emptyLineItem()]);

  // Summary
  const [discount, setDiscount] = useState(0);
  const [cgst, setCgst] = useState(0);
  const [sgst, setSgst] = useState(0);
  const [igst, setIgst] = useState(0);

  // Dropdowns data
  const [billingCompanies, setBillingCompanies] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [itemTypes, setItemTypes] = useState<{ value: string; label: string }[]>([]);

  // Search states for dropdowns
  const [billingSearch, setBillingSearch] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showBillingDrop, setShowBillingDrop] = useState(false);
  const [showCustomerDrop, setShowCustomerDrop] = useState(false);
  const billingRef = useRef<HTMLDivElement>(null);
  const customerRef = useRef<HTMLDivElement>(null);

  const [submitting, setSubmitting] = useState(false);

  // Fetch dropdown data
  useEffect(() => {
    billingApi.getBillingCompanies().then(res => {
      if (res.success) setBillingCompanies(res.data);
    }).catch(() => {});

    customersApi.getDropdown().then(res => {
      if (res.success) setCustomers(res.data);
    }).catch(() => {});

    billingApi.getTallyItemTypes().then(res => {
      if (res.success) setItemTypes(res.data);
    }).catch(() => {});
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (billingRef.current && !billingRef.current.contains(e.target as Node)) setShowBillingDrop(false);
      if (customerRef.current && !customerRef.current.contains(e.target as Node)) setShowCustomerDrop(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Calculated values
  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  const total = subtotal - discount;
  const grandTotal = total + cgst + sgst + igst;

  // Update line item
  const updateItem = useCallback((index: number, field: keyof LineItem, value: any) => {
    setItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      // Auto-calculate amount
      if (field === 'rate' || field === 'no_users') {
        const rate = field === 'rate' ? Number(value) : updated[index].rate;
        const noUsers = field === 'no_users' ? Number(value) : updated[index].no_users;
        updated[index].amount = rate * noUsers;
      }
      return updated;
    });
  }, []);

  const addRow = () => setItems(prev => [...prev, emptyLineItem()]);

  const removeRow = (index: number) => {
    if (items.length <= 1) return;
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  // Filtered billing companies
  const filteredBilling = billingCompanies.filter(c =>
    (c.company || c.name || '').toLowerCase().includes(billingSearch.toLowerCase())
  );

  // Filtered customers
  const filteredCustomers = customers.filter(c =>
    (c.company || '').toLowerCase().includes(customerSearch.toLowerCase())
  );

  const handleSubmit = async () => {
    if (!selectCompanyId) {
      showError('Validation', 'Please select a company');
      return;
    }
    if (!invoiceNo.trim()) {
      showError('Validation', 'Please enter invoice number');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        bill_type: 'Tally',
        voucher_type: voucher,
        billing_company: billingCompanyId || billingCompany,
        customer_id: selectCompanyId,
        invoice_no: invoiceNo,
        invoice_date: invoiceDate,
        task_add: taskAdd,
        ref_no: refNo,
        ref_date: refDate,
        items: items.map(item => ({
          type: item.type,
          serial: item.serial,
          old_expiry: item.old_expiry,
          new_expiry: item.new_expiry,
          period: item.period,
          remarks: item.remarks,
          no_users: item.no_users,
          rate: item.rate,
          amount: item.amount,
        })),
        subtotal,
        discount,
        total,
        cgst,
        sgst,
        igst,
        grand_total: grandTotal,
      };

      const res = await billingApi.createBill(payload);
      if (res.success) {
        showSuccess('Success', res.message || 'Bill created successfully');
        // Reset form
        setItems([emptyLineItem()]);
        setInvoiceNo('');
        setRefNo('');
        setRefDate('');
        setDiscount(0);
        setCgst(0);
        setSgst(0);
        setIgst(0);
      }
    } catch (err: any) {
      showError('Error', err.message || 'Failed to create bill');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-3">
      <div className="bg-white rounded-lg shadow p-4 max-w-[1400px] mx-auto">
        <h1 className="text-lg font-semibold text-gray-800 mb-3">Tally Bill</h1>

        {/* Header Row 1 */}
        <div className="grid grid-cols-5 gap-3 mb-2">
          {/* Voucher */}
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">Voucher</label>
            <select
              value={voucher}
              onChange={e => setVoucher(e.target.value)}
              className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="Sales">Sales</option>
              <option value="Purchase">Purchase</option>
              <option value="DebitNote">DebitNote</option>
              <option value="CreditNote">CreditNote</option>
            </select>
          </div>

          {/* Billing Company */}
          <div ref={billingRef} className="relative">
            <label className="block text-[11px] text-gray-500 mb-0.5">Billing Company</label>
            <input
              type="text"
              value={billingCompany}
              onChange={e => {
                setBillingCompany(e.target.value);
                setBillingSearch(e.target.value);
                setBillingCompanyId('');
                setShowBillingDrop(true);
              }}
              onFocus={() => setShowBillingDrop(true)}
              placeholder="Search..."
              className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            {showBillingDrop && filteredBilling.length > 0 && (
              <div className="absolute z-20 w-full bg-white border border-gray-200 rounded shadow-lg max-h-40 overflow-y-auto mt-0.5">
                {filteredBilling.map((c: any) => (
                  <div
                    key={c.id}
                    className="px-2 py-1 text-sm hover:bg-blue-50 cursor-pointer"
                    onClick={() => {
                      setBillingCompany(c.company || c.name);
                      setBillingCompanyId(c.id);
                      setShowBillingDrop(false);
                      // Fetch and populate line items for this billing company
                      billingApi.getBillingCompanyItems(c.id).then(res => {
                        if (res.success && res.data && res.data.length > 0) {
                          const mapped: LineItem[] = res.data.map((bi: any) => ({
                            type: bi.product_name || '',
                            serial: bi.serialid ? String(bi.serialid) : '',
                            old_expiry: bi.expiry || '',
                            new_expiry: '',
                            period: '',
                            remarks: bi.remark || '',
                            no_users: Number(bi.no_users) || 1,
                            rate: Number(bi.rate) || 0,
                            amount: Number(bi.amount) || 0,
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
                    {c.company || c.name}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Select Company */}
          <div ref={customerRef} className="relative">
            <label className="block text-[11px] text-gray-500 mb-0.5">Select Company</label>
            <input
              type="text"
              value={selectCompany}
              onChange={e => {
                setSelectCompany(e.target.value);
                setCustomerSearch(e.target.value);
                setSelectCompanyId('');
                setShowCustomerDrop(true);
              }}
              onFocus={() => setShowCustomerDrop(true)}
              placeholder="Search customer..."
              className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            {showCustomerDrop && filteredCustomers.length > 0 && (
              <div className="absolute z-20 w-full bg-white border border-gray-200 rounded shadow-lg max-h-40 overflow-y-auto mt-0.5">
                {filteredCustomers.map((c: any) => (
                  <div
                    key={c.id}
                    className="px-2 py-1 text-sm hover:bg-blue-50 cursor-pointer"
                    onClick={() => {
                      setSelectCompany(c.company);
                      setSelectCompanyId(c.id);
                      setShowCustomerDrop(false);
                    }}
                  >
                    {c.company}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Invoice No */}
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">Invoice No</label>
            <input
              type="text"
              value={invoiceNo}
              onChange={e => setInvoiceNo(e.target.value)}
              className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>

          {/* Invoice Date */}
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">Invoice Date</label>
            <input
              type="date"
              value={invoiceDate}
              onChange={e => setInvoiceDate(e.target.value)}
              className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
        </div>

        {/* Header Row 2 */}
        <div className="grid grid-cols-5 gap-3 mb-4">
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">Task Add</label>
            <select
              value={taskAdd}
              onChange={e => setTaskAdd(e.target.value)}
              className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">Ref No</label>
            <input
              type="text"
              value={refNo}
              onChange={e => setRefNo(e.target.value)}
              className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">Ref Date</label>
            <input
              type="date"
              value={refDate}
              onChange={e => setRefDate(e.target.value)}
              className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div />
          <div />
        </div>

        {/* Line Items Table */}
        <div className="border border-gray-200 rounded mb-4">
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="text-[11px] text-gray-500 uppercase">
                  <th className="py-1.5 px-2 text-left w-[120px]">Type</th>
                  <th className="py-1.5 px-2 text-left w-[110px]">Serial</th>
                  <th className="py-1.5 px-2 text-left w-[120px]">Old Expiry</th>
                  <th className="py-1.5 px-2 text-left w-[120px]">New Expiry</th>
                  <th className="py-1.5 px-2 text-left w-[80px]">Period</th>
                  <th className="py-1.5 px-2 text-left">Remarks</th>
                  <th className="py-1.5 px-2 text-right w-[70px]">No Users</th>
                  <th className="py-1.5 px-2 text-right w-[90px]">Rate</th>
                  <th className="py-1.5 px-2 text-right w-[100px]">Amount</th>
                  <th className="py-1.5 px-2 text-center w-[40px]"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="py-1 px-1">
                      <select
                        value={item.type}
                        onChange={e => updateItem(idx, 'type', e.target.value)}
                        className="w-full border border-gray-200 rounded text-sm py-1 px-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      >
                        <option value="">--</option>
                        {itemTypes.length > 0
                          ? itemTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)
                          : <>
                              <option value="Gold">Gold</option>
                              <option value="Silver">Silver</option>
                              <option value="Auditor">Auditor</option>
                              <option value="TDL">TDL</option>
                              <option value="Rental">Rental</option>
                            </>
                        }
                      </select>
                    </td>
                    <td className="py-1 px-1">
                      <input
                        type="text"
                        value={item.serial}
                        onChange={e => updateItem(idx, 'serial', e.target.value)}
                        className="w-full border border-gray-200 rounded text-sm py-1 px-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>
                    <td className="py-1 px-1">
                      <input
                        type="date"
                        value={item.old_expiry}
                        onChange={e => updateItem(idx, 'old_expiry', e.target.value)}
                        className="w-full border border-gray-200 rounded text-sm py-1 px-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-gray-50"
                      />
                    </td>
                    <td className="py-1 px-1">
                      <input
                        type="date"
                        value={item.new_expiry}
                        onChange={e => updateItem(idx, 'new_expiry', e.target.value)}
                        className="w-full border border-gray-200 rounded text-sm py-1 px-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>
                    <td className="py-1 px-1">
                      <input
                        type="text"
                        value={item.period}
                        onChange={e => updateItem(idx, 'period', e.target.value)}
                        className="w-full border border-gray-200 rounded text-sm py-1 px-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>
                    <td className="py-1 px-1">
                      <input
                        type="text"
                        value={item.remarks}
                        onChange={e => updateItem(idx, 'remarks', e.target.value)}
                        className="w-full border border-gray-200 rounded text-sm py-1 px-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>
                    <td className="py-1 px-1">
                      <input
                        type="number"
                        min={0}
                        value={item.no_users}
                        onChange={e => updateItem(idx, 'no_users', Number(e.target.value))}
                        className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>
                    <td className="py-1 px-1">
                      <input
                        type="number"
                        min={0}
                        value={item.rate}
                        onChange={e => updateItem(idx, 'rate', Number(e.target.value))}
                        className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>
                    <td className="py-1 px-1">
                      <input
                        type="number"
                        value={item.amount}
                        readOnly
                        className="w-full border border-gray-100 rounded text-sm py-1 px-1 text-right bg-gray-50 font-medium"
                      />
                    </td>
                    <td className="py-1 px-1 text-center">
                      {items.length > 1 && (
                        <button
                          onClick={() => removeRow(idx)}
                          className="text-red-400 hover:text-red-600"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Add Row Button */}
          <div className="p-2 border-t border-gray-100">
            <button
              onClick={addRow}
              className="flex items-center gap-1 text-sm text-white bg-green-500 hover:bg-green-600 rounded px-3 py-1"
            >
              <Plus size={14} /> Add Row
            </button>
          </div>
        </div>

        {/* Summary Section */}
        <div className="flex justify-end mb-4">
          <div className="w-[320px] space-y-1.5">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">Subtotal</span>
              <span className="font-medium">{subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">Discount</span>
              <input
                type="number"
                min={0}
                value={discount}
                onChange={e => setDiscount(Number(e.target.value))}
                className="w-[120px] border border-gray-200 rounded text-sm py-1 px-2 text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div className="flex justify-between items-center text-sm font-medium border-t border-gray-200 pt-1">
              <span className="text-gray-600">Total</span>
              <span>{total.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">CGST</span>
              <input
                type="number"
                min={0}
                value={cgst}
                onChange={e => setCgst(Number(e.target.value))}
                className="w-[120px] border border-gray-200 rounded text-sm py-1 px-2 text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">SGST</span>
              <input
                type="number"
                min={0}
                value={sgst}
                onChange={e => setSgst(Number(e.target.value))}
                className="w-[120px] border border-gray-200 rounded text-sm py-1 px-2 text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">IGST</span>
              <input
                type="number"
                min={0}
                value={igst}
                onChange={e => setIgst(Number(e.target.value))}
                className="w-[120px] border border-gray-200 rounded text-sm py-1 px-2 text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div className="flex justify-between items-center text-sm font-semibold border-t border-gray-300 pt-1.5">
              <span className="text-gray-800">Grand Total</span>
              <span className="text-blue-600 text-base">{grandTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded px-5 py-2"
          >
            <Save size={16} />
            {submitting ? 'Submitting...' : 'Submit Bill'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TallyBill;
