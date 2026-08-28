import React, { useEffect, useState, useCallback } from "react";
import {
  getAwsAccounts,
  createAwsAccount,
  updateAwsAccount,
  deleteAwsAccount,
  fetchAwsCosts,
  listChildAccounts,
  addChildAccount,
  addPayer,
  bulkSwitchPayer,
  activatePayer,
  deletePayer,
} from "../api";
import { useToast } from "../components/Toast";
import {
  Cloud, Download, Building2, RefreshCw, Pencil, Trash2,
  Eye, EyeOff, X, ClipboardList, Lock, CheckCircle,
  AlertTriangle, Plus, Loader2, ShieldCheck, KeyRound,
  ChevronDown, ChevronUp, History, Star, Search,
} from "lucide-react";
import "./AwsAccounts.css";

const AWS_REGIONS = [
  "us-east-1","us-east-2","us-west-1","us-west-2",
  "ap-south-1","ap-southeast-1","ap-southeast-2",
  "ap-northeast-1","ap-northeast-2","ap-northeast-3",
  "eu-west-1","eu-west-2","eu-west-3","eu-central-1",
  "eu-north-1","sa-east-1","ca-central-1","me-south-1",
];

const EMPTY_FORM = {
  name: "", aws_account_id: "", access_key_id: "",
  secret_access_key: "", region: "us-east-1",
  contract_date: "", is_active: true,
};

