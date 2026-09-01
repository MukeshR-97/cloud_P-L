import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Cloud, FileText, Settings, Pencil, Trash2,
  CheckCircle, ShieldCheck, AlertTriangle, PlusCircle, Database, FileDown
} from "lucide-react";
import { getRecords, getAwsAccounts, createAwsAccount, deleteRecord, bulkUpdateDiscounts, importCur } from "../api";
import { formatCurrency, formatINR, formatPct } from "../utils/format";
import { useToast } from "../components/Toast";
import Dialog from "../components/Dialog";
import "./RecordList.css";

// ── Build account buckets ─────────────────────────────────────────────────────
function buildBuckets(accounts, records) {
  const acctById = new Map();
  for (const a of accounts) acctById.set(a.id, a);

  const bucketKey = (a) => a.aws_account_id ? `acct:${a.aws_account_id}` : `dbid:${a.id}`;
  const map = new Map();

  for (const a of accounts) {
    const k = bucketKey(a);
    if (!map.has(k)) {
      map.set(k, {
        key: k,
        accountId:    a.id,
        accountName:  a.name,
        childAccountId: a.aws_account_id || null,
        csp:          a.csp || "AWS",
        isManual:     a.is_manual || false,
        contractDate: a.contract_date,
        s3_cur_bucket: a.s3_cur_bucket || null,
        s3_cur_prefix: a.s3_cur_prefix || null,
        records:      [],
        dbAccountIds: new Set([a.id]),
      });
    }
  }

  const orphans = [];
  for (const r of records) {
    if (!r.aws_account_id) { orphans.push(r); continue; }
    const a   = acctById.get(r.aws_account_id);
    const k   = a ? bucketKey(a) : `dbid:${r.aws_account_id}`;
    if (map.has(k)) {
      map.get(k).records.push(r);
    } else {
      map.set(k, {
        key: k,
        accountId:    r.aws_account_id,
        accountName:  r.aws_account_name || `Account #${r.aws_account_id}`,
        childAccountId: r.aws_child_account_id || null,
        csp:          "AWS",
        isManual:     false,
        contractDate: r.contract_date,
        s3_cur_bucket: null,
        s3_cur_prefix: null,
        records:      [r],
        dbAccountIds: new Set([r.aws_account_id]),
      });
    }
  }

  for (const b of map.values())
    b.records.sort((a, b) => a.consumption_month.localeCompare(b.consumption_month));

  const buckets = [...map.values()].sort((a, b) =>
    (a.accountName || "").localeCompare(b.accountName || "")
  );

  if (orphans.length > 0) {
    orphans.sort((a, b) => a.consumption_month.localeCompare(b.consumption_month));
    buckets.push({
      key: "manual", accountId: null, accountName: "Manual Entries",
      childAccountId: null, csp: "AWS", isManual: true,
      contractDate: null, s3_cur_bucket: null, s3_cur_prefix: null,
      records: orphans, dbAccountIds: new Set(),
    });
  }

  return buckets;
}

// ── Sum all records in a bucket ───────────────────────────────────────────────
function sumBucket(records) {
  return records.reduce((acc, r) => ({
    cloud_service_cost:       acc.cloud_service_cost       + (r.cloud_service_cost || 0),
    marketplace_cost:         acc.marketplace_cost         + (r.marketplace_cost || 0),
    total_consumption:        acc.total_consumption        + (r.total_consumption || 0),
    distributor_discount_amt: acc.distributor_discount_amt + (r.distributor_discount_amt || 0),
    credit_amount:            acc.credit_amount            + (r.credit_amount || 0),
    customer_discount_amt:    acc.customer_discount_amt    + (r.customer_discount_amt || 0),
    managed_services_amt:     acc.managed_services_amt     + (r.managed_services_amt || 0),
    cash_claim:               acc.cash_claim               + (r.cash_claim || 0),
    redington_credit_note:    acc.redington_credit_note    + (r.redington_credit_note || 0),
    ilios_spend:              acc.ilios_spend              + (r.ilios_spend || 0),
    invoice_to_customer:      acc.invoice_to_customer      + (r.invoice_to_customer || 0),
    ilios_margin:             acc.ilios_margin             + (r.ilios_margin || 0),
    total_consumption_inr:    acc.total_consumption_inr    + (r.total_consumption_inr || 0),
    ilios_spend_inr:          acc.ilios_spend_inr          + (r.ilios_spend_inr || 0),
    invoice_to_customer_inr:  acc.invoice_to_customer_inr  + (r.invoice_to_customer_inr || 0),
    ilios_margin_inr:         acc.ilios_margin_inr         + (r.ilios_margin_inr || 0),
  }), {
    cloud_service_cost:0, marketplace_cost:0, total_consumption:0,
    distributor_discount_amt:0, credit_amount:0, customer_discount_amt:0,
    managed_services_amt:0, cash_claim:0, redington_credit_note:0,
    ilios_spend:0, invoice_to_customer:0, ilios_margin:0,
    total_consumption_inr:0, ilios_spend_inr:0,
    invoice_to_customer_inr:0, ilios_margin_inr:0,
  });
}

