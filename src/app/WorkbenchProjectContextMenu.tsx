/**
 * Project / archive / sandbox / color sidebar context-menu items.
 */
import type { Dispatch, SetStateAction } from "react";
import { type ContextMenuItem } from "@/components/ContextMenu";
import * as api from "@/lib/api";
import { IconAppearance, IconArchive, IconCheck, IconChevronDown, IconChevronUp, IconExternalLink, IconFileText, IconFolderPlus, IconHistory, IconPin, IconPinOff, IconPlus, IconQueue, IconRename, IconShield, IconTrash } from "@/components/icons";
import { canMoveProjectInPinGroup } from "@/lib/app/projectOrder";
import { isGeneralProject, projectDisplayName, type Project, type SessionRow } from "@/lib/app/sidebarModels";
import { revealInOsLabel, type AppPlatform } from "@/lib/appPlatform";
import { canOfferContinueCwd } from "@/lib/continueCwd";
import { PERMISSION_POLICIES, type PermissionPolicyId } from "@/lib/grokCatalog";
import { PROJECT_COLOR_TOKENS, normalizeProjectColor, resolveProjectColorCss, type ProjectColorToken } from "@/lib/projectColor";
import { spaceDisplayName, spaceOfProject, type CreateSpaceError, type DeleteSpaceError, type SpaceNameError } from "@/lib/projectSpaces";
import { SANDBOX_PROFILES, isDangerousSandboxProfile, normalizeSandboxProfile, type SandboxProfileId } from "@/lib/sandboxProfile";
import { listArchiveAgeOptionPreviews } from "@/lib/sessionArchiveAge";
import { createT, type MessageKey } from "@/i18n";
import { useProjectSpaces } from "@/hooks/useProjectSpaces";
import type { AppDialog, ContextMenuState } from "@/lib/app/appDialogTypes";
import type { SidebarProjectReorderApi } from "@/hooks/useSidebarProjectReorder";

type TFn = ReturnType<typeof createT>;
type ProjectSpacesApi = ReturnType<typeof useProjectSpaces>;

export type WorkbenchProjectContextMenuProps = {
  ctxMenu: ContextMenuState;
  applyProjectColor: (proj: Project, next: string | null) => void;
  applyProjectPermissionPolicy: (proj: Project, next: PermissionPolicyId | null) => void;
  applyProjectSandboxProfile: (proj: Project, next: SandboxProfileId | null) => void;
  archiveProjectSessions: (proj: Project) => Promise<void>;
  confirmArchiveOlderThan: (days: number) => void;
  continueLastAgentForProject: (proj: Project) => Promise<void>;
  moveProjectByMenu: (projId: string, direction: "up" | "down") => void;
  openSandboxWizardGuide: () => void;
  platform: AppPlatform;
  projectColorLabel: (token: ProjectColorToken) => string;
  projectReorder: SidebarProjectReorderApi;
  projectSpaces: ProjectSpacesApi;
  projects: Project[];
  refreshProjects: () => Promise<void>;
  relocateProject: (proj: Project) => Promise<void>;
  removeProjectFromApp: (proj: Project) => void;
  renameProject: (proj: Project) => void;
  sandboxProfileLabel: (id: SandboxProfileId) => string;
  sessions: SessionRow[];
  setAppDialog: Dispatch<SetStateAction<AppDialog>>;
  setCtxMenu: Dispatch<SetStateAction<ContextMenuState>>;
  setLocalError: Dispatch<SetStateAction<string | null>>;
  setProjectRulesTarget: Dispatch<SetStateAction<{ path: string; name: string } | null>>;
  showToast: (msg: string, ms?: number) => void;
  spaceErrorKey: (err: SpaceNameError | CreateSpaceError | DeleteSpaceError) => MessageKey;
  tr: TFn;
  visibleProjects: Project[];
};

