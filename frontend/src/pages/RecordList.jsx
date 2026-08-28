import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Cloud, FileText, Settings, Pencil, Trash2,
  CheckCircle, ShieldCheck, AlertTriangle, PlusCircle,
  GitBranch, Merge, Plus
} from "lucide-react";
import { getRecords, getAwsAccounts, createAwsAccount, deleteRecord, bulkUpdateDiscounts, addSplitRow, mergeSplitGroup } from "../api";
import { formatCurrency, formatINR, formatPct } from "../utils/format";
import { useToast } from "../components/Toast";
import Dialog from "../components/Dialog";
import "./RecordList.css";

function buildBuckets(accounts, records) {
  const acctById = new Map();
  for (const a of accounts) acctById.set(a.id, a);
  const bucketKey = (a) => a.aws_account_id ? `child:${a.aws_account_id}` : `dbid:${a.id}`;
  const map = new Map();
  for (const a of accounts) {
    const k = bucketKey(a);
    if (!map.has(k)) {
      map.set(k, {
        key: k, childAccountId: a.aws_account_id || null,
        accountName: _stripPayerSuffix(a.name),
        isManual: a.is_manual || false, isNoKey: a.is_manual || false,
        contractDate: a.contract_date, records: [], dbAccountIds: new Set([a.id]),
      });
    } else {
      const b = map.get(k);
      b.dbAccountIds.add(a.id);
      if (a.contract_date && (!b.contractDate || a.contract_date < b.contractDate))
        b.contractDate = a.contract_date;
    }
  }
  const orphans = [];
  for (const r of records) {
    if (!r.aws_account_id) { orphans.push(r); continue; }
    const a = acctById.get(r.aws_account_id);
    const k = a ? bucketKey(a) : `dbid:${r.aws_account_id}`;
    if (map.has(k)) {
      map.get(k).records.push(r);
    } else {
      map.set(k, {
        key: k, childAccountId: r.aws_child_account_id || null,
        accountName: r.aws_account_name || `Account #${r.aws_account_id}`,
        isManual: false, isNoKey: false,
        contractDate: r.contract_date, records: [r], dbAccountIds: new Set([r.aws_account_id]),
      });
    }
  }
  for (const b of map.values())
    b.records.sort((a, b) => new Date(a.consumption_month) - new Date(b.consumption_month));
  const buckets = [...map.values()].sort((a, b) => {
    if (a.isNoKey && !b.isNoKey) return 1;
    if (!a.isNoKey && b.isNoKey) return -1;
    return (a.accountName || "").localeCompare(b.accountName || "");
  });
  if (orphans.length > 0) {
    orphans.sort((a, b) => new Date(a.consumption_month) - new Date(b.consumption_month));
    if (orphans.some(r => r.cloud_service_cost > 0 || r.marketplace_cost > 0)) {
      buckets.push({
        key: "manual", childAccountId: null, accountName: "Manual Entries",
        isManual: true, isNoKey: true, contractDate: null, records: orphans,
        dbAccountIds: new Set(),
      });
    }
  }
  return buckets;
}

function _stripPayerSuffix(name) {
  if (!name) return name;
  return name.replace(/\s*[—–-]\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{4}|Mgmt|Payer|Old|New).*/i, "").trim() || name;
}

function sumBucket(records) {
  return records.reduce((acc, r) => ({
    cloud_service_cost:       acc.cloud_service_cost       + r.cloud_service_cost,
    marketplace_cost:         acc.marketplace_cost         + r.marketplace_cost,
    total_consumption:        acc.total_consumption        + r.total_consumption,
    distributor_discount_amt: acc.distributor_discount_amt + (r.distributor_discount_amt || 0),
    credit_amount:            acc.credit_amount            + r.credit_amount,
    customer_discount_amt:    acc.customer_discount_amt    + (r.customer_discount_amt    || 0),
    managed_services_amt:     acc.managed_services_amt     + (r.managed_services_amt     || 0),
    cash_claim:               acc.cash_claim               + r.cash_claim,
    redington_credit_note:    acc.redington_credit_note    + r.redington_credit_note,
    ilios_spend:              acc.ilios_spend              + r.ilios_spend,
    invoice_to_customer:      acc.invoice_to_customer      + r.invoice_to_customer,
    ilios_margin:             acc.ilios_margin             + r.ilios_margin,
    total_consumption_inr:    acc.total_consumption_inr    + (r.total_consumption_inr    || 0),
    ilios_spend_inr:          acc.ilios_spend_inr          + (r.ilios_spend_inr          || 0),
    invoice_to_customer_inr:  acc.invoice_to_customer_inr  + (r.invoice_to_customer_inr  || 0),
    ilios_margin_inr:         acc.ilios_margin_inr         + (r.ilios_margin_inr         || 0),
  }), {
    cloud_service_cost: 0, marketplace_cost: 0, total_consumption: 0,
    distributor_discount_amt: 0, credit_amount: 0, customer_discount_amt: 0,
    managed_services_amt: 0, cash_claim: 0, redington_credit_note: 0,
    ilios_spend: 0, invoice_to_customer: 0, ilios_margin: 0,
    total_consumption_inr: 0, ilios_spend_inr: 0,
    invoice_to_customer_inr: 0, ilios_margin_inr: 0,
  });
}

