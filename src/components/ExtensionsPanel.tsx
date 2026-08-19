/**
 * Settings → Extensions: Skills + MCP + Plugins.
 * Skills/MCP from `grok inspect` with enable toggles (extensions.json / ACP inject).
 * Plugins from `grok plugin list/install/update/…` (config.toml disabled list).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "@/lib/api";
import { createT, intlLocale, type Locale, type MessageKey } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import {
  IconDoctor,
  IconEdit,
  IconPlus,
  IconPlug,
  IconPuzzle,
  IconRefresh,
  IconSettings,
  IconSkills,
  IconTrash,
} from "@/components/icons";
import {
  isCliMissingError,
  isExtensionEnabled,
  isProjectSkillSource,
  mcpMetaLine,
  mergeInspectErrors,
  normalizePluginInstallSource,
  pluginRowKey,
  shortPathLabel,
  skillMetaLine,
  skillSourceTone,
  sortMcpByName,
  sortPluginsByName,
  sortSkillsByName,
} from "@/lib/extensionsUi";
import {
  formatPluginValidateMessages,
  pluginValidateBadgeTone,
  pluginValidateHint,
  pluginValidateKindLabel,
  type PluginValidateKind,
  type PluginValidatePresentation,
} from "@/lib/pluginValidate";
import {
  indexDoctorServerStatuses,
  lookupServerStatus,
  mcpAuthGuidanceKey,
  mcpStatusBadgeMod,
  mcpStatusLabelKey,
  redactMcpText,
  type McpServerStatus,
  type McpStatusIndex,
} from "@/lib/mcpStatus";
import {
  classifyMcpOauthFromStatus,
  mcpOauthActionLabelKey,
  type McpOauthAction,
} from "@/lib/mcpOauth";
import { McpOauthWizard } from "@/components/McpOauthWizard";
import {
  isSkillEditable,
  resolveSkillMdPath,
} from "@/lib/skillEditPath";
import { sanitizeSkillFolderName } from "@/lib/skillScaffold";
import { withDiscoverAppPref } from "@/lib/skillCompat";
import {
  buildSkillHostErrorPresentation,
  buildSkillSaveOkPresentation,
  buildSkillSavePreflightError,
  buildSkillValidatePresentation,
  skillEditBadgeTone,
  skillEditHint,
  skillEditKindLabel,
  type SkillEditKind,
  type SkillEditPresentation,
} from "@/lib/skillEditFeedback";
import {
  isFsWriteConflict,
  isResourceDraftDirty,
} from "@/lib/resourceEdit";
import {
  ExtensionsBuildExtras,
  type ExtAgentsTabActions,
} from "@/components/ExtensionsBuildExtras";
import {
  ExtensionsHooksPanel,
  type ExtHooksTabActions,
} from "@/components/ExtensionsHooksPanel";
import {
  installedPluginDetailModel,
  type AvailablePluginDetailModel,
  type PluginComponentBadgeKind,
} from "@/lib/pluginMarketplace";
import {
  CHATCUT_CODEX_INSTALL_SOURCE,
  isChatCutInstalled,
  pluginDisplayName,
  resolveExtensionsTabId,
} from "@/lib/pluginRecommended";
import {
  buildInstalledCard,
  marketplaceCategoryMessageKey,
  parsePluginManifestJson,
  pluginIconPathCandidates,
  pluginInitials,
  pluginManifestPathCandidates,
  type PluginCardKind,
  type PluginCardModel,
} from "@/lib/pluginCard";
import {
  invalidatePluginsListCache,
  loadPluginsListCached,
  patchPluginsListEnabled,
} from "@/lib/pluginsListCache";
import {
  loadMarketplaceCatalog,
  invalidateMarketplaceCatalogCache,
} from "@/lib/marketplaceCatalogCache";
import {
  enrichAvailableFromComponents,
  filterAvailablePlugins,
  marketplaceQualifiedInstallSource,
  sortAvailablePluginsByName,
  type AvailablePluginLike,
  type MarketplaceSourceLike,
} from "@/lib/pluginMarketplace";
import {
  ensureDefaultMarketplaces,
  filterCatalogToDefaultSources,
} from "@/lib/marketplaceDefaults";
import {
  availableToCards,
  buildInstalledPluginNameSet,
  dedupeAvailablePluginsByName,
  filterPluginCardsByQuery,
  installedPluginAliasKeys,
  PLUGIN_CATALOG_PAGE_SIZE,
  pickExpandStackLogos,
  sliceGroupedCatalogPage,
  splitGroupItemsForCollapse,
} from "@/lib/pluginCatalogUi";
import {
  ensureMediaEndpoint,
  localPathToMediaHttpUrl,
} from "@/lib/imageSrc";

type SkillEditorState = {
  skill: api.SkillDto;
  path: string;
  baselineText: string;
  draftText: string;
  mtimeMs: number | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  savedHint: string | null;
};

export type ExtensionsTabId =
  | "plugins"
  | "skills"
  | "mcp"
  | "agents"
  | "hooks"
  /** @deprecated Deep-link only; resolves to plugins. */
  | "market";

export interface ExtensionsPanelProps {
  locale: Locale;
  /** Active workbench project path (inspect cwd — not shown in toolbar). */
  projectPath?: string | null;
  /** Whether CLI probe found a binary (for empty-state copy). */
  cliFound?: boolean;
  /** Page tab from settings hash (`#/settings/extensions/{tab}`). */
  activeTab?: ExtensionsTabId;
  onTabChange?: (tab: ExtensionsTabId) => void;
  /** Navigate to Settings → Runtime when CLI is missing. */
  onOpenRuntime?: () => void;
  /** Fired after skill enable prefs change so slash palette can refresh. */
  onSkillsPrefsChanged?: () => void;
}

