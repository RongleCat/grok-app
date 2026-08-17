/** Icon for a command-palette action row (stable by action id). */
import {
  IconActivity,
  IconArchive,
  IconAppearance,
  IconDeviceMobile,
  IconDoctor,
  IconFolder,
  IconHelp,
  IconHistory,
  IconInfo,
  IconKeyboard,
  IconList,
  IconNewChat as IconSquarePen,
  IconPlug,
  IconRewind,
  IconScheduled,
  IconSettings,
  IconUser,
  IconCopy,
} from "@/components/icons";

export function paletteActionIcon(id: string) {

  const size = 15;
  switch (id) {
    case "new-chat":
      return <IconSquarePen size={size} />;
    case "add-project":
      return <IconFolder size={size} />;
    case "new-space":
      return <IconFolder size={size} />;
    case "open-automations":
      return <IconScheduled size={size} />;
    case "open-ops":
    case "open-agent-dashboard":
      return <IconActivity size={size} />;
    case "open-tasks":
    case "open-task-board":
    case "open-kanban":
    case "open-batch-agents":
      return <IconList size={size} />;
    case "doctor":
      return <IconDoctor size={size} />;
    case "traces":
      return <IconArchive size={size} />;
    case "reliability":
      return <IconActivity size={size} />;
    case "shortcuts-help":
    case "settings-shortcuts":
      return <IconKeyboard size={size} />;
    case "product-tutorial":
      return <IconHelp size={size} />;
    case "copy-conversation-md":
      return <IconCopy size={size} />;
    case "continue-cwd":
      return <IconHistory size={size} />;
    case "resume-with-code-restore":
      return <IconRewind size={size} />;
    case "settings-appearance":
      return <IconAppearance size={size} />;
    case "settings-account":
      return <IconUser size={size} />;
    case "settings-extensions":
      return <IconPlug size={size} />;
    case "settings-runtime":
    case "settings-workflows":
    case "workflows-docs":
      return <IconDoctor size={size} />;
    case "settings-remote":
      return <IconDeviceMobile size={size} />;
    case "settings-about":
      return <IconInfo size={size} />;
    case "settings-general":
    default:
      return <IconSettings size={size} />;
  }
}