function MasterEditModal({ bucket, onSaved, onClose }) {
  const existing = bucket.records[0] || {};
  const [form, setForm] = useState({
    distributor_discount: existing.distributor_discount ?? "",
    customer_discount:    existing.customer_discount    ?? "",
    managed_services:     existing.managed_services     ?? "",
    conversion_rate:      existing.conversion_rate      ?? "",
  });
  const [applyTo, setApplyTo] = useState("all");
  const [saving, setSaving]   = useState(false);
  const [result, setResult]   = useState(null);
  const accountId = bucket.records[0]?.aws_account_id || null;

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
            <p className="master-edit-sub">Apply discounts to all <strong>{bucket.records.length}</strong> months at once.</p>
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
              { f:"customer_discount",    label:"Customer Discount",    hint:"% of Total",      sfx:"%" },
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

function AddManualAccountPanel({ onSaved, onClose }) {
  const [name, setName]               = useState("");
  const [contractDate, setContractDate] = useState("");
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState(null);
  const [successMsg, setSuccessMsg]   = useState(null);

  const handleCreate = async e => {
    e.preventDefault();
    if (!name.trim() || !contractDate) { setError("Name and contract date are required."); return; }
    setSaving(true); setError(null); setSuccessMsg(null);
    try {
      const { data } = await createAwsAccount({ name: name.trim(), contract_date: contractDate, is_manual: true, is_active: true });
      setSuccessMsg(`"${data.name}" created. Add another or close.`);
      setName(""); setContractDate("");
      onSaved(data);
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to create account.");
    } finally { setSaving(false); }
  };

  return (
    <div className="inline-add-panel">
      <h4><FileText size={14} style={{marginRight:6}}/>Add Manual Account (no AWS keys required)</h4>
      {error      && <p className="inline-error">{error}</p>}
      {successMsg && <p className="inline-success">{successMsg}</p>}
      <form onSubmit={handleCreate} className="inline-add-form">
        <div className="inline-field">
          <label>Account Name *</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. DoTE" autoFocus />
        </div>
        <div className="inline-field">
          <label>Contract Date *</label>
          <input type="date" value={contractDate} onChange={e => setContractDate(e.target.value)} />
        </div>
        <div className="inline-actions">
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Creating…" : "Create Account"}</button>
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </form>
      <p className="inline-hint">After creating, click <strong>+ New Entry</strong> to add monthly records.</p>
    </div>
  );
}

// ── Group records by consumption_month ───────────────────────────────────────
// Returns array of month-groups, each with:
//   { month, records[], isSplit, groupId, combined (summed totals) }
function groupByMonth(records) {
  const map = new Map();
  for (const r of records) {
    const m = r.consumption_month;
    if (!map.has(m)) map.set(m, []);
    map.get(m).push(r);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, recs]) => ({
      month,
      records: recs,
      isSplit: recs.length > 1 || recs.some(r => r.is_split),
      groupId: recs.find(r => r.split_month_group)?.split_month_group || null,
      combined: sumBucket(recs),
    }));
}

// ── Split badge ───────────────────────────────────────────────────────────────
function SplitBadge() {
  return (
    <span className="split-badge" title="Mid-month payer change — multiple rows for this month">
      <GitBranch size={10}/> Split
    </span>
  );
}

