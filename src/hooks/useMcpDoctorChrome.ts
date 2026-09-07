/**
 * MCP inspect list + doctor report for the status modal.
 *
 * Host fills {@link McpDoctorChromeHost} so `tr` stays late-bound.
 * Does not invent servers — inspect/doctor only report what the CLI has.
 */
import {
  useCallback,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { createT } from "@/i18n";
import * as api from "@/lib/api";

type TFn = ReturnType<typeof createT>;

export type McpDoctorChromeHost = {
  tr: TFn;
};

function emptyHost(): McpDoctorChromeHost {
  return { tr: ((k: string) => k) as TFn };
}

export function createMcpDoctorChromeHost(): McpDoctorChromeHost {
  return emptyHost();
}

export function useMcpDoctorChrome(opts: {
  hostRef: MutableRefObject<McpDoctorChromeHost>;
  projectPath: string | null | undefined;
}) {
  const hostRef = opts.hostRef;
  const [showMcpModal, setShowMcpModal] = useState(false);
  const [mcpServers, setMcpServers] = useState<api.McpDto[]>([]);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpDoctorReport, setMcpDoctorReport] =
    useState<api.McpDoctorReport | null>(null);
  const [mcpDoctorError, setMcpDoctorError] = useState<string | null>(null);
  const [mcpDoctorLoading, setMcpDoctorLoading] = useState(false);
  const [mcpDoctorFocus, setMcpDoctorFocus] = useState<string | null>(null);

  /** Re-run inspect list only — does not clear doctor findings. */
  const refreshMcpModal = useCallback(async () => {
    setMcpLoading(true);
    setMcpError(null);
    try {
      const res = await api.inspectMcp(opts.projectPath ?? null);
      setMcpServers(res.servers ?? []);
      if (res.error) setMcpError(res.error);
    } catch (e) {
      setMcpServers([]);
      setMcpError(String(e));
    } finally {
      setMcpLoading(false);
    }
  }, [opts.projectPath]);

  const openMcpModal = useCallback(async () => {
    setShowMcpModal(true);
    await refreshMcpModal();
  }, [refreshMcpModal]);

  /**
   * Run `grok mcp doctor --json [name]`. Optional name focuses one server
   * that already exists in CLI config.
   */
  const runMcpDoctor = useCallback(
    async (
      name?: string | null,
    ): Promise<{
      report: api.McpDoctorReport | null;
      error: string | null;
    }> => {
      if (!api.isTauri()) {
        const error = hostRef.current.tr("ext.needTauri");
        setMcpDoctorError(error);
        return { report: null, error };
      }
      const focus = name?.trim() || null;
      setMcpDoctorFocus(focus);
      setMcpDoctorLoading(true);
      setMcpDoctorError(null);
      try {
        const report = await api.mcpDoctor(focus);
        setMcpDoctorReport(report);
        return { report, error: null };
      } catch (e) {
        const error = String(e);
        setMcpDoctorReport(null);
        setMcpDoctorError(error);
        return { report: null, error };
      } finally {
        setMcpDoctorLoading(false);
      }
    },
    [hostRef],
  );

  return {
    showMcpModal,
    setShowMcpModal: setShowMcpModal as Dispatch<SetStateAction<boolean>>,
    mcpServers,
    mcpError,
    mcpLoading,
    mcpDoctorReport,
    mcpDoctorError,
    mcpDoctorLoading,
    mcpDoctorFocus,
    refreshMcpModal,
    openMcpModal,
    runMcpDoctor,
  };
}
