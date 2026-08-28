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

// ── Split-month ───────────────────────────────────────────────────────────────
/**
 * Add a second payer segment to an existing record (mid-month payer change).
 * record_id = the first segment already in DB.
 * Body: cost fields for the new payer portion.
 */
export const addSplitRow     = (recordId, data)  => api.post(`/records/${recordId}/add-split`, data);

/** Get all records that share a split_month_group UUID. */
export const getSplitGroup   = (groupId)         => api.get(`/records/split-group/${groupId}`);

/** Merge all split segments back into a single combined record. */
export const mergeSplitGroup = (groupId)         => api.post(`/records/split-group/${groupId}/merge`);

// ── AWS Accounts ──────────────────────────────────────────────────────────────
export const getAwsAccounts   = ()            => api.get("/aws-accounts");
export const getAwsAccount    = (id)          => api.get(`/aws-accounts/${id}`);
export const createAwsAccount = (data)        => api.post("/aws-accounts", data);
export const updateAwsAccount = (id, data)    => api.put(`/aws-accounts/${id}`, data);
export const deleteAwsAccount = (id)          => api.delete(`/aws-accounts/${id}`);
export const fetchAwsCosts    = (id)          => api.post(`/aws-accounts/${id}/fetch`);

// ── Payer Management ──────────────────────────────────────────────────────────
/** List all payer history rows for an account */
export const listPayers       = (accountId)          => api.get(`/aws-accounts/${accountId}/payers`);

/**
 * Add a NEW management/payer account to an existing aws_account.
 * Deactivates the previous payer automatically.
 * Body: { payer_account_id, management_account_name?, access_key_id,
 *          secret_access_key, region?, valid_from?, remarks? }
 */
export const addPayer         = (accountId, data)    => api.post(`/aws-accounts/${accountId}/payers`, data);

/**
 * Bulk switch: update the payer for ALL accounts that currently share the
 * same management account as accountId. Use when 10+ children all move payers.
 * Body: same as addPayer.
 */
export const bulkSwitchPayer  = (accountId, data)    => api.post(`/aws-accounts/${accountId}/payers/bulk-switch`, data);

/** Switch the active payer back to a previously inactive one */
export const activatePayer    = (accountId, payerId) => api.put(`/aws-accounts/${accountId}/payers/${payerId}/activate`);

/** Delete a (non-active) payer row */
export const deletePayer      = (accountId, payerId) => api.delete(`/aws-accounts/${accountId}/payers/${payerId}`);

// ── Child Accounts ────────────────────────────────────────────────────────────
export const listChildAccounts = (parentId)          => api.get(`/aws-accounts/${parentId}/list-children`);
export const addChildAccount   = (parentId, data)    => api.post(`/aws-accounts/${parentId}/add-child`, data);

/**
 * Legacy: rotate credentials on the active payer + legacy columns.
 * Prefer addPayer() for full management-account-switch workflow.
 */
export const rotateCredentials = (accountId, data)   => api.post(`/aws-accounts/${accountId}/rotate-credentials`, data);

export default api;
