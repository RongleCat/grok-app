import { memo } from "react";
import { IconChevronDown } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const BackBottom = memo(function BackBottom({
  visible,
  onClick,
  label,
}: {
  visible: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <Tip label={label}>
      <button
        type="button"
        className={cn("lobe-chat-back-bottom", visible && "is-visible")}
        aria-label={label}
        onClick={onClick}
      >
        <IconChevronDown size={18} />
      </button>
    </Tip>
  );
});