// ── Account Form Modal ────────────────────────────────────────────────────────
function AccountModal({ initial, onSave, onClose }) {
  const isEdit = Boolean(initial?.id);
  const [tab, setTab] = useState(initial?.is_manual ? "manual" : "aws");
  const [form, setForm] = useState(
    initial ? {
      name: initial.name ?? "",
      aws_account_id: initial.aws_account_id ?? "",
      access_key_id: "",
      secret_access_key: "",
      region: initial.region ?? "us-east-1",
      contract_date: initial.contract_date ?? "",
      is_active: initial.is_active ?? true,
      is_manual: initial.is_manual ?? false,
    } : { ...EMPTY_FORM, is_manual: false }
  );
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // When backend returns 409 (duplicate), offer to add new payer instead
  const [duplicateAccount, setDuplicateAccount] = useState(null);

  const handleChange = e => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const switchTab = t => {
    setTab(t);
    setForm(prev => ({ ...prev, is_manual: t === "manual" }));
  };

  const handleSubmit = async e => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setDuplicateAccount(null);
    const payload = {
      name: form.name,
      aws_account_id: form.aws_account_id,
      region: form.region,
      contract_date: form.contract_date,
      is_active: form.is_active,
      is_manual: form.is_manual,
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
      const status = err?.response?.status;
      const data   = err?.response?.data;
      if (status === 409 && data?.existing_account) {
        // Duplicate aws_account_id — offer to add payer instead
        setDuplicateAccount(data.existing_account);
        setError(data.error);
      } else {
        const s = data?.error;
        setError(s ? `[${status}] ${s}` : err?.message || "Save failed.");
      }
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

        {!isEdit && (
          <div className="account-type-tabs">
            <button className={`type-tab ${tab === "aws" ? "active" : ""}`} type="button" onClick={() => switchTab("aws")}>
              <Cloud size={14} /> AWS Account (with keys)
            </button>
            <button className={`type-tab ${tab === "manual" ? "active" : ""}`} type="button" onClick={() => switchTab("manual")}>
              <Pencil size={14} /> Manual Account (no keys)
            </button>
          </div>
        )}

        {error && (
          <div className="error-msg">
            {error}
            {duplicateAccount && (
              <p style={{ marginTop: 8, fontSize: "0.82rem" }}>
                <strong>Account:</strong> {duplicateAccount.name} (ID: {duplicateAccount.aws_account_id})<br />
                To add a new management account for this member account, use
                &ldquo;Add Payer&rdquo; on the existing account card.
              </p>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate autoComplete="off">
          <fieldset>
            <legend>Account Details</legend>
            <div className="field-row">
              <div className="field">
                <label htmlFor="name">Account Name *</label>
                <input id="name" name="name" type="text" value={form.name}
                  onChange={handleChange} required
                  placeholder={tab === "manual" ? "e.g. DoTE (Manual)" : "e.g. Production - ACME"} />
              </div>
              {tab === "aws" && (
                <div className="field">
                  <label htmlFor="aws_account_id">Member AWS Account ID</label>
                  <input id="aws_account_id" name="aws_account_id" type="text"
                    value={form.aws_account_id} onChange={handleChange}
                    placeholder="123456789012" maxLength={12} />
                </div>
              )}
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="contract_date">Contract Date *</label>
                <input id="contract_date" name="contract_date" type="date"
                  value={form.contract_date} onChange={handleChange} required />
              </div>
              {tab === "aws" && (
                <div className="field">
                  <label htmlFor="region">Region</label>
                  <select id="region" name="region" value={form.region} onChange={handleChange}>
                    {AWS_REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              )}
              <div className="field field-checkbox">
                <label>
                  <input type="checkbox" name="is_active" checked={form.is_active} onChange={handleChange} />
                  Active
                </label>
              </div>
            </div>
          </fieldset>

          {tab === "aws" && (
            <fieldset>
              <legend>
                Management Account IAM Credentials
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
                    required={!isEdit && tab === "aws"}
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
                      required={!isEdit && tab === "aws"}
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

          {tab === "manual" && (
            <div className="manual-notice">
              <Pencil size={14} /> This account has no AWS keys. Enter monthly costs manually
              using the <strong>+</strong> button in Records.
            </div>
          )}

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

// ── Add Payer Modal ───────────────────────────────────────────────────────────
function AddPayerModal({ account, allAccounts, onSaved, onClose }) {
  const activePayer = account.active_payer;

  // Count how many accounts share the same active payer_account_id
  const sharedAccounts = activePayer
    ? allAccounts.filter(a =>
        a.active_payer?.payer_account_id === activePayer.payer_account_id
      )
    : [account];

  const [form, setForm] = useState({
    payer_account_id: "",
    management_account_name: "",
    access_key_id: "",
    secret_access_key: "",
    region: account.region || "us-east-1",
    valid_from: new Date().toISOString().slice(0, 10),
    remarks: "",
  });
  const [applyToAll, setApplyToAll] = useState(sharedAccounts.length > 1);
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = e => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async e => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (applyToAll && sharedAccounts.length > 1) {
        await bulkSwitchPayer(account.id, form);
      } else {
        await addPayer(account.id, form);
      }
      onSaved(applyToAll ? sharedAccounts.length : 1);
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to add payer.");
    } finally {
      setSaving(false);
      setForm(prev => ({ ...prev, secret_access_key: "" }));
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-box">
        <div className="modal-header">
          <div>
            <h2>
              <Building2 size={16} style={{ marginRight: 8, verticalAlign: "middle" }} />
              Add Management Account &mdash; {account.name}
            </h2>
            <p className="modal-subtitle">
              Deactivates the current payer and sets the new one as active.
              All existing cost records are preserved.
              Member account ID ({account.aws_account_id || "n/a"}) stays unchanged.
            </p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {error && <div className="error-msg">{error}</div>}

        {/* Bulk switch option — shown when siblings share the same payer */}
        {sharedAccounts.length > 1 && activePayer && (
          <div className="bulk-switch-notice">
            <div className="bulk-switch-header">
              <Building2 size={14} />
              <strong>{sharedAccounts.length} accounts</strong> currently use management account
              <code>{activePayer.payer_account_id}</code>
            </div>
            <ul className="bulk-switch-list">
              {sharedAccounts.map(a => (
                <li key={a.id}>{a.name} <span className="bulk-acct-id">({a.aws_account_id})</span></li>
              ))}
            </ul>
            <label className="bulk-switch-checkbox">
              <input
                type="checkbox"
                checked={applyToAll}
                onChange={e => setApplyToAll(e.target.checked)}
              />
              Switch payer for <strong>all {sharedAccounts.length} accounts</strong> at once
              <span className="field-hint-sm">(recommended — they all share the same management account)</span>
            </label>
          </div>
        )}

        <form onSubmit={handleSubmit} autoComplete="off" noValidate>
          <fieldset>
            <legend>New Management Account</legend>
            <div className="field-row">
              <div className="field">
                <label htmlFor="payer_account_id">Management Account ID *</label>
                <input id="payer_account_id" name="payer_account_id" type="text"
                  value={form.payer_account_id} onChange={handleChange}
                  required placeholder="222222222222" maxLength={12} />
              </div>
              <div className="field">
                <label htmlFor="management_account_name">Payer Label</label>
                <input id="management_account_name" name="management_account_name" type="text"
                  value={form.management_account_name} onChange={handleChange}
                  placeholder="e.g. Acme Payer 2" />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="payer_region">Region</label>
                <select id="payer_region" name="region" value={form.region} onChange={handleChange}>
                  {AWS_REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="valid_from">Effective From *</label>
                <input id="valid_from" name="valid_from" type="date"
                  value={form.valid_from} onChange={handleChange} required />
              </div>
            </div>
          </fieldset>

          <fieldset>
            <legend>IAM Credentials for New Management Account</legend>
            <div className="credentials-notice">
              <Lock size={13} /> Credentials are encrypted and stored per payer.
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="payer_ak">Access Key ID *</label>
                <input id="payer_ak" name="access_key_id" type="text"
                  value={form.access_key_id} onChange={handleChange}
                  required placeholder="AKIANEWPAYEREXAMPLE"
                  autoComplete="off" spellCheck={false} />
              </div>
            </div>
            <div className="field-row">
              <div className="field field-wide">
                <label htmlFor="payer_sk">Secret Access Key *</label>
                <div className="secret-wrapper">
                  <input id="payer_sk" name="secret_access_key"
                    type={showSecret ? "text" : "password"}
                    value={form.secret_access_key} onChange={handleChange}
                    required placeholder="New management account secret..."
                    autoComplete="new-password" spellCheck={false} />
                  <button type="button" className="toggle-secret"
                    onClick={() => setShowSecret(v => !v)} aria-label={showSecret ? "Hide" : "Show"}>
                    {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </div>
            <div className="field-row">
              <div className="field field-wide">
                <label htmlFor="payer_remarks">Remarks</label>
                <input id="payer_remarks" name="remarks" type="text"
                  value={form.remarks} onChange={handleChange}
                  placeholder="e.g. Switched payer due to org change" />
              </div>
            </div>
          </fieldset>

          <div className="modal-actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving
                ? <><Loader2 size={14} className="spin-icon" /> Switching...</>
                : applyToAll && sharedAccounts.length > 1
                  ? `Switch Payer for All ${sharedAccounts.length} Accounts`
                  : "Add Management Account"
              }
            </button>
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Payer History Panel (inline) ──────────────────────────────────────────────
function PayerHistory({ account, onChanged }) {
  const [open, setOpen] = useState(false);
  const [activating, setActivating] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const { toast } = useToast();

  const payers = account.payers || [];
  if (payers.length === 0) return null;

  const handleActivate = async (payer) => {
    setActivating(payer.id);
    try {
      await activatePayer(account.id, payer.id);
      toast.success(`Payer "${payer.payer_account_id}" is now active.`);
      onChanged();
    } catch (err) {
      toast.error(err?.response?.data?.error || "Failed to activate payer.");
    } finally {
      setActivating(null);
    }
  };

  const handleDelete = async (payer) => {
    setDeleting(payer.id);
    try {
      await deletePayer(account.id, payer.id);
      toast.success("Payer record deleted.");
      onChanged();
    } catch (err) {
      toast.error(err?.response?.data?.error || "Failed to delete payer.");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="payer-history">
      <button className="payer-history-toggle" onClick={() => setOpen(v => !v)}>
        <History size={13} />
        Management Accounts ({payers.length})
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {open && (
        <div className="payer-history-list">
          {payers.map(p => (
            <div key={p.id} className={`payer-row ${p.is_active ? "payer-active" : "payer-inactive"}`}>
              <div className="payer-row-info">
                <div className="payer-row-top">
                  {p.is_active && <Star size={11} className="payer-star" />}
                  <code className="payer-id">{p.payer_account_id}</code>
                  {p.management_account_name && (
                    <span className="payer-name">{p.management_account_name}</span>
                  )}
                  <span className={`payer-status-badge ${p.is_active ? "active" : "inactive"}`}>
                    {p.is_active ? "Active" : "Previous"}
                  </span>
                </div>
                <div className="payer-row-meta">
                  <span>From: {p.valid_from}</span>
                  {p.valid_to && <span>To: {p.valid_to}</span>}
                  {p.access_key_id_masked && p.access_key_id_masked !== "-" && (
                    <span><KeyRound size={11} /> {p.access_key_id_masked}</span>
                  )}
                  {p.remarks && <span className="payer-remarks">{p.remarks}</span>}
                </div>
              </div>
              <div className="payer-row-actions">
                {!p.is_active && (
                  <>
                    <button
                      className="btn-payer-activate"
                      onClick={() => handleActivate(p)}
                      disabled={activating === p.id}
                      title="Switch back to this management account"
                    >
                      {activating === p.id
                        ? <Loader2 size={12} className="spin-icon" />
                        : <RefreshCw size={12} />}
                      Reactivate
                    </button>
                    <button
                      className="btn-payer-delete"
                      onClick={() => handleDelete(p)}
                      disabled={deleting === p.id}
                      title="Delete this payer record"
                    >
                      {deleting === p.id
                        ? <Loader2 size={12} className="spin-icon" />
                        : <Trash2 size={12} />}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Child Accounts Discovery Panel ────────────────────────────────────────────
function ChildAccountsPanel({ parentAccount, onAdded, onClose }) {
  const [children, setChildren]           = useState([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);
  const [contractDates, setContractDates] = useState({});
  const [adding, setAdding]               = useState({});
  const [addErrors, setAddErrors]         = useState({});
  const [addedIds, setAddedIds]           = useState(new Set());

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const { data } = await listChildAccounts(parentAccount.id);
        setChildren(data);
        const dates = {};
        data.forEach(c => { dates[c.account_id] = parentAccount.contract_date || ""; });
        setContractDates(dates);
      } catch (err) {
        setError(err?.response?.data?.error || "Failed to list child accounts.");
      } finally { setLoading(false); }
    })();
  }, [parentAccount]);

  const handleAdd = async (child) => {
    const contractDate = contractDates[child.account_id];
    if (!contractDate) {
      setAddErrors(prev => ({ ...prev, [child.account_id]: "Contract date required" }));
      return;
    }
    setAdding(prev => ({ ...prev, [child.account_id]: true }));
    setAddErrors(prev => ({ ...prev, [child.account_id]: null }));
    try {
      await addChildAccount(parentAccount.id, {
        child_account_id: child.account_id,
        child_name: child.name,
        contract_date: contractDate,
      });
      setAddedIds(prev => new Set([...prev, child.account_id]));
      setChildren(prev => prev.map(c =>
        c.account_id === child.account_id ? { ...c, already_added: true } : c
      ));
      onAdded();
    } catch (err) {
      const msg = err?.response?.data?.error || "Failed to add account.";
      setAddErrors(prev => ({ ...prev, [child.account_id]: msg }));
    } finally {
      setAdding(prev => ({ ...prev, [child.account_id]: false }));
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-box modal-box-wide">
        <div className="modal-header">
          <div>
            <h2>
              <Building2 size={16} style={{ marginRight: 8, verticalAlign: "middle" }} />
              Child Accounts &mdash; {parentAccount.name}
            </h2>
            <p className="modal-subtitle">
              Select child accounts to add. Each will inherit the current management account&apos;s credentials.
            </p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {loading && <div className="loading-msg"><Loader2 size={16} className="spin-icon" /> Fetching from AWS Organizations...</div>}
        {error   && <div className="error-msg" style={{ whiteSpace: "pre-wrap" }}>{error}</div>}

        {!loading && !error && children.length === 0 && (
          <p style={{ color: "#6b7280", padding: "20px 0" }}>No active child accounts found in this organization.</p>
        )}

        {!loading && !error && children.length > 0 && (
          <div className="children-list">
            <table className="children-table">
              <thead>
                <tr>
                  <th>Account Name</th>
                  <th>Account ID</th>
                  <th>Email</th>
                  <th>Contract Date</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {children.map(child => {
                  const isAdded  = child.already_added || addedIds.has(child.account_id);
                  const isAdding = adding[child.account_id];
                  const addErr   = addErrors[child.account_id];
                  return (
                    <tr key={child.account_id}>
                      <td className="child-name">{child.name}</td>
                      <td><code>{child.account_id}</code></td>
                      <td className="child-email">{child.email}</td>
                      <td>
                        {!isAdded ? (
                          <input type="date" className="child-date-input"
                            value={contractDates[child.account_id] || ""}
                            onChange={e => setContractDates(prev => ({ ...prev, [child.account_id]: e.target.value }))} />
                        ) : (
                          <span className="child-date-set">{contractDates[child.account_id] || "-"}</span>
                        )}
                        {addErr && <p className="child-add-err">{addErr}</p>}
                      </td>
                      <td>
                        {isAdded
                          ? <span className="badge created"><CheckCircle size={11} /> Added</span>
                          : <span className="badge cloud">Active</span>}
                      </td>
                      <td>
                        {isAdded ? <span className="text-muted">-</span> : (
                          <button className="btn-add-child" onClick={() => handleAdd(child)} disabled={isAdding}>
                            {isAdding ? <><Loader2 size={12} className="spin-icon" /> Adding...</> : <><Plus size={12} /> Add</>}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: 20 }}>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Fetch Result Panel ────────────────────────────────────────────────────────
function FetchResult({ result, onClose }) {
  if (!result) return null;
  const isError = Boolean(result.error);
  const summary = result.summary || {};
  const months  = result.months  || [];

  const statusClass = {
    fetched: "badge-fetched", preserved: "badge-preserved",
    unavailable: "badge-unavailable", zero: "badge-zero",
    inserted: "badge-fetched", updated: "badge-fetched",
  };

  const StatusIcon = ({ status }) => {
    if (["fetched","inserted","updated"].includes(status)) return <CheckCircle size={11} />;
    if (status === "unavailable") return <AlertTriangle size={11} />;
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
          {result.payer && (
            <p className="fetch-payer-info">
              <Building2 size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />
              Fetched via management account: <code>{result.payer}</code>
            </p>
          )}
          <div className="fetch-summary-bar">
            {[
              { label: "Fetched",     val: summary.fetched,     cls: "sum-fetched" },
              { label: "Preserved",   val: summary.preserved,   cls: "sum-preserved" },
              { label: "Unavailable", val: summary.unavailable, cls: "sum-unavail" },
              { label: "Inserted",    val: summary.inserted,    cls: "sum-fetched" },
              { label: "Updated",     val: summary.updated,     cls: "sum-fetched" },
            ].filter(s => s.val > 0).map(s => (
              <span key={s.label} className={`sum-chip ${s.cls}`}>{s.label}: {s.val}</span>
            ))}
          </div>
          <p className="fetch-msg">{result.message}</p>
          {months.length > 0 && (
            <table className="fetch-table">
              <thead>
                <tr><th>Month</th><th>Status</th><th>Cloud Cost</th><th>Marketplace</th><th>Payer</th><th>Note</th></tr>
              </thead>
              <tbody>
                {months.map(m => (
                  <tr key={m.month} className={`fetch-row-${m.status}`}>
                    <td><strong>{m.month}</strong></td>
                    <td>
                      <span className={`badge ${statusClass[m.status] || ""}`}>
                        <StatusIcon status={m.status} /> {m.status}
                      </span>
                    </td>
                    <td className="cost-cell">{m.cloud_service_cost != null ? `$${Number(m.cloud_service_cost).toFixed(2)}` : "-"}</td>
                    <td className={`cost-cell ${m.marketplace_cost > 0 ? "mp-highlight" : ""}`}>
                      {m.marketplace_cost != null ? `$${Number(m.marketplace_cost).toFixed(2)}` : "-"}
                    </td>
                    <td className="payer-cell">{m.cost_data_source || "-"}</td>
                    <td className="reason-cell">{m.reason || (m.action ? `(${m.action})` : "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {summary.unavailable > 0 && (
            <div className="fetch-unavail-warn">
              <AlertTriangle size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
              <strong>{summary.unavailable}</strong> month(s) unavailable from the current management account.
              Existing records were preserved.
            </div>
          )}
        </>
      )}
    </div>
  );
}


// ── Payer History Table (inside expanded row) ─────────────────────────────────
function PayerHistoryTable({ account, onChanged }) {
  const [activating, setActivating] = useState(null);
  const [deleting, setDeleting]     = useState(null);
  const { toast } = useToast();

  const handleActivate = async (payer) => {
    setActivating(payer.id);
    try {
      await activatePayer(account.id, payer.id);
      toast.success(`Payer "${payer.payer_account_id}" is now active.`);
      onChanged();
    } catch (err) {
      toast.error(err?.response?.data?.error || "Failed to activate payer.");
    } finally { setActivating(null); }
  };

  const handleDelete = async (payer) => {
    setDeleting(payer.id);
    try {
      await deletePayer(account.id, payer.id);
      toast.success("Payer record deleted.");
      onChanged();
    } catch (err) {
      toast.error(err?.response?.data?.error || "Failed to delete payer.");
    } finally { setDeleting(null); }
  };

  return (
    <table className="payer-history-table">
      <thead>
        <tr>
          <th>Management Account ID</th>
          <th>Label</th>
          <th>From</th>
          <th>To</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {account.payers.map(p => (
          <tr key={p.id} className={p.is_active ? "ph-active" : ""}>
            <td><span className="ph-payer-id">{p.payer_account_id}</span></td>
            <td style={{ color: "#6b7280", fontSize: "0.72rem", fontStyle: "italic" }}>
              {p.management_account_name || "-"}
            </td>
            <td>{p.valid_from || "-"}</td>
            <td>{p.valid_to || "-"}</td>
            <td>
              {p.is_active
                ? <span className="ph-status-active"><Star size={10} /> Active</span>
                : <span className="ph-status-inactive">Previous</span>}
            </td>
            <td>
              <div className="ph-actions">
                {!p.is_active && (
                  <>
                    <button className="btn-ph-activate"
                      onClick={() => handleActivate(p)}
                      disabled={activating === p.id}
                      title="Reactivate this payer">
                      {activating === p.id ? <Loader2 size={11} className="spin-icon" /> : <RefreshCw size={11} />}
                      Activate
                    </button>
                    <button className="btn-ph-del"
                      onClick={() => handleDelete(p)}
                      disabled={deleting === p.id}
                      title="Delete this payer record">
                      {deleting === p.id ? <Loader2 size={11} className="spin-icon" /> : <Trash2 size={11} />}
                    </button>
                  </>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AwsAccounts() {
  const [accounts, setAccounts]         = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [modal, setModal]               = useState(null);
  const [addPayerFor, setAddPayerFor]   = useState(null);
  const [childPanel, setChildPanel]     = useState(null);
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
    } catch { setError("Failed to load AWS accounts."); }
    finally   { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave  = () => { setModal(null); load(); };
  const handleAdded = () => { load(); };

  const handlePayerSaved = (count = 1) => {
    setAddPayerFor(null);
    load();
    toast.success(
      count > 1
        ? `Payer switched for ${count} accounts. Click Fetch on each to pull updated data.`
        : "New management account added. Click Fetch Costs to pull updated data."
    );
  };

  const doDelete = async () => {
    const acc = confirmDel;
    setConfirmDel(null);
    try { await deleteAwsAccount(acc.id); load(); toast.success(`"${acc.name}" deleted.`); }
    catch { toast.error("Delete failed. Please try again."); }
  };

  const handleFetch = async acc => {
    setFetchingId(acc.id);
    setFetchResults(prev => ({ ...prev, [acc.id]: null }));
    if (expandedId !== acc.id) setExpandedId(acc.id);
    try {
      const { data } = await fetchAwsCosts(acc.id);
      setFetchResults(prev => ({ ...prev, [acc.id]: data }));
    } catch (err) {
      const msg = err?.response?.data?.error || "Fetch failed. Check credentials and permissions.";
      setFetchResults(prev => ({ ...prev, [acc.id]: { error: msg } }));
    } finally { setFetchingId(null); }
  };

  const filtered = accounts.filter(acc => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      acc.name.toLowerCase().includes(q) ||
      (acc.aws_account_id || "").includes(q) ||
      (acc.active_payer?.payer_account_id || "").includes(q) ||
      (acc.active_payer?.management_account_name || "").toLowerCase().includes(q);
    const matchStatus =
      filterStatus === "all" ||
      (filterStatus === "active"   && acc.is_active && !acc.is_manual) ||
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

      {/* Toolbar: search + filters */}
      <div className="aws-toolbar">
        <div className="aws-search-wrap">
          <Search size={13} />
          <input
            className="aws-search"
            placeholder="Search name, account ID, payer..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {["all","active","inactive","manual"].map(f => (
          <button
            key={f}
            className={`aws-filter-btn ${filterStatus === f ? "active" : ""}`}
            onClick={() => setFilterStatus(f)}
          >
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
          <p>No AWS accounts configured yet.</p>
          <p className="empty-sub">Add a management account to get started.</p>
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
                <th>Management Account</th>
                <th>Access Key</th>
                <th>Region</th>
                <th>Contract</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((acc, i) => {
                const active     = acc.active_payer;
                const isExpanded = expandedId === acc.id;
                const fetchRes   = fetchResults[acc.id];

                return (
                  <React.Fragment key={acc.id}>
                    <tr
                      className={acc.is_active ? "" : "row-inactive"}
                      style={{ animationDelay: `${Math.min(i * 0.025, 0.4)}s` }}
                    >
                      <td style={{ width: 28, paddingRight: 4 }}>
                        <button
                          className="btn-expand"
                          onClick={() => setExpandedId(isExpanded ? null : acc.id)}
                          title={isExpanded ? "Collapse" : "Expand payer history & fetch results"}
                        >
                          {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </button>
                      </td>

                      <td>
                        <div className="acct-name">{acc.name}</div>
                        {acc.aws_account_id && <div className="acct-member-id">{acc.aws_account_id}</div>}
                      </td>

                      <td>
                        {active ? (
                          <div className="payer-cell-wrap">
                            <div className="payer-main">
                              <span className="payer-id-chip">{active.payer_account_id}</span>
                              {active.management_account_name && (
                                <span className="payer-name-chip">{active.management_account_name}</span>
                              )}
                            </div>
                            {(acc.payers?.length || 0) > 1 && (
                              <span className="payer-history-count">+{acc.payers.length - 1} previous</span>
                            )}
                          </div>
                        ) : <span className="text-muted" style={{ fontSize: "0.75rem" }}>-</span>}
                      </td>

                      <td><code className="masked-key">{acc.access_key_id_masked || "-"}</code></td>
                      <td><span className="region-chip">{acc.region || "-"}</span></td>
                      <td style={{ fontSize: "0.78rem", color: "#64748b" }}>{acc.contract_date || "-"}</td>

                      <td>
                        <span className={`status-badge ${acc.is_manual ? "manual" : acc.is_active ? "active" : "inactive"}`}>
                          {acc.is_manual ? "Manual" : acc.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>

                      <td>
                        <div className="row-actions">
                          <button className="btn-act btn-act-fetch"
                            onClick={() => handleFetch(acc)}
                            disabled={fetchingId === acc.id || !acc.is_active || acc.is_manual}
                            title="Fetch costs from AWS">
                            {fetchingId === acc.id
                              ? <Loader2 size={12} className="spin-icon" />
                              : <Download size={12} />}
                            Fetch
                          </button>
                          <button className="btn-act btn-act-payer"
                            onClick={() => setAddPayerFor(acc)}
                            title="Add / switch management account">
                            <Building2 size={12} /> Payer
                          </button>
                          <button className="btn-act btn-act-child"
                            onClick={() => setChildPanel(acc)}
                            title="Discover child accounts via AWS Organizations">
                            <Building2 size={12} /> Children
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
                        <td colSpan={8}>
                          <div className="expanded-content">
                            {(acc.payers?.length || 0) > 0 && (
                              <div>
                                <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
                                  <History size={11} /> Management Account History
                                </div>
                                <PayerHistoryTable account={acc} onChanged={load} />
                              </div>
                            )}
                            {fetchRes !== undefined && (
                              <div className="expanded-fetch">
                                <FetchResult
                                  result={fetchRes}
                                  onClose={() => setFetchResults(prev => { const n = { ...prev }; delete n[acc.id]; return n; })}
                                />
                              </div>
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
                  <td colSpan={8} style={{ textAlign: "center", padding: "32px", color: "#94a3b8", fontSize: "0.82rem" }}>
                    No accounts match your search or filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* IAM Policy */}
      <div className="info-panel">
        <h3><ClipboardList size={13} /> Required IAM Permissions</h3>
        <p>The management account&apos;s IAM user needs this policy:</p>
        <pre className="iam-policy">{JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            { Effect: "Allow", Action: ["ce:GetCostAndUsage","ce:GetDimensionValues"], Resource: "*" },
            { Effect: "Allow", Action: ["organizations:ListAccounts"], Resource: "*", Sid: "AllowListChildAccounts" },
          ],
        }, null, 2)}</pre>
        <p className="info-note">
          Use <strong>Add Payer</strong> to switch management accounts — all existing cost records are preserved.
        </p>
      </div>

      {/* Delete confirm */}
      {confirmDel && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-box" style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h2><Trash2 size={14} style={{ marginRight: 6, verticalAlign: "middle", color: "#dc2626" }} />Delete Account</h2>
              <button className="modal-close" onClick={() => setConfirmDel(null)}><X size={16} /></button>
            </div>
            <p style={{ color: "#475569", fontSize: "0.85rem", margin: "0 0 16px" }}>
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
      {addPayerFor && <AddPayerModal account={addPayerFor} allAccounts={accounts} onSaved={handlePayerSaved} onClose={() => setAddPayerFor(null)} />}
      {childPanel && <ChildAccountsPanel parentAccount={childPanel} onAdded={handleAdded} onClose={() => setChildPanel(null)} />}
    </div>
  );
}