// ── Master Edit Modal ─────────────────────────────────────────────────────────
function MasterEditModal({ bucket, onSaved, onClose }) {
  const existing   = bucket.records[0] || {};
  const accountId  = bucket.records[0]?.aws_account_id || null;
  const [form, setForm] = useState({
    distributor_discount: existing.distributor_discount ?? "",
    customer_discount:    existing.customer_discount    ?? "",
    managed_services:     existing.managed_services     ?? "",
    conversion_rate:      existing.conversion_rate      ?? "",
  });
  const [applyTo, setApplyTo] = useState("all");
  const [saving, setSaving]   = useState(false);
  const [result, setResult]   = useState(null);

  const handleChange = e => setForm(p => ({ ...p, [e.target.name]: e.target.value }));

  const handleSubmit = async e => {
    e.preventDefault();
    if (!accountId) return;
    setSaving(true); setResult(null);
    const payload = { aws_account_id: accountId, apply_to: applyTo };
    ["distributor_discount","customer_discount","managed_services","conversion_rate"]
      .forEach(f => { if (form[f] !== "") payload[f] = parseFloat(form[f]); });
    try {
      const { data } = await bulkUpdateDiscounts(payload);
      setResult(data); onSaved();
    } catch (err) {
      setResult({ error: err?.response?.data?.error || "Update failed." });
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="master-edit-modal">
        <div className="master-edit-header">
          <div>
            <h2><Settings size={16} style={{marginRight:6}}/>Master Edit — {bucket.accountName}</h2>
            <p className="master-edit-sub">Apply discounts/rate to all <strong>{bucket.records.length}</strong> months at once.</p>
          </div>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>
        {result && (
          <div className={`master-result ${result.error ? "master-error" : "master-success"}`}>
            {result.error ? `Error: ${result.error}` : result.message}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="master-edit-grid">
            {[
              { f:"distributor_discount", label:"Distributor Discount", hint:"% of Cloud Cost", sfx:"%" },
              { f:"customer_discount",    label:"Customer Discount",    hint:"% of Cloud Cost", sfx:"%" },
              { f:"managed_services",     label:"Managed Services",     hint:"% of Total",      sfx:"%" },
              { f:"conversion_rate",      label:"Conversion Rate",      hint:"1 USD = ? INR",   sfx:"₹" },
            ].map(({f,label,hint,sfx}) => (
              <div key={f} className="master-field">
                <label>{label}</label>
                <span className="field-hint-sm">{hint}</span>
                <div className="master-input-wrap">
                  <input type="number" name={f} step="0.01" min="0"
                    value={form[f]} onChange={handleChange} placeholder="0.00" />
                  <span className="master-suffix">{sfx}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="master-apply-row">
            <span className="master-apply-label">Apply to:</span>
            {[
              { v:"all",       label:"All months (overwrite existing)" },
              { v:"zero_only", label:"Only months where value is 0" },
            ].map(({v,label}) => (
              <label key={v} className="master-radio">
                <input type="radio" name="applyTo" value={v}
                  checked={applyTo === v} onChange={() => setApplyTo(v)} />
                {label}
              </label>
            ))}
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

// ── Add Manual Account Panel ──────────────────────────────────────────────────
function AddManualAccountPanel({ onSaved, onClose }) {
  const [name, setName]               = useState("");
  const [contractDate, setContractDate] = useState("");
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState(null);

  const handleCreate = async e => {
    e.preventDefault();
    if (!name.trim() || !contractDate) { setError("Name and contract date are required."); return; }
    setSaving(true); setError(null);
    try {
      const { data } = await createAwsAccount({
        name: name.trim(), contract_date: contractDate, is_manual: true, is_active: true,
      });
      setName(""); setContractDate("");
      onSaved(data);
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to create account.");
    } finally { setSaving(false); }
  };

  return (
    <div className="inline-add-panel">
      <h4><FileText size={14} style={{marginRight:6}}/>Add Manual Account (no AWS keys required)</h4>
      {error && <p className="inline-error">{error}</p>}
      <form onSubmit={handleCreate} className="inline-add-form">
        <div className="inline-field">
          <label>Account Name *</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. DoTE" autoFocus />
        </div>
        <div className="inline-field">
          <label>Contract Date *</label>
          <input type="date" value={contractDate} onChange={e => setContractDate(e.target.value)} />
        </div>
        <div className="inline-actions">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Creating…" : "Create Account"}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </form>
      <p className="inline-hint">After creating, click <strong>+ New Entry</strong> to add monthly records.</p>
    </div>
  );
}

// ── Single month row ──────────────────────────────────────────────────────────
function MonthRow({ r, showInr, csp, onEdit, onDelete, onCurImport }) {
  const isZero = (r.cost_status === "unavailable" || r.cost_status === "zero")
    && r.cloud_service_cost === 0 && r.marketplace_cost === 0;

  return (
    <tr className={isZero ? "zero-cost-row" : ""}>
      <td className="month-cell">{r.consumption_month?.slice(0,7)}</td>
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
      <td className={r.ilios_margin >= 0 ? "positive" : "negative"}>{formatCurrency(r.ilios_margin)}</td>
      {showInr && <>
        <td>{formatINR(r.total_consumption_inr)}</td>
        <td>{formatINR(r.ilios_spend_inr)}</td>
        <td>{formatINR(r.invoice_to_customer_inr)}</td>
        <td className={r.ilios_margin_inr >= 0 ? "positive" : "negative"}>{formatINR(r.ilios_margin_inr)}</td>
      </>}

      {/* Source column */}
      <td>
        <div className="source-cell">
          <span className={`csp-badge csp-${(csp||"AWS").toLowerCase()}`}>{csp||"AWS"}</span>
          <span className={`fetch-src-badge ${r.is_auto_fetched ? "auto" : "manual"}`}>
            {r.is_auto_fetched ? "Auto" : "Manual"}
          </span>
          {r.cost_status && r.cost_status !== "manual" && (
            <span className={`data-table-status-badge status-${r.cost_status}`}
              title={r.cost_status === "cur" ? "Imported from CUR S3" : r.cost_status}>
              {r.cost_status === "fetched"     ? <CheckCircle size={11}/>   :
               r.cost_status === "cur"         ? <Database size={11}/>      :
               r.cost_status === "preserved"   ? <ShieldCheck size={11}/>   :
               r.cost_status === "unavailable" ? <AlertTriangle size={11}/> :
               r.cost_status === "zero"        ? <AlertTriangle size={11}/> : null}
            </span>
          )}
        </div>
      </td>

      <td className="remarks-cell">{r.remarks || "—"}</td>

      {/* Actions — include Import CUR button for $0 months */}
      <td className="action-cell">
        {isZero && onCurImport && (
          <button className="btn-icon cur-row-btn"
            onClick={() => onCurImport(r)}
            title="Import this month from CUR S3">
            <FileDown size={13}/>
          </button>
        )}
        <button className="btn-icon" onClick={() => onEdit(r.id)} title="Edit">
          <Pencil size={14}/>
        </button>
        <button className="btn-icon danger" onClick={() => onDelete(r.id)} title="Delete">
          <Trash2 size={14}/>
        </button>
      </td>
    </tr>
  );
}

// ── CUR import for a single month (inline modal) ──────────────────────────────
function CurMonthImportModal({ record, bucket, onDone, onClose }) {
  const [importing, setImporting] = useState(false);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState(null);
  const { toast } = useToast();

  const month = record.consumption_month?.slice(0, 7); // YYYY-MM

  const handleImport = async () => {
    setImporting(true); setError(null);
    try {
      const { data } = await importCur(bucket.accountId, {
        from_month: month,
        to_month:   month,
        overwrite_fetched: false,
      });
      setResult(data);
      const inserted = data.summary?.inserted || 0;
      const updated  = data.summary?.updated  || 0;
      if (inserted + updated > 0) {
        toast.success(`CUR import complete for ${month} — cost updated.`);
        onDone();
      } else {
        toast.warning(`CUR ran for ${month} but no data was found in S3.`);
      }
    } catch (err) {
      setError(err?.response?.data?.error || "CUR import failed.");
    } finally { setImporting(false); }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-box" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <div>
            <h2>
              <FileDown size={15} style={{ marginRight:8, verticalAlign:"middle" }} />
              Import CUR — {month}
            </h2>
            <p className="modal-subtitle">
              {bucket.accountName} &nbsp;·&nbsp;
              {bucket.s3_cur_bucket
                ? <><code>s3://{bucket.s3_cur_bucket}/{bucket.s3_cur_prefix || ""}</code></>
                : <span style={{ color:"#dc2626" }}>No CUR S3 configured — edit the account first.</span>
              }
            </p>
          </div>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        {error && <div className="error-msg">{error}</div>}

        {result ? (
          <div className={`master-result ${(result.summary?.inserted||0)+(result.summary?.updated||0) > 0 ? "master-success" : "master-error"}`}>
            {result.message}
          </div>
        ) : (
          <p style={{ fontSize:"0.85rem", color:"#475569", margin:"0 0 18px" }}>
            This will import cost data for <strong>{month}</strong> from the CUR S3 bucket
            and replace the current $0 placeholder.
          </p>
        )}

        <div className="master-edit-actions">
          {!result && (
            <button className="btn-primary" onClick={handleImport}
              disabled={importing || !bucket.s3_cur_bucket}>
              {importing
                ? "Importing…"
                : bucket.s3_cur_bucket
                  ? `Import ${month} from CUR`
                  : "Configure CUR S3 first"
              }
            </button>
          )}
          <button className="btn-secondary" onClick={onClose}>
            {result ? "Close" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Account Section ───────────────────────────────────────────────────────────
function AccountSection({ bucket, onEdit, onDelete, onRefresh, onOpenMasterEdit, globalShowInr }) {
  const [open, setOpen]     = useState(false);
  const [showInr, setShowInr] = useState(globalShowInr);
  const [curMonthRecord, setCurMonthRecord] = useState(null); // record to CUR-import

  useEffect(() => { setShowInr(globalShowInr); }, [globalShowInr]);

  const totals         = sumBucket(bucket.records);
  const uniqueMonths   = bucket.records.length;
  const zeroMonthCount = bucket.records.filter(r =>
    (r.cost_status === "zero" || r.cost_status === "unavailable")
    && r.cloud_service_cost === 0 && r.marketplace_cost === 0
  ).length;

  const METRICS = [
    { label:"Cloud Cost",   v:totals.cloud_service_cost,       vi:null },
    { label:"Marketplace",  v:totals.marketplace_cost,         vi:null },
    { label:"Total",        v:totals.total_consumption,        vi:totals.total_consumption_inr },
    { label:"Dist. Disc",   v:totals.distributor_discount_amt, vi:null },
    { label:"Credit Amt",   v:totals.credit_amount,            vi:null },
    { label:"Cust. Disc",   v:totals.customer_discount_amt,    vi:null },
    { label:"Managed Svc",  v:totals.managed_services_amt,     vi:null },
    { label:"Cash Claim",   v:totals.cash_claim,               vi:null },
    { label:"Redington CN", v:totals.redington_credit_note,    vi:null },
    { label:"ILIOS Spend",  v:totals.ilios_spend,              vi:totals.ilios_spend_inr },
    { label:"Invoice",      v:totals.invoice_to_customer,      vi:totals.invoice_to_customer_inr },
    { label:"Margin",       v:totals.ilios_margin,             vi:totals.ilios_margin_inr, sign:true },
  ];

  const handleCurImport = (record) => {
    if (!bucket.s3_cur_bucket) {
      // No CUR configured — show hint that they need to configure it
      setCurMonthRecord(record);
    } else {
      setCurMonthRecord(record);
    }
  };

  return (
    <div className="account-section">
      <div className={`account-header ${open ? "open" : ""}`}
        onClick={() => setOpen(v => !v)} role="button" tabIndex={0}
        onKeyDown={e => e.key === "Enter" && setOpen(v => !v)}>

        <div className="account-header-left">
          <span className="chevron">{open ? "▾" : "▸"}</span>
          <div className="account-name-group">
            <span className="account-name">
              {bucket.isManual
                ? <><FileText size={13} className="acct-icon"/>&nbsp;{bucket.accountName}</>
                : <><Cloud size={13} className="acct-icon"/>&nbsp;{bucket.accountName}</>}
            </span>
            {bucket.childAccountId && (
              <span className="acct-meta-row">
                <span className="acct-meta-label">ID</span>
                <span className="child-account-id">{bucket.childAccountId}</span>
              </span>
            )}
            <span className="acct-meta-row">
              <span className="acct-meta-label">CSP</span>
              <span className={`csp-badge csp-${(bucket.csp||"AWS").toLowerCase()}`}>
                {bucket.csp||"AWS"}
              </span>
              {bucket.s3_cur_bucket && (
                <span className="cur-configured-badge" title={`CUR: s3://${bucket.s3_cur_bucket}/${bucket.s3_cur_prefix||""}`}>
                  <Database size={9}/> CUR
                </span>
              )}
            </span>
            <span className="acct-meta-row">
              <span className="acct-meta-label">Months</span>
              <span className="record-count">{uniqueMonths}</span>
              {zeroMonthCount > 0 && (
                <span className="zero-month-badge" title={`${zeroMonthCount} month(s) with $0 — import from CUR`}>
                  <AlertTriangle size={10}/> {zeroMonthCount} need CUR
                </span>
              )}
            </span>
          </div>
        </div>

        <div className="account-header-totals">
          {METRICS.map(m => (
            <span key={m.label} className="hdr-metric">
              <span className="hdr-label">{m.label}</span>
              <span className={`hdr-value ${m.sign ? (m.v >= 0 ? "positive" : "negative") : ""}`}>
                {showInr && m.vi != null ? formatINR(m.vi) : formatCurrency(m.v)}
              </span>
              {!showInr && m.vi > 0 && <span className="hdr-inr">{formatINR(m.vi)}</span>}
            </span>
          ))}
        </div>

        <button className="btn-master-edit-icon" title="Edit discounts for all months"
          onClick={e => { e.stopPropagation(); onOpenMasterEdit(bucket); }}>
          <Settings size={14}/>
        </button>
      </div>

      {open && (
        <div className="table-wrapper">
          <div className="table-toolbar">
            <span className="toolbar-label">Currency:</span>
            {["USD","INR"].map(c => (
              <button key={c}
                className={`toggle-currency ${(!showInr && c==="USD") || (showInr && c==="INR") ? "active" : ""}`}
                onClick={e => { e.stopPropagation(); setShowInr(c==="INR"); }}>
                {c}
              </button>
            ))}
            {zeroMonthCount > 0 && bucket.s3_cur_bucket && (
              <span className="toolbar-cur-hint">
                <FileDown size={11}/>
                {zeroMonthCount} month(s) show $0 — click <FileDown size={10}/> in the row to import from CUR
              </span>
            )}
            {zeroMonthCount > 0 && !bucket.s3_cur_bucket && (
              <span className="toolbar-cur-hint toolbar-cur-hint-warn">
                <AlertTriangle size={11}/>
                {zeroMonthCount} month(s) show $0 — configure CUR S3 in AWS Accounts to import
              </span>
            )}
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th><th>Contract</th><th>Cloud Cost</th><th>Marketplace</th><th>Total</th>
                <th>Dist. Disc %</th><th>Dist. Disc Amt</th><th>Credit Amt</th>
                <th>Cust. Disc %</th><th>Cust. Disc Amt</th>
                <th>Managed %</th><th>Managed Amt</th><th>Cash Claim</th>
                <th>Conv. Rate</th><th>Redington CN</th>
                <th>ILIOS Spend</th><th>Invoice</th><th>Margin</th>
                {showInr && <><th>Total (INR)</th><th>ILIOS Spend (INR)</th><th>Invoice (INR)</th><th>Margin (INR)</th></>}
                <th>Source</th><th>Remarks</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {bucket.records.map(r => (
                <MonthRow
                  key={r.id}
                  r={r}
                  showInr={showInr}
                  csp={bucket.csp}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onCurImport={bucket.s3_cur_bucket || !bucket.isManual ? handleCurImport : null}
                />
              ))}
              {/* Subtotal */}
              <tr className="subtotal-row">
                <td colSpan={2} className="subtotal-label"><strong>Subtotal</strong></td>
                <td><strong>{formatCurrency(totals.cloud_service_cost)}</strong></td>
                <td><strong>{formatCurrency(totals.marketplace_cost)}</strong></td>
                <td><strong>{formatCurrency(totals.total_consumption)}</strong></td>
                <td/><td><strong>{formatCurrency(totals.distributor_discount_amt)}</strong></td>
                <td><strong>{formatCurrency(totals.credit_amount)}</strong></td>
                <td/><td><strong>{formatCurrency(totals.customer_discount_amt)}</strong></td>
                <td/><td><strong>{formatCurrency(totals.managed_services_amt)}</strong></td>
                <td><strong>{formatCurrency(totals.cash_claim)}</strong></td>
                <td/><td><strong>{formatCurrency(totals.redington_credit_note)}</strong></td>
                <td><strong>{formatCurrency(totals.ilios_spend)}</strong></td>
                <td><strong>{formatCurrency(totals.invoice_to_customer)}</strong></td>
                <td className={totals.ilios_margin >= 0 ? "positive" : "negative"}>
                  <strong>{formatCurrency(totals.ilios_margin)}</strong>
                </td>
                {showInr && <>
                  <td><strong>{formatINR(totals.total_consumption_inr)}</strong></td>
                  <td><strong>{formatINR(totals.ilios_spend_inr)}</strong></td>
                  <td><strong>{formatINR(totals.invoice_to_customer_inr)}</strong></td>
                  <td className={totals.ilios_margin_inr >= 0 ? "positive" : "negative"}>
                    <strong>{formatINR(totals.ilios_margin_inr)}</strong>
                  </td>
                </>}
                <td colSpan={3}/>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Per-month CUR import modal */}
      {curMonthRecord && (
        <CurMonthImportModal
          record={curMonthRecord}
          bucket={bucket}
          onDone={() => { setCurMonthRecord(null); onRefresh(); }}
          onClose={() => setCurMonthRecord(null)}
        />
      )}
    </div>
  );
}

// ── Main RecordList page ──────────────────────────────────────────────────────
export default function RecordList() {
  const [records, setRecords]         = useState([]);
  const [accounts, setAccounts]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [fromDate, setFromDate]       = useState("");
  const [toDate, setToDate]           = useState("");
  const [confirmDel, setConfirmDel]   = useState(null);
  const [masterEditBucket, setMasterEditBucket] = useState(null);
  const [cspFilter, setCspFilter]     = useState("All");
  const [currency, setCurrency]       = useState("USD");
  const [showManual, setShowManual]   = useState(false);
  const navigate   = useNavigate();
  const { toast }  = useToast();

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = {};
      if (fromDate) params.from_date = fromDate;
      if (toDate)   params.to_date   = toDate;
      const [rR, aR] = await Promise.all([getRecords(params), getAwsAccounts()]);
      setRecords(rR.data); setAccounts(aR.data);
    } catch { setError("Failed to fetch records."); }
    finally  { setLoading(false); }
  }, [fromDate, toDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDelete = (id) => setConfirmDel({ id });

  const doDelete = async () => {
    const { id } = confirmDel;
    setConfirmDel(null);
    try {
      await deleteRecord(id);
      setRecords(prev => prev.filter(r => r.id !== id));
      toast.success("Record deleted.");
    } catch { toast.error("Delete failed. Please try again."); }
  };

  const buckets = buildBuckets(accounts, records);
  const filteredBuckets = cspFilter === "All"
    ? buckets
    : buckets.filter(b => (b.csp || "AWS") === cspFilter);
  const grand = sumBucket(filteredBuckets.flatMap(b => b.records));
  const showInr = currency === "INR";

  return (
    <div className="records-page">
      {/* Header */}
      <div className="page-header">
        <h1>Cost Records</h1>
        <div className="header-actions">
          <div className="filter-row">
            <label>From <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}/></label>
            <label>To <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}/></label>
            <button onClick={fetchData} className="btn-primary">Filter</button>
            <button onClick={() => { setFromDate(""); setToDate(""); }} className="btn-secondary">Clear</button>
          </div>
          <div className="header-btns">
            <div className="currency-toggle-records">
              <button className={currency === "USD" ? "active" : ""} onClick={() => setCurrency("USD")}>USD</button>
              <button className={currency === "INR" ? "active" : ""} onClick={() => setCurrency("INR")}>INR ₹</button>
            </div>
            <button className="btn-manual-add" onClick={() => setShowManual(v => !v)}>
              <PlusCircle size={14}/>&nbsp;Manual Account
            </button>
            <Link to="/records/new" className="btn-primary">
              <PlusCircle size={14}/>&nbsp;New Entry
            </Link>
          </div>
        </div>
      </div>

      {/* CSP filter bar */}
      {buckets.length > 0 && (
        <div className="csp-filter-bar">
          <span className="csp-filter-label">Cloud Provider:</span>
          {["All","AWS","GCP","Azure"].map(c => (
            <button key={c}
              className={`csp-filter-btn ${cspFilter === c ? `active csp-filter-${c.toLowerCase()}` : ""}`}
              onClick={() => setCspFilter(c)}>
              {c === "All" ? "All Providers" : c}
            </button>
          ))}
          {cspFilter !== "All" && (
            <span className="csp-filter-count">
              {filteredBuckets.length} account{filteredBuckets.length !== 1 ? "s" : ""}
              &nbsp;·&nbsp;
              <button className="csp-filter-clear" onClick={() => setCspFilter("All")}>
                Clear
              </button>
            </span>
          )}
        </div>
      )}

      {showManual && (
        <AddManualAccountPanel
          onSaved={() => { setShowManual(false); fetchData(); }}
          onClose={() => setShowManual(false)}/>
      )}

      {loading && <div className="loading-msg">Loading…</div>}
      {error   && <div className="error-msg">{error}</div>}

      {!loading && !error && records.length === 0 && accounts.length === 0 && (
        <div className="empty-state">
          <p>No accounts or records yet.</p>
          <Link to="/aws-accounts" className="btn-primary">Add your first account</Link>
        </div>
      )}

      {!loading && !error && (records.length > 0 || accounts.length > 0) && (
        <>
          {/* Grand total bar */}
          <div className="grand-total-bar">
            <span className="gt-label">All Accounts</span>
            <div className="gt-metrics">
              {[
                { label:"Total Consumption",   usd:grand.total_consumption,   inr:grand.total_consumption_inr },
                { label:"ILIOS Spend",         usd:grand.ilios_spend,         inr:grand.ilios_spend_inr },
                { label:"Invoice to Customer", usd:grand.invoice_to_customer, inr:grand.invoice_to_customer_inr },
                { label:"ILIOS Margin",        usd:grand.ilios_margin,        inr:grand.ilios_margin_inr, sign:true },
              ].map(m => (
                <div key={m.label} className="gt-metric">
                  <span className="gt-metric-label">{m.label}</span>
                  <span className={`gt-metric-value ${m.sign ? (m.usd >= 0 ? "positive" : "negative") : ""}`}>
                    {showInr ? formatINR(m.inr) : formatCurrency(m.usd)}
                  </span>
                  {!showInr && m.inr > 0 && (
                    <span className="gt-metric-inr">{formatINR(m.inr)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Account sections */}
          <div className="accounts-list">
            {filteredBuckets.map(b => (
              <AccountSection key={b.key} bucket={b}
                onEdit={id => navigate(`/records/${id}/edit`)}
                onDelete={handleDelete}
                onRefresh={fetchData}
                onOpenMasterEdit={setMasterEditBucket}
                globalShowInr={showInr}/>
            ))}
          </div>
        </>
      )}

      <Dialog
        open={Boolean(confirmDel)}
        type="danger"
        title="Delete Record"
        message="This record will be permanently deleted. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={doDelete}
        onClose={() => setConfirmDel(null)}
      />

      {masterEditBucket && (
        <MasterEditModal
          bucket={masterEditBucket}
          onSaved={() => { setMasterEditBucket(null); fetchData(); }}
          onClose={() => setMasterEditBucket(null)}
        />
      )}
    </div>
  );
}
