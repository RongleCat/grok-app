/**
 * App icons — Tabler Icons only (https://tabler.io/icons).
 * Stable `Icon*` names for call sites. No other icon libraries / local SVG packs.
 */

import type { ComponentType } from "react";
import {
  IconActivity as TbActivity,
  IconAlertTriangle as TbAlertTriangle,
  IconArchive as TbArchive,
  IconArrowBackUp as TbArrowBackUp,
  IconArrowLeft as TbArrowLeft,
  IconArrowsMinimize as TbArrowsMinimize,
  IconBolt as TbBolt,
  IconGitBranch as TbGitBranch,
  IconBox as TbBox,
  IconBrush as TbBrush,
  IconCalendarTime as TbCalendarTime,
  IconCheck as TbCheck,
  IconClipboardList as TbClipboardList,
  IconClock as TbClock,
  IconChevronDown as TbChevronDown,
  IconChevronLeft as TbChevronLeft,
  IconChevronRight as TbChevronRight,
  IconChevronsLeft as TbChevronsLeft,
  IconCircleDashed as TbCircleDashed,
  IconCopy as TbCopy,
  IconDots as TbDots,
  IconEdit as TbEdit,
  IconFileDiff as TbFileDiff,
  IconFileText as TbFileText,
  IconFiles as TbFiles,
  IconFirstAidKit as TbFirstAidKit,
  IconFolder as TbFolder,
  IconFolderPlus as TbFolderPlus,
  IconHandStop as TbHandStop,
  IconInfoCircle as TbInfoCircle,
  IconLanguage as TbLanguage,
  IconExternalLink as TbExternalLink,
  IconLayoutSidebar as TbLayoutSidebar,
  IconLayoutSidebarRight as TbLayoutSidebarRight,
  IconLink as TbLink,
  IconList as TbList,
  IconListTree as TbListTree,
  IconMarkdown as TbMarkdown,
  IconMessage as TbMessage,
  IconMicrophone as TbMicrophone,
  IconMinus as TbMinus,
  IconMoon as TbMoon,
  IconNotes as TbNotes,
  IconPaperclip as TbPaperclip,
  IconPencil as TbPencil,
  IconPinned as TbPinned,
  IconPinnedOff as TbPinnedOff,
  IconPlayerStop as TbPlayerStop,
  IconPlug as TbPlug,
  IconPlus as TbPlus,
  IconPuzzle as TbPuzzle,
  IconRefresh as TbRefresh,
  IconRobot as TbRobot,
  IconSearch as TbSearch,
  IconSend as TbSend,
  IconSettings as TbSettings,
  IconShield as TbShield,
  IconShieldCheck as TbShieldCheck,
  IconSparkles as TbSparkles,
  IconSquare as TbSquare,
  IconStack2 as TbStack2,
  IconSun as TbSun,
  IconTarget as TbTarget,
  IconThumbDown as TbThumbDown,
  IconThumbUp as TbThumbUp,
  IconTool as TbTool,
  IconTrash as TbTrash,
  IconUpload as TbUpload,
  IconUser as TbUser,
  IconWand as TbWand,
  IconX as TbX,
} from "@tabler/icons-react";

export type IconProps = {
  size?: number;
  title?: string;
  className?: string;
  stroke?: number;
  /** @deprecated No-op; call-site compatibility with previous icon APIs. */
  animated?: boolean;
  /** @deprecated No-op; call-site compatibility with Phosphor weight. */
  weight?: string;
};

type TbIcon = ComponentType<{
  size?: number | string;
  stroke?: number;
  color?: string;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

function wrap(Tb: TbIcon, defaults?: { stroke?: number; className?: string }) {
  function TablerAppIcon({
    size = 18,
    title,
    stroke = defaults?.stroke ?? 1.75,
    className = "",
    animated: _a,
    weight: _w,
  }: IconProps) {
    const classes = ["g-icon", defaults?.className, className]
      .filter(Boolean)
      .join(" ");
    return (
      <span
        className={classes}
        style={{
          display: "inline-flex",
          width: size,
          height: size,
          lineHeight: 0,
          color: "currentColor",
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
        }}
        role={title ? "img" : undefined}
        aria-hidden={title ? undefined : true}
        aria-label={title}
        title={title}
      >
        <Tb size={size} stroke={stroke} color="currentColor" aria-hidden />
      </span>
    );
  }
  return TablerAppIcon;
}

/**
 * Official Grok mark paths (currentColor) — follows theme via CSS color.
 * Dark: light glyph; light: dark glyph (no invert filter needed).
 */
export function IconGrokMark({
  size = 22,
  title = "Grok",
  className = "",
}: IconProps) {
  const classes = ["g-icon", "g-icon--grok-mark", className]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      className={classes}
      style={{
        display: "inline-flex",
        width: size,
        height: size,
        lineHeight: 0,
        color: "currentColor",
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
      }}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      title={title}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 35 33"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <path
          d="M13.2371 21.0407L24.3186 12.8506C24.8619 12.4491 25.6384 12.6057 25.8973 13.2294C27.2597 16.5185 26.651 20.4712 23.9403 23.1851C21.2297 25.8989 17.4581 26.4941 14.0108 25.1386L10.2449 26.8843C15.6463 30.5806 22.2053 29.6665 26.304 25.5601C29.5551 22.3051 30.562 17.8683 29.6205 13.8673L29.629 13.8758C28.2637 7.99809 29.9647 5.64871 33.449 0.844576C33.5314 0.730667 33.6139 0.616757 33.6964 0.5L29.1113 5.09055V5.07631L13.2343 21.0436"
          fill="currentColor"
          id="mark"
        />
        <path
          d="M10.9503 23.0313C7.07343 19.3235 7.74185 13.5853 11.0498 10.2763C13.4959 7.82722 17.5036 6.82767 21.0021 8.2971L24.7595 6.55998C24.0826 6.07017 23.215 5.54334 22.2195 5.17313C17.7198 3.31926 12.3326 4.24192 8.67479 7.90126C5.15635 11.4239 4.0499 16.8403 5.94992 21.4622C7.36924 24.9165 5.04257 27.3598 2.69884 29.826C1.86829 30.7002 1.0349 31.5745 0.36364 32.5L10.9474 23.0341"
          fill="currentColor"
          id="mark"
        />
      </svg>
    </span>
  );
}

