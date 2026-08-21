/**
 * Permission auto-deny seconds. The interval lives here so AppWorkbench
 * does not re-render every 250ms while a gate is open.
 */

import { useEffect, useState } from "react";
import { permissionTimeoutRemainingSec } from "@/lib/permissionTimeout";

export function PermissionCountdown(props: {
  startedAtMs: number;
  timeoutSec: number;
  format: (seconds: string) => string;
}) {
  const { startedAtMs, timeoutSec, format } = props;
  const [sec, setSec] = useState(() =>
    permissionTimeoutRemainingSec(startedAtMs, timeoutSec),
  );

  useEffect(() => {
    setSec(permissionTimeoutRemainingSec(startedAtMs, timeoutSec));
    if (!(timeoutSec > 0)) return;
    const tick = window.setInterval(() => {
      const left = permissionTimeoutRemainingSec(startedAtMs, timeoutSec);
      setSec(left);
      if (left <= 0) window.clearInterval(tick);
    }, 250);
    return () => window.clearInterval(tick);
  }, [startedAtMs, timeoutSec]);

  if (sec <= 0) return null;
  return (
    <span className="perm-bar__countdown" aria-live="polite">
      {format(String(sec))}
    </span>
  );
}
