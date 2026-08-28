import { useEffect, useState } from "react";
import { CheckCircle, XCircle, AlertTriangle, Info, X } from "lucide-react";
import "./Toast.css";

/**
 * Global Toast notification system.
 *
 * Usage — wrap App in ToastProvider, then call useToast() in any component:
 *
 *   const { toast } = useToast();
 *   toast.success("Saved!");
 *   toast.error("Something went wrong.");
 *   toast.warn("Please check the form.");
 *   toast.info("3 records imported.");
 */

import { createContext, useContext, useCallback, useRef } from "react";

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const add = useCallback((type, message, duration = 3500) => {
    const id = ++idRef.current;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = {
    success: (msg, ms) => add("success", msg, ms),
    error:   (msg, ms) => add("error",   msg, ms),
    warn:    (msg, ms) => add("warning", msg, ms),
    info:    (msg, ms) => add("info",    msg, ms),
  };

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="toast-container" aria-live="polite">
        {toasts.map(t => (
          <ToastItem key={t.id} {...t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

const ICONS = {
  success: CheckCircle,
  error:   XCircle,
  warning: AlertTriangle,
  info:    Info,
};

function ToastItem({ type, message, onDismiss }) {
  const [out, setOut] = useState(false);
  const Icon = ICONS[type] || Info;

  const close = () => {
    setOut(true);
    setTimeout(onDismiss, 200);
  };

  return (
    <div className={`toast toast-${type} ${out ? "toast-out" : ""}`}>
      <Icon size={16} className="toast-icon" strokeWidth={2.5} />
      <span className="toast-msg">{message}</span>
      <button className="toast-close" onClick={close} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
}