// ── Single month row (used for normal rows and individual split segments) ─────
function MonthRow({ r, showInr, onEdit, onDelete, isSplitSegment = false }) {
  return (
    <tr key={r.id} className={isSplitSegment ? "split-segment-row" : ""}>
      <td className="month-cell">
        {isSplitSegment ? (
          <span className="split-seg-indent">
            <span className="split-seg-payer" title="Payer account">
              {r.cost_data_source || "—"}
            </span>
          </span>
        ) : r.consumption_month}
      </td>
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
      <td>
        <span className={`source-badge ${r.is_auto_fetched ? "auto" : "manual"}`}>
          {r.is_auto_fetched ? "AWS" : "Manual"}
        </span>
        {r.cost_status && r.cost_status !== "manual" && (
          <span className={`status-badge status-${r.cost_status}`}
            title={r.cost_data_source ? `Payer: ${r.cost_data_source}` : ""}>
            {r.cost_status === "fetched"     ? <CheckCircle size={11}/>   :
             r.cost_status === "preserved"   ? <ShieldCheck size={11}/>   :
             r.cost_status === "unavailable" ? <AlertTriangle size={11}/> : null}
          </span>
        )}
      </td>
      <td className="remarks-cell">{r.remarks || "—"}</td>
      <td className="action-cell">
        <button className="btn-icon" onClick={() => onEdit(r.id)} title="Edit"><Pencil size={14}/></button>
        <button className="btn-icon danger" onClick={() => onDelete(r.id)} title="Delete"><Trash2 size={14}/></button>
      </td>
    </tr>
  );
}

// ── Split month group row ─────────────────────────────────────────────────────
function SplitMonthGroup({ group, showInr, onEdit, onDelete, onRefresh }) {
  const [expanded, setExpanded] = useState(true);
  const [merging, setMerging]   = useState(false);
  const { toast } = useToast();
  const c = group.combined;

  const handleMerge = async (e) => {
    e.stopPropagation();
    if (!group.groupId) return;
    setMerging(true);
    try {
      await mergeSplitGroup(group.groupId);
      toast.success(`Split rows for ${group.month} merged into one record.`);
      onRefresh();
    } catch (err) {
      toast.error(err?.response?.data?.error || "Merge failed.");
    } finally { setMerging(false); }
  };

  return (
    <>
      {/* Combined summary row */}
      <tr className="split-combined-row" onClick={() => setExpanded(v => !v)} style={{ cursor: "pointer" }}>
        <td className="month-cell">
          <span className="split-month-toggle">{expanded ? "▾" : "▸"}</span>
          {group.month}
          <SplitBadge />
        </td>
        <td>—</td>
        <td>{formatCurrency(c.cloud_service_cost)}</td>
        <td>{formatCurrency(c.marketplace_cost)}</td>
        <td><strong>{formatCurrency(c.total_consumption)}</strong></td>
        <td className="pct-cell">—</td>
        <td>{formatCurrency(c.distributor_discount_amt)}</td>
        <td>{formatCurrency(c.credit_amount)}</td>
        <td className="pct-cell">—</td>
        <td>{formatCurrency(c.customer_discount_amt)}</td>
        <td className="pct-cell">—</td>
        <td>{formatCurrency(c.managed_services_amt)}</td>
        <td>{formatCurrency(c.cash_claim)}</td>
        <td className="rate-cell">—</td>
        <td>{formatCurrency(c.redington_credit_note)}</td>
        <td>{formatCurrency(c.ilios_spend)}</td>
        <td>{formatCurrency(c.invoice_to_customer)}</td>
        <td className={c.ilios_margin >= 0 ? "positive" : "negative"}>{formatCurrency(c.ilios_margin)}</td>
        {showInr && <>
          <td>{formatINR(c.total_consumption_inr)}</td>
          <td>{formatINR(c.ilios_spend_inr)}</td>
          <td>{formatINR(c.invoice_to_customer_inr)}</td>
          <td className={c.ilios_margin_inr >= 0 ? "positive" : "negative"}>{formatINR(c.ilios_margin_inr)}</td>
        </>}
        <td>
          <span className="source-badge auto">AWS</span>
          <SplitBadge />
        </td>
        <td className="remarks-cell">
          {group.records.map(r => r.cost_data_source).filter(Boolean).join(" + ")}
        </td>
        <td className="action-cell" onClick={e => e.stopPropagation()}>
          {group.groupId && (
            <button className="btn-icon merge" onClick={handleMerge}
              disabled={merging} title="Merge all split segments into one combined record">
              <Merge size={13}/>{merging ? "…" : ""}
            </button>
          )}
        </td>
      </tr>

      {/* Individual payer segment rows (expanded) */}
      {expanded && group.records.map(r => (
        <MonthRow key={r.id} r={r} showInr={showInr}
          onEdit={onEdit} onDelete={onDelete}
          isSplitSegment={true} />
      ))}
    </>
  );
}