export const IconCollapse = wrap(TbChevronsLeft);
export const IconSearch = wrap(TbSearch);
/** New chat / compose — Tabler Edit (pencil writing on paper). */
export const IconNewChat = wrap(TbEdit);
export const IconEdit = wrap(TbEdit);
export const IconNotes = wrap(TbNotes);
export const IconImagine = wrap(TbWand);
export const IconAutomations = wrap(TbBolt);
/** Scheduled / “已安排” nav — calendar clock. */
export const IconScheduled = wrap(TbCalendarTime);
export const IconClock = wrap(TbClock);
export const IconSkills = wrap(TbTool);
export const IconChevronDown = wrap(TbChevronDown);
export const IconChevronLeft = wrap(TbChevronLeft);
export const IconChevronRight = wrap(TbChevronRight);
export const IconFolderPlus = wrap(TbFolderPlus);
export const IconPlus = wrap(TbPlus);
export const IconMore = wrap(TbDots);
export const IconFolder = wrap(TbFolder);
export const IconRename = wrap(TbPencil);
export const IconShare = wrap(TbLink);
export const IconTrash = wrap(TbTrash, { className: "g-icon--danger" });
export const IconPaperclip = wrap(TbPaperclip);
export const IconAttach = wrap(TbPaperclip);
export const IconClose = wrap(TbX);
export const IconSend = wrap(TbSend);
export const IconQueue = wrap(TbStack2);
export const IconMic = wrap(TbMicrophone);
export const IconPanel = wrap(TbLayoutSidebar);
/** Right files / context pane (Codex-style top bar). */
export const IconPanelRight = wrap(TbLayoutSidebarRight);
/** Open project in Finder / external app. */
export const IconExternalLink = wrap(TbExternalLink);
export const IconList = wrap(TbList);
export const IconInstructions = wrap(TbFileText);
export const IconSettings = wrap(TbSettings);
export const IconDoctor = wrap(TbFirstAidKit);
export const IconThemeSun = wrap(TbSun);
export const IconThemeMoon = wrap(TbMoon);
export const IconStop = wrap(TbPlayerStop);
export const IconHistory = wrap(TbRefresh);
/** Session rewind / undo conversation tail. */
export const IconRewind = wrap(TbArrowBackUp);
/** Session fork / branch. */
export const IconFork = wrap(TbGitBranch);
export const IconUpload = wrap(TbUpload);
export const IconFiles = wrap(TbFiles);
/** Session changes / diff panel (resource viewer). */
export const IconFileDiff = wrap(TbFileDiff);
/** File tree panel toggle (resource viewer). */
export const IconListTree = wrap(TbListTree);
export const IconFileUp = wrap(TbUpload);
export const IconCart = wrap(TbBolt);
export const IconThumbsUp = wrap(TbThumbUp);
export const IconThumbsDown = wrap(TbThumbDown);
export const IconRefresh = wrap(TbRefresh);
export const IconCopy = wrap(TbCopy);
export const IconExportMd = wrap(TbMarkdown);
export const IconArchive = wrap(TbArchive);
export const IconChat = wrap(TbMessage);
export const IconFileText = wrap(TbFileText);
export const IconBolt = wrap(TbBolt);
export const IconMinimize = wrap(TbMinus);
export const IconMaximize = wrap(TbSquare);
export const IconPlan = wrap(TbList);
export const IconPin = wrap(TbPinned);
export const IconPinOff = wrap(TbPinnedOff);
export const IconHandStop = wrap(TbHandStop);
export const IconShield = wrap(TbShield);
export const IconShieldCheck = wrap(TbShieldCheck);
export const IconAlertTriangle = wrap(TbAlertTriangle);
export const IconCheck = wrap(TbCheck);
export const IconRobot = wrap(TbRobot);
export const IconArrowLeft = wrap(TbArrowLeft);
export const IconUser = wrap(TbUser);
export const IconAppearance = wrap(TbBrush);
export const IconLanguage = wrap(TbLanguage);
export const IconInfo = wrap(TbInfoCircle);
/** Slash palette / goal mode */
export const IconTarget = wrap(TbTarget);
export const IconClipboardList = wrap(TbClipboardList);
export const IconArrowsMinimize = wrap(TbArrowsMinimize);
export const IconCircleDashed = wrap(TbCircleDashed);
export const IconPlug = wrap(TbPlug);
export const IconActivity = wrap(TbActivity);
export const IconSparkles = wrap(TbSparkles);
export const IconBox = wrap(TbBox);
export const IconPuzzle = wrap(TbPuzzle);
