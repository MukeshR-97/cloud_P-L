import React, { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getRecords, deleteRecord, bulkUpdateDiscounts } from "../api";
import { formatCurrency, formatINR, formatPct } from "../utils/format";
import "./RecordList.css";

// ── Group by account ──────────────────────────────────────────────────────────
function groupByAccount(records) {
  const map = new Map();
  for (const r of records) {
    const key   = r.aws_account_id ? `account:${r.aws_account_id}` : "manual";
    const label = r.aws_account_name || (r.aws_account_id ? `Account #${r.aws_account_id}` : null);
    if (!map.has(key)) {
      map.set(key, { key, accountName: label, isManual: !r.aws_account_id, records: [] });
    }
    map.get(key).records.push(r);
  }
  for (const b of map.values()) {
    b.records.sort((a, b) => new Date(a.consumption_month) - new Date(b.consumption_month));
  }
  return [...map.values()].sort((a, b) => {
    if (a.isManual) return 1;
    if (b.isManual) return -1;
    return (a.accountName || "").localeCompare(b.accountName || "");
  });
}

// ── Sum all records in a bucket ───────────────────────────────────────────────
function sumBucket(records) {
  return records.reduce((acc, r) => ({
    cloud_service_cost:      acc.cloud_service_cost      + r.cloud_service_cost,
    marketplace_cost:        acc.marketplace_cost        + r.marketplace_cost,
    total_consumption:       acc.total_consumption       + r.total_consumption,
    distributor_discount_amt:acc.distributor_discount_amt+ (r.distributor_discount_amt || 0),
    credit_amount:           acc.credit_amount           + r.credit_amount,
    customer_discount_amt:   acc.customer_discount_amt   + (r.customer_discount_amt   || 0),
    managed_services_amt:    acc.managed_services_amt    + (r.managed_services_amt    || 0),
    cash_claim:              acc.cash_claim              + r.cash_claim,
    redington_credit_note:   acc.redington_credit_note   + r.redington_credit_note,
    ilios_spend:             acc.ilios_spend             + r.ilios_spend,
    invoice_to_customer:     acc.invoice_to_customer     + r.invoice_to_customer,
    ilios_margin:            acc.ilios_margin            + r.ilios_margin,
    total_consumption_inr:   acc.total_consumption_inr   + (r.total_consumption_inr   || 0),
    ilios_spend_inr:         acc.ilios_spend_inr         + (r.ilios_spend_inr         || 0),
    invoice_to_customer_inr: acc.invoice_to_customer_inr + (r.invoice_to_customer_inr || 0),
    ilios_margin_inr:        acc.ilios_margin_inr        + (r.ilios_margin_inr        || 0),
  }), {
    cloud_service_cost: 0,      marketplace_cost: 0,       total_consumption: 0,
    distributor_discount_amt: 0, credit_amount: 0,         customer_discount_amt: 0,
    managed_services_amt: 0,    cash_claim: 0,             redington_credit_note: 0,
    ilios_spend: 0,             invoice_to_customer: 0,    ilios_margin: 0,
    total_consumption_inr: 0,   ilios_spend_inr: 0,
    invoice_to_customer_inr: 0, ilios_margin_inr: 0,
  });
}

