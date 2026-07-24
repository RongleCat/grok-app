/** Map ACP permission options → UI buttons (once / session / deny). */

export interface AcpPermissionOption {
  optionId?: string;
  id?: string;
  name?: string;
  label?: string;
  kind?: string;
}

export interface MappedPermButton {
  decision: "allow_once" | "allow_session" | "deny";
  optionId: string;
  label: string;
}

function oid(o: AcpPermissionOption): string {
  return o.optionId || o.id || "";
}

function kindOf(o: AcpPermissionOption): string {
  return (o.kind || "").toLowerCase();
}

function nameOf(o: AcpPermissionOption): string {
  return (o.name || o.label || "").toLowerCase();
}

export interface PermLabelOverrides {
  allowOnce?: string;
  allowSession?: string;
  deny?: string;
}

/** Prefer real Agent optionIds; fall back to kind heuristics. */
export function mapPermissionButtons(
  options: unknown,
  labels?: PermLabelOverrides,
): MappedPermButton[] {
  const arr: AcpPermissionOption[] = Array.isArray(options)
    ? (options as AcpPermissionOption[])
    : [];

  const find = (pred: (o: AcpPermissionOption) => boolean) => arr.find(pred);

  const once =
    find((o) => kindOf(o) === "allow_once") ||
    find((o) => nameOf(o).includes("once") && nameOf(o).includes("allow")) ||
    find((o) => kindOf(o).includes("allow") && !kindOf(o).includes("always"));

  const always =
    find((o) => kindOf(o) === "allow_always") ||
    find((o) => nameOf(o).includes("always") || nameOf(o).includes("session"));

  const reject =
    find((o) => kindOf(o) === "reject_once" || kindOf(o) === "reject_always") ||
    find((o) => nameOf(o).includes("reject") || nameOf(o).includes("deny"));

  const L = {
    allowOnce: labels?.allowOnce ?? "Allow once",
    allowSession: labels?.allowSession ?? "Allow for session",
    deny: labels?.deny ?? "Deny",
  };

  // Always show short i18n labels (agent option names are often long English).
  // optionId still comes from the real ACP option when present.
  const out: MappedPermButton[] = [];
  if (once && oid(once)) {
    out.push({
      decision: "allow_once",
      optionId: oid(once),
      label: L.allowOnce,
    });
  } else {
    out.push({
      decision: "allow_once",
      optionId: "allow_once",
      label: L.allowOnce,
    });
  }
  // Map "Allow for session" to allow_always kind when present (session scope in our Host)
  if (always && oid(always)) {
    out.push({
      decision: "allow_session",
      optionId: oid(always),
      label: L.allowSession,
    });
  } else {
    out.push({
      decision: "allow_session",
      optionId: "allow_always",
      label: L.allowSession,
    });
  }
  if (reject && oid(reject)) {
    out.push({
      decision: "deny",
      optionId: oid(reject),
      label: L.deny,
    });
  } else {
    out.push({ decision: "deny", optionId: "reject", label: L.deny });
  }
  return out;
}
