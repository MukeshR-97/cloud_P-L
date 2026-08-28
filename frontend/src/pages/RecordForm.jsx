import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { createRecord, updateRecord, getRecord, getAwsAccounts, addSplitRow } from "../api";
import { formatCurrency, formatINR, formatPct } from "../utils/format";
import { GitBranch } from "lucide-react";
import "./RecordForm.css";

const EMPTY = {
  aws_account_id: "", contract_date: "", consumption_month: "",
  cloud_service_cost: "", marketplace_cost: "",
  distributor_discount: "", customer_discount: "", managed_services: "",
  credit_amount: "", cash_claim: "", redington_credit_note: "",
  conversion_rate: "", remarks: "",
};

function n(v) { const x = parseFloat(v); return isNaN(x) ? 0 : x; }

// ── Suffix input ──────────────────────────────────────────────────────────────
function SInput({ id, name, label, hint, value, onChange, suffix, suffixClass = "",
                  required, step = "0.0001", min = "0", max, placeholder = "0.00" }) {
  return (
    <div className="rf-field">
      <label htmlFor={id}>
        {label}{required && <span className="rf-req"> *</span>}
        {hint && <span className="rf-hint">{hint}</span>}
      </label>
      <div className="rf-suffix-wrap">
        <input id={id} name={name} type="number"
          step={step} min={min} max={max}
          value={value} onChange={onChange}
          placeholder={placeholder} required={required} />
        <span className={`rf-suffix ${suffixClass}`}>{suffix}</span>
      </div>
    </div>
  );
}

