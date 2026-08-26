import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createRecord, updateRecord, getRecord } from "../api";
import { formatCurrency, formatINR, formatPct } from "../utils/format";
import "./RecordForm.css";

// ── Constants ─────────────────────────────────────────────────────────────────
const EMPTY_FORM = {
  contract_date: "",
  consumption_month: "",
  cloud_service_cost: "",
  marketplace_cost: "",
  distributor_discount: "",
  credit_amount: "",
  customer_discount: "",
  managed_services: "",
  cash_claim: "",
  conversion_rate: "",
  redington_credit_note: "",
  remarks: "",
};

function toNum(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// ── Reusable input components ─────────────────────────────────────────────────

function UsdInput({ id, name, label, value, onChange, required, placeholder = "0.00" }) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}{required && " *"}
      </label>
      <div className="input-suffix-wrap">
        <input
          id={id} name={name} type="number"
          step="0.0001" min="0"
          value={value} onChange={onChange}
          required={required} placeholder={placeholder}
        />
        <span className="input-suffix usd">USD</span>
      </div>
    </div>
  );
}

function PctInput({ id, name, label, hint, value, onChange }) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {hint && <span className="field-hint">{hint}</span>}
      </label>
      <div className="input-suffix-wrap">
        <input
          id={id} name={name} type="number"
          step="0.01" min="0" max="100"
          value={value} onChange={onChange}
          placeholder="0.00"
        />
        <span className="input-suffix pct">%</span>
      </div>
    </div>
  );
}

