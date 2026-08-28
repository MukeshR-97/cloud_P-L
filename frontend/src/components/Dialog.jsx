import { useEffect } from "react";
import { X, AlertTriangle, Trash2, Info, CheckCircle } from "lucide-react";
import "./Dialog.css";

/**
 * Reusable modal dialog.
 * Usage:
 *   <Dialog
 *     open={true}
 *     type="danger"          // "danger" | "warning" | "info" | "success"
 *     title="Delete record"
 *     message="This cannot be undone."
 *     confirmLabel="Delete"
 *     onConfirm={() => ...}
 *     onClose={() => ...}
 *   />
 */
export default function Dialog({
  open, type = "info", title, message,
  confirmLabel = "Confirm", cancelLabel = "Cancel",
  onConfirm, onClose, children,
}) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const Icon = {
    danger:  Trash2,
    warning: AlertTriangle,
    info:    Info,
    success: CheckCircle,
  }[type] || Info;

  return (
    <div className="dlg-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className={`dlg-box dlg-${type}`} onClick={e => e.stopPropagation()}>
        <div className="dlg-header">
          <div className={`dlg-icon-wrap dlg-icon-${type}`}>
            <Icon size={20} strokeWidth={2} />
          </div>
          <h3 className="dlg-title">{title}</h3>
          <button className="dlg-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {(message || children) && (
          <div className="dlg-body">
            {message && <p className="dlg-msg">{message}</p>}
            {children}
          </div>
        )}
        <div className="dlg-footer">
          <button className="dlg-btn dlg-btn-cancel" onClick={onClose}>
            {cancelLabel}
          </button>
          {onConfirm && (
            <button className={`dlg-btn dlg-btn-confirm dlg-btn-${type}`} onClick={onConfirm}>
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