// ── Preview panel ─────────────────────────────────────────────────────────────
function Preview({ form }) {
  const cloud = n(form.cloud_service_cost);
  const mp    = n(form.marketplace_cost);
  const total = cloud + mp;
  const fx    = n(form.conversion_rate) || 1;

  const distAmt = cloud * n(form.distributor_discount) / 100;
  const custAmt = total * n(form.customer_discount)    / 100;
  const mgtAmt  = total * n(form.managed_services)     / 100;
  const credAmt = n(form.credit_amount);
  const redAmt  = n(form.redington_credit_note);

  const ilios   = total - distAmt - credAmt - mgtAmt - custAmt - redAmt;
  const invoice = total - custAmt + mgtAmt;
  const margin  = invoice - ilios;

  const rows = [
    { label: "Cloud + Marketplace", val: total,   bold: true },
    { label: `− Dist. Disc (${formatPct(n(form.distributor_discount))})`, val: distAmt, neg: true },
    { label: `− Credit Amt`,        val: credAmt, neg: true },
    { label: `− Managed (${formatPct(n(form.managed_services))})`,       val: mgtAmt,  neg: true },
    { label: `− Cust. Disc (${formatPct(n(form.customer_discount))})`,   val: custAmt, neg: true },
    { label: `− Redington CN`,      val: redAmt,  neg: true },
    null,
    { label: "ILIOS Spend",         val: ilios,   bold: true },
    { label: "Invoice to Customer", val: invoice, bold: true },
    { label: "ILIOS Margin",        val: margin,  bold: true, highlight: true },
  ];

  return (
    <aside className="rf-preview">
      <div className="rf-preview-head">Live Preview</div>

      <div className="rf-preview-section">USD</div>
      <table className="rf-preview-table">
        <tbody>
          {rows.map((r, i) =>
            r === null ? (
              <tr key={i} className="rf-divider"><td colSpan={2}></td></tr>
            ) : (
              <tr key={r.label}>
                <td className="rf-pl">{r.label}</td>
                <td className={[
                  "rf-pv",
                  r.highlight ? (r.val >= 0 ? "pos" : "neg") : "",
                  r.neg ? "dim" : "",
                ].filter(Boolean).join(" ")}
                style={r.bold ? { fontWeight: 800 } : {}}>
                  {formatCurrency(r.val)}
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>

      {fx > 1 && (
        <>
          <div className="rf-preview-section" style={{ marginTop: 14 }}>
            INR <span className="rf-fx">@ ₹{fx.toFixed(2)}</span>
          </div>
          <table className="rf-preview-table">
            <tbody>
              {[
                ["Total",   total   * fx],
                ["ILIOS Spend",  ilios   * fx],
                ["Invoice", invoice * fx],
                ["Margin",  margin  * fx, true],
              ].map(([lbl, val, hl]) => (
                <tr key={lbl}>
                  <td className="rf-pl">{lbl}</td>
                  <td className={`rf-pv ${hl ? (val >= 0 ? "pos" : "neg") : ""}`}
                      style={{ fontWeight: 800 }}>
                    {formatINR(val)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </aside>
  );
}

// ── Main form ─────────────────────────────────────────────────────────────────
export default function RecordForm() {
  const { id }            = useParams();
  const [sp]              = useSearchParams();
  const navigate          = useNavigate();
  const isEdit            = Boolean(id);
  const preAcct           = sp.get("account_id") || "";

  const [form, setForm]   = useState({ ...EMPTY, aws_account_id: preAcct });
  const [accounts, setAcc]= useState([]);
  const [loading, setLoad]= useState(true);
  const [saving, setSave] = useState(false);
  const [error, setErr]   = useState(null);

  // Split-month state — only relevant when editing an existing record
  const [existingRecord, setExistingRecord] = useState(null);
  const [showSplitForm, setShowSplitForm]   = useState(false);
  const [splitForm, setSplitForm]           = useState({
    cloud_service_cost: "",
    marketplace_cost:   "",
    cost_data_source:   "",
    remarks:            "",
  });
  const [splitSaving, setSplitSaving] = useState(false);
  const [splitError, setSplitError]   = useState(null);
  const [splitDone, setSplitDone]     = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [aR, rR] = await Promise.all([
          getAwsAccounts(),
          isEdit ? getRecord(id) : Promise.resolve(null),
        ]);
        const accts = aR.data || [];
        setAcc(accts);

        if (rR) {
          const d = rR.data;
          setExistingRecord(d);
          setForm({
            aws_account_id:        d.aws_account_id        ?? "",
            contract_date:         d.contract_date         ?? "",
            consumption_month:     d.consumption_month     ?? "",
            cloud_service_cost:    d.cloud_service_cost    ?? "",
            marketplace_cost:      d.marketplace_cost      ?? "",
            distributor_discount:  d.distributor_discount  ?? "",
            credit_amount:         d.credit_amount         ?? "",
            customer_discount:     d.customer_discount     ?? "",
            managed_services:      d.managed_services      ?? "",
            cash_claim:            d.cash_claim            ?? "",
            conversion_rate:       d.conversion_rate       ?? "",
            redington_credit_note: d.redington_credit_note ?? "",
            remarks:               d.remarks               ?? "",
          });
          // Pre-fill split payer field with account's active payer if known
          setSplitForm(prev => ({ ...prev, cost_data_source: "" }));
        } else if (preAcct) {
          const acct = accts.find(a => String(a.id) === preAcct);
          setForm(prev => ({
            ...prev,
            aws_account_id: preAcct,
            contract_date:  acct?.contract_date || "",
          }));
        }
      } catch { setErr("Failed to load data."); }
      finally  { setLoad(false); }
    })();
  }, [id, isEdit, preAcct]);

  const handleChange = e => {
    const { name, value } = e.target;
    setForm(prev => {
      const next = { ...prev, [name]: value };
      if (name === "aws_account_id" && value) {
        const acct = accounts.find(a => String(a.id) === value);
        if (acct?.contract_date) next.contract_date = acct.contract_date;
      }
      return next;
    });
  };

  const handleSubmit = async e => {
    e.preventDefault();
    setSave(true); setErr(null);
    const payload = { ...form };
    if (!payload.aws_account_id) delete payload.aws_account_id;
    try {
      isEdit ? await updateRecord(id, payload) : await createRecord(payload);
      navigate("/records");
    } catch (err) {
      setErr(err?.response?.data?.error || "Save failed.");
    } finally { setSave(false); }
  };

  // ── Add split segment ──────────────────────────────────────────────────────
  const handleAddSplit = async e => {
    e.preventDefault();
    setSplitSaving(true); setSplitError(null); setSplitDone(null);
    try {
      const payload = {
        cloud_service_cost: parseFloat(splitForm.cloud_service_cost) || 0,
        marketplace_cost:   parseFloat(splitForm.marketplace_cost)   || 0,
        cost_data_source:   splitForm.cost_data_source || null,
        remarks:            splitForm.remarks || `Split: ${splitForm.cost_data_source || "new payer"} portion`,
        cost_status:        "fetched",
      };
      const { data } = await addSplitRow(id, payload);
      setSplitDone(data.message);
      setSplitForm({ cloud_service_cost: "", marketplace_cost: "", cost_data_source: "", remarks: "" });
      setShowSplitForm(false);
    } catch (err) {
      setSplitError(err?.response?.data?.error || "Failed to add split row.");
    } finally { setSplitSaving(false); }
  };

  if (loading) return <div className="loading-msg">Loading…</div>;

  const selectedAcct   = accounts.find(a => String(a.id) === String(form.aws_account_id));
  const isSplit        = existingRecord?.is_split;
  const splitGroupId   = existingRecord?.split_month_group;

  return (
    <div className="rf-page">
      <div className="rf-layout">

        {/* ── Form ─────────────────────────────────────────────────── */}
        <div className="rf-card">

          {/* Header */}
          <div className="rf-card-header">
            <div>
              <h1>{isEdit ? "Edit Cost Record" : "New Cost Record"}</h1>
              <p className="rf-subtitle">
                {selectedAcct
                  ? `Account: ${selectedAcct.name}${selectedAcct.is_manual ? " (manual)" : ""}`
                  : "Fill in the details below"}
              </p>
            </div>
            <button type="button" className="btn-secondary rf-cancel"
              onClick={() => navigate("/records")}>
              ✕ Cancel
            </button>
          </div>

          {/* Split-month banner */}
          {isEdit && isSplit && (
            <div className="rf-split-banner">
              <GitBranch size={14} />
              <span>
                This is a <strong>split-month segment</strong>.
                It is part of split group <code>{splitGroupId?.slice(0, 8)}…</code>.
                Editing affects only this payer&apos;s portion. The combined total
                is shown in the Records list.
              </span>
            </div>
          )}

          {/* Offer to add split if it's a normal (non-split) record being edited */}
          {isEdit && !isSplit && (
            <div className="rf-split-offer">
              <GitBranch size={13} />
              <span>
                Management account changed mid-month?
              </span>
              <button
                type="button"
                className="btn-split-add"
                onClick={() => setShowSplitForm(v => !v)}
              >
                {showSplitForm ? "Cancel" : "+ Add Split Segment"}
              </button>
            </div>
          )}

          {/* Split segment form */}
          {showSplitForm && (
            <div className="rf-split-form">
              <h3>
                <GitBranch size={14} style={{ marginRight: 6 }} />
                Add New Payer Segment — {form.consumption_month}
              </h3>
              <p className="rf-split-desc">
                Enter the costs billed by the <strong>new management account</strong> for the
                remainder of this month. The original record ({form.cost_data_source || "existing payer"})
                and this new segment will be linked and shown as a combined total in Records.
              </p>

              {splitError && <div className="error-msg">{splitError}</div>}
              {splitDone  && <div className="rf-split-success">{splitDone}</div>}

              <form onSubmit={handleAddSplit} className="rf-split-fields">
                <div className="rf-row rf-row-2">
                  <div className="rf-field">
                    <label htmlFor="split_payer">New Payer Account ID</label>
                    <input
                      id="split_payer"
                      type="text"
                      value={splitForm.cost_data_source}
                      onChange={e => setSplitForm(p => ({ ...p, cost_data_source: e.target.value }))}
                      placeholder="222222222222"
                      maxLength={12}
                    />
                  </div>
                  <div className="rf-field">
                    <label htmlFor="split_remarks">Remarks</label>
                    <input
                      id="split_remarks"
                      type="text"
                      value={splitForm.remarks}
                      onChange={e => setSplitForm(p => ({ ...p, remarks: e.target.value }))}
                      placeholder={`e.g. Jul 15–31 via new payer`}
                    />
                  </div>
                </div>
                <div className="rf-row rf-row-2">
                  <SInput
                    id="split_cloud" name="split_cloud"
                    label="Cloud Service Cost" suffix="USD" suffixClass="usd"
                    value={splitForm.cloud_service_cost}
                    onChange={e => setSplitForm(p => ({ ...p, cloud_service_cost: e.target.value }))}
                  />
                  <SInput
                    id="split_mp" name="split_mp"
                    label="Marketplace Cost" suffix="USD" suffixClass="usd"
                    value={splitForm.marketplace_cost}
                    onChange={e => setSplitForm(p => ({ ...p, marketplace_cost: e.target.value }))}
                  />
                </div>
                <div className="rf-split-actions">
                  <button type="submit" className="btn-primary" disabled={splitSaving}>
                    {splitSaving ? "Adding…" : "Add Split Segment"}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setShowSplitForm(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {splitDone && !showSplitForm && (
            <div className="rf-split-success">
              {splitDone} &mdash;{" "}
              <button type="button" className="btn-link" onClick={() => navigate("/records")}>
                View in Records
              </button>
            </div>
          )}

          {error && <div className="error-msg">{error}</div>}

          <form onSubmit={handleSubmit} noValidate>

            {/* Row 1: Account + Month */}
            <div className="rf-row rf-row-2">
              <div className="rf-field">
                <label htmlFor="aws_account_id">Account *</label>
                <select id="aws_account_id" name="aws_account_id"
                  value={form.aws_account_id} onChange={handleChange} required>
                  <option value="">— Select account —</option>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.is_manual ? "✏" : "☁"} {a.name}
                      {a.aws_account_id ? ` · ${a.aws_account_id}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rf-field">
                <label htmlFor="consumption_month">Consumption Month *</label>
                <input id="consumption_month" name="consumption_month" type="date"
                  value={form.consumption_month} onChange={handleChange} required />
              </div>
            </div>

            {/* Row 2: Contract date */}
            <div className="rf-row rf-row-1">
              <div className="rf-field">
                <label htmlFor="contract_date">
                  Contract Date *
                  <span className="rf-hint">Auto-filled from account — you can override</span>
                </label>
                <input id="contract_date" name="contract_date" type="date"
                  value={form.contract_date} onChange={handleChange} required />
              </div>
            </div>

            <div className="rf-divider-line"></div>

            {/* Row 3: Cloud & Marketplace */}
            <p className="rf-group-label">Cloud &amp; Marketplace Cost (USD)</p>
            <div className="rf-row rf-row-2">
              <SInput id="cloud_service_cost" name="cloud_service_cost"
                label="Cloud Service Cost" required suffix="USD" suffixClass="usd"
                value={form.cloud_service_cost} onChange={handleChange} />
              <SInput id="marketplace_cost" name="marketplace_cost"
                label="Marketplace Cost" required suffix="USD" suffixClass="usd"
                value={form.marketplace_cost} onChange={handleChange} />
            </div>

            <div className="rf-divider-line"></div>

            {/* Row 4: Discounts */}
            <p className="rf-group-label">Discounts &amp; Services (%)</p>
            <div className="rf-row rf-row-3">
              <SInput id="distributor_discount" name="distributor_discount"
                label="Distributor Discount" hint="% of Cloud Cost"
                suffix="%" suffixClass="pct" step="0.01" max="100"
                value={form.distributor_discount} onChange={handleChange} />
              <SInput id="customer_discount" name="customer_discount"
                label="Customer Discount" hint="% of Total"
                suffix="%" suffixClass="pct" step="0.01" max="100"
                value={form.customer_discount} onChange={handleChange} />
              <SInput id="managed_services" name="managed_services"
                label="Managed Services" hint="% of Total"
                suffix="%" suffixClass="pct" step="0.01" max="100"
                value={form.managed_services} onChange={handleChange} />
            </div>

            <div className="rf-divider-line"></div>

            {/* Row 5: Flat amounts */}
            <p className="rf-group-label">Flat Amounts (USD)</p>
            <div className="rf-row rf-row-3">
              <SInput id="credit_amount" name="credit_amount"
                label="Credit Amount" suffix="USD" suffixClass="usd"
                value={form.credit_amount} onChange={handleChange} />
              <SInput id="cash_claim" name="cash_claim"
                label="Cash Claim" suffix="USD" suffixClass="usd"
                value={form.cash_claim} onChange={handleChange} />
              <SInput id="redington_credit_note" name="redington_credit_note"
                label="Redington Credit Note" suffix="USD" suffixClass="usd"
                value={form.redington_credit_note} onChange={handleChange} />
            </div>

            <div className="rf-divider-line"></div>

            {/* Row 6: Rate + Remarks */}
            <p className="rf-group-label">Currency &amp; Remarks</p>
            <div className="rf-row rf-row-2">
              <SInput id="conversion_rate" name="conversion_rate"
                label="Conversion Rate" hint="1 USD = ? INR"
                suffix="₹/USD" suffixClass="rate" step="0.01"
                placeholder="e.g. 84.50"
                value={form.conversion_rate} onChange={handleChange} />
              <div className="rf-field">
                <label htmlFor="remarks">Remarks</label>
                <textarea id="remarks" name="remarks" rows={3}
                  value={form.remarks} onChange={handleChange}
                  placeholder="Optional notes…" />
              </div>
            </div>

            {/* Actions */}
            <div className="rf-actions">
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? "Saving…" : isEdit ? "Update Record" : "Save Record"}
              </button>
              <button type="button" className="btn-secondary"
                onClick={() => navigate("/records")}>
                Cancel
              </button>
            </div>
          </form>
        </div>

        {/* ── Preview ────────────────────────────────────────────────── */}
        <Preview form={form} />
      </div>
    </div>
  );
}