export function buildProjectContextMenuItems(
  p: WorkbenchProjectContextMenuProps,
): ContextMenuItem[] {
  const {
    applyProjectColor,
    applyProjectPermissionPolicy,
    applyProjectSandboxProfile,
    archiveProjectSessions,
    confirmArchiveOlderThan,
    continueLastAgentForProject,
    moveProjectByMenu,
    openSandboxWizardGuide,
    platform,
    projectColorLabel,
    projectReorder,
    projectSpaces,
    projects,
    refreshProjects,
    relocateProject,
    removeProjectFromApp,
    renameProject,
    sandboxProfileLabel,
    sessions,
    setAppDialog,
    setCtxMenu,
    setLocalError,
    setProjectRulesTarget,
    showToast,
    spaceErrorKey,
    tr,
    visibleProjects,
  } = p;
  const ctxMenu = p.ctxMenu;
  let items: ContextMenuItem[] = [];
                if (ctxMenu?.kind === "archive-older") {
          const agePreviews = listArchiveAgeOptionPreviews(sessions);
          items = agePreviews.map(({ days, count }) => ({
            id: `archive-older-${days}`,
            label:
              count > 0
                ? tr("sidebar.archiveOlderDaysCount", {
                    days: String(days),
                    n: String(count),
                  })
                : tr("sidebar.archiveOlderDays", { days: String(days) }),
            icon: <IconArchive size={16} />,
            // Keep rows clickable when empty so empty-honesty toast can fire.
            disabled: false,
            onClick: () => {
              confirmArchiveOlderThan(days);
            },
          }));
        } else if (ctxMenu?.kind === "project") {
          const proj = projects.find((x) => x.id === ctxMenu.id);
          if (proj) {
            const canUp = canMoveProjectInPinGroup(visibleProjects, proj.id, "up");
            const canDown = canMoveProjectInPinGroup(
              visibleProjects,
              proj.id,
              "down",
            );
            items = [
              {
                id: "pin",
                label: proj.pinned
                  ? tr("project.unpin")
                  : tr("project.pin"),
                icon: proj.pinned ? (
                  <IconPinOff size={16} />
                ) : (
                  <IconPin size={16} />
                ),
                onClick: () => {
                  void api
                    .projectSetPinned(proj.id, !proj.pinned)
                    .then(() => refreshProjects());
                },
              },
              ...(projectReorder.enabled
                ? [
                    {
                      id: "move-up",
                      label: tr("project.moveUp"),
                      icon: <IconChevronUp size={16} />,
                      disabled: !canUp,
                      onClick: () => moveProjectByMenu(proj.id, "up"),
                    } satisfies ContextMenuItem,
                    {
                      id: "move-down",
                      label: tr("project.moveDown"),
                      icon: <IconChevronDown size={16} />,
                      disabled: !canDown,
                      onClick: () => moveProjectByMenu(proj.id, "down"),
                    } satisfies ContextMenuItem,
                  ]
                : []),
              {
                id: "color",
                label: tr("project.color"),
                icon: (() => {
                  const css = resolveProjectColorCss(proj.color);
                  return css ? (
                    <span
                      className="project-color-swatch"
                      style={{ background: css }}
                      aria-hidden
                    />
                  ) : (
                    <IconAppearance size={16} />
                  );
                })(),
                onClick: () => {
                  setCtxMenu({
                    kind: "project-color",
                    id: proj.id,
                    x: ctxMenu.x,
                    y: ctxMenu.y,
                  });
                },
              },
              {
                id: "move-space",
                label: tr("sidebar.spaces.moveTo"),
                icon: <IconQueue size={16} />,
                children: [
                  ...projectSpaces.state.spaces.map((space) => {
                    const current =
                      spaceOfProject(projectSpaces.state, proj.id) ===
                      space.id;
                    return {
                      id: `move-space-${space.id}`,
                      label: spaceDisplayName(
                        space,
                        tr("sidebar.spaces.default"),
                      ),
                      icon: current ? <IconCheck size={16} /> : undefined,
                      onClick: () => {
                        if (current) return;
                        projectSpaces.moveProject(proj.id, space.id);
                        showToast(
                          tr("sidebar.spaces.moved", {
                            name: projectDisplayName(proj, tr),
                            space: spaceDisplayName(
                              space,
                              tr("sidebar.spaces.default"),
                            ),
                          }),
                          2400,
                        );
                      },
                    } satisfies ContextMenuItem;
                  }),
                  { id: "move-space-sep", separator: true },
                  {
                    id: "move-space-new",
                    label: tr("sidebar.spaces.new"),
                    icon: <IconPlus size={16} />,
                    onClick: () => {
                      setAppDialog({
                        kind: "prompt",
                        title: tr("sidebar.spaces.newTitle"),
                        initial: "",
                        placeholder: tr("sidebar.spaces.namePlaceholder"),
                        onSubmit: (value) => {
                          const result = projectSpaces.createAndMove(
                            proj.id,
                            value,
                          );
                          if (!result.ok) {
                            return tr(spaceErrorKey(result.error));
                          }
                          showToast(
                            tr("sidebar.spaces.moved", {
                              name: projectDisplayName(proj, tr),
                              space: value.trim(),
                            }),
                            2400,
                          );
                        },
                      });
                    },
                  },
                ],
              },
              {
                id: "reveal",
                label: revealInOsLabel(tr, platform),
                icon: <IconExternalLink size={16} />,
                onClick: () => {
                  void api
                    .projectReveal(proj.id)
                    .catch((e) => setLocalError(String(e)));
                },
              },
              ...(isGeneralProject(proj)
                ? []
                : [
                    {
                      id: "relocate",
                      label: tr("project.relocate"),
                      icon: <IconFolderPlus size={16} />,
                      onClick: () => {
                        void relocateProject(proj);
                      },
                    } satisfies ContextMenuItem,
                    {
                      id: "rename",
                      label: tr("project.rename"),
                      icon: <IconRename size={16} />,
                      onClick: () => renameProject(proj),
                    } satisfies ContextMenuItem,
                  ]),
              {
                id: "rules",
                label: tr("project.rules"),
                icon: <IconFileText size={16} />,
                onClick: () => {
                  setProjectRulesTarget({
                    path: proj.path,
                    name: projectDisplayName(proj, tr),
                  });
                },
              },
              ...(canOfferContinueCwd(proj.path)
                ? [
                    {
                      id: "continue-cwd",
                      label: tr("project.continueCwd"),
                      icon: <IconHistory size={16} />,
                      onClick: () => {
                        void continueLastAgentForProject(proj);
                      },
                    } satisfies ContextMenuItem,
                  ]
                : []),
              ...(proj.trusted
                ? [
                    {
                      id: "permission",
                      label: tr("project.permission"),
                      icon: <IconShield size={16} />,
                      onClick: () => {
                        setCtxMenu({
                          kind: "project-policy",
                          id: proj.id,
                          x: ctxMenu.x,
                          y: ctxMenu.y,
                        });
                      },
                    } satisfies ContextMenuItem,
                    {
                      id: "sandbox",
                      label: tr("project.sandbox"),
                      icon: <IconShield size={16} />,
                      onClick: () => {
                        setCtxMenu({
                          kind: "project-sandbox",
                          id: proj.id,
                          x: ctxMenu.x,
                          y: ctxMenu.y,
                        });
                      },
                    } satisfies ContextMenuItem,
                  ]
                : []),
              {
                id: "archive-chats",
                label: tr("project.archiveChats"),
                icon: <IconArchive size={16} />,
                onClick: () => {
                  void archiveProjectSessions(proj);
                },
              },
              ...(isGeneralProject(proj)
                ? []
                : [
                    {
                      id: "remove",
                      label: tr("project.remove"),
                      icon: <IconTrash size={16} />,
                      danger: true,
                      onClick: () => removeProjectFromApp(proj),
                    } satisfies ContextMenuItem,
                  ]),
            ];
          }
        } else if (ctxMenu?.kind === "project-policy") {
          const proj = projects.find((x) => x.id === ctxMenu.id);
          if (proj && proj.trusted) {
            const current = proj.permissionPolicy?.trim() || null;
            const policyLabel = (id: PermissionPolicyId) =>
              tr(
                (
                  {
                    ask: "policy.ask",
                    accept_edits: "policy.accept_edits",
                    allow_for_session: "policy.allow_for_session",
                    auto: "policy.auto",
                    dont_ask: "policy.dont_ask",
                    always_approve: "policy.always_approve",
                  } as const
                )[id],
              );
            items = [
              {
                id: "inherit",
                label: tr("project.permissionInherit"),
                icon: !current ? <IconCheck size={16} /> : undefined,
                onClick: () => applyProjectPermissionPolicy(proj, null),
              },
              ...PERMISSION_POLICIES.map(
                (p) =>
                  ({
                    id: `policy-${p.id}`,
                    label: policyLabel(p.id),
                    icon:
                      current === p.id ? <IconCheck size={16} /> : undefined,
                    danger: !!p.dangerous,
                    onClick: () => applyProjectPermissionPolicy(proj, p.id),
                  }) satisfies ContextMenuItem,
              ),
            ];
          }
        } else if (ctxMenu?.kind === "project-sandbox") {
          const proj = projects.find((x) => x.id === ctxMenu.id);
          if (proj && proj.trusted) {
            const current =
              normalizeSandboxProfile(proj.sandboxProfile) ?? null;
            items = [
              {
                id: "sandbox-inherit",
                label: tr("project.sandboxInherit"),
                icon: !current ? <IconCheck size={16} /> : undefined,
                onClick: () => applyProjectSandboxProfile(proj, null),
              },
              ...SANDBOX_PROFILES.map(
                (id) =>
                  ({
                    id: `sandbox-${id}`,
                    label: sandboxProfileLabel(id),
                    icon: current === id ? <IconCheck size={16} /> : undefined,
                    danger: isDangerousSandboxProfile(id),
                    onClick: () => applyProjectSandboxProfile(proj, id),
                  }) satisfies ContextMenuItem,
              ),
              {
                id: "sandbox-open-guide",
                label: tr("settings.sandbox.openGuide"),
                onClick: () => openSandboxWizardGuide(),
              },
            ];
          }
        } else if (ctxMenu?.kind === "project-color") {
          const proj = projects.find((x) => x.id === ctxMenu.id);
          if (proj) {
            const current = normalizeProjectColor(proj.color);
            items = [
              {
                id: "color-none",
                label: tr("project.colorNone"),
                icon: !current ? <IconCheck size={16} /> : undefined,
                onClick: () => applyProjectColor(proj, null),
              },
              ...PROJECT_COLOR_TOKENS.map(
                (tok) =>
                  ({
                    id: `color-${tok}`,
                    label: projectColorLabel(tok),
                    icon:
                      current === tok ? (
                        <IconCheck size={16} />
                      ) : (
                        <span
                          className="project-color-swatch"
                          style={{
                            background: resolveProjectColorCss(tok) ?? undefined,
                          }}
                          aria-hidden
                        />
                      ),
                    onClick: () => applyProjectColor(proj, tok),
                  }) satisfies ContextMenuItem,
              ),
            ];
          }
        }
  return items;
}
