import React, { useEffect, useState, useCallback } from "react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart,
} from "recharts";
import { getDashboardSummary } from "../api";
import MetricCard from "../components/MetricCard";
import { formatCurrency, formatINR } from "../utils/format";
import "./Dashboard.css";

const COLORS = {
  cloud_service_cost:  "#6366f1",
  marketplace_cost:    "#8b5cf6",
  ilios_spend:         "#f97316",
  invoice_to_customer: "#22c55e",
  ilios_margin:        "#14b8a6",
};

export default function Dashboard() {
  const [summary, setSummary]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate]     = useState("");
  const [currency, setCurrency] = useState("USD"); // "USD" | "INR"

  const fetchSummary = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = {};
      if (fromDate) params.from_date = fromDate;
      if (toDate)   params.to_date   = toDate;
      const { data } = await getDashboardSummary(params);
      setSummary(data);
    } catch { setError("Failed to load dashboard data."); }
    finally  { setLoading(false); }
  }, [fromDate, toDate]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const fmt   = currency === "INR" ? formatINR  : formatCurrency;
  const fmtK  = (v) => currency === "INR"
    ? `₹${(v / 100000).toFixed(0)}L`   // lakhs
    : `$${(v / 1000).toFixed(0)}k`;
  const suffix = currency === "INR" ? "_inr" : "";

  const customTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="chart-tooltip">
        <p className="tooltip-label">{label}</p>
        {payload.map(entry => (
          <p key={entry.dataKey} style={{ color: entry.color }}>
            {entry.name}: {fmt(entry.value)}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <h1>Overall Cost &amp; Margin Analysis</h1>
        <div className="filter-row">
          <label>From<input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} /></label>
          <label>To<input type="date" value={toDate}   onChange={e => setToDate(e.target.value)} /></label>
          <button onClick={fetchSummary} className="btn-primary">Apply</button>
          <button onClick={() => { setFromDate(""); setToDate(""); }} className="btn-secondary">Clear</button>
          {/* Currency toggle */}
          <div className="currency-toggle">
            <button className={currency === "USD" ? "active" : ""} onClick={() => setCurrency("USD")}>USD</button>
            <button className={currency === "INR" ? "active" : ""} onClick={() => setCurrency("INR")}>INR ₹</button>
          </div>
        </div>
      </div>

      {loading && <div className="loading-msg">Loading dashboard…</div>}
      {error   && <div className="error-msg">{error}</div>}

      {!loading && summary && (
        <>
          {/* ── KPI Cards ── */}
          <div className="metric-grid">
            <MetricCard
              title="Total Consumption"
              value={summary.totals[`total_consumption${suffix}`]}
              subtitle={`${summary.record_count} record(s)`}
              colorClass="blue"
              isCurrency={currency}
            />
            <MetricCard
              title="Cloud Service Cost"
              value={summary.totals.cloud_service_cost * (currency === "INR" ? 1 : 1)}
              colorClass="purple"
              isCurrency={currency}
            />
            <MetricCard
              title="Marketplace Cost"
              value={summary.totals.marketplace_cost}
              colorClass="purple"
              isCurrency={currency}
            />
            <MetricCard
              title="ILIOS Spend"
              value={summary.totals[`ilios_spend${suffix}`]}
              subtitle="After all deductions"
              colorClass="orange"
              isCurrency={currency}
            />
            <MetricCard
              title="Invoice to Customer"
              value={summary.totals[`invoice_to_customer${suffix}`]}
              colorClass="green"
              isCurrency={currency}
            />
            <MetricCard
              title="ILIOS Margin"
              value={summary.totals[`ilios_margin${suffix}`]}
              subtitle="Invoice − ILIOS Spend"
              colorClass={summary.totals.ilios_margin >= 0 ? "teal" : "red"}
              isCurrency={currency}
            />
          </div>

          {/* ── Trend chart ── */}
          <section className="chart-section">
            <h2>Monthly Trend — Consumption vs Spend vs Invoice ({currency})</h2>
            {summary.monthly_trend.length === 0 ? (
              <p className="no-data">No data for the selected period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={summary.monthly_trend} margin={{ top: 10, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={fmtK} tick={{ fontSize: 12 }} />
                  <Tooltip content={customTooltip} />
                  <Legend />
                  <Bar dataKey={`cloud_service_cost${suffix === "_inr" ? "" : ""}`}
                    name="Cloud Cost" fill={COLORS.cloud_service_cost} stackId="costs" />
                  <Bar dataKey="marketplace_cost"
                    name="Marketplace Cost" fill={COLORS.marketplace_cost} stackId="costs" />
                  <Line type="monotone" dataKey={`ilios_spend${suffix}`}
                    name="ILIOS Spend" stroke={COLORS.ilios_spend} strokeWidth={2} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey={`invoice_to_customer${suffix}`}
                    name="Invoice to Customer" stroke={COLORS.invoice_to_customer} strokeWidth={2} dot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </section>

          {/* ── Margin chart ── */}
          <section className="chart-section">
            <h2>Monthly ILIOS Margin ({currency})</h2>
            {summary.monthly_trend.length === 0 ? (
              <p className="no-data">No data for the selected period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={summary.monthly_trend} margin={{ top: 10, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={fmtK} tick={{ fontSize: 12 }} />
                  <Tooltip content={customTooltip} />
                  <Legend />
                  <Bar dataKey={`ilios_margin${suffix}`}
                    name="ILIOS Margin" fill={COLORS.ilios_margin} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </section>

          {/* ── Monthly breakdown table ── */}
          {summary.monthly_trend.length > 0 && (
            <section className="chart-section">
              <h2>Monthly Breakdown</h2>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Total Consumption</th>
                      <th>Cloud Cost</th>
                      <th>Marketplace Cost</th>
                      <th>ILIOS Spend</th>
                      <th>Invoice to Customer</th>
                      <th>ILIOS Margin</th>
                      <th>Conv. Rate</th>
                      <th>Total (INR)</th>
                      <th>ILIOS Spend (INR)</th>
                      <th>Invoice (INR)</th>
                      <th>Margin (INR)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.monthly_trend.map(row => (
                      <tr key={row.consumption_month_raw}>
                        <td>{row.month}</td>
                        <td>{formatCurrency(row.total_consumption)}</td>
                        <td>{formatCurrency(row.cloud_service_cost)}</td>
                        <td>{formatCurrency(row.marketplace_cost)}</td>
                        <td>{formatCurrency(row.ilios_spend)}</td>
                        <td>{formatCurrency(row.invoice_to_customer)}</td>
                        <td className={row.ilios_margin >= 0 ? "positive" : "negative"}>
                          {formatCurrency(row.ilios_margin)}
                        </td>
                        <td className="rate-cell">
                          {row.conversion_rate ? `₹${Number(row.conversion_rate).toFixed(2)}` : "—"}
                        </td>
                        <td>{formatINR(row.total_consumption_inr)}</td>
                        <td>{formatINR(row.ilios_spend_inr)}</td>
                        <td>{formatINR(row.invoice_to_customer_inr)}</td>
                        <td className={row.ilios_margin_inr >= 0 ? "positive" : "negative"}>
                          {formatINR(row.ilios_margin_inr)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
