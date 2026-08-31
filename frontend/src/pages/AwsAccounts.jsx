import React, { useEffect, useState, useCallback } from "react";
import {
  getAwsAccounts,
  createAwsAccount,
  updateAwsAccount,
  deleteAwsAccount,
  fetchAwsCosts,
  importCur,
  diagnoseCur,
} from "../api";
import { useToast } from "../components/Toast";
import {
  Cloud, Download, Pencil, Trash2,
  Eye, EyeOff, X, ClipboardList, Lock,
  CheckCircle, AlertTriangle, Plus, Loader2,
  ShieldCheck, Database, FileDown, Search, RefreshCw,
} from "lucide-react";
import "./AwsAccounts.css";

const AWS_REGIONS = [
  "us-east-1","us-east-2","us-west-1","us-west-2",
  "ap-south-1","ap-southeast-1","ap-southeast-2",
  "ap-northeast-1","ap-northeast-2","ap-northeast-3",
  "eu-west-1","eu-west-2","eu-west-3","eu-central-1",
  "eu-north-1","sa-east-1","ca-central-1","me-south-1",
];

const CSP_OPTIONS = [
  { value: "AWS",   label: "Amazon Web Services (AWS)" },
  { value: "GCP",   label: "Google Cloud Platform (GCP)" },
  { value: "Azure", label: "Microsoft Azure" },
];

const EMPTY_FORM = {
  name: "", aws_account_id: "", access_key_id: "",
  secret_access_key: "", region: "us-east-1",
  contract_date: "", is_active: true, is_manual: false,
  csp: "AWS",
  s3_cur_bucket: "", s3_cur_prefix: "", s3_cur_region: "us-east-1",
};

