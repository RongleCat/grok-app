/**
 * PointHand preset card for the Add MCP server modal: fills the existing form
 * (the user still reviews the path and presses Add), installs the bundled
 * Grok skill on click, and opens the setup guide.
 */
import { useState } from "react";
import * as api from "@/lib/api";
import { createT } from "@/i18n";
import {
  POINTHAND_REPO_URL,
  POINTHAND_SKILL_MD,
  POINTHAND_SKILL_NAME,
  pointhandPresetFields,
  type PointhandPresetFields,
} from "@/lib/pointhand";

type TFn = ReturnType<typeof createT>;

type SkillState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done"; path: string }
  | { kind: "exists"; path: string }
  | { kind: "error"; message: string };

export function PointhandPresetCard(props: {
  tr: TFn;
  disabled: boolean;
  onFill: (fields: PointhandPresetFields) => void;
}) {
  const { tr, disabled, onFill } = props;
  const [skill, setSkill] = useState<SkillState>({ kind: "idle" });

  const installSkill = async () => {
    if (!api.isTauri() || skill.kind === "busy") return;
    setSkill({ kind: "busy" });
    try {
      const res = await api.skillCreate({
        name: POINTHAND_SKILL_NAME,
        description: "PointHand Windows computer use",
        scope: "user",
      });
      if (res.alreadyExisted) {
        setSkill({ kind: "exists", path: res.path });
        return;
      }
      await api.skillWrite(res.path, POINTHAND_SKILL_MD);
      setSkill({ kind: "done", path: res.path });
    } catch (e) {
      setSkill({ kind: "error", message: String(e) });
    }
  };

  return (
    <div className="ext-pointhand-card" data-testid="pointhand-preset">
      <div className="ext-pointhand-card__text">
        <strong>{tr("ext.mcp.pointhand.title")}</strong>
        <p className="ext-mcp-auth-hint">{tr("ext.mcp.pointhand.body")}</p>
      </div>
      <div className="ext-pointhand-card__actions">
        <button
          type="button"
          className="btn btn--solid btn--sm"
          disabled={disabled}
          onClick={() => onFill(pointhandPresetFields())}
        >
          {tr("ext.mcp.pointhand.fill")}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={disabled || skill.kind === "busy" || !api.isTauri()}
          onClick={() => void installSkill()}
        >
          {tr("ext.mcp.pointhand.skill")}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => void api.openExternalUrl(POINTHAND_REPO_URL).catch(() => {})}
        >
          {tr("ext.mcp.pointhand.docs")}
        </button>
      </div>
      {skill.kind === "done" ? (
        <span className="ext-field-hint">
          {tr("ext.mcp.pointhand.skillDone", { path: skill.path })}
        </span>
      ) : null}
      {skill.kind === "exists" ? (
        <span className="ext-field-hint">
          {tr("ext.mcp.pointhand.skillExists", { path: skill.path })}
        </span>
      ) : null}
      {skill.kind === "error" ? (
        <span className="ext-field-hint" role="alert">
          {skill.message}
        </span>
      ) : null}
      <span className="ext-field-hint">{tr("ext.mcp.pointhand.pathHint")}</span>
    </div>
  );
}