function AccountSection({ bucket, onEdit, onDelete, onRefresh }) {
  const [open, setOpen]             = useState(false);
  const [showInr, setShowInr]       = useState(false);
  const [masterEdit, setMasterEdit] = useState(false);
  const totals = sumBucket(bucket.records);

  // Count unique months (split months count as 1 month not 2 records)
  const monthGroups    = groupByMonth(bucket.records);
  const uniqueMonthCnt = monthGroups.length;
  const splitMonthCnt  = monthGroups.filter(g => g.isSplit).length;

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
                ? <><FileText size={14} className="acct-icon"/>&nbsp;{bucket.accountName}</>
                : <><Cloud size={14} className="acct-icon"/>&nbsp;{bucket.accountName}</>}
            </span>
            <div className="account-info-row">
              {bucket.childAccountId && (
                <span className="child-account-id" title="AWS Child Account ID">Account: {bucket.childAccountId}</span>
              )}
              <span className="record-count">
                {uniqueMonthCnt} month{uniqueMonthCnt !== 1 ? "s" : ""}
              </span>
              {splitMonthCnt > 0 && (
                <span className="split-count-badge" title="Months with mid-month payer change">
                  <GitBranch size={10}/> {splitMonthCnt} split
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="account-header-totals">
          {METRICS.map(m => (
            <span key={m.label} className="hdr-metric">
              <span className="hdr-label">{m.label}</span>
              <span className={`hdr-value ${m.sign ? (m.v >= 0 ? "positive" : "negative") : ""}`}>
                {formatCurrency(m.v)}
              </span>
              {m.vi > 0 && <span className="hdr-inr">{formatINR(m.vi)}</span>}
            </span>
          ))}
        </div>

        <button className="btn-master-edit-icon" title="Edit discounts"
          onClick={e => { e.stopPropagation(); setMasterEdit(true); }}>
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
            {splitMonthCnt > 0 && (
              <span className="toolbar-split-hint">
                <GitBranch size={11}/> {splitMonthCnt} split month{splitMonthCnt > 1 ? "s" : ""} — click row to expand / use Merge to combine
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
                <th>Source</th><th>Payer / Remarks</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {monthGroups.map(group =>
                group.isSplit ? (
                  <SplitMonthGroup
                    key={group.month}
                    group={group}
                    showInr={showInr}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onRefresh={onRefresh}
                  />
                ) : (
                  <MonthRow
                    key={group.records[0].id}
                    r={group.records[0]}
                    showInr={showInr}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                )
              )}
              {/* Subtotal row */}
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

      {masterEdit && (
        <MasterEditModal bucket={bucket}
          onSaved={() => { setMasterEdit(false); onRefresh(); }}
          onClose={() => setMasterEdit(false)}/>
      )}
    </div>
  );
}

export default function RecordList() {
  const [records, setRecords]     = useState([]);
  const [accounts, setAccounts]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [fromDate, setFromDate]   = useState("");
  const [toDate, setToDate]       = useState("");
  const [confirmDel, setConfirmDel] = useState(null);
  const [showManual, setShowManual] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

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
  const grand   = sumBucket(records);

  return (
    <div className="records-page">
      <div className="page-header">
        <h1>Cost Records</h1>
        <div className="header-actions">
          <div className="filter-row">
            <label>From<input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}/></label>
            <label>To  <input type="date" value={toDate}   onChange={e => setToDate(e.target.value)}/></label>
            <button onClick={fetchData} className="btn-primary">Filter</button>
            <button onClick={() => { setFromDate(""); setToDate(""); }} className="btn-secondary">Clear</button>
          </div>
          <div className="header-btns">
            <button className="btn-manual-add" onClick={() => setShowManual(v => !v)}>
              <PlusCircle size={14}/>&nbsp;Manual Account
            </button>
            <Link to="/records/new" className="btn-primary"><PlusCircle size={14}/>&nbsp;New Entry</Link>
          </div>
        </div>
      </div>

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
                    {formatCurrency(m.usd)}
                  </span>
                  {m.inr > 0 && <span className="gt-metric-inr">{formatINR(m.inr)}</span>}
                </div>
              ))}
            </div>
          </div>

          <div className="accounts-list">
            {buckets.map(b => (
              <AccountSection key={b.key} bucket={b}
                onEdit={id => navigate(`/records/${id}/edit`)}
                onDelete={handleDelete}
                onRefresh={fetchData}/>
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
    </div>
  );
}
