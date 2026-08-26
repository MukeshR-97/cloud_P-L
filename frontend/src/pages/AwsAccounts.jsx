import React, { useEffect, useState, useCallback } from "react";
import {
  getAwsAccounts,
  createAwsAccount,
  updateAwsAccount,
  deleteAwsAccount,
  fetchAwsCosts,
  listChildAccounts,
  addChildAccount,
} from "../api";
import "./AwsAccounts.css";

const EMPTY_FORM = {
  name: "", aws_account_id: "", access_key_id: "",
  secret_access_key: "", region: "us-east-1",
  contract_date: "", is_active: true,
};

const AWS_REGIONS = [
  "us-east-1","us-east-2","us-west-1","us-west-2",
  "ap-south-1","ap-southeast-1","ap-southeast-2",
  "ap-northeast-1","ap-northeast-2","ap-northeast-3",
  "eu-west-1","eu-west-2","eu-west-3","eu-central-1",
  "eu-north-1","sa-east-1","ca-central-1","me-south-1",
];

// ── Account Form Modal ────────────────────────────────────────────────────────
function AccountModal({ initial, onSave, onClose }) {
  const isEdit = Boolean(initial?.id);
  const [form, setForm] = useState(
    initial ? {
      name: initial.name ?? "", aws_account_id: initial.aws_account_id ?? "",
      access_key_id: "", secret_access_key: "",
      region: initial.region ?? "us-east-1",
      contract_date: initial.contract_date ?? "",
      is_active: initial.is_active ?? true,
    } : EMPTY_FORM
  );
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = e => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const handleSubmit = async e => {
    e.preventDefault();
    setSaving(true); setError(null);
    const payload = {
      name: form.name, aws_account_id: form.aws_account_id,
      region: form.region, contract_date: form.contract_date,
      is_active: form.is_active,
    };
    if (form.access_key_id)     payload.access_key_id     = form.access_key_id;
    if (form.secret_access_key) payload.secret_access_key = form.secret_access_key;
    try {
      isEdit ? await updateAwsAccount(initial.id, payload) : await createAwsAccount(payload);
      onSave();
    } catch (err) {
      const s = err?.response?.data?.error;
      setError(s ? `[${err?.response?.status}] ${s}` : err?.message || "Save failed.");
    } finally {
      setSaving(false);
      setForm(prev => ({ ...prev, secret_access_key: "" }));
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-box">
        <div className="modal-header">
          <h2>{isEdit ? "Edit AWS Account" : "Add AWS Account"}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={handleSubmit} noValidate autoComplete="off">
          <fieldset>
            <legend>Account Details</legend>
            <div className="field-row">
              <div className="field">
                <label htmlFor="name">Account Label *</label>
                <input id="name" name="name" type="text" value={form.name}
                  onChange={handleChange} required placeholder="e.g. Production — ACME Corp" />
              </div>
              <div className="field">
                <label htmlFor="aws_account_id">AWS Account ID</label>
                <input id="aws_account_id" name="aws_account_id" type="text"
                  value={form.aws_account_id} onChange={handleChange}
                  placeholder="123456789012" maxLength={12} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="contract_date">Contract Date *</label>
                <input id="contract_date" name="contract_date" type="date"
                  value={form.contract_date} onChange={handleChange} required />
              </div>
              <div className="field">
                <label htmlFor="region">Region</label>
                <select id="region" name="region" value={form.region} onChange={handleChange}>
                  {AWS_REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="field field-checkbox">
                <label><input type="checkbox" name="is_active" checked={form.is_active}
                  onChange={handleChange} /> Active</label>
              </div>
            </div>
          </fieldset>

          <fieldset>
            <legend>IAM Credentials
              {isEdit && <span className="legend-hint">Leave blank to keep existing keys</span>}
            </legend>
            <div className="credentials-notice">
              🔒 Keys are encrypted with AES-256 before being stored. Never returned to the browser.
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="access_key_id">Access Key ID {!isEdit && "*"}</label>
                <input id="access_key_id" name="access_key_id" type="text"
                  value={form.access_key_id} onChange={handleChange} required={!isEdit}
                  placeholder={isEdit ? "Enter new key to rotate…" : "AKIAIOSFODNN7EXAMPLE"}
                  autoComplete="off" spellCheck={false} />
              </div>
            </div>
            <div className="field-row">
              <div className="field field-wide">
                <label htmlFor="secret_access_key">Secret Access Key {!isEdit && "*"}</label>
                <div className="secret-wrapper">
                  <input id="secret_access_key" name="secret_access_key"
                    type={showSecret ? "text" : "password"}
                    value={form.secret_access_key} onChange={handleChange} required={!isEdit}
                    placeholder={isEdit ? "Enter new secret to rotate…" : "wJalrX…"}
                    autoComplete="new-password" spellCheck={false} />
                  <button type="button" className="toggle-secret"
                    onClick={() => setShowSecret(v => !v)}>
                    {showSecret ? "🙈" : "👁️"}
                  </button>
                </div>
              </div>
            </div>
          </fieldset>

          <div className="modal-actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Update Account" : "Add Account"}
            </button>
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Child Accounts Discovery Panel ───────────────────────────────────────────
function ChildAccountsPanel({ parentAccount, onAdded, onClose }) {
  const [children, setChildren]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [contractDates, setContractDates] = useState({});  // { account_id: date }
  const [adding, setAdding]           = useState({});      // { account_id: bool }
  const [addErrors, setAddErrors]     = useState({});
  const [addedIds, setAddedIds]       = useState(new Set());

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const { data } = await listChildAccounts(parentAccount.id);
        setChildren(data);
        // Pre-fill contract dates with parent's contract date
        const dates = {};
        data.forEach(c => { dates[c.account_id] = parentAccount.contract_date || ""; });
        setContractDates(dates);
      } catch (err) {
        setError(err?.response?.data?.error || "Failed to list child accounts.");
      } finally {
        setLoading(false);
      }
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
        child_name:       child.name,
        contract_date:    contractDate,
      });
      setAddedIds(prev => new Set([...prev, child.account_id]));
      // mark as already_added in the list
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
            <h2>Child Accounts — {parentAccount.name}</h2>
            <p className="modal-subtitle">
              Select child accounts to add. Each will use the management account's credentials
              and filter Cost Explorer by its account ID.
            </p>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {loading && <div className="loading-msg">Fetching accounts from AWS Organizations…</div>}
        {error   && <div className="error-msg" style={{ whiteSpace: "pre-wrap" }}>{error}</div>}

        {!loading && !error && children.length === 0 && (
          <p style={{ color: "#6b7280", padding: "20px 0" }}>
            No active child accounts found in this organization.
          </p>
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
                  const isAdded   = child.already_added || addedIds.has(child.account_id);
                  const isAdding  = adding[child.account_id];
                  const addErr    = addErrors[child.account_id];
                  return (
                    <tr key={child.account_id}>
                      <td className="child-name">{child.name}</td>
                      <td><code>{child.account_id}</code></td>
                      <td className="child-email">{child.email}</td>
                      <td>
                        {!isAdded ? (
                          <input
                            type="date"
                            className="child-date-input"
                            value={contractDates[child.account_id] || ""}
                            onChange={e => setContractDates(prev => ({
                              ...prev, [child.account_id]: e.target.value
                            }))}
                          />
                        ) : (
                          <span className="child-date-set">
                            {contractDates[child.account_id] || "—"}
                          </span>
                        )}
                        {addErr && <p className="child-add-err">{addErr}</p>}
                      </td>
                      <td>
                        {isAdded
                          ? <span className="badge created">✓ Added</span>
                          : <span className="badge cloud">Active</span>}
                      </td>
                      <td>
                        {isAdded ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <button
                            className="btn-add-child"
                            onClick={() => handleAdd(child)}
                            disabled={isAdding}
                          >
                            {isAdding ? "Adding…" : "+ Add"}
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

// ── Fetch Result ──────────────────────────────────────────────────────────────
function FetchResult({ result, onClose }) {
  const [expandedMonth, setExpandedMonth] = useState(null);
  if (!result) return null;
  return (
    <div className={`fetch-result ${result.error ? "fetch-error" : "fetch-success"}`}>
      <button className="fetch-close" onClick={onClose}>✕</button>
      {result.error ? (
        <p style={{ whiteSpace: "pre-wrap" }}>❌ {result.error}</p>
      ) : (
        <>
          <p>✅ {result.message}</p>
          {result.records?.length > 0 && (
            <table className="fetch-table">
              <thead>
                <tr>
                  <th>Month</th><th>Cloud Cost</th><th>Marketplace</th>
                  <th>Total</th><th>Action</th><th></th>
                </tr>
              </thead>
              <tbody>
                {result.records.map(r => {
                  const isExpanded = expandedMonth === r.consumption_month;
                  const services   = Array.isArray(r.services) ? r.services : [];
                  return (
                    <React.Fragment key={r.consumption_month}>
                      <tr>
                        <td><strong>{r.consumption_month}</strong></td>
                        <td className="cost-cell">${r.cloud_service_cost.toFixed(2)}</td>
                        <td className={`cost-cell ${r.marketplace_cost > 0 ? "mp-highlight" : ""}`}>
                          ${r.marketplace_cost.toFixed(2)}
                        </td>
                        <td className="cost-cell"><strong>${r.total.toFixed(2)}</strong></td>
                        <td><span className={`badge ${r.action}`}>{r.action}</span></td>
                        <td>
                          {services.length > 0 && (
                            <button className="btn-breakdown"
                              onClick={() => setExpandedMonth(isExpanded ? null : r.consumption_month)}>
                              {isExpanded ? "▲ Hide" : "▼ Details"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && services.map(svc => (
                        <tr key={svc.name} className="breakdown-row">
                          <td></td>
                          <td colSpan={2} className="svc-name">
                            {svc.name}
                            {svc.entity && svc.entity !== "NoLegalEntityName" && (
                              <span className="svc-entity"> · {svc.entity}</span>
                            )}
                          </td>
                          <td className="cost-cell">${Number(svc.amount).toFixed(4)}</td>
                          <td>
                            <span className={`badge ${svc.is_marketplace ? "mp" : "cloud"}`}>
                              {svc.is_marketplace ? "Marketplace" : "Cloud"}
                            </span>
                          </td>
                          <td></td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AwsAccounts() {
  const [accounts, setAccounts]         = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [modal, setModal]               = useState(null);   // null | "new" | account
  const [childPanel, setChildPanel]     = useState(null);   // null | account (the parent)
  const [fetchingId, setFetchingId]     = useState(null);
  const [fetchResults, setFetchResults] = useState({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data } = await getAwsAccounts();
      setAccounts(data);
    } catch { setError("Failed to load AWS accounts."); }
    finally   { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave   = () => { setModal(null); load(); };
  const handleAdded  = () => { load(); };

  const handleDelete = async acc => {
    if (!window.confirm(`Delete "${acc.name}"? Cost records will be kept but unlinked.`)) return;
    try { await deleteAwsAccount(acc.id); load(); }
    catch { alert("Delete failed."); }
  };

  const handleFetch = async acc => {
    setFetchingId(acc.id);
    setFetchResults(prev => ({ ...prev, [acc.id]: null }));
    try {
      const { data } = await fetchAwsCosts(acc.id);
      setFetchResults(prev => ({ ...prev, [acc.id]: data }));
    } catch (err) {
      const msg = err?.response?.data?.error || "Fetch failed — check credentials and permissions.";
      setFetchResults(prev => ({ ...prev, [acc.id]: { error: msg } }));
    } finally { setFetchingId(null); }
  };

  return (
    <div className="aws-page">
      <div className="page-header">
        <h1>AWS Accounts</h1>
        <button className="btn-primary" onClick={() => setModal("new")}>+ Add Account</button>
      </div>

      {loading && <div className="loading-msg">Loading…</div>}
      {error   && <div className="error-msg">{error}</div>}

      {!loading && accounts.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">☁️</div>
          <p>No AWS accounts configured yet.</p>
          <p className="empty-sub">Add a management account to get started.</p>
          <button className="btn-primary" onClick={() => setModal("new")}>Add your first account</button>
        </div>
      )}

      {!loading && accounts.length > 0 && (
        <div className="accounts-grid">
          {accounts.map(acc => (
            <div key={acc.id} className={`account-card ${acc.is_active ? "" : "inactive"}`}>
              <div className="account-card-header">
                <div>
                  <h3>{acc.name}</h3>
                  {acc.aws_account_id && (
                    <p className="account-id">Account: {acc.aws_account_id}</p>
                  )}
                </div>
                <span className={`status-badge ${acc.is_active ? "active" : "inactive"}`}>
                  {acc.is_active ? "Active" : "Inactive"}
                </span>
              </div>

              <div className="account-meta">
                <div className="meta-row">
                  <span className="meta-label">Access Key</span>
                  <code className="meta-value masked-key">{acc.access_key_id_masked}</code>
                </div>
                <div className="meta-row">
                  <span className="meta-label">Region</span>
                  <span className="meta-value">{acc.region}</span>
                </div>
                <div className="meta-row">
                  <span className="meta-label">Contract Date</span>
                  <span className="meta-value">{acc.contract_date}</span>
                </div>
              </div>

              <div className="account-actions">
                <button className="btn-fetch" onClick={() => handleFetch(acc)}
                  disabled={fetchingId === acc.id || !acc.is_active}>
                  {fetchingId === acc.id ? <span className="spinner">⟳</span> : "⬇ Fetch Costs"}
                </button>
                {/* List child accounts button — useful for management/payer accounts */}
                <button className="btn-icon-sm org"
                  onClick={() => setChildPanel(acc)}
                  title="List child accounts from AWS Organizations">
                  🏢 Child Accounts
                </button>
                <button className="btn-icon-sm" onClick={() => setModal(acc)}>✏️ Edit</button>
                <button className="btn-icon-sm danger" onClick={() => handleDelete(acc)}>🗑️ Delete</button>
              </div>

              {fetchResults[acc.id] !== undefined && (
                <FetchResult
                  result={fetchResults[acc.id]}
                  onClose={() => setFetchResults(prev => {
                    const next = { ...prev }; delete next[acc.id]; return next;
                  })}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* IAM policy info */}
      <div className="info-panel">
        <h3>📋 Required IAM Permissions</h3>
        <p>The management account's IAM user needs this policy:</p>
        <pre className="iam-policy">{JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            { Effect: "Allow", Action: ["ce:GetCostAndUsage","ce:GetDimensionValues"], Resource: "*" },
            { Effect: "Allow", Action: ["organizations:ListAccounts"], Resource: "*",
              Sid: "AllowListChildAccounts" },
          ]
        }, null, 2)}</pre>
        <p className="info-note">
          Add <code>organizations:ListAccounts</code> to the management account's IAM policy
          to enable the <strong>Child Accounts</strong> discovery feature.
          Each child account's costs are filtered by its 12-digit Account ID in Cost Explorer.
        </p>
      </div>

      {/* Modals */}
      {modal && (
        <AccountModal
          initial={modal === "new" ? null : modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
      {childPanel && (
        <ChildAccountsPanel
          parentAccount={childPanel}
          onAdded={handleAdded}
          onClose={() => setChildPanel(null)}
        />
      )}
    </div>
  );
}
