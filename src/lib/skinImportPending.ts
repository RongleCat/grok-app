export type PendingSkinImport =
  | { kind: "url"; href: string }
  | { kind: "file"; path: string }
  | { kind: "official"; id: string };