export function ExtensionsPanel({
  locale,
  projectPath = null,
  cliFound = true,
  activeTab = "plugins",
  onTabChange,
  onOpenRuntime,
  onSkillsPrefsChanged,
}: ExtensionsPanelProps) {
  const tr = useMemo(() => createT(locale), [locale]);

  const pluginValidateKindLabels = useMemo(
    (): Partial<Record<PluginValidateKind, string>> => ({
      ok: tr("ext.plugins.validate.kind.ok"),
      cli_too_old: tr("ext.plugins.validate.kind.cliTooOld"),
      cli_missing: tr("ext.plugins.validate.kind.cliMissing"),
      empty_source: tr("ext.plugins.validate.kind.emptySource"),
      path_only: tr("ext.plugins.validate.kind.pathOnly"),
      not_found: tr("ext.plugins.validate.kind.notFound"),
      not_a_directory: tr("ext.plugins.validate.kind.notADirectory"),
      no_manifest: tr("ext.plugins.validate.kind.noManifest"),
      parse_error: tr("ext.plugins.validate.kind.parseError"),
      missing_field: tr("ext.plugins.validate.kind.missingField"),
      invalid_manifest: tr("ext.plugins.validate.kind.invalidManifest"),
      host_only: tr("ext.plugins.validate.kind.hostOnly"),
      host_error: tr("ext.plugins.validate.kind.hostError"),
      other: tr("ext.plugins.validate.kind.other"),
    }),
    [tr],
  );

  const pluginValidateKindHints = useMemo(
    (): Partial<Record<PluginValidateKind, string>> => ({
      ok: tr("ext.plugins.validate.hint.ok"),
      cli_too_old: tr("ext.plugins.validate.hint.cliTooOld"),
      cli_missing: tr("ext.plugins.validate.hint.cliMissing"),
      empty_source: tr("ext.plugins.validate.hint.emptySource"),
      path_only: tr("ext.plugins.validate.hint.pathOnly"),
      not_found: tr("ext.plugins.validate.hint.notFound"),
      not_a_directory: tr("ext.plugins.validate.hint.notADirectory"),
      no_manifest: tr("ext.plugins.validate.hint.noManifest"),
      parse_error: tr("ext.plugins.validate.hint.parseError"),
      missing_field: tr("ext.plugins.validate.hint.missingField"),
      invalid_manifest: tr("ext.plugins.validate.hint.invalidManifest"),
      host_only: tr("ext.plugins.validate.hint.hostOnly"),
      host_error: tr("ext.plugins.validate.hint.hostError"),
      other: tr("ext.plugins.validate.hint.other"),
    }),
    [tr],
  );

  const [skills, setSkills] = useState<api.SkillDto[]>([]);
  const [skillRoots, setSkillRoots] = useState<string[]>([]);
  const [skillsDiscover, setSkillsDiscover] =
    useState<api.SkillsCompatSnapshot | null>(null);
  const [servers, setServers] = useState<api.McpDto[]>([]);
  const [plugins, setPlugins] = useState<api.PluginDto[]>([]);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [pluginsError, setPluginsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pathHint, setPathHint] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionErrorSource, setActionErrorSource] = useState<
    "plugin" | "mcp" | null
  >(null);
  const [uninstallTarget, setUninstallTarget] = useState<api.PluginDto | null>(
    null,
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsTitle, setDetailsTitle] = useState("");
  const [detailsBody, setDetailsBody] = useState("");
  const [detailsLoading, setDetailsLoading] = useState(false);
  /** Structured detail when provides / marketplace meta is available. */
  const [detailsModel, setDetailsModel] =
    useState<AvailablePluginDetailModel | null>(null);
  const [installSource, setInstallSource] = useState("");
  /** GlassModal result for last validate (row or advanced install). */
  const [validateModal, setValidateModal] = useState<{
    open: boolean;
    presentation: PluginValidatePresentation | null;
    /** Installed plugin display name, or null for pre-install path. */
    pluginName: string | null;
  }>({ open: false, presentation: null, pluginName: null });
  /** In-app SKILL.md light editor (Settings → Extensions → Skills). */
  const [skillEditor, setSkillEditor] = useState<SkillEditorState | null>(null);
  const [skillDiscardOpen, setSkillDiscardOpen] = useState(false);
  const [skillConflictOpen, setSkillConflictOpen] = useState(false);
  /** Classified validate / load / save feedback (GlassModal — no window.confirm). */
  const [skillFeedback, setSkillFeedback] =
    useState<SkillEditPresentation | null>(null);
  const [skillFeedbackOpen, setSkillFeedbackOpen] = useState(false);
  const skillEditorSeq = useRef(0);
  /** New skill scaffold modal (Extensions → Skills). */
  const [skillNewOpen, setSkillNewOpen] = useState(false);
  const [skillNewName, setSkillNewName] = useState("");
  const [skillNewDesc, setSkillNewDesc] = useState("");
  const [skillNewScope, setSkillNewScope] = useState<"user" | "project">("user");
  const [skillNewError, setSkillNewError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCommand, setAddCommand] = useState("");
  const [addArgs, setAddArgs] = useState("");
  const [addEnv, setAddEnv] = useState("");
  const [removeTarget, setRemoveTarget] = useState<api.McpDto | null>(null);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [doctorLoading, setDoctorLoading] = useState(false);
  const [doctorReport, setDoctorReport] =
    useState<any>(null);
  const [doctorError, setDoctorError] = useState<string | null>(null);
  const [doctorFocus, setDoctorFocus] = useState<string | null>(null);
  /** Last successful doctor run (ms) — shown as lightweight timestamp. */
  const [doctorLastAt, setDoctorLastAt] = useState<number | null>(null);
  /**
   * Cumulative per-server status from doctor runs.
   * Focused doctor re-runs merge in so other servers keep their last tone.
   */
  const [doctorStatusIndex, setDoctorStatusIndex] = useState<McpStatusIndex>(
    () => new Map(),
  );
  /** OAuth recovery wizard target (Authorize / Retry / How to refresh). */
  const [oauthWizardTarget, setOauthWizardTarget] = useState<{
    action: McpOauthAction;
    status: McpServerStatus;
  } | null>(null);
  /** Co-located tab search query. */
  const [extQuery, setExtQuery] = useState("");
  /** Agents / Hooks actions hosted in the tab trail. */
  const [agentsTabActions, setAgentsTabActions] =
    useState<ExtAgentsTabActions | null>(null);
  const [hooksTabActions, setHooksTabActions] =
    useState<ExtHooksTabActions | null>(null);
  /** Expanded installed-plugin rows (secondary actions). */
  /* expandedPluginKeys removed */
  /** Expanded MCP row gear menu (secondary actions). */
  const [expandedMcpNames, setExpandedMcpNames] = useState<
    Record<string, boolean>
  >({});
  /** Confirm Modal for recommended ChatCut install (never auto-install). */
  const [chatcutInstallOpen, setChatcutInstallOpen] = useState(false);
  /** Marketplace sources + advanced install live in a modal (not page body). */
  const [sourcesModalOpen, setSourcesModalOpen] = useState(false);
  /** Enriched cards (manifest + logo) for installed plugins. */
  const [pluginCards, setPluginCards] = useState<PluginCardModel[]>([]);
  /** Discover catalog (available plugins) — own state so we render Featured 2-col. */
  const [catalogPlugins, setCatalogPlugins] = useState<AvailablePluginLike[]>(
    [],
  );
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogPage, setCatalogPage] = useState(1);
  /** Category keys expanded past the 7+more collapse tile. */
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {},
  );
  /** Full meta for detail modal (installed or available). */
  const [detailCard, setDetailCard] = useState<PluginCardModel | null>(null);
  const [detailRawAvailable, setDetailRawAvailable] =
    useState<AvailablePluginLike | null>(null);
  const [detailRawInstalled, setDetailRawInstalled] =
    useState<api.PluginDto | null>(null);
  const [menuPlugin, setMenuPlugin] = useState<api.PluginDto | null>(null);
  /** name(lower) → logo convertFileSrc URL + enriched fields */
  const [metaByName, setMetaByName] = useState<
    Map<
      string,
      {
        displayName?: string | null;
        description?: string | null;
        longDescription?: string | null;
        version?: string | null;
        category?: string | null;
        author?: string | null;
        homepage?: string | null;
        repository?: string | null;
        license?: string | null;
        logoUrl?: string | null;
        keywords?: string[];
      }
    >
  >(() => new Map());
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  const categoryLabel = useCallback(
    (k: PluginCardKind): string => {
      const map: Record<PluginCardKind, MessageKey> = {
        video: "ext.plugins.category.video",
        design: "ext.plugins.category.design",
        mcp: "ext.plugins.category.mcp",
        skills: "ext.plugins.category.skills",
        agents: "ext.plugins.category.agents",
        hooks: "ext.plugins.category.hooks",
        devtools: "ext.plugins.category.devtools",
        productivity: "ext.plugins.category.productivity",
        other: "ext.plugins.category.other",
      };
      return tr(map[k]);
    },
    [tr],
  );

  /** Localize marketplace meta category labels (Developer Tools, Finance, …). */
  const displayCategoryLabel = useCallback(
    (raw: string): string => {
      const key = marketplaceCategoryMessageKey(raw);
      if (key) return tr(key);
      return raw.trim() || tr("ext.plugins.category.other");
    },
    [tr],
  );

  const enrichPluginCards = useCallback(
    async (list: api.PluginDto[]) => {
      const chatcutLabel = tr("ext.plugins.recommended.chatcutName");
      const cards: PluginCardModel[] = [];
      // Prefer loopback media HTTP (path_scope) over convertFileSrc asset protocol.
      await ensureMediaEndpoint();
      for (const p of list) {
        let manifest = null as ReturnType<typeof parsePluginManifestJson>;
        let iconUrl: string | null = null;
        let iconPath: string | null = null;
        const root = (p.path ?? "").trim();
        if (root && api.isTauri()) {
          for (const mpath of pluginManifestPathCandidates(root)) {
            try {
              const res = await api.fsReadAbsolute(mpath);
              const text = res?.text?.trim() ? res.text : null;
              if (text) {
                manifest = parsePluginManifestJson(text);
                if (manifest) break;
              }
            } catch {
              /* try next */
            }
          }
          const logoField =
            (manifest as { logo?: string } | null)?.logo ||
            (manifest as { interface?: { logo?: string; composerIcon?: string } } | null)
              ?.interface?.logo ||
            (manifest as { interface?: { composerIcon?: string } } | null)
              ?.interface?.composerIcon ||
            null;
          const iconTry = [
            logoField
              ? logoField.startsWith("/")
                ? logoField
                : `${root}/${logoField.replace(/^\.\//, "")}`
              : null,
            `${root}/codex/assets/logo-light.png`,
            `${root}/codex/assets/logo.png`,
            `${root}/assets/logo-light.png`,
            `${root}/assets/logo.png`,
            `${root}/assets/logo.svg`,
            `${root}/assets/icon.png`,
            ...pluginIconPathCandidates(root),
          ].filter(Boolean) as string[];
          for (const ip of iconTry) {
            const media = localPathToMediaHttpUrl(ip);
            if (media) {
              iconUrl = media;
              iconPath = ip;
              break;
            }
          }
        }
        cards.push(
          buildInstalledCard(p, {
            chatcutLabel,
            manifest,
            iconPath,
            iconUrl,
            categoryLabel,
          }),
        );
      }
      setPluginCards(cards);
    },
    [categoryLabel, tr],
  );

  const loadCatalog = useCallback(
    async (force = false) => {
      if (!api.isTauri() || !cliFound) {
        setCatalogPlugins([]);
        setCatalogLoading(false);
        return;
      }
      setCatalogLoading(true);
      setCatalogError(null);
      try {
        await ensureDefaultMarketplaces({
          list: async () => {
            const r = await api.marketplaceList();
            return (r.sources ?? []).map((s: Record<string, unknown>) => ({
              name: String(s.name ?? ""),
              url:
                typeof (s as { url?: string }).url === "string"
                  ? (s as { url: string }).url
                  : typeof (s as { source?: { url?: string } }).source?.url ===
                      "string"
                    ? (s as { source: { url: string } }).source.url
                    : null,
              path: null,
              kind: String((s as { kind?: string }).kind ?? "git"),
            }));
          },
          add: async (url) => {
            await api.marketplaceAdd(url);
          },
          remove: async (nameOrUrl) => {
            await api.marketplaceRemove(nameOrUrl);
          },
          removeClaude: true,
        });
        if (force) invalidateMarketplaceCatalogCache();

        const result = await loadMarketplaceCatalog(async () => {
          const [srcRes, availRes] = await Promise.all([
            api.marketplaceList(),
            api.marketplaceAvailable(),
          ]);
          const sources = (srcRes.sources ?? []).map((row) => {
            const o = row as Record<string, unknown>;
            const sourceObj =
              o.source && typeof o.source === "object"
                ? (o.source as Record<string, unknown>)
                : null;
            return {
              name: String(o.name ?? ""),
              kind: String(o.kind ?? "git"),
              url:
                (typeof o.url === "string" && o.url) ||
                (typeof sourceObj?.url === "string" && sourceObj.url) ||
                null,
              path:
                (typeof o.path === "string" && o.path) ||
                (typeof sourceObj?.path === "string" && sourceObj.path) ||
                null,
            } as MarketplaceSourceLike;
          });
          const mapped: AvailablePluginLike[] = [];
          for (const row of availRes.plugins ?? []) {
            const raw = row as Record<string, unknown>;
            const name = String(raw.name ?? "").trim();
            if (!name) continue;
            const skillCountRaw =
              typeof raw.skillCount === "number"
                ? raw.skillCount
                : typeof raw.skill_count === "number"
                  ? raw.skill_count
                  : null;
            const enriched = enrichAvailableFromComponents(raw, {
              skillCount: skillCountRaw,
              hasHooks: !!(raw.hasHooks ?? raw.has_hooks),
              hasAgents: !!(raw.hasAgents ?? raw.has_agents),
              hasMcp: !!(raw.hasMcp ?? raw.has_mcp),
            });
            mapped.push({
              name,
              status: String(raw.status ?? "available").trim() || "available",
              marketplace:
                (typeof raw.marketplace === "string" && raw.marketplace) ||
                null,
              description:
                (typeof raw.description === "string" && raw.description) ||
                null,
              version:
                (typeof raw.version === "string" && raw.version) || null,
              skillCount: enriched.skillCount,
              hasHooks: enriched.hasHooks,
              hasAgents: enriched.hasAgents,
              hasMcp: enriched.hasMcp,
            });
          }
          let available = sortAvailablePluginsByName(
            filterAvailablePlugins(mapped),
          );
          available = filterCatalogToDefaultSources(available, sources);
          available = dedupeAvailablePluginsByName(available);
          return {
            sources,
            available,
            error: srcRes.error?.trim() || availRes.error?.trim() || null,
          };
        }, { force });

        setCatalogPlugins(dedupeAvailablePluginsByName(result.available));
        setCatalogError(result.error);
        if (!force) setCatalogPage(1);

        // Enrich logos / display names from marketplace-cache plugin.json
        try {
          const metaRes = await api.marketplacePluginMetaIndex();
          // Media HTTP is path_scope-gated (includes ~/.grok); do not use convertFileSrc.
          await ensureMediaEndpoint();
          const map = new Map<
            string,
            {
              displayName?: string | null;
              description?: string | null;
              longDescription?: string | null;
              version?: string | null;
              category?: string | null;
              author?: string | null;
              homepage?: string | null;
              repository?: string | null;
              license?: string | null;
              logoUrl?: string | null;
              keywords?: string[];
            }
          >();
          for (const m of metaRes.plugins ?? []) {
            const key = (m.name ?? "").trim().toLowerCase();
            if (!key) continue;
            const logoPath = (m.logoPath ?? "").trim();
            map.set(key, {
              displayName: m.displayName,
              description: m.description,
              longDescription: m.longDescription,
              version: m.version,
              category: m.category,
              author: m.author,
              homepage: m.homepage,
              repository: m.repository,
              license: m.license,
              logoUrl: logoPath ? localPathToMediaHttpUrl(logoPath) : null,
              keywords: m.keywords ?? [],
            });
          }
          setMetaByName(map);
        } catch {
          /* soft-fail: cards still show CLI description */
        }
      } catch (e) {
        setCatalogPlugins([]);
        setCatalogError(String(e));
      } finally {
        setCatalogLoading(false);
      }
    },
    [cliFound],
  );

  const refresh = useCallback(async (opts?: { forcePlugins?: boolean }) => {
    if (!api.isTauri()) {
      setSkills([]);
      setSkillRoots([]);
      setSkillsDiscover(null);
      setServers([]);
      setPlugins([]);
      setPluginCards([]);
      setSkillsError(tr("ext.needTauri"));
      setMcpError(null);
      setPluginsError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setSkillsError(null);
    setMcpError(null);
    setPluginsError(null);
    setPathHint(null);
    const cwd = projectPath?.trim() || null;
    const forcePlugins = !!opts?.forcePlugins;
    const [skillsRes, mcpRes, pluginsRes] = await Promise.all([
      api.skillsList(cwd).catch((e) => ({
        skills: [] as api.SkillDto[],
        skillRoots: [] as string[],
        discoverExternal: undefined,
        error: String(e),
      })),
      api.inspectMcp(cwd).catch((e) => ({
        servers: [] as api.McpDto[],
        error: String(e),
      })),
      loadPluginsListCached(
        async () => {
          try {
            const r = await api.pluginsList();
            return {
              plugins: r.plugins ?? [],
              error: r.error?.trim() || null,
            };
          } catch (e) {
            return { plugins: [], error: String(e) };
          }
        },
        { force: forcePlugins },
      ),
    ]);
    setSkills(sortSkillsByName(skillsRes.skills ?? []));
    setSkillRoots(
      Array.isArray(skillsRes.skillRoots)
        ? skillsRes.skillRoots.filter((r) => typeof r === "string" && r.trim())
        : [],
    );
    setSkillsDiscover(skillsRes.discoverExternal ?? null);
    setServers(sortMcpByName(mcpRes.servers ?? []));
    const list = sortPluginsByName(pluginsRes.plugins ?? []);
    setPlugins(list);
    setSkillsError(skillsRes.error?.trim() ? skillsRes.error : null);
    setMcpError(mcpRes.error?.trim() ? mcpRes.error : null);
    setPluginsError(pluginsRes.error?.trim() ? pluginsRes.error : null);
    setLoading(false);
    // Enrich cards after first paint so cache path feels instant
    void enrichPluginCards(list);
  }, [enrichPluginCards, projectPath, tr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Load discover catalog when plugins tab is shown (cached when possible).
  useEffect(() => {
    if (resolveExtensionsTabId(activeTab) !== "plugins") return;
    void loadCatalog(false);
  }, [activeTab, loadCatalog]);

  useEffect(() => {
    setCatalogPage(1);
    setExpandedGroups({});
  }, [extQuery]);

  const bannerError = useMemo(
    () => mergeInspectErrors(skillsError, mcpError, pluginsError),
    [skillsError, mcpError, pluginsError],
  );
  const cliMissing =
    !cliFound ||
    isCliMissingError(skillsError) ||
    isCliMissingError(mcpError) ||
    isCliMissingError(pluginsError);

  const mcpOffCount = useMemo(
    () => servers.filter((s) => !isExtensionEnabled(s.enabled)).length,
    [servers],
  );
  const skillsOffCount = useMemo(
    () => skills.filter((s) => !isExtensionEnabled(s.enabled)).length,
    [skills],
  );
  const skillsDiscoverHonesty = useMemo(() => {
    if (!skillsDiscover || skillsDiscover.effective) return null;
    if (skillsDiscover.claudeSkills === false || skillsDiscover.cursorSkills === false) {
      return tr("ext.skills.discoverExternalHonesty.configOff");
    }
    if (skillsDiscover.appPref === false) {
      return skillsDiscover.writable
        ? tr("ext.skills.discoverExternalHonesty.appOff")
        : tr("ext.skills.discoverExternalHonesty.sharedHint");
    }
    return null;
  }, [skillsDiscover, tr]);

  const toggleMcp = async (name: string, next: boolean) => {
    if (!api.isTauri() || busyKey) return;
    setBusyKey(`mcp:${name}`);
    setServers((prev) =>
      prev.map((s) => (s.name === name ? { ...s, enabled: next } : s)),
    );
    try {
      await api.extensionsSetMcp(name, next);
    } catch (e) {
      setPathHint(String(e));
      setServers((prev) =>
        prev.map((s) => (s.name === name ? { ...s, enabled: !next } : s)),
      );
    } finally {
      setBusyKey(null);
    }
  };

  const toggleSkill = async (name: string, next: boolean) => {
    if (!api.isTauri() || busyKey) return;
    setBusyKey(`skill:${name}`);
    setSkills((prev) =>
      prev.map((s) => (s.name === name ? { ...s, enabled: next } : s)),
    );
    try {
      await api.extensionsSetSkill(name, next);
      onSkillsPrefsChanged?.();
    } catch (e) {
      setPathHint(String(e));
      setSkills((prev) =>
        prev.map((s) => (s.name === name ? { ...s, enabled: !next } : s)),
      );
    } finally {
      setBusyKey(null);
    }
  };

  const enableAllMcp = async () => {
    if (!api.isTauri() || busyKey || servers.length === 0) return;
    setBusyKey("mcp:all");
    const names = servers.map((s) => s.name);
    setServers((prev) => prev.map((s) => ({ ...s, enabled: true })));
    try {
      await api.extensionsEnableAllMcp(names);
    } catch (e) {
      setPathHint(String(e));
      await refresh();
    } finally {
      setBusyKey(null);
    }
  };

  const toggleDiscoverExternal = async (next: boolean) => {
    if (!api.isTauri() || busyKey) return;
    setBusyKey("skill:discover");
    setSkillsDiscover((prev) =>
      prev ? withDiscoverAppPref(prev, next) : prev,
    );
    try {
      await api.skillsCompatSet(next);
      onSkillsPrefsChanged?.();
      await refresh();
    } catch (e) {
      setPathHint(String(e));
      await refresh();
    } finally {
      setBusyKey(null);
    }
  };

  const enableAllSkills = async () => {
    if (!api.isTauri() || busyKey || skills.length === 0) return;
    setBusyKey("skill:all");
    const names = skills.map((s) => s.name);
    setSkills((prev) => prev.map((s) => ({ ...s, enabled: true })));
    try {
      await api.extensionsEnableAllSkills(names);
      onSkillsPrefsChanged?.();
    } catch (e) {
      setPathHint(String(e));
      await refresh();
    } finally {
      setBusyKey(null);
    }
  };

  const skillEditorDirty = isResourceDraftDirty(
    skillEditor?.draftText,
    skillEditor?.baselineText,
  );

  const skillKindLabels = useMemo((): Partial<Record<SkillEditKind, string>> => {
    return {
      ok: tr("ext.skills.feedback.kind.ok"),
      empty: tr("ext.skills.feedback.kind.empty"),
      too_large: tr("ext.skills.feedback.kind.tooLarge"),
      missing_frontmatter: tr("ext.skills.feedback.kind.missingFrontmatter"),
      unclosed_frontmatter: tr("ext.skills.feedback.kind.unclosedFrontmatter"),
      invalid_frontmatter: tr("ext.skills.feedback.kind.invalidFrontmatter"),
      missing_name: tr("ext.skills.feedback.kind.missingName"),
      invalid_name: tr("ext.skills.feedback.kind.invalidName"),
      name_mismatch: tr("ext.skills.feedback.kind.nameMismatch"),
      missing_description: tr("ext.skills.feedback.kind.missingDescription"),
      empty_body: tr("ext.skills.feedback.kind.emptyBody"),
      conflict: tr("ext.skills.feedback.kind.conflict"),
      path_denied: tr("ext.skills.feedback.kind.pathDenied"),
      path_outside: tr("ext.skills.feedback.kind.pathOutside"),
      bundled_readonly: tr("ext.skills.feedback.kind.bundledReadonly"),
      not_found: tr("ext.skills.feedback.kind.notFound"),
      not_a_file: tr("ext.skills.feedback.kind.notAFile"),
      already_exists: tr("ext.skills.feedback.kind.alreadyExists"),
      host_only: tr("ext.skills.feedback.kind.hostOnly"),
      host_error: tr("ext.skills.feedback.kind.hostError"),
      other: tr("ext.skills.feedback.kind.other"),
    };
  }, [tr]);

  const skillKindHints = useMemo((): Partial<Record<SkillEditKind, string>> => {
    return {
      ok: tr("ext.skills.feedback.hint.ok"),
      empty: tr("ext.skills.feedback.hint.empty"),
      too_large: tr("ext.skills.feedback.hint.tooLarge"),
      missing_frontmatter: tr("ext.skills.feedback.hint.missingFrontmatter"),
      unclosed_frontmatter: tr("ext.skills.feedback.hint.unclosedFrontmatter"),
      invalid_frontmatter: tr("ext.skills.feedback.hint.invalidFrontmatter"),
      missing_name: tr("ext.skills.feedback.hint.missingName"),
      invalid_name: tr("ext.skills.feedback.hint.invalidName"),
      name_mismatch: tr("ext.skills.feedback.hint.nameMismatch"),
      missing_description: tr("ext.skills.feedback.hint.missingDescription"),
      empty_body: tr("ext.skills.feedback.hint.emptyBody"),
      conflict: tr("ext.skills.feedback.hint.conflict"),
      path_denied: tr("ext.skills.feedback.hint.pathDenied"),
      path_outside: tr("ext.skills.feedback.hint.pathOutside"),
      bundled_readonly: tr("ext.skills.feedback.hint.bundledReadonly"),
      not_found: tr("ext.skills.feedback.hint.notFound"),
      not_a_file: tr("ext.skills.feedback.hint.notAFile"),
      already_exists: tr("ext.skills.feedback.hint.alreadyExists"),
      host_only: tr("ext.skills.feedback.hint.hostOnly"),
      host_error: tr("ext.skills.feedback.hint.hostError"),
      other: tr("ext.skills.feedback.hint.other"),
    };
  }, [tr]);

  const openSkillFeedback = useCallback(
    (presentation: SkillEditPresentation) => {
      setSkillFeedback(presentation);
      setSkillFeedbackOpen(true);
    },
    [],
  );

  const closeSkillEditor = useCallback(() => {
    skillEditorSeq.current += 1;
    setSkillEditor(null);
    setSkillDiscardOpen(false);
    setSkillConflictOpen(false);
    setSkillFeedbackOpen(false);
    setSkillFeedback(null);
  }, []);

  const requestCloseSkillEditor = useCallback(() => {
    if (skillEditor?.saving) return;
    if (skillEditorDirty) {
      setSkillDiscardOpen(true);
      return;
    }
    closeSkillEditor();
  }, [closeSkillEditor, skillEditor?.saving, skillEditorDirty]);

  const openSkillEditor = useCallback(
    async (skill: api.SkillDto, opts?: { force?: boolean }) => {
      if (!api.isTauri()) {
        const presentation = buildSkillHostErrorPresentation(
          tr("ext.needTauri"),
          "load",
          {
            labels: skillKindLabels,
            fallbackTitle: tr("ext.skills.editLoadError"),
          },
        );
        openSkillFeedback(presentation);
        setPathHint(tr("ext.needTauri"));
        return;
      }
      // `force` skips client allowlist (e.g. right after create, roots state may lag).
      if (!opts?.force && !isSkillEditable(skill, skillRoots)) return;
      const mdPath = resolveSkillMdPath(skill.path) ?? skill.path?.trim() ?? "";
      if (!mdPath) return;
      const seq = ++skillEditorSeq.current;
      setSkillDiscardOpen(false);
      setSkillConflictOpen(false);
      setSkillFeedbackOpen(false);
      setSkillFeedback(null);
      setSkillEditor({
        skill,
        path: mdPath,
        baselineText: "",
        draftText: "",
        mtimeMs: null,
        loading: true,
        saving: false,
        error: null,
        savedHint: null,
      });
      try {
        const res = await api.skillRead(mdPath, projectPath);
        if (seq !== skillEditorSeq.current) return;
        setSkillEditor({
          skill,
          path: res.path || mdPath,
          baselineText: res.content ?? "",
          draftText: res.content ?? "",
          mtimeMs:
            typeof res.mtimeMs === "number" && Number.isFinite(res.mtimeMs)
              ? res.mtimeMs
              : null,
          loading: false,
          saving: false,
          error: null,
          savedHint: null,
        });
      } catch (e) {
        if (seq !== skillEditorSeq.current) return;
        const presentation = buildSkillHostErrorPresentation(e, "load", {
          path: mdPath,
          labels: skillKindLabels,
          fallbackTitle: tr("ext.skills.editLoadError"),
        });
        setSkillEditor({
          skill,
          path: mdPath,
          baselineText: "",
          draftText: "",
          mtimeMs: null,
          loading: false,
          saving: false,
          error: presentation.summary || tr("ext.skills.editLoadError"),
          savedHint: null,
        });
        openSkillFeedback(presentation);
      }
    },
    [openSkillFeedback, projectPath, skillKindLabels, skillRoots, tr],
  );

  const validateSkillEditor = useCallback(() => {
    if (!skillEditor || skillEditor.loading) return;
    const presentation = buildSkillValidatePresentation(skillEditor.draftText, {
      expectedName: skillEditor.skill.name,
      path: skillEditor.path,
      labels: skillKindLabels,
      titles: {
        ok: tr("ext.skills.feedback.validateOk"),
        fail: tr("ext.skills.feedback.validateFail"),
      },
    });
    setSkillEditor((s) =>
      s
        ? {
            ...s,
            error: presentation.blocking ? presentation.summary : null,
            savedHint: presentation.blocking
              ? null
              : presentation.summary || tr("ext.skills.feedback.validateOk"),
          }
        : s,
    );
    openSkillFeedback(presentation);
  }, [openSkillFeedback, skillEditor, skillKindLabels, tr]);

  const saveSkillEditor = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!skillEditor || skillEditor.loading || skillEditor.saving) return;
      if (
        !isResourceDraftDirty(skillEditor.draftText, skillEditor.baselineText) &&
        !opts?.force
      ) {
        return;
      }

      // Client-side SKILL.md validate before host write (force overwrite still validates).
      const preflight = buildSkillSavePreflightError(skillEditor.draftText, {
        isTauri: api.isTauri(),
        expectedName: skillEditor.skill.name,
        path: skillEditor.path,
        labels: skillKindLabels,
        hostOnlyTitle: tr("ext.needTauri"),
      });
      if (preflight) {
        setSkillEditor((s) =>
          s
            ? {
                ...s,
                error: preflight.summary,
                savedHint: null,
              }
            : s,
        );
        openSkillFeedback(preflight);
        return;
      }

      setSkillEditor((s) =>
        s ? { ...s, saving: true, error: null, savedHint: null } : s,
      );
      try {
        const expected = opts?.force ? null : skillEditor.mtimeMs;
        const w = await api.skillWrite(
          skillEditor.path,
          skillEditor.draftText,
          expected,
          projectPath,
        );
        const saved = skillEditor.draftText;
        const okPresentation = buildSkillSaveOkPresentation({
          path: w.path || skillEditor.path,
          name: skillEditor.skill.name,
          sizeBytes: w.size,
          labels: skillKindLabels,
          title: tr("ext.skills.editSaved"),
        });
        setSkillEditor((s) =>
          s
            ? {
                ...s,
                saving: false,
                baselineText: saved,
                draftText: saved,
                mtimeMs: w.mtimeMs,
                path: w.path || s.path,
                error: null,
                savedHint: tr("ext.skills.editSaved"),
              }
            : s,
        );
        setSkillFeedback(okPresentation);
        // Reload Extensions list + composer skills picker.
        await refresh();
        onSkillsPrefsChanged?.();
      } catch (e) {
        if (isFsWriteConflict(e)) {
          setSkillEditor((s) => (s ? { ...s, saving: false } : s));
          setSkillConflictOpen(true);
          return;
        }
        const presentation = buildSkillHostErrorPresentation(e, "save", {
          path: skillEditor.path,
          labels: skillKindLabels,
          fallbackTitle: tr("ext.skills.editSaveError"),
        });
        setSkillEditor((s) =>
          s
            ? {
                ...s,
                saving: false,
                error: presentation.summary || tr("ext.skills.editSaveError"),
              }
            : s,
        );
        openSkillFeedback(presentation);
      }
    },
    [
      onSkillsPrefsChanged,
      openSkillFeedback,
      projectPath,
      refresh,
      skillEditor,
      skillKindLabels,
      tr,
    ],
  );

  const skillNewSanitized = useMemo(
    () => sanitizeSkillFolderName(skillNewName),
    [skillNewName],
  );

  const openSkillNew = useCallback(() => {
    setSkillNewName("");
    setSkillNewDesc("");
    setSkillNewScope("user");
    setSkillNewError(null);
    setSkillNewOpen(true);
  }, []);

  const submitSkillNew = useCallback(async () => {
    if (!api.isTauri() || actionBusy) return;
    const safe = sanitizeSkillFolderName(skillNewName);
    if (!safe) {
      setSkillNewError(tr("ext.skills.newNameInvalid"));
      return;
    }
    const scope: "user" | "project" =
      skillNewScope === "project" && projectPath?.trim()
        ? "project"
        : "user";
    if (skillNewScope === "project" && !projectPath?.trim()) {
      setSkillNewError(tr("ext.skills.newScopeProjectNeed"));
      return;
    }
    setActionBusy("skill:create");
    setSkillNewError(null);
    setActionError(null);
    try {
      const res = await api.skillCreate({
        name: safe,
        description: skillNewDesc,
        projectPath,
        scope,
      });
      setSkillNewOpen(false);
      setSkillNewName("");
      setSkillNewDesc("");
      await refresh();
      onSkillsPrefsChanged?.();
      // Reuse existing SKILL.md editor open flow.
      const dto: api.SkillDto = {
        name: res.name,
        description: skillNewDesc.trim(),
        source: scope === "project" ? "project" : "user",
        path: res.path,
        userInvocable: true,
        enabled: true,
      };
      // Roots React state may lag one frame after refresh — force open by path.
      void openSkillEditor(dto, { force: true });
    } catch (e) {
      const presentation = buildSkillHostErrorPresentation(e, "create", {
        labels: skillKindLabels,
        fallbackTitle: tr("ext.skills.newError"),
      });
      setSkillNewError(presentation.summary || tr("ext.skills.newError"));
      openSkillFeedback(presentation);
    } finally {
      setActionBusy(null);
    }
  }, [
    actionBusy,
    onSkillsPrefsChanged,
    openSkillEditor,
    openSkillFeedback,
    projectPath,
    refresh,
    skillKindLabels,
    skillNewDesc,
    skillNewName,
    skillNewScope,
    tr,
  ]);

  const runPluginAction = async (
    key: string,
    action: () => Promise<unknown>,
    opts?: { soft?: boolean },
  ) => {
    setActionBusy(key);
    setActionError(null);
    setActionErrorSource(null);
    try {
      await action();
      if (opts?.soft) {
        // Enable/disable: trust patch + local state (no full CLI list).
        setPlugins((prev) =>
          prev.map((p) => {
            const match =
              pluginRowKey(p) === key ||
              p.name === key ||
              key.endsWith(`:${p.name}`);
            if (!match) return p;
            // action already flipped via API; read from patch cache when possible
            return p;
          }),
        );
        await refresh({ forcePlugins: false });
      } else {
        invalidatePluginsListCache();
        await refresh({ forcePlugins: true });
      }
    } catch (e) {
      setActionError(String(e));
      setActionErrorSource("plugin");
    } finally {
      setActionBusy(null);
    }
  };

  const togglePlugin = (p: api.PluginDto) => {
    const key = pluginRowKey(p);
    const nextEnabled = !p.enabled;
    void runPluginAction(
      key,
      async () => {
        if (p.enabled) {
          await api.pluginDisable(p.name);
        } else {
          await api.pluginEnable(p.name);
        }
        patchPluginsListEnabled(p.name, nextEnabled);
        setPlugins((prev) =>
          prev.map((row) =>
            row.name === p.name ? { ...row, enabled: nextEnabled } : row,
          ),
        );
        setPluginCards((prev) =>
          prev.map((c) =>
            c.name === p.name ? { ...c, enabled: nextEnabled } : c,
          ),
        );
      },
      { soft: true },
    );
  };

  const confirmUninstall = async () => {
    const target = uninstallTarget;
    if (!target) return;
    const key = pluginRowKey(target);
    setUninstallTarget(null);
    await runPluginAction(key, async () => {
      await api.pluginUninstall(target.name);
    });
  };

  const installPlugin = async () => {
    if (!api.isTauri() || actionBusy || cliMissing) return;
    const source = normalizePluginInstallSource(installSource);
    if (!source) {
      setActionError(tr("ext.plugins.installEmpty"));
      return;
    }
    await runPluginAction("install", async () => {
      await api.pluginInstall(source);
      setInstallSource("");
    });
  };

  const showDetails = async (p: api.PluginDto) => {
    setDetailsTitle(p.name);
    setDetailsBody("");
    setDetailsModel(
      installedPluginDetailModel({
        name: p.name,
        version: p.version,
        marketplace: p.marketplace,
        status: p.status || "installed",
        provides: p.provides
          ? {
              skills: p.provides.skills,
              agents: p.provides.agents,
              hooks: p.provides.hooks,
              mcpServers: p.provides.mcpServers,
            }
          : null,
      }),
    );
    setDetailsOpen(true);
    setDetailsLoading(true);
    setActionError(null);
    try {
      const res = await api.pluginDetails(p.name);
      setDetailsBody(res.details?.trim() || tr("ext.plugins.detailsEmpty"));
    } catch (e) {
      setDetailsBody(String(e));
    } finally {
      setDetailsLoading(false);
    }
  };

  const badgeLabel = useCallback(
    (kind: PluginComponentBadgeKind, count?: number | null) => {
      if (kind === "skills" && typeof count === "number" && count > 0) {
        return tr("ext.market.badge.skillsCount", { n: String(count) });
      }
      const key =
        kind === "skills"
          ? "ext.market.badge.skills"
          : kind === "hooks"
            ? "ext.market.badge.hooks"
            : kind === "agents"
              ? "ext.market.badge.agents"
              : "ext.market.badge.mcp";
      return tr(key);
    },
    [tr],
  );

  const resetAddForm = () => {
    setAddName("");
    setAddCommand("");
    setAddArgs("");
    setAddEnv("");
  };

  const openAdd = () => {
    resetAddForm();
    setActionError(null);
    setAddOpen(true);
  };

  const submitAdd = async () => {
    if (!api.isTauri() || actionBusy) return;
    const name = addName.trim();
    const command = addCommand.trim();
    if (!name || !command) return;
    const args = splitArgs(addArgs);
    const env = parseEnvLines(addEnv);
    setActionBusy("mcp:add");
    setActionError(null);
    setActionErrorSource(null);
    try {
      await api.mcpAdd({
        name,
        command,
        args,
        env: Object.keys(env).length ? env : undefined,
      });
      setAddOpen(false);
      resetAddForm();
      await refresh();
    } catch (e) {
      setActionError(String(e));
      setActionErrorSource("mcp");
    } finally {
      setActionBusy(null);
    }
  };

  const confirmRemoveMcp = async () => {
    const target = removeTarget;
    if (!target || !api.isTauri()) return;
    setRemoveTarget(null);
    setActionBusy(`mcp:rm:${target.name}`);
    setActionError(null);
    setActionErrorSource(null);
    try {
      await api.mcpRemove(target.name);
      await refresh();
    } catch (e) {
      setActionError(String(e));
      setActionErrorSource("mcp");
    } finally {
      setActionBusy(null);
    }
  };

  const runDoctor = useCallback(
    async (
      focusName?: string | null,
    ): Promise<{ report: unknown; error: string | null }> => {
      if (!api.isTauri()) {
        return { report: null, error: tr("ext.needTauri") };
      }
      setDoctorOpen(true);
      setDoctorLoading(true);
      setDoctorError(null);
      setDoctorFocus(focusName?.trim() || null);
      try {
        const report = await api.mcpDoctor(focusName?.trim() || null);
        setDoctorReport(report);
        setDoctorLastAt(Date.now());
        const next = indexDoctorServerStatuses(report);
        setDoctorStatusIndex((prev) => {
          // Full doctor (no focus): replace. Focused: merge into previous.
          if (!focusName?.trim()) return next;
          const merged = new Map(prev);
          for (const [k, v] of next) merged.set(k, v);
          return merged;
        });
        return { report, error: null };
      } catch (e) {
        const error = String(e);
        setDoctorReport(null);
        setDoctorError(error);
        return { report: null, error };
      } finally {
        setDoctorLoading(false);
      }
    },
    [tr],
  );

  const openOauthWizard = useCallback(
    (action: McpOauthAction | null, status: McpServerStatus) => {
      if (action) {
        setOauthWizardTarget({ action, status });
        return;
      }
      // No OAuth classifier hit — still open wizard with a synthetic action
      // so the user gets TUI / re-add instructions (soft-fail path).
      const isRetry = status.tone === "auth_expired";
      setOauthWizardTarget({
        action: {
          kind: isRetry ? "retry" : "authorize",
          authUrls: [],
          preferredUrl: null,
          server: status.name,
          isRetry,
        },
        status,
      });
    },
    [],
  );

  /** Live index for the open doctor modal (may be a focused subset). */
  const doctorReportStatusIndex = useMemo(
    () => indexDoctorServerStatuses(doctorReport),
    [doctorReport],
  );

  const doctorLastLabel = useMemo(() => {
    if (!doctorLastAt) return null;
    try {
      const d = new Date(doctorLastAt);
      if (Number.isNaN(d.getTime())) return null;
      return d.toLocaleString(intlLocale(locale), {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return null;
    }
  }, [doctorLastAt, locale]);

  // Legacy market deep-link / search → plugins (no top-level market tab).
  const tab = resolveExtensionsTabId(activeTab);
  const chatcutInstalled = useMemo(
    () => isChatCutInstalled(plugins),
    [plugins],
  );

  const q = extQuery.trim().toLowerCase();
  const filterText = useCallback(
    (parts: Array<string | null | undefined>) => {
      if (!q) return true;
      return parts.some((p) => (p ?? "").toLowerCase().includes(q));
    },
    [q],
  );

  const filteredSkills = useMemo(() => {
    if (!q) return skills;
    return skills.filter((s) =>
      filterText([s.name, s.description, s.source, s.path]),
    );
  }, [skills, q, filterText]);

  /** User-managed MCP vs plugin-provided (honest empty when unknown). */
  const { userMcpServers, pluginMcpServers } = useMemo(() => {
    const user: api.McpDto[] = [];
    const fromPlugin: api.McpDto[] = [];
    for (const s of servers) {
      const vendor = (s.vendor ?? "").toLowerCase();
      const src = `${s.vendor ?? ""} ${s.target ?? ""} ${s.name ?? ""}`.toLowerCase();
      const looksPlugin =
        vendor.includes("plugin") ||
        src.includes("plugin:") ||
        src.includes("/plugins/") ||
        !!(s as { fromPlugin?: boolean }).fromPlugin;
      if (looksPlugin) fromPlugin.push(s);
      else user.push(s);
    }
    return { userMcpServers: user, pluginMcpServers: fromPlugin };
  }, [servers]);

  const filteredUserMcp = useMemo(() => {
    if (!q) return userMcpServers;
    return userMcpServers.filter((s) =>
      filterText([s.name, s.target, s.transport, s.vendor]),
    );
  }, [userMcpServers, q, filterText]);

  const filteredPluginMcp = useMemo(() => {
    if (!q) return pluginMcpServers;
    return pluginMcpServers.filter((s) =>
      filterText([s.name, s.target, s.transport, s.vendor]),
    );
  }, [pluginMcpServers, q, filterText]);

  const mcpCount = servers.length;
  const searchPlaceholder =
    tab === "mcp"
      ? tr("ext.search.mcp")
      : tab === "skills"
        ? tr("ext.search.skills")
        : tr("ext.search.plugins");
  /** Search only on list tabs; Agents/Hooks use the same trail slot for actions. */
  const showTabSearch =
    tab === "plugins" || tab === "mcp" || tab === "skills";

  const installChatCut = async () => {
    if (!api.isTauri() || actionBusy || cliMissing) return;
    setChatcutInstallOpen(false);
    await runPluginAction("install:chatcut", async () => {
      await api.pluginInstall(CHATCUT_CODEX_INSTALL_SOURCE);
    });
  };

  const installAvailableDirect = async (target: AvailablePluginLike) => {
    if (!api.isTauri() || actionBusy || cliMissing) return;
    const source = marketplaceQualifiedInstallSource(
      target.name,
      target.marketplace,
    );
    await runPluginAction(`inst:${target.name}`, async () => {
      await api.pluginInstall(source);
      invalidateMarketplaceCatalogCache();
      void loadCatalog(true);
    });
  };

  const installedNameSet = useMemo(
    () => buildInstalledPluginNameSet(plugins),
    [plugins],
  );

  const discoverCards = useMemo(() => {
    const cards = availableToCards(catalogPlugins, {
      installedNames: installedNameSet,
      categoryLabel,
      metaByName,
    });
    // Second pass: guard against any residual id/name dupes after enrich
    const seen = new Set<string>();
    const unique = cards.filter((c) => {
      const k = c.name.trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return filterPluginCardsByQuery(unique, extQuery);
  }, [catalogPlugins, installedNameSet, categoryLabel, extQuery, metaByName]);

  /**
   * Group full catalog first, then take a prefix — so loading more only
   * appends below (never re-inserts into earlier category sections).
   */
  const discoverPage = useMemo(
    () =>
      sliceGroupedCatalogPage(
        discoverCards,
        catalogPage,
        PLUGIN_CATALOG_PAGE_SIZE,
      ),
    [discoverCards, catalogPage],
  );

  const discoverGroups = discoverPage.groups;
  const catalogHasMore = discoverPage.hasMore;
  const catalogVisibleCount = discoverPage.visibleCount;
  const catalogTotal = discoverPage.total;

  // Keep latest hasMore for the observer without re-binding every page.
  const catalogHasMoreRef = useRef(catalogHasMore);
  catalogHasMoreRef.current = catalogHasMore;
  const catalogLoadLockRef = useRef(false);

  // Infinite scroll: append next page when sentinel enters view.
  // Avoid re-creating the observer on every length change (that + regroup
  // used to yank scroll upward). After each page grow, re-check once in
  // case the sentinel is still visible at the bottom.
  useEffect(() => {
    if (resolveExtensionsTabId(activeTab) !== "plugins") return;
    const el = loadMoreSentinelRef.current;
    if (!el) return;

    const tryLoadMore = () => {
      if (!catalogHasMoreRef.current) return;
      if (catalogLoadLockRef.current) return;
      catalogLoadLockRef.current = true;
      setCatalogPage((p) => p + 1);
      // Unlock on next frame so one intersection cannot multi-fire.
      requestAnimationFrame(() => {
        catalogLoadLockRef.current = false;
      });
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) tryLoadMore();
      },
      // Modest rootMargin — large pre-fetch + regroup used to feel like bounce.
      { root: null, rootMargin: "120px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [activeTab, catalogHasMore]);

  // If the sentinel stays in view after content grows, IntersectionObserver
  // will not re-fire (no edge change). Nudge another page when still visible.
  useEffect(() => {
    if (resolveExtensionsTabId(activeTab) !== "plugins") return;
    if (!catalogHasMore) return;
    const el = loadMoreSentinelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewportH =
      typeof window !== "undefined" ? window.innerHeight : 0;
    if (rect.top <= viewportH + 120) {
      if (catalogLoadLockRef.current) return;
      catalogLoadLockRef.current = true;
      setCatalogPage((p) => p + 1);
      requestAnimationFrame(() => {
        catalogLoadLockRef.current = false;
      });
    }
  }, [activeTab, catalogHasMore, catalogVisibleCount]);

  return (
    <div className="ext-panel ext-ref-shell" data-testid="extensions-panel">
      <p className="settings-page__lead">{tr("ext.lead")}</p>

      {onTabChange ? (
        <div
          className="ext-ref-tabs"
          role="tablist"
          aria-label={tr("settings.nav.extensions")}
        >
          <div className="ext-ref-tabs__list" role="presentation">
            {(
              [
                ["plugins", "ext.plugins.title", plugins.length] as const,
                ["mcp", "ext.mcp.title", mcpCount] as const,
                ["skills", "ext.skills.title", skills.length] as const,
                ["agents", "ext.agents.title", null] as const,
                ["hooks", "ext.hooks.title", null] as const,
              ] as const
            ).map(([id, key, count]) => (
              <button
                key={id}
                type="button"
                role="tab"
                className={
                  "ext-ref-tabs__tab" + (tab === id ? " is-on" : "")
                }
                aria-selected={tab === id}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onTabChange(id);
                  setExtQuery("");
                }}
              >
                <span>{tr(key)}</span>
                {!loading && count != null ? (
                  <span className="ext-ref-tabs__count">{count}</span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="ext-ref-tabs__trail">
            {showTabSearch ? (
              <input
                type="search"
                className="settings-input"
                value={extQuery}
                placeholder={searchPlaceholder}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setExtQuery(e.target.value)}
                aria-label={searchPlaceholder}
              />
            ) : tab === "agents" ? (
              <div className="ext-ref-tabs__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={!agentsTabActions || agentsTabActions.busy}
                  onClick={() => agentsTabActions?.refresh()}
                >
                  <IconRefresh size={14} />
                  <span>{tr("ext.refresh")}</span>
                </button>
                <button
                  type="button"
                  className="btn btn--solid btn--sm"
                  disabled={!agentsTabActions || agentsTabActions.busy}
                  onClick={() => agentsTabActions?.openNew()}
                >
                  <IconPlus size={14} />
                  <span>
                    {agentsTabActions?.busy
                      ? tr("ext.agents.creating")
                      : tr("ext.agents.new")}
                  </span>
                </button>
              </div>
            ) : tab === "hooks" ? (
              <div className="ext-ref-tabs__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={
                    !hooksTabActions ||
                    hooksTabActions.busy ||
                    hooksTabActions.loading
                  }
                  onClick={() => hooksTabActions?.refresh()}
                >
                  <IconRefresh size={14} />
                  <span>
                    {hooksTabActions?.loading
                      ? tr("ext.refreshing")
                      : tr("ext.refresh")}
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {pathHint && (
        <p className="ext-alert ext-alert--warn" role="status">
          {pathHint}
        </p>
      )}

      {actionError && (
        <div className="ext-alert ext-alert--error" role="alert">
          <div className="ext-alert__title">
            {actionErrorSource === "mcp"
              ? tr("ext.mcp.actionError")
              : tr("ext.plugins.actionError")}
          </div>
          <p className="ext-alert__body">{actionError}</p>
          <button
            type="button"
            className="btn btn--ghost ext-alert__cta"
            onClick={() => {
              setActionError(null);
              setActionErrorSource(null);
            }}
          >
            {tr("common.close")}
          </button>
        </div>
      )}

      {bannerError && (
        <div
          className={
            "ext-alert" + (cliMissing ? " ext-alert--error" : " ext-alert--warn")
          }
          role="alert"
        >
          <div className="ext-alert__title">
            {cliMissing ? tr("ext.error.cliTitle") : tr("ext.error.title")}
          </div>
          <p className="ext-alert__body">
            {cliMissing ? tr("ext.error.cliBody") : bannerError}
          </p>
          {cliMissing && onOpenRuntime ? (
            <button
              type="button"
              className="btn btn--solid ext-alert__cta"
              onClick={onOpenRuntime}
            >
              {tr("ext.error.openRuntime")}
            </button>
          ) : null}
          {cliMissing && bannerError && !isCliMissingError(bannerError) ? (
            <p className="ext-alert__detail">{bannerError}</p>
          ) : null}
          {cliMissing && isCliMissingError(bannerError) ? (
            <p className="ext-alert__detail">{bannerError}</p>
          ) : null}
        </div>
      )}

      {/* Plugins — reference layout: installed strip + 2-col featured catalog */}
      {tab === "plugins" && (
      <div className="ext-ref-stack ext-ref-plugins-scroll">
        {/* Installed strip */}
        <section
          className="ext-ref-block"
          id="settings-anchor-ext-plugins"
        >
          <div className="ext-ref-section-label">
            {tr("ext.plugins.installedTitle")}
            {!loading ? ` · ${plugins.length}` : ""}
          </div>
          {loading && plugins.length === 0 ? (
            <p className="ext-ref-empty">{tr("ext.plugins.loading")}</p>
          ) : null}
          {!loading && plugins.length === 0 ? (
            <p className="ext-ref-empty">
              {cliMissing ? tr("ext.plugins.emptyCli") : tr("ext.plugins.empty")}
            </p>
          ) : null}
          {plugins.length > 0 ? (
            <div className="ext-ref-installed-strip" role="list">
              {(pluginCards.length > 0
                ? pluginCards
                : plugins.map((p) =>
                    buildInstalledCard(p, {
                      chatcutLabel: tr("ext.plugins.recommended.chatcutName"),
                      categoryLabel,
                    }),
                  )
              ).map((c) => {
                const raw = plugins.find((p) => p.name === c.name);
                const meta = metaByName.get(c.name.trim().toLowerCase());
                const logo = c.iconUrl || meta?.logoUrl || null;
                const label =
                  meta?.displayName?.trim() || c.displayName;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="listitem"
                    className={
                      "ext-ref-installed-chip" + (c.enabled ? "" : " is-off")
                    }
                    title={label}
                    aria-label={label}
                    onClick={() => {
                      setDetailCard({
                        ...c,
                        displayName: label,
                        description:
                          meta?.description ||
                          c.description ||
                          meta?.longDescription ||
                          c.description,
                        iconUrl: logo,
                      });
                      setDetailRawInstalled(raw ?? null);
                      setDetailRawAvailable(null);
                    }}
                  >
                    {logo ? (
                      <img
                        src={logo}
                        alt=""
                        onError={(e) => {
                          const el = e.target as HTMLImageElement;
                          const btn = el.parentElement;
                          el.remove();
                          if (!btn) return;
                          if (btn.querySelector(".ext-ref-icon__glyph")) return;
                          const span = document.createElement("span");
                          span.className = "ext-ref-icon__glyph";
                          span.textContent = pluginInitials(label);
                          btn.appendChild(span);
                        }}
                      />
                    ) : (
                      <span className="ext-ref-icon__glyph">
                        {pluginInitials(label)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : null}
        </section>

        {/* Recommended ChatCut if missing */}
        {!chatcutInstalled ? (
          <section
            className="ext-ref-block"
            id="settings-anchor-ext-plugins-recommended"
          >
            <div className="ext-ref-section-label">
              {tr("ext.plugins.recommendedTitle")}
            </div>
            <ul className="ext-ref-featured">
              <li className="ext-ref-featured__item">
                <div className="ext-ref-featured__icon" aria-hidden>
                  <IconPuzzle size={18} />
                </div>
                <div className="ext-ref-featured__body">
                  <div className="ext-ref-featured__title">
                    {tr("ext.plugins.recommended.chatcutName")}
                  </div>
                  <div className="ext-ref-featured__desc">
                    {tr("ext.plugins.recommended.chatcutDesc")}
                  </div>
                </div>
                <div className="ext-ref-featured__end">
                  <button
                    type="button"
                    className="btn btn--solid btn--sm"
                    disabled={!!actionBusy || cliMissing}
                    onClick={() => setChatcutInstallOpen(true)}
                  >
                    {actionBusy === "install:chatcut"
                      ? tr("ext.plugins.installing")
                      : tr("ext.plugins.recommended.install")}
                  </button>
                </div>
              </li>
            </ul>
          </section>
        ) : null}

        {/* Discover / Featured catalog — 2 columns, paginated */}
        <section
          className="ext-ref-block"
          id="settings-anchor-ext-plugins-catalog"
        >
          <div className="ext-ref-block__head">
            <div className="ext-ref-section-label">
              {tr("ext.plugins.discoverTitle")}
              {!catalogLoading && discoverCards.length > 0
                ? ` · ${discoverCards.length}`
                : ""}
            </div>
            <span className="ext-ref-block__actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={loading || catalogLoading || !!actionBusy || cliMissing}
                onClick={() => {
                  void refresh({ forcePlugins: true });
                  void loadCatalog(true);
                }}
              >
                <IconRefresh size={14} />
                <span>
                  {loading || catalogLoading
                    ? tr("ext.refreshing")
                    : tr("ext.refresh")}
                </span>
              </button>
              <button
                type="button"
                className="ext-ref-icon-btn"
                disabled={cliMissing}
                onClick={() => setSourcesModalOpen(true)}
                title={tr("ext.plugins.sourcesAndInstall")}
                aria-label={tr("ext.plugins.sourcesAndInstall")}
              >
                <IconSettings size={16} />
              </button>
            </span>
          </div>
          {catalogError ? (
            <div className="ext-alert ext-alert--warn" role="status">
              <p className="ext-alert__body">{catalogError}</p>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => void loadCatalog(true)}
              >
                {tr("ext.market.retry")}
              </button>
            </div>
          ) : null}
          {catalogLoading && catalogPlugins.length === 0 ? (
            <p className="ext-ref-empty">{tr("ext.market.availableLoading")}</p>
          ) : null}
          {!catalogLoading && discoverCards.length === 0 && !catalogError ? (
            <p className="ext-ref-empty">
              {cliMissing
                ? tr("ext.market.emptyCli")
                : extQuery.trim()
                  ? tr("ext.market.availableEmpty")
                  : tr("ext.market.emptyCatalog")}
            </p>
          ) : null}
          {catalogVisibleCount > 0 ? (
            <div className="ext-ref-cat-stack">
              {discoverGroups.map((group) => {
                const expanded = !!expandedGroups[group.key];
                const {
                  visible: visibleItems,
                  remaining,
                  collapsed,
                  moreCount,
                } = splitGroupItemsForCollapse(group.items, expanded);
                // Image logos only, preferred first; reverse for stack paint order.
                const stackIcons = pickExpandStackLogos(remaining);
                return (
                <section
                  key={group.key}
                  className="ext-ref-cat-group"
                  aria-label={displayCategoryLabel(group.label)}
                >
                  <div className="ext-ref-section-label ext-ref-cat-group__label">
                    {displayCategoryLabel(group.label)}
                    <span className="ext-ref-cat-group__count">
                      {group.items.length}
                    </span>
                  </div>
                  <ul className="ext-ref-featured">
                    {visibleItems.map((c) => {
                      const nameKey = c.name.trim().toLowerCase();
                      const raw =
                        catalogPlugins.find(
                          (p) => p.name.trim().toLowerCase() === nameKey,
                        ) ?? null;
                      const busy =
                        actionBusy === `inst:${c.name}` ||
                        actionBusy === `install:chatcut`;
                      const installed = c.installed;
                      const meta = metaByName.get(nameKey);
                      const hasLogo = !!(c.iconUrl && c.iconUrl.trim());
                      // Resolve installed dto even when CLI used a hash-suffixed name
                      const installedDto =
                        plugins.find(
                          (p) => p.name.trim().toLowerCase() === nameKey,
                        ) ??
                        plugins.find((p) =>
                          installedPluginAliasKeys(p).includes(nameKey),
                        ) ??
                        null;
                      return (
                        <li
                          key={nameKey}
                          className={
                            "ext-ref-featured__item" +
                            (installed ? " is-off" : "")
                          }
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            setDetailCard({
                              ...c,
                              installed: installed || !!installedDto,
                            });
                            setDetailRawAvailable(raw);
                            setDetailRawInstalled(installedDto);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setDetailCard({
                                ...c,
                                installed: installed || !!installedDto,
                              });
                              setDetailRawAvailable(raw);
                              setDetailRawInstalled(installedDto);
                            }
                          }}
                        >
                          {hasLogo ? (
                            <div
                              className="ext-ref-featured__icon ext-ref-featured__icon--logo"
                              aria-hidden
                            >
                              <img
                                src={c.iconUrl!}
                                alt=""
                                onError={(e) => {
                                  const wrap = (e.target as HTMLImageElement)
                                    .parentElement;
                                  if (wrap) {
                                    wrap.classList.remove(
                                      "ext-ref-featured__icon--logo",
                                    );
                                    wrap.classList.add(
                                      "ext-ref-featured__icon--fallback",
                                    );
                                    (e.target as HTMLImageElement).remove();
                                    const span = document.createElement("span");
                                    span.className = "ext-ref-icon__glyph";
                                    span.textContent = pluginInitials(
                                      c.displayName,
                                    );
                                    wrap.appendChild(span);
                                  }
                                }}
                              />
                            </div>
                          ) : (
                            <div
                              className="ext-ref-featured__icon ext-ref-featured__icon--fallback"
                              aria-hidden
                            >
                              <span className="ext-ref-icon__glyph">
                                {pluginInitials(c.displayName)}
                              </span>
                            </div>
                          )}
                          <div className="ext-ref-featured__body">
                            <div className="ext-ref-featured__title">
                              {c.displayName}
                            </div>
                            <div className="ext-ref-featured__desc">
                              {c.description ||
                                meta?.longDescription ||
                                c.providesLine ||
                                c.marketplace ||
                                "—"}
                            </div>
                          </div>
                          <div
                            className="ext-ref-featured__end"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {installed ? (
                              <span className="ext-ref-badge">
                                {tr("ext.market.installedBadge")}
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="btn btn--solid btn--sm"
                                disabled={
                                  busy || !!actionBusy || cliMissing || !raw
                                }
                                onClick={() => {
                                  if (raw) void installAvailableDirect(raw);
                                }}
                              >
                                {busy
                                  ? tr("ext.market.installing")
                                  : tr("ext.market.install")}
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                    {collapsed && moreCount > 0 ? (
                      <li
                        key={`${group.key}__more`}
                        className="ext-ref-featured__item ext-ref-featured__more-tile"
                        role="button"
                        tabIndex={0}
                        aria-label={tr("ext.plugins.groupMoreHint")}
                        title={tr("ext.plugins.groupMoreHint")}
                        onClick={() => {
                          setExpandedGroups((prev) => ({
                            ...prev,
                            [group.key]: true,
                          }));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setExpandedGroups((prev) => ({
                              ...prev,
                              [group.key]: true,
                            }));
                          }
                        }}
                      >
                        {stackIcons.length > 0 ? (
                          <div className="ext-ref-stack-icons" aria-hidden>
                            {stackIcons.map((ic, idx) => (
                              <span
                                key={ic.key}
                                className="ext-ref-stack-icons__item"
                                style={{ zIndex: idx + 1 }}
                              >
                                <img
                                  src={ic.iconUrl}
                                  alt=""
                                  onError={(e) => {
                                    // No text-glyph fallback on expand stack —
                                    // drop broken image tiles entirely.
                                    const wrap = (e.target as HTMLImageElement)
                                      .parentElement;
                                    wrap?.remove();
                                  }}
                                />
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div
                            className="ext-ref-featured__icon ext-ref-featured__icon--fallback ext-ref-featured__more-icon"
                            aria-hidden
                          >
                            <span className="ext-ref-icon__glyph">+</span>
                          </div>
                        )}
                        <div className="ext-ref-featured__body">
                          <div className="ext-ref-featured__title">
                            {tr("ext.plugins.groupMore", {
                              n: String(moreCount),
                            })}
                          </div>
                          <div className="ext-ref-featured__desc">
                            {tr("ext.plugins.groupMoreHint")}
                          </div>
                        </div>
                      </li>
                    ) : null}
                  </ul>
                </section>
                );
              })}
            </div>
          ) : null}
          {/* Infinite-scroll sentinel (no button) */}
          {catalogHasMore ? (
            <div
              ref={loadMoreSentinelRef}
              className="ext-ref-load-more"
              aria-hidden
            >
              <span className="ext-ref-block__meta">
                {catalogVisibleCount} / {catalogTotal}
              </span>
            </div>
          ) : catalogTotal > 0 ? (
            <div className="ext-ref-load-more">
              <span className="ext-ref-block__meta">{catalogTotal}</span>
            </div>
          ) : null}
        </section>
      </div>
      )}

      {/* Skills */}
      {tab === "skills" && (
      <>
      <h2 className="settings-page__h2" id="settings-anchor-ext-skills">
        <IconSkills size={15} />
        {tr("ext.skills.title")}
        {!loading ? (
          <span className="ext-count">{skills.length}</span>
        ) : null}
        <span className="ext-h2-actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={!!actionBusy || !!busyKey || !api.isTauri() || !!skillEditor}
            onClick={openSkillNew}
          >
            <IconPlus size={14} />
            <span>{tr("ext.skills.new")}</span>
          </button>
          {!loading && skills.length > 0 && skillsOffCount > 0 ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={!!busyKey}
              onClick={() => void enableAllSkills()}
            >
              {tr("ext.enableAll")}
            </button>
          ) : null}
        </span>
      </h2>
      <div
        className="settings-card ext-card"
        id="settings-anchor-ext-skills-discover"
      >
        <div className="ext-ref-row ext-ref-row--dense">
          <div className="ext-ref-row__main">
            <div className="ext-ref-row__body">
              <div className="ext-ref-row__title">
                <span className="ext-ref-row__title-text">
                  {tr("ext.skills.discoverExternal")}
                </span>
              </div>
              <div className="ext-ref-row__desc">
                {tr("ext.skills.discoverExternalDesc")}
              </div>
              {skillsDiscoverHonesty ? (
                <div className="ext-ref-row__meta">{skillsDiscoverHonesty}</div>
              ) : null}
              {!loading &&
              skillsDiscover &&
              skillsDiscover.hiddenCount > 0 ? (
                <div className="ext-ref-row__meta">
                  {tr("ext.skills.discoverExternalHidden", {
                    n: skillsDiscover.hiddenCount,
                  })}
                </div>
              ) : null}
            </div>
            <div className="ext-ref-row__end">
              <ExtensionToggle
                checked={skillsDiscover?.appPref !== false}
                disabled={!!busyKey || !api.isTauri()}
                label={tr("ext.skills.discoverExternal")}
                onChange={(next) => void toggleDiscoverExternal(next)}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="settings-card ext-card">
        {loading && (
          <p className="ext-empty">{tr("ext.skills.loading")}</p>
        )}
        {!loading && skills.length === 0 && (
          <p className="ext-empty">
            {cliMissing ? tr("ext.skills.emptyCli") : tr("ext.skills.empty")}
          </p>
        )}
        {!loading && skills.length > 0 && filteredSkills.length === 0 && (
          <p className="ext-empty">{tr("ext.plugins.filterEmpty")}</p>
        )}
        {!loading && filteredSkills.length > 0 && (
          <ul className="ext-ref-list">
            {filteredSkills.map((s) => {
              const tone = skillSourceTone(s.source);
              const on = isExtensionEnabled(s.enabled);
              const editable = isSkillEditable(s, skillRoots);
              return (
                <li
                  key={`${s.source}:${s.name}:${s.path ?? ""}`}
                  className={
                    "ext-ref-row ext-ref-row--dense" +
                    (on ? "" : " ext-ref-row--off")
                  }
                >
                  <div className="ext-ref-row__main">
                    <div className="ext-ref-row__icon" aria-hidden>
                      <IconSkills size={14} />
                    </div>
                    <div className="ext-ref-row__body">
                      <div className="ext-ref-row__title">
                        <span className="ext-ref-row__title-text">{s.name}</span>
                        {isProjectSkillSource(s.source) ? (
                          <span
                            className="skill-scope-tag skill-scope-tag--project"
                            title={tr("ext.skills.badge.project")}
                          >
                            [{tr("ext.skills.badge.project")}]
                          </span>
                        ) : null}
                      </div>
                      <div className="ext-ref-row__desc">
                        {s.description || skillMetaLine(s) || "—"}
                      </div>
                      <div className="ext-ref-row__meta">
                        <span className={`ext-ref-badge ext-badge--${tone}`}>
                          {normalizeSourceLabel(s.source)}
                        </span>
                        {s.userInvocable ? (
                          <span className="ext-ref-badge">
                            {tr("ext.skills.invocable")}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="ext-ref-row__end">
                      {editable ? (
                        <button
                          type="button"
                          className="ext-ref-gear"
                          disabled={!!busyKey || !!skillEditor}
                          title={tr("ext.skills.edit")}
                          aria-label={tr("ext.skills.edit")}
                          onClick={() => void openSkillEditor(s)}
                        >
                          <IconEdit size={14} />
                        </button>
                      ) : null}
                      <ExtensionToggle
                        checked={on}
                        disabled={!!busyKey}
                        label={on ? tr("ext.enabled") : tr("ext.disabled")}
                        onChange={(next) => void toggleSkill(s.name, next)}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      </>
      )}

      {/* MCP */}
      {tab === "mcp" && (
      <>
      <h2 className="settings-page__h2" id="settings-anchor-ext-mcp">
        <IconPlug size={15} />
        {tr("ext.mcp.title")}
        {!loading ? (
          <span className="ext-count">{servers.length}</span>
        ) : null}
        <span className="ext-h2-actions">
          {doctorLastLabel ? (
            <span
              className="ext-h2-meta"
              role="status"
              title={tr("ext.mcp.doctorLastAt", { time: doctorLastLabel })}
            >
              {tr("ext.mcp.doctorLastAt", { time: doctorLastLabel })}
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={!!actionBusy || !!busyKey || cliMissing}
            onClick={() => void runDoctor(null)}
          >
            <IconDoctor size={14} />
            <span>{tr("ext.mcp.doctor")}</span>
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={!!actionBusy || !!busyKey || !api.isTauri()}
            onClick={openAdd}
          >
            <IconPlus size={14} />
            <span>{tr("ext.mcp.add")}</span>
          </button>
          {!loading && servers.length > 0 && mcpOffCount > 0 ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={!!busyKey || !!actionBusy}
              onClick={() => void enableAllMcp()}
            >
              {tr("ext.enableAll")}
            </button>
          ) : null}
        </span>
      </h2>
      <div className="ext-ref-stack">
        {loading ? (
          <p className="ext-ref-empty">{tr("ext.mcp.loading")}</p>
        ) : filteredUserMcp.length === 0 ? (
          <p className="ext-ref-empty">
            {cliMissing
              ? tr("ext.mcp.emptyCli")
              : q
                ? tr("ext.plugins.filterEmpty")
                : tr("ext.mcp.empty")}
          </p>
        ) : (
          <ul className="ext-ref-list">
            {filteredUserMcp.map((s) => {
              const meta = mcpMetaLine(s);
              const on = isExtensionEnabled(s.enabled);
              const rmBusy = actionBusy === `mcp:rm:${s.name}`;
              const st = lookupServerStatus(doctorStatusIndex, s.name);
              const badgeMod = st ? mcpStatusBadgeMod(st.tone) : null;
              const guidanceKey = st ? mcpAuthGuidanceKey(st.tone) : null;
              const oauthAction = st
                ? classifyMcpOauthFromStatus(st)
                : null;
              const expanded = !!expandedMcpNames[s.name];
              return (
                <li
                  key={s.name}
                  className={
                    "ext-ref-row" + (on ? "" : " ext-ref-row--off")
                  }
                >
                  <div className="ext-ref-row__main">
                    <div className="ext-ref-row__icon" aria-hidden>
                      <IconPlug size={16} />
                    </div>
                    <div className="ext-ref-row__body">
                      <div className="ext-ref-row__title">{s.name}</div>
                      <div className="ext-ref-row__desc">
                        {meta || s.target || "—"}
                      </div>
                      {st && badgeMod ? (
                        <div className="ext-ref-row__meta">
                          <span
                            className={
                              "ext-mcp-status ext-mcp-status--" + badgeMod
                            }
                            title={st.reason ?? undefined}
                          >
                            <span
                              className="ext-mcp-status__lamp"
                              aria-hidden
                            />
                            <span
                              className={"ext-badge ext-badge--" + badgeMod}
                            >
                              {tr(mcpStatusLabelKey(st.tone) as MessageKey)}
                            </span>
                          </span>
                        </div>
                      ) : null}
                    </div>
                    <div className="ext-ref-row__end">
                      <button
                        type="button"
                        className="ext-ref-gear"
                        disabled={!!actionBusy || doctorLoading}
                        aria-label={tr("ext.mcp.serverSettings")}
                        title={tr("ext.mcp.serverSettings")}
                        onClick={() =>
                          setExpandedMcpNames((prev) => ({
                            ...prev,
                            [s.name]: !prev[s.name],
                          }))
                        }
                      >
                        <IconSettings size={16} />
                      </button>
                      <ExtensionToggle
                        checked={on}
                        disabled={!!busyKey || !!actionBusy}
                        label={on ? tr("ext.enabled") : tr("ext.disabled")}
                        onChange={(next) => void toggleMcp(s.name, next)}
                      />
                    </div>
                  </div>
                  {expanded ? (
                    <div className="ext-ref-row__expand">
                      {(() => {
                        const transport = (s.transport || "").toLowerCase();
                        const isRemoteHttp =
                          transport === "http" ||
                          transport === "sse" ||
                          /^https?:\/\//i.test(s.target || "");
                        const showAuth =
                          (st?.needsAuthRefresh && guidanceKey) ||
                          (isRemoteHttp &&
                            (!st ||
                              st.tone === "auth_required" ||
                              st.tone === "auth_expired" ||
                              st.tone === "error" ||
                              st.tone === "unknown"));
                        if (!showAuth) return null;
                        const syntheticStatus: McpServerStatus = st ?? {
                          name: s.name,
                          tone: "auth_required",
                          needsAuthRefresh: true,
                          reason: null,
                          issues: [],
                          healthy: null,
                        };
                        const action =
                          oauthAction ??
                          classifyMcpOauthFromStatus(syntheticStatus) ??
                          ({
                            kind: "authorize" as const,
                            authUrls: [] as string[],
                            preferredUrl: null as string | null,
                            server: s.name,
                            isRetry: false,
                          });
                        return (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() =>
                              openOauthWizard(action, syntheticStatus)
                            }
                          >
                            {tr(
                              mcpOauthActionLabelKey(
                                action.kind,
                              ) as MessageKey,
                            )}
                          </button>
                        );
                      })()}
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={
                          !!actionBusy || doctorLoading || cliMissing
                        }
                        onClick={() => void runDoctor(s.name)}
                      >
                        <IconDoctor size={13} />
                        <span>{tr("ext.mcp.doctor")}</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm ext-item__danger"
                        disabled={rmBusy || !!actionBusy}
                        onClick={() => setRemoveTarget(s)}
                      >
                        <IconTrash size={13} />
                        <span>
                          {rmBusy
                            ? tr("ext.plugins.working")
                            : tr("ext.mcp.remove")}
                        </span>
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {!loading ? (
          <section className="ext-ref-block">
            <div className="ext-ref-section-label">
              {tr("ext.mcp.fromPluginsTitle")}
            </div>
            {filteredPluginMcp.length === 0 ? (
              <p className="ext-ref-empty">{tr("ext.mcp.fromPluginsEmpty")}</p>
            ) : (
              <ul className="ext-ref-list">
                {filteredPluginMcp.map((s) => (
                  <li key={`plugin-mcp:${s.name}`} className="ext-ref-row">
                    <div className="ext-ref-row__main">
                      <div className="ext-ref-row__icon" aria-hidden>
                        <IconPlug size={16} />
                      </div>
                      <div className="ext-ref-row__body">
                        <div className="ext-ref-row__title">{s.name}</div>
                        <div className="ext-ref-row__desc">
                          {mcpMetaLine(s) || s.vendor || "—"}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
      </>
      )}

      {tab === "hooks" && (
        <ExtensionsHooksPanel
          locale={locale}
          projectPath={projectPath}
          cliFound={cliFound && !cliMissing}
          hidePageToolbar
          onTabActionsChange={setHooksTabActions}
        />
      )}
      {tab === "agents" && (
        <ExtensionsBuildExtras
          locale={locale}
          projectPath={projectPath}
          cliFound={cliFound && !cliMissing}
          mode="agents"
          hidePageToolbar
          onTabActionsChange={setAgentsTabActions}
          installedPlugins={plugins.map((p) => ({
            name: p.name,
            marketplace: p.marketplace,
            path: p.path,
            source: p.source,
            repoKey: p.repoKey,
          }))}
          onOpenRuntime={onOpenRuntime}
          onPluginsChanged={() => {
            void refresh();
          }}
        />
      )}

      <GlassModal
        open={chatcutInstallOpen}
        onClose={() => {
          if (actionBusy !== "install:chatcut") setChatcutInstallOpen(false);
        }}
        title={tr("ext.plugins.recommended.installTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={actionBusy === "install:chatcut"}
              onClick={() => setChatcutInstallOpen(false)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={actionBusy === "install:chatcut" || cliMissing}
              onClick={() => void installChatCut()}
            >
              {actionBusy === "install:chatcut"
                ? tr("ext.plugins.installing")
                : tr("ext.plugins.recommended.install")}
            </button>
          </>
        }
      >
        <p className="app-dialog__msg">
          {tr("ext.plugins.recommended.installConfirm", {
            source: CHATCUT_CODEX_INSTALL_SOURCE,
          })}
        </p>
        <p className="ext-field-hint">{tr("ext.market.installTrustNote")}</p>
      </GlassModal>

      <GlassModal
        open={!!detailCard}
        onClose={() => {
          setDetailCard(null);
          setDetailRawAvailable(null);
          setDetailRawInstalled(null);
        }}
        title={detailCard?.displayName ?? tr("ext.market.detailTitle")}
        size="md"
        closeLabel={tr("common.close")}
        wrapBody
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setDetailCard(null);
                setDetailRawAvailable(null);
                setDetailRawInstalled(null);
              }}
            >
              {tr("common.close")}
            </button>
            {detailRawAvailable && !detailCard?.installed ? (
              <button
                type="button"
                className="btn btn--solid"
                disabled={
                  !!actionBusy ||
                  cliMissing ||
                  actionBusy === `inst:${detailRawAvailable.name}`
                }
                onClick={() => {
                  const t = detailRawAvailable;
                  setDetailCard(null);
                  setDetailRawAvailable(null);
                  void installAvailableDirect(t);
                }}
              >
                {actionBusy === `inst:${detailRawAvailable.name}`
                  ? tr("ext.market.installing")
                  : tr("ext.market.install")}
              </button>
            ) : null}
            {detailRawInstalled ? (
              <button
                type="button"
                className="btn btn--solid"
                onClick={() => {
                  togglePlugin(detailRawInstalled);
                  setDetailCard(null);
                  setDetailRawInstalled(null);
                }}
              >
                {detailRawInstalled.enabled
                  ? tr("ext.plugins.disable")
                  : tr("ext.plugins.enable")}
              </button>
            ) : null}
          </>
        }
      >
        {detailCard ? (
          <div className="ext-market-detail">
            <div
              style={{
                display: "flex",
                gap: 14,
                alignItems: "flex-start",
                marginBottom: 12,
              }}
            >
              <div className="ext-ref-featured__icon" aria-hidden>
                {detailCard.iconUrl ? (
                  <img src={detailCard.iconUrl} alt="" />
                ) : (
                  <span className="ext-ref-icon__glyph">
                    {pluginInitials(detailCard.displayName)}
                  </span>
                )}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="ext-ref-featured__title">
                  {detailCard.displayName}
                </div>
                <div className="ext-ref-featured__desc">
                  {detailCard.description || "—"}
                </div>
              </div>
            </div>
            {(() => {
              const meta = metaByName.get(
                detailCard.name.trim().toLowerCase(),
              );
              const clean: Array<[string, string]> = [];
              clean.push([
                tr("ext.market.field.marketplace"),
                detailCard.marketplace?.trim() || "—",
              ]);
              clean.push([
                tr("ext.market.field.version"),
                String(detailCard.version || meta?.version || "—"),
              ]);
              if (meta?.category || detailCard.categoryLabel) {
                clean.push([
                  detailCard.categoryLabel || "Category",
                  meta?.category || detailCard.categoryLabel || "—",
                ]);
              }
              if (meta?.author) clean.push(["Author", meta.author]);
              if (meta?.homepage) clean.push(["Homepage", meta.homepage]);
              if (meta?.repository) clean.push(["Repository", meta.repository]);
              if (meta?.license) clean.push(["License", meta.license]);
              if (detailCard.providesLine) {
                clean.push([
                  tr("ext.market.componentsLabel"),
                  detailCard.providesLine,
                ]);
              }
              if (meta?.keywords && meta.keywords.length > 0) {
                clean.push(["Keywords", meta.keywords.join(", ")]);
              }
              if (detailRawInstalled?.path) {
                clean.push(["Path", detailRawInstalled.path]);
              }
              if (detailRawInstalled?.source) {
                clean.push([
                  tr("ext.market.field.source"),
                  detailRawInstalled.source,
                ]);
              }
              return (
                <dl className="ext-market-detail__meta">
                  {clean.map(([k, v]) => (
                    <div key={k} className="ext-market-detail__row">
                      <dt>{k}</dt>
                      <dd title={v}>{v}</dd>
                    </div>
                  ))}
                </dl>
              );
            })()}
            {(() => {
              const meta = metaByName.get(
                detailCard.name.trim().toLowerCase(),
              );
              const long =
                meta?.longDescription?.trim() ||
                detailCard.description ||
                "";
              if (!long) return null;
              return (
                <p className="ext-field-hint" style={{ marginTop: 12 }}>
                  {long}
                </p>
              );
            })()}
            {!detailCard.installed ? (
              <p className="ext-field-hint" style={{ marginTop: 8 }}>
                {tr("ext.market.installTrustNote")}
              </p>
            ) : null}
          </div>
        ) : null}
      </GlassModal>

      <GlassModal
        open={!!menuPlugin}
        onClose={() => setMenuPlugin(null)}
        title={
          pluginDisplayName(
            menuPlugin,
            tr("ext.plugins.recommended.chatcutName"),
          )
        }
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setMenuPlugin(null)}
          >
            {tr("common.close")}
          </button>
        }
      >
        {menuPlugin ? (
          <div className="ext-ref-stack" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn--ghost"
              style={{ justifyContent: "flex-start" }}
              onClick={() => {
                togglePlugin(menuPlugin);
                setMenuPlugin(null);
              }}
            >
              {menuPlugin.enabled
                ? tr("ext.plugins.disable")
                : tr("ext.plugins.enable")}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              style={{ justifyContent: "flex-start" }}
              onClick={() => {
                void showDetails(menuPlugin);
                setMenuPlugin(null);
              }}
            >
              {tr("ext.plugins.details")}
            </button>
            <button
              type="button"
              className="btn btn--ghost ext-item__danger"
              style={{ justifyContent: "flex-start" }}
              onClick={() => {
                setUninstallTarget(menuPlugin);
                setMenuPlugin(null);
              }}
            >
              {tr("ext.plugins.uninstall")}
            </button>
          </div>
        ) : null}
      </GlassModal>

      <GlassModal
        open={sourcesModalOpen}
        onClose={() => setSourcesModalOpen(false)}
        title={tr("ext.plugins.sourcesModalTitle")}
        size="lg"
        closeLabel={tr("common.close")}
        wrapBody
        footer={
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setSourcesModalOpen(false)}
          >
            {tr("common.close")}
          </button>
        }
      >
        <p className="ext-ref-block__lead" style={{ marginBottom: 12 }}>
          {tr("ext.plugins.sourcesModalLead")}
        </p>
        <div className="ext-ref-block" style={{ marginBottom: 16 }}>
          <div className="ext-ref-block__head">
            <h3 className="ext-ref-block__title">
              {tr("ext.plugins.sourcesListTitle")}
            </h3>
          </div>
          {/* Reuse market block for sources management only (non-embedded shows sources). */}
          <ExtensionsBuildExtras
            locale={locale}
            projectPath={projectPath}
            cliFound={cliFound && !cliMissing}
            mode="market"
            embedded
            sourcesOnly
            installedPlugins={plugins.map((p) => ({
              name: p.name,
              marketplace: p.marketplace,
              path: p.path,
              source: p.source,
              repoKey: p.repoKey,
            }))}
            onOpenRuntime={onOpenRuntime}
            onPluginsChanged={() => {
              invalidatePluginsListCache();
              void refresh({ forcePlugins: true });
            }}
          />
        </div>
        <div className="ext-ref-advanced" style={{ borderRadius: 12 }}>
          <div style={{ padding: "12px 14px" }}>
            <div className="ext-ref-block__title" style={{ marginBottom: 8 }}>
              {tr("ext.plugins.advancedInstall")}
            </div>
            <div className="ext-plugin-install">
              <label
                className="ext-plugin-install__label"
                htmlFor="ext-plugin-source-modal"
              >
                {tr("ext.plugins.installLabel")}
              </label>
              <div className="ext-plugin-install__row">
                <input
                  id="ext-plugin-source-modal"
                  type="text"
                  className="settings-input ext-plugin-install__input"
                  value={installSource}
                  placeholder={tr("ext.plugins.installPlaceholder")}
                  disabled={!!actionBusy || cliMissing}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setInstallSource(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void installPlugin();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn--solid btn--sm"
                  disabled={
                    !!actionBusy ||
                    cliMissing ||
                    !normalizePluginInstallSource(installSource)
                  }
                  onClick={() => void installPlugin()}
                >
                  {actionBusy === "install"
                    ? tr("ext.plugins.installing")
                    : tr("ext.plugins.install")}
                </button>
              </div>
              <p className="ext-plugin-install__hint">
                {tr("ext.plugins.installHint")}
              </p>
            </div>
          </div>
        </div>
      </GlassModal>

      <GlassModal
        open={!!uninstallTarget}
        onClose={() => {
          if (!actionBusy) setUninstallTarget(null);
        }}
        title={tr("ext.plugins.uninstallTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={!!actionBusy}
              onClick={() => setUninstallTarget(null)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={!!actionBusy}
              onClick={() => void confirmUninstall()}
            >
              {tr("ext.plugins.uninstall")}
            </button>
          </>
        }
      >
        <p className="app-dialog__msg">
          {tr("ext.plugins.uninstallConfirm", {
            name: uninstallTarget?.name ?? "",
          })}
        </p>
      </GlassModal>

      <GlassModal
        open={validateModal.open && !!validateModal.presentation}
        onClose={() =>
          setValidateModal((prev) => ({ ...prev, open: false }))
        }
        title={
          validateModal.pluginName
            ? tr("ext.plugins.validate.resultTitleNamed", {
                name: validateModal.pluginName,
              })
            : tr("ext.plugins.validate.resultTitle")
        }
        size="lg"
        closeLabel={tr("common.close")}
        wrapBody
        bodyClassName="ext-plugin-result-modal"
        footer={
          <button
            type="button"
            className="btn btn--solid"
            onClick={() =>
              setValidateModal((prev) => ({ ...prev, open: false }))
            }
          >
            {tr("common.close")}
          </button>
        }
      >
        {validateModal.presentation ? (
          <div className="ext-plugin-result">
            <div className="ext-plugin-result__meta">
              <span
                className={
                  "ext-badge ext-badge--" +
                  pluginValidateBadgeTone(validateModal.presentation.severity)
                }
              >
                {pluginValidateKindLabel(
                  validateModal.presentation.kind,
                  pluginValidateKindLabels,
                )}
              </span>
              {validateModal.presentation.softFail ? (
                <span className="ext-badge ext-badge--muted">
                  {tr("ext.plugins.validate.softFail")}
                </span>
              ) : null}
              {validateModal.presentation.ok ? (
                <span className="ext-badge ext-badge--ok">
                  {tr("ext.plugins.validateOk")}
                </span>
              ) : null}
            </div>
            <p
              className={
                "ext-plugin-result__summary" +
                (validateModal.presentation.severity === "ok"
                  ? " ext-plugin-result__summary--ok"
                  : validateModal.presentation.severity === "err"
                    ? " ext-plugin-result__summary--err"
                    : " ext-plugin-result__summary--warn")
              }
            >
              {validateModal.presentation.summary}
            </p>
            {pluginValidateHint(
              validateModal.presentation.kind,
              pluginValidateKindHints,
            ) ? (
              <p className="ext-plugin-result__hint">
                {pluginValidateHint(
                  validateModal.presentation.kind,
                  pluginValidateKindHints,
                )}
              </p>
            ) : null}
            {validateModal.presentation.detail &&
            validateModal.presentation.detail !==
              validateModal.presentation.summary ? (
              <pre className="ext-plugin-result__detail">
                {validateModal.presentation.detail}
              </pre>
            ) : validateModal.presentation.messages.length > 1 ? (
              <pre className="ext-plugin-result__detail">
                {formatPluginValidateMessages(
                  validateModal.presentation.messages,
                )}
              </pre>
            ) : null}
            {validateModal.presentation.reason ? (
              <p className="ext-plugin-result__reason">
                <span className="ext-plugin-result__label">
                  {tr("ext.plugins.validate.reason")}
                </span>
                <code>{validateModal.presentation.reason}</code>
              </p>
            ) : null}
            {validateModal.presentation.path ? (
              <p
                className="ext-plugin-result__path"
                title={validateModal.presentation.path}
              >
                <span className="ext-plugin-result__label">
                  {tr("ext.plugins.validate.path")}
                </span>
                <code>{validateModal.presentation.path}</code>
              </p>
            ) : null}
          </div>
        ) : null}
      </GlassModal>

      <GlassModal
        open={detailsOpen}
        onClose={() => {
          setDetailsOpen(false);
          setDetailsModel(null);
        }}
        title={tr("ext.plugins.detailsTitle", { name: detailsTitle })}
        size="lg"
        closeLabel={tr("common.close")}
        wrapBody
        footer={
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setDetailsOpen(false);
              setDetailsModel(null);
            }}
          >
            {tr("common.close")}
          </button>
        }
      >
        {detailsModel ? (
          <div className="ext-market-detail">
            <dl className="ext-market-detail__meta">
              <div className="ext-market-detail__row">
                <dt>{tr("ext.market.field.marketplace")}</dt>
                <dd>
                  {detailsModel.marketplace?.trim() ||
                    tr("ext.market.field.unknown")}
                </dd>
              </div>
              <div className="ext-market-detail__row">
                <dt>{tr("ext.market.field.version")}</dt>
                <dd>
                  {detailsModel.versionLabel
                    ? `v${detailsModel.versionLabel}`
                    : tr("ext.market.field.unknown")}
                </dd>
              </div>
            </dl>
            {detailsModel.badges.length > 0 ? (
              <div
                className="ext-component-badges ext-component-badges--detail"
                aria-label={tr("ext.market.componentsLabel")}
              >
                {detailsModel.badges.map((b) => (
                  <span
                    key={b.kind}
                    className={
                      "ext-badge ext-badge--component ext-badge--component-" +
                      b.kind
                    }
                  >
                    {badgeLabel(b.kind, b.count)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {detailsLoading ? (
          <p className="ext-empty">{tr("ext.plugins.detailsLoading")}</p>
        ) : (
          <pre className="ext-details-pre">{detailsBody}</pre>
        )}
      </GlassModal>

      <GlassModal
        open={addOpen}
        onClose={() => {
          if (actionBusy !== "mcp:add") setAddOpen(false);
        }}
        title={tr("ext.mcp.addTitle")}
        size="md"
        closeLabel={tr("common.close")}
        wrapBody
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={actionBusy === "mcp:add"}
              onClick={() => setAddOpen(false)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={
                actionBusy === "mcp:add" ||
                !addName.trim() ||
                !addCommand.trim()
              }
              onClick={() => void submitAdd()}
            >
              {actionBusy === "mcp:add"
                ? tr("ext.mcp.addWorking")
                : tr("ext.mcp.addSubmit")}
            </button>
          </>
        }
      >
        <form
          className="app-dialog__form"
          onSubmit={(e) => {
            e.preventDefault();
            void submitAdd();
          }}
        >
          <label className="field">
            <span>{tr("ext.mcp.name")}</span>
            <input
              className="app-dialog__input"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder={tr("ext.mcp.namePlaceholder")}
              autoComplete="off"
              spellCheck={false}
              disabled={actionBusy === "mcp:add"}
            />
          </label>
          <label className="field">
            <span>{tr("ext.mcp.command")}</span>
            <input
              className="app-dialog__input"
              value={addCommand}
              onChange={(e) => setAddCommand(e.target.value)}
              placeholder={tr("ext.mcp.commandPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              disabled={actionBusy === "mcp:add"}
            />
          </label>
          <label className="field">
            <span>{tr("ext.mcp.args")}</span>
            <input
              className="app-dialog__input"
              value={addArgs}
              onChange={(e) => setAddArgs(e.target.value)}
              placeholder={tr("ext.mcp.argsPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              disabled={actionBusy === "mcp:add"}
            />
            <span className="ext-field-hint">{tr("ext.mcp.argsHint")}</span>
          </label>
          <label className="field">
            <span>{tr("ext.mcp.env")}</span>
            <textarea
              className="app-dialog__input ext-env-textarea"
              value={addEnv}
              onChange={(e) => setAddEnv(e.target.value)}
              placeholder={tr("ext.mcp.envPlaceholder")}
              rows={3}
              spellCheck={false}
              disabled={actionBusy === "mcp:add"}
            />
            <span className="ext-field-hint">{tr("ext.mcp.envHint")}</span>
          </label>
        </form>
      </GlassModal>

      <GlassModal
        open={!!removeTarget}
        onClose={() => {
          if (!actionBusy) setRemoveTarget(null);
        }}
        title={tr("ext.mcp.removeTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={!!actionBusy}
              onClick={() => setRemoveTarget(null)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={!!actionBusy}
              onClick={() => void confirmRemoveMcp()}
            >
              {tr("ext.mcp.remove")}
            </button>
          </>
        }
      >
        <p className="app-dialog__msg">
          {tr("ext.mcp.removeConfirm", {
            name: removeTarget?.name ?? "",
          })}
        </p>
      </GlassModal>

      <GlassModal
        open={doctorOpen}
        onClose={() => {
          if (!doctorLoading) setDoctorOpen(false);
        }}
        title={
          doctorFocus
            ? `${tr("ext.mcp.doctorTitle")} · ${doctorFocus}`
            : tr("ext.mcp.doctorTitle")
        }
        size="lg"
        closeLabel={tr("common.close")}
        wrapBody
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={doctorLoading}
              onClick={() => void runDoctor(doctorFocus)}
            >
              <IconRefresh size={14} />
              <span>{tr("ext.mcp.doctorRerun")}</span>
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={doctorLoading}
              onClick={() => setDoctorOpen(false)}
            >
              {tr("common.close")}
            </button>
          </>
        }
      >
        {doctorLoading && (
          <p className="ext-empty">{tr("ext.mcp.doctorRunning")}</p>
        )}
        {!doctorLoading && doctorError && (
          <div className="ext-alert ext-alert--error" role="alert">
            <p className="ext-alert__body">{doctorError}</p>
          </div>
        )}
        {!doctorLoading && doctorReport && (
          <div className="ext-doctor">
            <p className="ext-doctor__summary">
              {tr("ext.mcp.doctorSummary", {
                healthy: doctorReport.summary.healthy,
                unhealthy: doctorReport.summary.unhealthy,
                total: doctorReport.summary.total,
              })}
            </p>
            {(doctorReport.sources?.length ?? 0) > 0 ? (
              <div className="ext-doctor__sources">
                <div className="ext-doctor__section-title">
                  {tr("ext.mcp.doctorSources")}
                </div>
                <ul className="ext-doctor__source-list">
                  {doctorReport.sources.map((src: any) => (
                    <li key={src.path}>
                      <code>{src.path}</code>
                      <span className="ext-badge ext-badge--muted">
                        {src.status}
                        {src.serverCount != null
                          ? ` · ${src.serverCount}`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {(doctorReport.servers?.length ?? 0) === 0 ? (
              <p className="ext-empty">
                {redactMcpText(doctorReport.rawText)?.trim() ||
                  tr("ext.mcp.doctorEmpty")}
              </p>
            ) : (
              <ul className="ext-list ext-doctor__servers">
                {doctorReport.servers.map((s: any) => {
                  const st =
                    lookupServerStatus(doctorReportStatusIndex, s.name) ??
                    lookupServerStatus(doctorStatusIndex, s.name);
                  const badgeMod = st
                    ? mcpStatusBadgeMod(st.tone)
                    : s.healthy
                      ? "ok"
                      : "fail";
                  const label = st
                    ? tr(mcpStatusLabelKey(st.tone) as MessageKey)
                    : s.healthy
                      ? tr("ext.mcp.doctorHealthy")
                      : tr("ext.mcp.doctorUnhealthy");
                  const guidanceKey = st
                    ? mcpAuthGuidanceKey(st.tone)
                    : null;
                  const oauthAction = st
                    ? classifyMcpOauthFromStatus(st)
                    : null;
                  return (
                    <li
                      key={s.name}
                      className={
                        "ext-item" + (s.healthy ? "" : " ext-item--off")
                      }
                    >
                      <div className="ext-item__head">
                        <strong className="ext-item__name">{s.name}</strong>
                        <span
                          className={
                            "ext-mcp-status ext-mcp-status--" + badgeMod
                          }
                        >
                          <span
                            className="ext-mcp-status__lamp"
                            aria-hidden
                          />
                          <span
                            className={"ext-badge ext-badge--" + badgeMod}
                          >
                            {label}
                          </span>
                        </span>
                        {s.transport ? (
                          <span className="ext-badge ext-badge--muted">
                            {s.transport}
                          </span>
                        ) : null}
                      </div>
                      {s.target ? (
                        <p className="ext-item__desc" title={s.target}>
                          {shortPathLabel(s.target, 72) || s.target}
                        </p>
                      ) : null}
                      {st?.needsAuthRefresh && guidanceKey ? (
                        <div className="ext-mcp-auth-row">
                          <p className="ext-mcp-auth-hint">
                            {tr(guidanceKey as MessageKey)}
                          </p>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => openOauthWizard(oauthAction, st)}
                          >
                            {tr(
                              (oauthAction
                                ? mcpOauthActionLabelKey(oauthAction.kind)
                                : "ext.mcp.auth.howToRefresh") as MessageKey,
                            )}
                          </button>
                        </div>
                      ) : null}
                      {Array.isArray(s.checks) && s.checks.length > 0 ? (
                        <ul className="ext-doctor__checks">
                          {s.checks.map((c: any, i: any) => (
                            <li
                              key={`${s.name}:${c.label}:${i}`}
                              className={
                                "ext-doctor__check" +
                                (c.passed ? " is-pass" : " is-fail")
                              }
                            >
                              <span className="ext-doctor__check-label">
                                {c.passed ? "✓" : "✗"} {c.label}
                              </span>
                              {c.detail ? (
                                <span className="ext-doctor__check-detail">
                                  {redactMcpText(c.detail)}
                                </span>
                              ) : null}
                              {c.hint ? (
                                <span className="ext-doctor__check-hint">
                                  {tr("ext.mcp.doctorHint", {
                                    hint: redactMcpText(c.hint),
                                  })}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {doctorReport.rawText ? (
              <pre className="ext-details-pre">
                {redactMcpText(doctorReport.rawText)}
              </pre>
            ) : null}
          </div>
        )}
      </GlassModal>

      <McpOauthWizard
        open={!!oauthWizardTarget}
        locale={locale}
        action={oauthWizardTarget?.action ?? null}
        statusReason={oauthWizardTarget?.status.reason ?? null}
        onClose={() => setOauthWizardTarget(null)}
        onRefreshDoctor={async (serverName) => {
          // Keep doctor modal closed when refreshing from wizard; still update index.
          if (!api.isTauri()) {
            return { report: null, error: tr("ext.needTauri") };
          }
          setDoctorLoading(true);
          setDoctorError(null);
          setDoctorFocus(serverName?.trim() || null);
          try {
            const report = await api.mcpDoctor(serverName?.trim() || null);
            setDoctorReport(report);
            setDoctorLastAt(Date.now());
            const next = indexDoctorServerStatuses(report);
            setDoctorStatusIndex((prev) => {
              if (!serverName?.trim()) return next;
              const merged = new Map(prev);
              for (const [k, v] of next) merged.set(k, v);
              return merged;
            });
            return { report, error: null };
          } catch (e) {
            const error = String(e);
            setDoctorError(error);
            return { report: null, error };
          } finally {
            setDoctorLoading(false);
          }
        }}
      />

      <GlassModal
        open={skillNewOpen}
        onClose={() => {
          if (actionBusy !== "skill:create") setSkillNewOpen(false);
        }}
        title={tr("ext.skills.newTitle")}
        size="md"
        closeLabel={tr("common.close")}
        wrapBody
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={actionBusy === "skill:create"}
              onClick={() => setSkillNewOpen(false)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={
                actionBusy === "skill:create" || !skillNewSanitized
              }
              onClick={() => void submitSkillNew()}
            >
              {actionBusy === "skill:create"
                ? tr("ext.skills.newWorking")
                : tr("ext.skills.newSubmit")}
            </button>
          </>
        }
      >
        <form
          className="app-dialog__form"
          onSubmit={(e) => {
            e.preventDefault();
            void submitSkillNew();
          }}
        >
          <label className="field">
            <span>{tr("ext.skills.newName")}</span>
            <input
              className="app-dialog__input"
              value={skillNewName}
              onChange={(e) => {
                setSkillNewName(e.target.value);
                setSkillNewError(null);
              }}
              placeholder={tr("ext.skills.newNamePlaceholder")}
              autoComplete="off"
              spellCheck={false}
              disabled={actionBusy === "skill:create"}
              autoFocus
            />
            <span className="ext-field-hint">
              {skillNewSanitized
                ? tr("ext.skills.newNameHintOk", { name: skillNewSanitized })
                : tr("ext.skills.newNameHint")}
            </span>
          </label>
          <label className="field">
            <span>{tr("ext.skills.newDescription")}</span>
            <textarea
              className="app-dialog__input ext-env-textarea"
              value={skillNewDesc}
              onChange={(e) => {
                setSkillNewDesc(e.target.value);
                setSkillNewError(null);
              }}
              placeholder={tr("ext.skills.newDescriptionPlaceholder")}
              rows={3}
              spellCheck
              disabled={actionBusy === "skill:create"}
            />
            <span className="ext-field-hint">
              {tr("ext.skills.newDescriptionHint")}
            </span>
          </label>
          <fieldset className="field" disabled={actionBusy === "skill:create"}>
            <legend>{tr("ext.skills.newScope")}</legend>
            <label className="ext-radio-row">
              <input
                type="radio"
                name="skill-new-scope"
                checked={skillNewScope === "user"}
                onChange={() => setSkillNewScope("user")}
              />
              <span>{tr("ext.skills.newScopeUser")}</span>
            </label>
            <label className="ext-radio-row">
              <input
                type="radio"
                name="skill-new-scope"
                checked={skillNewScope === "project"}
                onChange={() => setSkillNewScope("project")}
                disabled={!projectPath?.trim()}
              />
              <span>
                {projectPath?.trim()
                  ? tr("ext.skills.newScopeProject")
                  : tr("ext.skills.newScopeProjectDisabled")}
              </span>
            </label>
            <span className="ext-field-hint">{tr("ext.skills.newScopeHint")}</span>
          </fieldset>
          {skillNewError ? (
            <p className="ext-alert" role="alert">
              <span className="ext-alert__body">{skillNewError}</span>
            </p>
          ) : null}
        </form>
      </GlassModal>

      <GlassModal
        open={!!skillEditor}
        onClose={requestCloseSkillEditor}
        title={
          skillEditor
            ? tr("ext.skills.editTitle", { name: skillEditor.skill.name })
            : tr("ext.skills.edit")
        }
        size="lg"
        closeLabel={tr("common.close")}
        closeOnOverlay={!skillEditor?.saving}
        wrapBody
        bodyClassName="ext-skill-editor"
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={!!skillEditor?.saving}
              onClick={requestCloseSkillEditor}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={
                !skillEditor || skillEditor.loading || skillEditor.saving
              }
              onClick={validateSkillEditor}
            >
              {tr("ext.skills.editValidate")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={
                !skillEditor ||
                skillEditor.loading ||
                skillEditor.saving ||
                !!skillEditor.error ||
                !skillEditorDirty
              }
              onClick={() => void saveSkillEditor()}
            >
              {skillEditor?.saving
                ? tr("ext.skills.editSaving")
                : tr("common.save")}
            </button>
          </>
        }
      >
        {skillEditor ? (
          <>
            {!isExtensionEnabled(skillEditor.skill.enabled) ? (
              <p className="ext-skill-editor__note" role="status">
                {tr("ext.skills.editDisabledNote")}
              </p>
            ) : null}
            {skillEditor.path ? (
              <p className="ext-skill-editor__path" title={skillEditor.path}>
                {shortPathLabel(skillEditor.path, 72) || skillEditor.path}
              </p>
            ) : null}
            {skillEditor.loading ? (
              <p className="ext-empty">{tr("ext.skills.editLoading")}</p>
            ) : skillEditor.error && !skillEditor.baselineText ? (
              <p className="ext-alert ext-alert--error" role="alert">
                <span className="ext-alert__body">{skillEditor.error}</span>
              </p>
            ) : (
              <textarea
                className="ext-skill-editor__textarea"
                value={skillEditor.draftText}
                onChange={(e) =>
                  setSkillEditor((s) =>
                    s
                      ? {
                          ...s,
                          draftText: e.target.value,
                          savedHint: null,
                          error: null,
                        }
                      : s,
                  )
                }
                spellCheck={false}
                disabled={skillEditor.saving}
                aria-label={tr("ext.skills.editAria", {
                  name: skillEditor.skill.name,
                })}
                rows={18}
              />
            )}
            {skillEditor.error && skillEditor.baselineText ? (
              <p className="ext-skill-editor__error" role="alert">
                {skillEditor.error}
                {skillFeedback ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm ext-skill-editor__details-btn"
                      onClick={() => setSkillFeedbackOpen(true)}
                    >
                      {tr("ext.skills.feedback.viewDetails")}
                    </button>
                  </>
                ) : null}
              </p>
            ) : null}
            {skillEditor.savedHint ? (
              <p
                className={
                  "ext-skill-editor__saved" +
                  (skillFeedback && !skillFeedback.blocking
                    ? skillFeedback.severity === "warn"
                      ? " ext-skill-editor__status--warn"
                      : skillFeedback.severity === "ok"
                        ? " ext-skill-editor__status--ok"
                        : ""
                    : " ext-skill-editor__status--ok")
                }
                role="status"
              >
                {skillEditor.savedHint}
                {skillFeedback && !skillFeedback.blocking ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm ext-skill-editor__details-btn"
                      onClick={() => setSkillFeedbackOpen(true)}
                    >
                      {tr("ext.skills.feedback.viewDetails")}
                    </button>
                  </>
                ) : null}
              </p>
            ) : null}
          </>
        ) : null}
      </GlassModal>

      <GlassModal
        open={skillFeedbackOpen && !!skillFeedback}
        onClose={() => setSkillFeedbackOpen(false)}
        title={
          skillFeedback?.phase === "validate"
            ? tr("ext.skills.feedback.resultValidateTitle")
            : skillFeedback?.phase === "load"
              ? tr("ext.skills.feedback.resultLoadTitle")
              : skillFeedback?.phase === "create"
                ? tr("ext.skills.feedback.resultCreateTitle")
                : tr("ext.skills.feedback.resultSaveTitle")
        }
        size="md"
        closeLabel={tr("common.close")}
        wrapBody
        bodyClassName="ext-skill-feedback"
        footer={
          <>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => setSkillFeedbackOpen(false)}
            >
              {tr("common.close")}
            </button>
          </>
        }
      >
        {skillFeedback ? (
          <div className="ext-skill-feedback__body">
            <div className="ext-skill-feedback__meta">
              <span
                className={
                  "ext-badge ext-badge--" +
                  skillEditBadgeTone(skillFeedback.severity)
                }
              >
                {skillEditKindLabel(skillFeedback.kind, skillKindLabels)}
              </span>
              {skillFeedback.name ? (
                <span className="ext-badge ext-badge--muted">
                  /{skillFeedback.name}
                </span>
              ) : null}
              {skillFeedback.sizeBytes != null ? (
                <span className="ext-badge ext-badge--muted">
                  {tr("ext.skills.feedback.sizeBytes", {
                    n: String(skillFeedback.sizeBytes),
                  })}
                </span>
              ) : null}
            </div>
            <p
              className={
                "ext-skill-feedback__summary" +
                (skillFeedback.severity === "ok"
                  ? " ext-skill-feedback__summary--ok"
                  : skillFeedback.severity === "err"
                    ? " ext-skill-feedback__summary--err"
                    : skillFeedback.severity === "warn"
                      ? " ext-skill-feedback__summary--warn"
                      : "")
              }
            >
              {skillFeedback.summary}
            </p>
            {skillEditHint(skillFeedback.kind, skillKindHints) ? (
              <p className="ext-skill-feedback__hint">
                {skillEditHint(skillFeedback.kind, skillKindHints)}
              </p>
            ) : null}
            {skillFeedback.detail &&
            skillFeedback.detail !== skillFeedback.summary ? (
              <p className="ext-skill-feedback__detail">
                {skillFeedback.detail}
              </p>
            ) : null}
            {skillFeedback.issues.length > 1 ? (
              <ul className="ext-skill-feedback__issues">
                {skillFeedback.issues.map((issue, idx) => (
                  <li key={`${issue.kind}-${idx}`}>
                    <span
                      className={
                        "ext-badge ext-badge--" +
                        skillEditBadgeTone(issue.severity)
                      }
                    >
                      {skillEditKindLabel(issue.kind, skillKindLabels)}
                    </span>
                    {issue.detail ? (
                      <span className="ext-skill-feedback__issue-detail">
                        {issue.detail}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {skillFeedback.reason ? (
              <p className="ext-skill-feedback__reason">
                <span className="ext-skill-feedback__label">
                  {tr("ext.skills.feedback.reason")}
                </span>
                <code>{skillFeedback.reason}</code>
              </p>
            ) : null}
            {skillFeedback.path ? (
              <p className="ext-skill-feedback__path" title={skillFeedback.path}>
                <span className="ext-skill-feedback__label">
                  {tr("ext.skills.feedback.path")}
                </span>
                <code>
                  {shortPathLabel(skillFeedback.path, 64) || skillFeedback.path}
                </code>
              </p>
            ) : null}
          </div>
        ) : null}
      </GlassModal>

      <GlassModal
        open={skillDiscardOpen}
        onClose={() => setSkillDiscardOpen(false)}
        title={tr("ext.skills.editDiscardTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setSkillDiscardOpen(false)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                setSkillDiscardOpen(false);
                closeSkillEditor();
              }}
            >
              {tr("ext.skills.editDiscard")}
            </button>
          </>
        }
      >
        <p className="app-dialog__msg">{tr("ext.skills.editDiscardBody")}</p>
      </GlassModal>

      <GlassModal
        open={skillConflictOpen}
        onClose={() => setSkillConflictOpen(false)}
        title={tr("ext.skills.editConflictTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setSkillConflictOpen(false);
                if (skillEditor) void openSkillEditor(skillEditor.skill);
              }}
            >
              {tr("ext.skills.editConflictReload")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => {
                setSkillConflictOpen(false);
                void saveSkillEditor({ force: true });
              }}
            >
              {tr("ext.skills.editConflictOverwrite")}
            </button>
          </>
        }
      >
        <p className="app-dialog__msg">{tr("ext.skills.editConflictBody")}</p>
      </GlassModal>
    </div>
  );
}

/** Space-separated args; keeps simple tokens (no shell quoting). */
function splitArgs(raw: string): string[] {
  return raw
    .trim()
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parse KEY=value lines into a map. Skips blanks and `#` comments. */
function parseEnvLines(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function ExtensionToggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={"ext-switch" + (checked ? " is-on" : "")}
      onClick={() => onChange(!checked)}
    >
      <span className="ext-switch__thumb" aria-hidden />
    </button>
  );
}

function normalizeSourceLabel(source: string): string {
  const s = (source ?? "").trim();
  return s || "unknown";
}
