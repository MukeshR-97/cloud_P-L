import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

const api = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
});

// ── Cost Records ──────────────────────────────────────────────────────────────
export const getRecords          = (params = {}) => api.get("/records", { params });
export const getRecord           = (id)           => api.get(`/records/${id}`);
export const createRecord        = (data)         => api.post("/records", data);
export const updateRecord        = (id, data)     => api.put(`/records/${id}`, data);
export const deleteRecord        = (id)           => api.delete(`/records/${id}`);
export const getDashboardSummary = (params = {})  => api.get("/dashboard/summary", { params });
export const bulkUpdateDiscounts = (data)         => api.post("/records/bulk-update-discounts", data);

// ── Split-month — removed (not needed for direct account key setup)
// Records simply use CUR import per-month for $0 months

// ── AWS Accounts ──────────────────────────────────────────────────────────────
export const getAwsAccounts   = ()            => api.get("/aws-accounts");
export const createAwsAccount = (data)        => api.post("/aws-accounts", data);
export const updateAwsAccount = (id, data)    => api.put(`/aws-accounts/${id}`, data);
export const deleteAwsAccount = (id)          => api.delete(`/aws-accounts/${id}`);
export const fetchAwsCosts    = (id)          => api.post(`/aws-accounts/${id}/fetch`);

// ── Payer Management — REMOVED (distributor manages payers, we don't have those keys)

// ── Child Accounts ────────────────────────────────────────────────────────────
// Removed: listChildAccounts, addChildAccount (management account concept removed)

// ── CUR S3 Import ─────────────────────────────────────────────────────────────
// CUR config is saved via updateAwsAccount (s3_cur_bucket, s3_cur_prefix, s3_cur_region fields)

/**
 * Import monthly costs from S3 CUR files.
 * Used when Cost Explorer returns $0 (distributor changed management account).
 */
export const importCur   = (accountId, data = {}) => api.post(`/aws-accounts/${accountId}/import-cur`, data);
export const diagnoseCur = (accountId)            => api.get(`/aws-accounts/${accountId}/cur-diagnose`);

export default api;
