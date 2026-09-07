import { useEffect, useState } from "react";
import QRCode from "qrcode";

type QrState = { value: string; dataUrl: string | null; error: boolean };

/** Binding URLs stay in this process. Never send them to a QR image service. */
export function useLocalQrCode(value: string | null) {
  const [state, setState] = useState<QrState | null>(null);

  useEffect(() => {
    if (!value) return;
    let cancelled = false;
    void QRCode.toDataURL(value, {
      width: 180,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#111111", light: "#ffffff" },
    })
      .then((dataUrl) => {
        if (!cancelled) setState({ value, dataUrl, error: false });
      })
      .catch(() => {
        // Do not log errors that could contain the binding URL.
        if (!cancelled) setState({ value, dataUrl: null, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  // Hide the previous QR immediately when a binding refreshes, even before effects run.
  return state && value && state.value === value
    ? { dataUrl: state.dataUrl, error: state.error }
    : { dataUrl: null, error: false };
}