// ── Live Preview ──────────────────────────────────────────────────────────────
function Preview({ form }) {
  const cloud  = toNum(form.cloud_service_cost);
  const market = toNum(form.marketplace_cost);
  const total  = cloud + market;
  const fx     = toNum(form.conversion_rate) || 1;

  // % → USD amounts
  // distributor_discount: % of cloud_service_cost ONLY (not marketplace)
  // customer_discount:    % of total_consumption
  // managed_services:     % of total_consumption
  const distDiscAmt  = cloud * toNum(form.distributor_discount) / 100;
  const custDiscAmt  = total * toNum(form.customer_discount)    / 100;
  const managedAmt   = total * toNum(form.managed_services)     / 100;
  const creditAmt    = toNum(form.credit_amount);        // flat, applied on cloud only
  const redingtonAmt = toNum(form.redington_credit_note); // flat

  /**
   * ILIOS Spend = total_consumption
   *               − distributor_discount_amt  (% of cloud)
   *               − credit_amount             (flat, cloud only)
   *               − managed_services_amt      (% of total)
   *               − customer_discount_amt     (% of total)
   *               − redington_credit_note     (flat)
   */
  const iliosSpend = total - distDiscAmt - creditAmt - managedAmt - custDiscAmt - redingtonAmt;

  /**
   * Invoice to Customer = total_consumption
   *                       − customer_discount_amt
   *                       + managed_services_amt
   */
  const invoiceToCustomer = total - custDiscAmt + managedAmt;

  /**
   * ILIOS Margin = invoice_to_customer − ilios_spend
   */
  const iliosMargin = invoiceToCustomer - iliosSpend;

  // Rows shown in the USD breakdown section
  const usdRows = [
    {
      label: "Total Consumption",
      value: total,
      note: "Cloud + Marketplace",
      bold: true,
    },
    {
      label: "− Distributor Disc.",
      value: distDiscAmt,
      note: `${formatPct(toNum(form.distributor_discount))} × Cloud`,
      deduct: true,
    },
    {
      label: "− Credit Amount",
      value: creditAmt,
      note: "Flat (cloud only)",
      deduct: true,
    },
    {
      label: "− Managed Services",
      value: managedAmt,
      note: `${formatPct(toNum(form.managed_services))} × Total`,
      deduct: true,
    },
    {
      label: "− Customer Disc.",
      value: custDiscAmt,
      note: `${formatPct(toNum(form.customer_discount))} × Total`,
      deduct: true,
    },
    {
      label: "− Redington CN",
      value: redingtonAmt,
      note: "Flat",
      deduct: true,
    },
    { divider: true },
    {
      label: "ILIOS Spend",
      value: iliosSpend,
      bold: true,
    },
    {
      label: "Invoice to Customer",
      value: invoiceToCustomer,
      note: "Total − CustDisc + Managed",
      bold: true,
    },
    {
      label: "ILIOS Margin",
      value: iliosMargin,
      note: "Invoice − ILIOS Spend",
      bold: true,
      highlight: true,
    },
  ];

  return (
    <div className="preview-box">
      <h3>Live Preview</h3>

      {/* USD section */}
      <p className="preview-section-label">USD</p>
      <table className="preview-table">
        <tbody>
          {usdRows.map((r, i) =>
            r.divider ? (
              <tr key={`div-${i}`} className="preview-divider-row">
                <td colSpan={2}><hr className="preview-hr" /></td>
              </tr>
            ) : (
              <tr key={r.label}>
                <td className="preview-label">{r.label}</td>
                <td
                  className={[
                    "preview-value",
                    r.highlight ? (r.value >= 0 ? "positive" : "negative") : "",
                    r.deduct ? "deduct" : "",
                  ].join(" ")}
                  style={r.bold ? { fontWeight: 800 } : {}}
                >
                  {r.deduct
                    ? formatCurrency(r.value)
                    : formatCurrency(r.value)}
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>

      {/* INR section — only shown when a valid rate is entered */}
      {fx > 1 && (
        <>
          <p className="preview-section-label" style={{ marginTop: 14 }}>
            INR <span className="preview-fx">@ ₹{fx.toFixed(2)}</span>
          </p>
          <table className="preview-table">
            <tbody>
              {[
                { label: "Total Consumption",   value: total            * fx },
                { label: "ILIOS Spend",         value: iliosSpend       * fx },
                { label: "Invoice to Customer", value: invoiceToCustomer * fx },
                { label: "ILIOS Margin",        value: iliosMargin      * fx, highlight: true },
              ].map(r => (
                <tr key={r.label}>
                  <td className="preview-label">{r.label}</td>
                  <td
                    className={`preview-value${r.highlight ? (r.value >= 0 ? " positive" : " negative") : ""}`}
                    style={{ fontWeight: 800 }}
                  >
                    {formatINR(r.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// ── Main Form ─────────────────────────────────────────────────────────────────
export default function RecordForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [form, setForm]       = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const { data } = await getRecord(id);
        setForm({
          contract_date:         data.contract_date         ?? "",
          consumption_month:     data.consumption_month     ?? "",
          cloud_service_cost:    data.cloud_service_cost    ?? "",
          marketplace_cost:      data.marketplace_cost      ?? "",
          distributor_discount:  data.distributor_discount  ?? "",
          credit_amount:         data.credit_amount         ?? "",
          customer_discount:     data.customer_discount     ?? "",
          managed_services:      data.managed_services      ?? "",
          cash_claim:            data.cash_claim            ?? "",
          conversion_rate:       data.conversion_rate       ?? "",
          redington_credit_note: data.redington_credit_note ?? "",
          remarks:               data.remarks               ?? "",
        });
      } catch {
        setError("Failed to load record.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isEdit]);

  const handleChange = e => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async e => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      isEdit ? await updateRecord(id, form) : await createRecord(form);
      navigate("/records");
    } catch (err) {
      setError(err?.response?.data?.error || "Save failed. Check all fields.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading-msg">Loading…</div>;

  return (
    <div className="form-page">
      <div className="form-layout">

        {/* ── Main form card ───────────────────────────────────────────── */}
        <div className="form-card">
          <h1>{isEdit ? "Edit Cost Record" : "New Cost Record"}</h1>
          {error && <div className="error-msg">{error}</div>}

          <form onSubmit={handleSubmit} noValidate>

            {/* 1. Cost Period */}
            <fieldset>
              <legend>Cost Period</legend>
              <div className="field-row-2">
                <div className="field">
                  <label htmlFor="contract_date">Contract Date *</label>
                  <input id="contract_date" name="contract_date" type="date"
                    value={form.contract_date} onChange={handleChange} required />
                </div>
                <div className="field">
                  <label htmlFor="consumption_month">Last Month Consumption *</label>
                  <input id="consumption_month" name="consumption_month" type="date"
                    value={form.consumption_month} onChange={handleChange} required />
                </div>
              </div>
            </fieldset>

            {/* 2. Cloud & Marketplace Costs */}
            <fieldset>
              <legend>Cloud &amp; Marketplace Cost</legend>
              <div className="field-row-2">
                <UsdInput id="cloud_service_cost" name="cloud_service_cost"
                  label="Cloud Service Cost" required
                  value={form.cloud_service_cost} onChange={handleChange} />
                <UsdInput id="marketplace_cost" name="marketplace_cost"
                  label="Marketplace Cost" required
                  value={form.marketplace_cost} onChange={handleChange} />
              </div>
            </fieldset>

            {/* 3. Discounts & Services (%) */}
            <fieldset>
              <legend>Discounts &amp; Services (%)</legend>
              <div className="field-row-3">
                <PctInput id="distributor_discount" name="distributor_discount"
                  label="Distributor Discount" hint="of Cloud Cost"
                  value={form.distributor_discount} onChange={handleChange} />
                <PctInput id="customer_discount" name="customer_discount"
                  label="Customer Discount" hint="of Total"
                  value={form.customer_discount} onChange={handleChange} />
                <PctInput id="managed_services" name="managed_services"
                  label="Managed Services" hint="of Total"
                  value={form.managed_services} onChange={handleChange} />
              </div>
            </fieldset>

            {/* 4. Flat USD Amounts */}
            <fieldset>
              <legend>Flat Amounts (USD)</legend>
              <div className="field-row-3">
                <UsdInput id="credit_amount" name="credit_amount"
                  label="Credit Amount"
                  value={form.credit_amount} onChange={handleChange} />
                <UsdInput id="cash_claim" name="cash_claim"
                  label="Cash Claim"
                  value={form.cash_claim} onChange={handleChange} />
                <UsdInput id="redington_credit_note" name="redington_credit_note"
                  label="Redington Credit Note"
                  value={form.redington_credit_note} onChange={handleChange} />
              </div>
            </fieldset>

            {/* 5. Conversion Rate & Remarks */}
            <fieldset>
              <legend>Currency &amp; Remarks</legend>
              <div className="field-row-2">
                <div className="field">
                  <label htmlFor="conversion_rate">
                    Conversion Rate
                    <span className="field-hint">1 USD = ? INR</span>
                  </label>
                  <div className="input-suffix-wrap">
                    <input id="conversion_rate" name="conversion_rate" type="number"
                      step="0.01" min="0"
                      value={form.conversion_rate} onChange={handleChange}
                      placeholder="e.g. 84.50" />
                    <span className="input-suffix rate">₹/USD</span>
                  </div>
                </div>
                <div className="field field-wide">
                  <label htmlFor="remarks">Remarks</label>
                  <textarea id="remarks" name="remarks" rows={3}
                    value={form.remarks} onChange={handleChange}
                    placeholder="Optional notes…" />
                </div>
              </div>
            </fieldset>

            <div className="form-actions">
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

        {/* ── Preview sidebar ──────────────────────────────────────────── */}
        <Preview form={form} />
      </div>
    </div>
  );
}