// ── Master Edit Modal ─────────────────────────────────────────────────────────
function MasterEditModal({ bucket, onSaved, onClose }) {
  const existing = bucket.records[0] || {};
  const [form, setForm] = useState({
    distributor_discount: existing.distributor_discount ?? "",
    customer_discount:    existing.customer_discount    ?? "",
    managed_services:     existing.managed_services     ?? "",
    conversion_rate:      existing.conversion_rate      ?? "",
  });
  const [applyTo, setApplyTo]   = useState("all");
  const [saving,  setSaving]    = useState(false);
  const [result,  setResult]    = useState(null);  // { updated, message } | { error }
  const accountId = bucket.records[0]?.aws_account_id || null;

  const handleChange = e => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (!accountId) return;
    setSaving(true); setResult(null);

    const payload = { aws_account_id: accountId, apply_to: applyTo };
    ["distributor_discount","customer_discount","managed_services","conversion_rate"]
      .forEach(f => { if (form[f] !== "") payload[f] = parseFloat(form[f]); });

    try {
      const { data } = await bulkUpdateDiscounts(payload);
      setResult(data);
      onSaved();
    } catch (err) {
      setResult({ error: err?.response?.data?.error || "Update failed." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="master-edit-modal">
        <div className="master-edit-header">
          <div>
            <h2>⚙ Master Edit — {bucket.isManual ? "Manual Entries" : bucket.accountName}</h2>
            <p className="master-edit-sub">
              Apply discount percentages and conversion rate to <strong>all {bucket.records.length} months</strong> of this account at once.
            </p>
          </div>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        {result && (
          <div className={`master-result ${result.error ? "master-error" : "master-success"}`}>
            {result.error ? `❌ ${result.error}` : `✅ ${result.message}`}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="master-edit-grid">
            {/* Distributor Discount */}
            <div className="master-field">
              <label>Distributor Discount</label>
              <span className="field-hint-sm">% of Cloud Cost</span>
              <div className="master-input-wrap">
                <input type="number" name="distributor_discount" step="0.01" min="0" max="100"
                  value={form.distributor_discount} onChange={handleChange} placeholder="e.g. 8.00" />
                <span className="master-suffix">%</span>
              </div>
            </div>

            {/* Customer Discount */}
            <div className="master-field">
              <label>Customer Discount</label>
              <span className="field-hint-sm">% of Total</span>
              <div className="master-input-wrap">
                <input type="number" name="customer_discount" step="0.01" min="0" max="100"
                  value={form.customer_discount} onChange={handleChange} placeholder="e.g. 5.00" />
                <span className="master-suffix">%</span>
              </div>
            </div>

            {/* Managed Services */}
            <div className="master-field">
              <label>Managed Services</label>
              <span className="field-hint-sm">% of Total</span>
              <div className="master-input-wrap">
                <input type="number" name="managed_services" step="0.01" min="0" max="100"
                  value={form.managed_services} onChange={handleChange} placeholder="e.g. 10.00" />
                <span className="master-suffix">%</span>
              </div>
            </div>

            {/* Conversion Rate */}
            <div className="master-field">
              <label>Conversion Rate</label>
              <span className="field-hint-sm">1 USD = ? INR</span>
              <div className="master-input-wrap">
                <input type="number" name="conversion_rate" step="0.01" min="0"
                  value={form.conversion_rate} onChange={handleChange} placeholder="e.g. 84.50" />
                <span className="master-suffix">₹</span>
              </div>
            </div>
          </div>

          {/* Apply mode */}
          <div className="master-apply-row">
            <span className="master-apply-label">Apply to:</span>
            <label className="master-radio">
              <input type="radio" name="applyTo" value="all"
                checked={applyTo === "all"} onChange={() => setApplyTo("all")} />
              All months (overwrite existing values)
            </label>
            <label className="master-radio">
              <input type="radio" name="applyTo" value="zero_only"
                checked={applyTo === "zero_only"} onChange={() => setApplyTo("zero_only")} />
              Only months where value is 0 (skip already-filled)
            </label>
          </div>

          <div className="master-edit-actions">
            <button type="submit" className="btn-primary" disabled={saving || !accountId}>
              {saving ? "Applying…" : "Apply to All Months"}
            </button>
            <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Account section ───────────────────────────────────────────────────────────
function AccountSection({ bucket, onEdit, onDelete, onRefresh }) {
  const [open, setOpen]           = useState(false);
  const [showInr, setShowInr]     = useState(false);
  const [masterEdit, setMasterEdit] = useState(false);
  const totals = sumBucket(bucket.records);

  return (
    <div className="account-section">

      {/* ── Collapsible header — shows ALL cumulative totals ── */}
      <div
        className={`account-header ${open ? "open" : ""}`}
        onClick={() => setOpen(v => !v)}
        role="button" tabIndex={0}
        onKeyDown={e => e.key === "Enter" && setOpen(v => !v)}
      >
        {/* Left: name + count */}
        <div className="account-header-left">
          <span className="chevron">{open ? "▾" : "▸"}</span>
          <span className="account-name">
            {bucket.isManual ? "✏️ Manual Entries" : `☁️ ${bucket.accountName}`}
          </span>
          <span className="record-count">
            {bucket.records.length} month{bucket.records.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Right: ALL cumulative metric columns */}
        <div className="account-header-totals">
          {[
            { label: "Cloud Cost",    v: totals.cloud_service_cost,      vi: null },
            { label: "Marketplace",   v: totals.marketplace_cost,        vi: null },
            { label: "Total",         v: totals.total_consumption,       vi: totals.total_consumption_inr },
            { label: "Dist. Disc",    v: totals.distributor_discount_amt, vi: null },
            { label: "Credit Amt",    v: totals.credit_amount,           vi: null },
            { label: "Cust. Disc",    v: totals.customer_discount_amt,   vi: null },
            { label: "Managed Svc",   v: totals.managed_services_amt,    vi: null },
            { label: "Cash Claim",    v: totals.cash_claim,              vi: null },
            { label: "Redington CN",  v: totals.redington_credit_note,   vi: null },
            { label: "ILIOS Spend",   v: totals.ilios_spend,             vi: totals.ilios_spend_inr },
            { label: "Invoice",       v: totals.invoice_to_customer,     vi: totals.invoice_to_customer_inr },
            { label: "Margin",        v: totals.ilios_margin,            vi: totals.ilios_margin_inr, sign: true },
          ].map(m => (
            <span key={m.label} className="hdr-metric">
              <span className="hdr-label">{m.label}</span>
              <span className={`hdr-value ${m.sign ? (m.v >= 0 ? "positive" : "negative") : ""}`}>
                {formatCurrency(m.v)}
              </span>
              {m.vi > 0 && <span className="hdr-inr">{formatINR(m.vi)}</span>}
            </span>
          ))}
        </div>

        {/* Gear icon — top-right, icon only */}
        <button
          className="btn-master-edit-icon"
          title="Edit discounts for all months"
          onClick={e => { e.stopPropagation(); setMasterEdit(true); }}
        >
          ⚙
        </button>
      </div>

      {/* ── Monthly rows table ── */}
      {open && (
        <div className="table-wrapper">

          {/* Currency toggle */}
          <div className="table-toolbar">
            <span className="toolbar-label">Currency:</span>
            <button className={`toggle-currency ${!showInr ? "active" : ""}`}
              onClick={e => { e.stopPropagation(); setShowInr(false); }}>USD</button>
            <button className={`toggle-currency ${showInr ? "active" : ""}`}
              onClick={e => { e.stopPropagation(); setShowInr(true); }}>INR</button>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Contract</th>
                <th>Cloud Cost</th>
                <th>Marketplace</th>
                <th>Total</th>
                <th>Dist. Disc %</th>
                <th>Dist. Disc Amt</th>
                <th>Credit Amt</th>
                <th>Cust. Disc %</th>
                <th>Cust. Disc Amt</th>
                <th>Managed %</th>
                <th>Managed Amt</th>
                <th>Cash Claim</th>
                <th>Conv. Rate</th>
                <th>Redington CN</th>
                <th>ILIOS Spend</th>
                <th>Invoice</th>
                <th>Margin</th>
                {showInr && <th>Total (INR)</th>}
                {showInr && <th>ILIOS Spend (INR)</th>}
                {showInr && <th>Invoice (INR)</th>}
                {showInr && <th>Margin (INR)</th>}
                <th>Source</th>
                <th>Remarks</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {bucket.records.map(r => (
                <tr key={r.id}>
                  <td className="month-cell">{r.consumption_month}</td>
                  <td>{r.contract_date}</td>
                  <td>{formatCurrency(r.cloud_service_cost)}</td>
                  <td>{formatCurrency(r.marketplace_cost)}</td>
                  <td><strong>{formatCurrency(r.total_consumption)}</strong></td>
                  <td className="pct-cell">{formatPct(r.distributor_discount)}</td>
                  <td>{formatCurrency(r.distributor_discount_amt)}</td>
                  <td>{formatCurrency(r.credit_amount)}</td>
                  <td className="pct-cell">{formatPct(r.customer_discount)}</td>
                  <td>{formatCurrency(r.customer_discount_amt)}</td>
                  <td className="pct-cell">{formatPct(r.managed_services)}</td>
                  <td>{formatCurrency(r.managed_services_amt)}</td>
                  <td>{formatCurrency(r.cash_claim)}</td>
                  <td className="rate-cell">₹{Number(r.conversion_rate).toFixed(2)}</td>
                  <td>{formatCurrency(r.redington_credit_note)}</td>
                  <td>{formatCurrency(r.ilios_spend)}</td>
                  <td>{formatCurrency(r.invoice_to_customer)}</td>
                  <td className={r.ilios_margin >= 0 ? "positive" : "negative"}>
                    {formatCurrency(r.ilios_margin)}
                  </td>
                  {showInr && <td>{formatINR(r.total_consumption_inr)}</td>}
                  {showInr && <td>{formatINR(r.ilios_spend_inr)}</td>}
                  {showInr && <td>{formatINR(r.invoice_to_customer_inr)}</td>}
                  {showInr && (
                    <td className={r.ilios_margin_inr >= 0 ? "positive" : "negative"}>
                      {formatINR(r.ilios_margin_inr)}
                    </td>
                  )}
                  <td>
                    <span className={`source-badge ${r.is_auto_fetched ? "auto" : "manual"}`}>
                      {r.is_auto_fetched ? "AWS" : "Manual"}
                    </span>
                  </td>
                  <td className="remarks-cell">{r.remarks || "—"}</td>
                  <td className="action-cell">
                    <button className="btn-icon" onClick={() => onEdit(r.id)} title="Edit">✏️</button>
                    <button className="btn-icon" onClick={() => onDelete(r.id)} title="Delete">🗑️</button>
                  </td>
                </tr>
              ))}

              {/* Subtotal */}
              <tr className="subtotal-row">
                <td colSpan={2} className="subtotal-label"><strong>Subtotal</strong></td>
                <td><strong>{formatCurrency(totals.cloud_service_cost)}</strong></td>
                <td><strong>{formatCurrency(totals.marketplace_cost)}</strong></td>
                <td><strong>{formatCurrency(totals.total_consumption)}</strong></td>
                <td></td>
                <td><strong>{formatCurrency(totals.distributor_discount_amt)}</strong></td>
                <td><strong>{formatCurrency(totals.credit_amount)}</strong></td>
                <td></td>
                <td><strong>{formatCurrency(totals.customer_discount_amt)}</strong></td>
                <td></td>
                <td><strong>{formatCurrency(totals.managed_services_amt)}</strong></td>
                <td><strong>{formatCurrency(totals.cash_claim)}</strong></td>
                <td></td>
                <td><strong>{formatCurrency(totals.redington_credit_note)}</strong></td>
                <td><strong>{formatCurrency(totals.ilios_spend)}</strong></td>
                <td><strong>{formatCurrency(totals.invoice_to_customer)}</strong></td>
                <td className={totals.ilios_margin >= 0 ? "positive" : "negative"}>
                  <strong>{formatCurrency(totals.ilios_margin)}</strong>
                </td>
                {showInr && <td><strong>{formatINR(totals.total_consumption_inr)}</strong></td>}
                {showInr && <td><strong>{formatINR(totals.ilios_spend_inr)}</strong></td>}
                {showInr && <td><strong>{formatINR(totals.invoice_to_customer_inr)}</strong></td>}
                {showInr && (
                  <td className={totals.ilios_margin_inr >= 0 ? "positive" : "negative"}>
                    <strong>{formatINR(totals.ilios_margin_inr)}</strong>
                  </td>
                )}
                <td colSpan={3}></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Master Edit Modal */}
      {masterEdit && (
        <MasterEditModal
          bucket={bucket}
          onSaved={() => { setMasterEdit(false); onRefresh(); }}
          onClose={() => setMasterEdit(false)}
        />
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function RecordList() {
  const [records, setRecords]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate]     = useState("");
  const navigate = useNavigate();

  const fetchRecords = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = {};
      if (fromDate) params.from_date = fromDate;
      if (toDate)   params.to_date   = toDate;
      const { data } = await getRecords(params);
      setRecords(data);
    } catch { setError("Failed to fetch records."); }
    finally  { setLoading(false); }
  }, [fromDate, toDate]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this record?")) return;
    try {
      await deleteRecord(id);
      setRecords(prev => prev.filter(r => r.id !== id));
    } catch { alert("Delete failed."); }
  };

  const buckets = groupByAccount(records);
  const grand   = sumBucket(records);

  return (
    <div className="records-page">
      <div className="page-header">
        <h1>Cost Records</h1>
        <div className="header-actions">
          <div className="filter-row">
            <label>From<input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} /></label>
            <label>To<input type="date" value={toDate}     onChange={e => setToDate(e.target.value)} /></label>
            <button onClick={fetchRecords} className="btn-primary">Filter</button>
            <button onClick={() => { setFromDate(""); setToDate(""); }} className="btn-secondary">Clear</button>
          </div>
          <Link to="/records/new" className="btn-primary">+ New Entry</Link>
        </div>
      </div>

      {loading && <div className="loading-msg">Loading…</div>}
      {error   && <div className="error-msg">{error}</div>}

      {!loading && !error && records.length === 0 && (
        <div className="empty-state">
          <p>No records found.</p>
          <Link to="/records/new" className="btn-primary">Add your first entry</Link>
        </div>
      )}

      {!loading && !error && records.length > 0 && (
        <>
          {/* Grand total banner */}
          <div className="grand-total-bar">
            <span className="gt-label">All Accounts</span>
            <div className="gt-metrics">
              {[
                { label: "Total Consumption",   usd: grand.total_consumption,   inr: grand.total_consumption_inr },
                { label: "ILIOS Spend",         usd: grand.ilios_spend,         inr: grand.ilios_spend_inr },
                { label: "Invoice to Customer", usd: grand.invoice_to_customer, inr: grand.invoice_to_customer_inr },
                { label: "ILIOS Margin",        usd: grand.ilios_margin,        inr: grand.ilios_margin_inr, sign: true },
              ].map(m => (
                <div key={m.label} className="gt-metric">
                  <span className="gt-metric-label">{m.label}</span>
                  <span className={`gt-metric-value ${m.sign ? (m.usd >= 0 ? "positive" : "negative") : ""}`}>
                    {formatCurrency(m.usd)}
                  </span>
                  {m.inr > 0 && <span className="gt-metric-inr">{formatINR(m.inr)}</span>}
                </div>
              ))}
            </div>
          </div>

          <div className="accounts-list">
            {buckets.map(bucket => (
              <AccountSection
                key={bucket.key}
                bucket={bucket}
                onEdit={id => navigate(`/records/${id}/edit`)}
                onDelete={handleDelete}
                onRefresh={fetchRecords}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