// ── Account Form Modal ─────────────────────────────────────────────────────────
function AccountModal({ initial, onSave, onClose }) {
  const isEdit = Boolean(initial?.id);
  const [form, setForm] = useState(
    initial ? {
      name:              initial.name           ?? "",
      aws_account_id:    initial.aws_account_id ?? "",
      access_key_id:     "",
      secret_access_key: "",
      region:            initial.region         ?? "us-east-1",
      contract_date:     initial.contract_date  ?? "",
      is_active:         initial.is_active      ?? true,
      is_manual:         initial.is_manual      ?? false,
      csp:               initial.csp            ?? "AWS",
      s3_cur_bucket:     initial.s3_cur_bucket  ?? "",
      s3_cur_prefix:     initial.s3_cur_prefix  ?? "",
      s3_cur_region:     initial.s3_cur_region  ?? initial.region ?? "us-east-1",
    } : { ...EMPTY_FORM }
  );
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  const handleChange = e => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const handleSubmit = async e => {
    e.preventDefault();
    setSaving(true); setError(null);
    const payload = {
      name:          form.name,
      aws_account_id: form.aws_account_id || null,
      region:        form.region,
      contract_date: form.contract_date,
      is_active:     form.is_active,
      is_manual:     form.is_manual,
      csp:           form.csp,
      s3_cur_bucket: form.s3_cur_bucket || null,
      s3_cur_prefix: form.s3_cur_prefix || null,
      s3_cur_region: form.s3_cur_region || null,
    };
    if (!form.is_manual) {
      if (form.access_key_id)     payload.access_key_id     = form.access_key_id;
      if (form.secret_access_key) payload.secret_access_key = form.secret_access_key;
    }
    try {
      isEdit
        ? await updateAwsAccount(initial.id, payload)
        : await createAwsAccount(payload);
      onSave();
    } catch (err) {
      const d = err?.response?.data;
      setError(d?.error || err?.message || "Save failed.");
    } finally {
      setSaving(false);
      setForm(prev => ({ ...prev, secret_access_key: "" }));
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-box">
        <div className="modal-header">
          <h2>{isEdit ? "Edit Account" : "Add Account"}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleSubmit} noValidate autoComplete="off">
          {/* Account Details */}
          <fieldset>
            <legend>Account Details</legend>
            <div className="field-row">
              <div className="field">
                <label htmlFor="name">Account Name *</label>
                <input id="name" name="name" type="text" value={form.name}
                  onChange={handleChange} required placeholder="e.g. WeAlwin" />
              </div>
              <div className="field">
                <label htmlFor="aws_account_id">AWS Account ID</label>
                <input id="aws_account_id" name="aws_account_id" type="text"
                  value={form.aws_account_id} onChange={handleChange}
                  placeholder="12-digit account ID" maxLength={12} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="contract_date">Contract Date *</label>
                <input id="contract_date" name="contract_date" type="date"
                  value={form.contract_date} onChange={handleChange} required />
              </div>
              <div className="field">
                <label htmlFor="csp">Cloud Provider</label>
                <select id="csp" name="csp" value={form.csp} onChange={handleChange}>
                  {CSP_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field-row">
              {!form.is_manual && (
                <div className="field">
                  <label htmlFor="region">Region</label>
                  <select id="region" name="region" value={form.region} onChange={handleChange}>
                    {AWS_REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              )}
              <div className="field field-checkbox">
                <label>
                  <input type="checkbox" name="is_manual" checked={form.is_manual} onChange={handleChange} />
                  Manual Account (no AWS keys)
                </label>
              </div>
              <div className="field field-checkbox">
                <label>
                  <input type="checkbox" name="is_active" checked={form.is_active} onChange={handleChange} />
                  Active
                </label>
              </div>
            </div>
          </fieldset>

          {/* IAM Credentials — only for non-manual accounts */}
          {!form.is_manual && (
            <fieldset>
              <legend>
                IAM Credentials
                {isEdit && <span className="legend-hint">Leave blank to keep existing keys</span>}
              </legend>
              <div className="credentials-notice">
                <Lock size={13} /> Keys are encrypted with AES-256 before being stored.
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="access_key_id">Access Key ID {!isEdit && "*"}</label>
                  <input id="access_key_id" name="access_key_id" type="text"
                    value={form.access_key_id} onChange={handleChange}
                    required={!isEdit}
                    placeholder={isEdit ? "Enter new key to rotate..." : "AKIAIOSFODNN7EXAMPLE"}
                    autoComplete="off" spellCheck={false} />
                </div>
              </div>
              <div className="field-row">
                <div className="field field-wide">
                  <label htmlFor="secret_access_key">Secret Access Key {!isEdit && "*"}</label>
                  <div className="secret-wrapper">
                    <input id="secret_access_key" name="secret_access_key"
                      type={showSecret ? "text" : "password"}
                      value={form.secret_access_key} onChange={handleChange}
                      required={!isEdit}
                      placeholder={isEdit ? "Enter new secret to rotate..." : "wJalrX..."}
                      autoComplete="new-password" spellCheck={false} />
                    <button type="button" className="toggle-secret"
                      onClick={() => setShowSecret(v => !v)}
                      aria-label={showSecret ? "Hide" : "Show"}>
                      {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              </div>
            </fieldset>
          )}

          {form.is_manual && (
            <div className="manual-notice">
              <Pencil size={14} /> No AWS keys needed. Enter monthly costs manually in Records.
            </div>
          )}

          {/* CUR S3 configuration */}
          <fieldset>
            <legend>
              <Database size={12} style={{ marginRight: 5, verticalAlign: "middle" }} />
              CUR S3 Export
              <span className="legend-hint" style={{ marginLeft: 8 }}>
                optional — used when Cost Explorer returns $0 for historical months
              </span>
            </legend>
            <div className="credentials-notice">
              <Lock size={12} /> IAM policy needs <code>s3:GetObject</code> and <code>s3:ListBucket</code> on the bucket.
              Leave blank if not using CUR.
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="s3_cur_bucket">S3 Bucket Name</label>
                <input id="s3_cur_bucket" name="s3_cur_bucket" type="text"
                  value={form.s3_cur_bucket} onChange={handleChange}
                  placeholder="e.g. cloud-p-l" />
              </div>
              <div className="field">
                <label htmlFor="s3_cur_prefix">
                  S3 Prefix / Path
                  <span className="legend-hint" style={{ marginLeft: 6 }}>folder inside bucket</span>
                </label>
                <input id="s3_cur_prefix" name="s3_cur_prefix" type="text"
                  value={form.s3_cur_prefix} onChange={handleChange}
                  placeholder="e.g. wealwin/" />
              </div>
              <div className="field">
                <label htmlFor="s3_cur_region">S3 Region</label>
                <select id="s3_cur_region" name="s3_cur_region"
                  value={form.s3_cur_region} onChange={handleChange}>
                  {AWS_REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            {form.s3_cur_bucket && (
              <div className="cur-path-preview">
                s3://<strong>{form.s3_cur_bucket}</strong>/{form.s3_cur_prefix || ""}
              </div>
            )}
          </fieldset>

          <div className="modal-actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <><Loader2 size={14} className="spin-icon" /> Saving...</> : isEdit ? "Update Account" : "Add Account"}
            </button>
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Fetch Result Panel ─────────────────────────────────────────────────────────
function FetchResult({ result, account, onClose, onOpenCurImport, onOpenEditModal }) {
  if (!result) return null;
  const isError = Boolean(result.error);
  const summary = result.summary || {};
  const months  = result.months  || [];

  const zeroMonths = months.filter(m => m.status === "zero" || m.status === "unavailable");
  const hasZero = zeroMonths.length > 0 || (summary.zero || 0) > 0 || (summary.unavailable || 0) > 0;
  const zeroCount = zeroMonths.length || ((summary.zero || 0) + (summary.unavailable || 0));

  const statusClass = {
    fetched:"badge-fetched", preserved:"badge-preserved",
    unavailable:"badge-unavailable", zero:"badge-zero",
    inserted:"badge-fetched", updated:"badge-fetched", split:"badge-preserved",
  };

  const StatusIcon = ({ status }) => {
    if (["fetched","inserted","updated"].includes(status)) return <CheckCircle size={11} />;
    if (status === "unavailable" || status === "zero")     return <AlertTriangle size={11} />;
    if (status === "preserved")                            return <ShieldCheck size={11} />;
    return null;
  };

  return (
    <div className={`fetch-result ${isError ? "fetch-error" : "fetch-success"}`}>
      <button className="fetch-close" onClick={onClose} aria-label="Close"><X size={14} /></button>

      {isError ? (
        <p style={{ whiteSpace: "pre-wrap" }}>
          <AlertTriangle size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
          {result.error}
        </p>
      ) : (
        <>
          <div className="fetch-summary-bar">
            {[
              { label: "Fetched",     val: summary.fetched,     cls: "sum-fetched" },
              { label: "Updated",     val: summary.updated,     cls: "sum-fetched" },
              { label: "Inserted",    val: summary.inserted,    cls: "sum-fetched" },
              { label: "Preserved",   val: summary.preserved,   cls: "sum-preserved" },
              { label: "Skipped",     val: summary.skipped,     cls: "sum-preserved" },
              { label: "Unavailable", val: summary.unavailable, cls: "sum-unavail" },
              { label: "Zero",        val: summary.zero,        cls: "sum-unavail" },
            ].filter(s => s.val > 0).map(s => (
              <span key={s.label} className={`sum-chip ${s.cls}`}>{s.label}: {s.val}</span>
            ))}
          </div>

          {months.length > 0 && (
            <div className="fetch-table-wrap">
              <table className="fetch-table">
                <thead>
                  <tr>
                    <th className="ft-month">Month</th>
                    <th className="ft-status">Status</th>
                    <th className="ft-cost">Cloud Cost</th>
                    <th className="ft-cost">Marketplace</th>
                    <th className="ft-note">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map(m => (
                    <tr key={m.month} className={`fetch-row-${m.status}`}>
                      <td className="ft-month"><strong>{m.month?.slice(0,7)}</strong></td>
                      <td className="ft-status">
                        <span className={`badge ${statusClass[m.status] || ""}`}>
                          <StatusIcon status={m.status} /> {m.action || m.status}
                        </span>
                      </td>
                      <td className="ft-cost cost-cell">
                        {m.cloud_service_cost != null ? `$${Number(m.cloud_service_cost).toFixed(2)}` : "—"}
                      </td>
                      <td className={`ft-cost cost-cell ${m.marketplace_cost > 0 ? "mp-highlight" : ""}`}>
                        {m.marketplace_cost != null ? `$${Number(m.marketplace_cost).toFixed(2)}` : "—"}
                      </td>
                      <td className="ft-note">{m.reason || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {hasZero && (
            <div className="cur-activation-hint">
              <div className="cur-hint-header">
                <Database size={15} className="cur-hint-icon" />
                <strong>{zeroCount} month(s) returned $0 from Cost Explorer</strong>
                <span className="cur-hint-reason">— distributor changed management account</span>
              </div>
              {account?.s3_cur_bucket ? (
                <div className="cur-hint-body cur-hint-configured">
                  <CheckCircle size={13} style={{ color: "#16a34a", flexShrink: 0 }} />
                  <div>
                    CUR S3 configured: <code>{account.s3_cur_bucket}/{account.s3_cur_prefix || ""}</code>
                    <br />
                    <button className="cur-hint-action-btn" onClick={onOpenCurImport}>
                      <FileDown size={13} /> Import CUR now to fill these {zeroCount} month(s)
                    </button>
                  </div>
                </div>
              ) : (
                <div className="cur-hint-body">
                  <div className="cur-hint-steps">
                    <div className="cur-hint-step">
                      <span className="cur-step-num">1</span>
                      <div>
                        <button className="cur-hint-action-btn cur-hint-action-sm" onClick={onOpenEditModal}>
                          <Pencil size={12} /> Open Edit Account
                        </button>
                      </div>
                    </div>
                    <div className="cur-hint-step">
                      <span className="cur-step-num">2</span>
                      <span>Scroll to <strong>CUR S3 Export</strong> → enter your <strong>S3 Bucket</strong> and <strong>Prefix</strong> → Save</span>
                    </div>
                    <div className="cur-hint-step">
                      <span className="cur-step-num">3</span>
                      <span>Click the <strong>Import CUR</strong> button that appears in this account&apos;s row</span>
                    </div>
                  </div>
                  <p style={{ fontSize: "0.75rem", color: "#92400e", marginTop: 8 }}>
                    Or enter the missing months manually via <strong>Records → New Entry</strong>.
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── CUR Import Modal ───────────────────────────────────────────────────────────
function CurImportModal({ account, onClose }) {
  const [activeTab, setActiveTab]   = useState("import");
  const [form, setForm]             = useState({ from_month: "", to_month: "", overwrite_fetched: false });
  const [importing, setImporting]   = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [result, setResult]         = useState(null);
  const [diagResult, setDiagResult] = useState(null);
  const [error, setError]           = useState(null);
  const { toast } = useToast();

  const handleChange = e => {
    const { name, value, type, checked } = e.target;
    setForm(p => ({ ...p, [name]: type === "checkbox" ? checked : value }));
  };

  const handleImport = async e => {
    e.preventDefault();
    setImporting(true); setError(null); setResult(null);
    const payload = { overwrite_fetched: form.overwrite_fetched };
    if (form.from_month) payload.from_month = form.from_month;
    if (form.to_month)   payload.to_month   = form.to_month;
    try {
      const { data } = await importCur(account.id, payload);
      setResult(data);
      toast.success(`CUR import complete — ${data.summary.inserted} inserted, ${data.summary.updated} updated.`);
    } catch (err) {
      setError(err?.response?.data?.error || "CUR import failed.");
    } finally { setImporting(false); }
  };

  const handleDiagnose = async () => {
    setDiagnosing(true); setDiagResult(null); setError(null);
    try {
      const { data } = await diagnoseCur(account.id);
      setDiagResult(data);
    } catch (err) {
      setError(err?.response?.data?.error || "Diagnose failed.");
    } finally { setDiagnosing(false); }
  };

  const s = result?.summary;
  const d = diagResult;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-box modal-box-wide">
        <div className="modal-header">
          <div>
            <h2><FileDown size={16} style={{ marginRight: 8, verticalAlign: "middle" }} />
              CUR S3 — {account.name}
            </h2>
            <p className="modal-subtitle">
              <code>s3://{account.s3_cur_bucket}/{account.s3_cur_prefix || ""}</code>
            </p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="account-type-tabs" style={{ marginBottom: 16 }}>
          <button className={`type-tab ${activeTab === "import" ? "active" : ""}`}
            type="button" onClick={() => setActiveTab("import")}>
            <FileDown size={13} /> Import
          </button>
          <button className={`type-tab ${activeTab === "diagnose" ? "active" : ""}`}
            type="button" onClick={() => { setActiveTab("diagnose"); if (!diagResult) handleDiagnose(); }}>
            <Database size={13} /> Diagnose S3 Files
          </button>
        </div>

        {error && <div className="error-msg">{error}</div>}

        {activeTab === "import" && !result && (
          <form onSubmit={handleImport} autoComplete="off">
            <fieldset>
              <legend>Date Range (optional — leave blank for all months)</legend>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="cur_from">From Month</label>
                  <input id="cur_from" name="from_month" type="month"
                    value={form.from_month} onChange={handleChange} placeholder="2024-01" />
                </div>
                <div className="field">
                  <label htmlFor="cur_to">To Month</label>
                  <input id="cur_to" name="to_month" type="month"
                    value={form.to_month} onChange={handleChange} placeholder="2024-12" />
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem", cursor: "pointer" }}>
                  <input type="checkbox" name="overwrite_fetched"
                    checked={form.overwrite_fetched} onChange={handleChange} />
                  Overwrite months that already have Cost Explorer data
                  <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>(skipped by default)</span>
                </label>
              </div>
            </fieldset>
            <div className="modal-actions">
              <button type="submit" className="btn-primary" disabled={importing}>
                {importing ? <><Loader2 size={14} className="spin-icon" /> Importing...</> : <><FileDown size={14} /> Import from CUR</>}
              </button>
              <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}

        {activeTab === "import" && result && (
          <>
            <div className="cur-result-box">
              <p className="cur-result-msg">{result.message}</p>
              <div className="cur-result-chips">
                {[
                  { label:"Inserted",  val:s.inserted,  cls:"sum-fetched" },
                  { label:"Updated",   val:s.updated,   cls:"sum-fetched" },
                  { label:"Skipped",   val:s.skipped,   cls:"sum-preserved" },
                  { label:"Preserved", val:s.preserved, cls:"sum-preserved" },
                  { label:"Zero",      val:s.zero,      cls:"sum-unavail" },
                ].filter(c => c.val > 0).map(c => (
                  <span key={c.label} className={`sum-chip ${c.cls}`}>{c.label}: {c.val}</span>
                ))}
              </div>
              {result.months?.length > 0 && (
                <table className="cur-months-table">
                  <thead>
                    <tr><th>Month</th><th>Status</th><th>Cloud Cost</th><th>Marketplace</th><th>Note</th></tr>
                  </thead>
                  <tbody>
                    {result.months.map(m => (
                      <tr key={m.month} className={`cur-row-${m.status}`}>
                        <td><strong>{m.month?.slice(0,7)}</strong></td>
                        <td><span className={`badge ${m.status==="cur"?"badge-fetched":m.status==="zero"?"badge-zero":"badge-preserved"}`}>
                          {m.status==="cur"?<CheckCircle size={10}/>:m.status==="skipped"?<ShieldCheck size={10}/>:null}
                          {" "}{m.action||m.status}
                        </span></td>
                        <td>{m.cloud_service_cost!=null?`$${Number(m.cloud_service_cost).toFixed(2)}`:"—"}</td>
                        <td>{m.marketplace_cost!=null?`$${Number(m.marketplace_cost).toFixed(2)}`:"—"}</td>
                        <td style={{ fontSize:"0.7rem", color:"#6b7280", whiteSpace:"normal" }}>{m.reason||""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="modal-actions"><button type="button" className="btn-secondary" onClick={onClose}>Close</button></div>
          </>
        )}

        {activeTab === "diagnose" && (
          <>
            <div style={{ display:"flex", gap:8, marginBottom:12 }}>
              <button className="btn-secondary" onClick={handleDiagnose} disabled={diagnosing}
                style={{ display:"flex", alignItems:"center", gap:6, fontSize:"0.82rem" }}>
                {diagnosing ? <><Loader2 size={13} className="spin-icon" /> Scanning...</> : <><RefreshCw size={13} /> Re-scan S3</>}
              </button>
            </div>
            {diagnosing && <div className="loading-msg"><Loader2 size={16} className="spin-icon" /> Scanning S3 files...</div>}
            {d && (
              <div className="diag-box">
                <div className="diag-section">
                  <span className="diag-label">Files found:</span>
                  <span className={`diag-value ${d.files_found?.length>0?"diag-ok":"diag-warn"}`}>{d.files_found?.length??0}</span>
                  {d.files_found?.length>0 && (
                    <div className="diag-file-list">
                      {d.files_found.map(f=>(
                        <div key={f.key} className="diag-file-row">
                          <code>{f.key}</code>
                          {f.billing_period&&<span className="diag-period">{f.billing_period}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="diag-section">
                  <span className="diag-label">Critical columns:</span>
                  <table className="diag-col-table"><tbody>
                    {Object.entries(d.col_map||{}).map(([k,v])=>(
                      <tr key={k}>
                        <td className="diag-col-key">{k}</td>
                        <td className={v?"diag-col-found":"diag-col-missing"}>
                          {v?<><CheckCircle size={11}/> {v}</>:<><AlertTriangle size={11}/> NOT FOUND</>}
                        </td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
                <div className="diag-section">
                  <span className="diag-label">Account IDs in file:</span>
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:4 }}>
                    {(d.account_id_values||[]).map(id=>(
                      <code key={id} style={{
                        background: id===d.linked_account_id?"#dcfce7":"#f1f5f9",
                        color: id===d.linked_account_id?"#166534":"#374151",
                        padding:"2px 8px", borderRadius:5, fontSize:"0.78rem"
                      }}>
                        {id}{id===d.linked_account_id?" ✓":""}
                      </code>
                    ))}
                  </div>
                </div>
                <div className="diag-section">
                  <span className="diag-label">Non-zero cost rows (first 200):</span>
                  <span className={`diag-value ${d.non_zero_cost_count>0?"diag-ok":"diag-warn"}`}>{d.non_zero_cost_count}</span>
                </div>
                {d.warnings?.length>0 && (
                  <div className="diag-section">
                    {d.warnings.map((w,i)=>(
                      <div key={i} className="diag-warning"><AlertTriangle size={12}/> {w}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="modal-actions" style={{ marginTop:12 }}>
              <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function AwsAccounts() {
  const [accounts, setAccounts]         = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [modal, setModal]               = useState(null);       // null | "new" | account
  const [curImportFor, setCurImportFor] = useState(null);
  const [fetchingId, setFetchingId]     = useState(null);
  const [fetchResults, setFetchResults] = useState({});
  const [confirmDel, setConfirmDel]     = useState(null);
  const [expandedId, setExpandedId]     = useState(null);
  const [search, setSearch]             = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data } = await getAwsAccounts();
      setAccounts(data);
    } catch { setError("Failed to load accounts."); }
    finally   { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = () => { setModal(null); load(); };

  const doDelete = async () => {
    const acc = confirmDel;
    setConfirmDel(null);
    try { await deleteAwsAccount(acc.id); load(); toast.success(`"${acc.name}" deleted.`); }
    catch { toast.error("Delete failed."); }
  };

  const handleFetch = async acc => {
    setFetchingId(acc.id);
    setFetchResults(prev => ({ ...prev, [acc.id]: null }));
    if (expandedId !== acc.id) setExpandedId(acc.id);
    try {
      const { data } = await fetchAwsCosts(acc.id);
      setFetchResults(prev => ({ ...prev, [acc.id]: data }));
    } catch (err) {
      const msg = err?.response?.data?.error || "Fetch failed. Check IAM credentials.";
      setFetchResults(prev => ({ ...prev, [acc.id]: { error: msg } }));
    } finally { setFetchingId(null); }
  };

  const filtered = accounts.filter(acc => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      acc.name.toLowerCase().includes(q) ||
      (acc.aws_account_id || "").includes(q);
    const matchStatus =
      filterStatus === "all" ||
      (filterStatus === "active"   && acc.is_active  && !acc.is_manual) ||
      (filterStatus === "inactive" && !acc.is_active) ||
      (filterStatus === "manual"   && acc.is_manual);
    return matchSearch && matchStatus;
  });

  return (
    <div className="aws-page">
      <div className="page-header">
        <h1>AWS Accounts</h1>
        <button className="btn-primary" onClick={() => setModal("new")}>
          <Plus size={14} /> Add Account
        </button>
      </div>

      {/* Search + filter toolbar */}
      <div className="aws-toolbar">
        <div className="aws-search-wrap">
          <Search size={13} />
          <input className="aws-search" placeholder="Search name or account ID..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {["all","active","inactive","manual"].map(f => (
          <button key={f}
            className={`aws-filter-btn ${filterStatus === f ? "active" : ""}`}
            onClick={() => setFilterStatus(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <span className="aws-count">{filtered.length} / {accounts.length}</span>
      </div>

      {loading && <div className="loading-msg"><Loader2 size={16} className="spin-icon" /> Loading...</div>}
      {error   && <div className="error-msg">{error}</div>}

      {!loading && accounts.length === 0 && (
        <div className="empty-state">
          <Cloud size={44} className="empty-icon-svg" />
          <p>No accounts configured yet.</p>
          <button className="btn-primary" onClick={() => setModal("new")}><Plus size={13} /> Add your first account</button>
        </div>
      )}

      {!loading && accounts.length > 0 && (
        <div className="accounts-table-wrap">
          <table className="accounts-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>Account</th>
                <th>Access Key</th>
                <th>Region</th>
                <th>Contract</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((acc, i) => {
                const isExpanded = expandedId === acc.id;
                const fetchRes   = fetchResults[acc.id];
                return (
                  <React.Fragment key={acc.id}>
                    <tr className={acc.is_active ? "" : "row-inactive"}
                      style={{ animationDelay: `${Math.min(i*0.025,0.4)}s` }}>

                      <td style={{ width:28, paddingRight:4 }}>
                        <button className="btn-expand"
                          onClick={() => setExpandedId(isExpanded ? null : acc.id)}
                          title={isExpanded ? "Collapse" : "Expand fetch results"}>
                          {isExpanded ? "▾" : "▸"}
                        </button>
                      </td>

                      <td>
                        <div className="acct-name">{acc.name}</div>
                        {acc.aws_account_id && <div className="acct-member-id">{acc.aws_account_id}</div>}
                        <div style={{ display:"flex", alignItems:"center", gap:5, marginTop:3, flexWrap:"wrap" }}>
                          <span className={`csp-badge csp-${(acc.csp||"AWS").toLowerCase()}`}>{acc.csp||"AWS"}</span>
                          {acc.s3_cur_bucket && (
                            <span className="cur-configured-badge" title={`CUR: s3://${acc.s3_cur_bucket}/${acc.s3_cur_prefix||""}`}>
                              <Database size={9} /> CUR
                            </span>
                          )}
                        </div>
                      </td>

                      <td><code className="masked-key">{acc.access_key_id_masked || "-"}</code></td>
                      <td><span className="region-chip">{acc.region || "-"}</span></td>
                      <td style={{ fontSize:"0.78rem", color:"#64748b" }}>{acc.contract_date || "-"}</td>

                      <td>
                        <span className={`status-badge ${acc.is_manual?"manual":acc.is_active?"active":"inactive"}`}>
                          {acc.is_manual?"Manual":acc.is_active?"Active":"Inactive"}
                        </span>
                      </td>

                      <td>
                        <div className="row-actions">
                          <button className="btn-act btn-act-fetch"
                            onClick={() => handleFetch(acc)}
                            disabled={fetchingId === acc.id || !acc.is_active || acc.is_manual}
                            title="Fetch costs from AWS Cost Explorer">
                            {fetchingId === acc.id
                              ? <Loader2 size={12} className="spin-icon" />
                              : <Download size={12} />}
                            Fetch
                          </button>
                          <button
                            className={`btn-act ${acc.s3_cur_bucket ? "btn-act-cur-import" : "btn-act-cur-setup"}`}
                            onClick={() => acc.s3_cur_bucket ? setCurImportFor(acc) : setModal(acc)}
                            title={acc.s3_cur_bucket
                              ? `Import from s3://${acc.s3_cur_bucket}/${acc.s3_cur_prefix||""}`
                              : "Set up CUR S3 to import historical months"}>
                            <FileDown size={12} />
                            {acc.s3_cur_bucket ? "Import CUR" : "Setup CUR"}
                          </button>
                          <button className="btn-act btn-act-edit"
                            onClick={() => setModal(acc)} title="Edit account">
                            <Pencil size={12} />
                          </button>
                          <button className="btn-act btn-act-delete"
                            onClick={() => setConfirmDel(acc)} title="Delete account">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="expanded-row">
                        <td colSpan={7}>
                          <div className="expanded-content">
                            {fetchRes !== undefined && (
                              <FetchResult
                                result={fetchRes}
                                account={acc}
                                onClose={() => setFetchResults(prev => { const n={...prev}; delete n[acc.id]; return n; })}
                                onOpenCurImport={() => setCurImportFor(acc)}
                                onOpenEditModal={() => setModal(acc)}
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign:"center", padding:"32px", color:"#94a3b8", fontSize:"0.82rem" }}>
                    No accounts match your search or filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* IAM Policy Reference */}
      <div className="info-panel">
        <h3><ClipboardList size={13} /> Required IAM Permissions</h3>
        <p>The customer account&apos;s IAM user needs this policy for <strong>Fetch Costs</strong>:</p>
        <pre className="iam-policy">{JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            { Sid:"CostExplorer", Effect:"Allow", Action:["ce:GetCostAndUsage","ce:GetDimensionValues"], Resource:"*" }
          ],
        }, null, 2)}</pre>
        <p style={{ marginTop:12 }}>For <strong>CUR S3 Import</strong>, add S3 read permissions:</p>
        <pre className="iam-policy">{JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            { Sid:"CurS3Read", Effect:"Allow", Action:["s3:GetObject","s3:ListBucket"],
              Resource:["arn:aws:s3:::YOUR-BUCKET","arn:aws:s3:::YOUR-BUCKET/*"] }
          ],
        }, null, 2)}</pre>
        <p className="info-note">
          If Cost Explorer returns $0 for some months (distributor changed management account),
          use <strong>Setup CUR</strong> → <strong>Import CUR</strong> to recover those months from S3.
          Or enter them manually in <strong>Records → New Entry</strong>.
        </p>
      </div>

      {/* Delete Confirmation */}
      {confirmDel && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-box" style={{ maxWidth:400 }}>
            <div className="modal-header">
              <h2><Trash2 size={14} style={{ marginRight:6, verticalAlign:"middle", color:"#dc2626" }} />Delete Account</h2>
              <button className="modal-close" onClick={() => setConfirmDel(null)}><X size={16} /></button>
            </div>
            <p style={{ color:"#475569", fontSize:"0.85rem", margin:"0 0 16px" }}>
              Delete <strong>{confirmDel.name}</strong>? This cannot be undone.
            </p>
            <div className="modal-actions">
              <button className="btn-danger" onClick={doDelete}><Trash2 size={13} /> Delete</button>
              <button className="btn-secondary" onClick={() => setConfirmDel(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {modal && <AccountModal initial={modal === "new" ? null : modal} onSave={handleSave} onClose={() => setModal(null)} />}
      {curImportFor && <CurImportModal account={curImportFor} onClose={() => setCurImportFor(null)} />}
    </div>
  );
}
