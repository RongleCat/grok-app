export {
  startPetFocusBridge,
  type PetFocusBridge,
  type PetFocusBridgeOpts,
} from "./petFocusBridge";

export {
  kindForSession,
  petKindRank,
  petVerbFor,
  pickPetFocus,
  resolvePetFocus,
  type PetFocus,
  type PetFocusInput,
  type PetFocusSession,
  type PetKind,
  type PetVerb,
} from "./petFocus";

export {
  PET_BUBBLE_GAP,
  PET_BUBBLE_ROW_H,
  PET_BUBBLE_SHADOW_PAD,
  PET_BUBBLE_STACK_PAD,
  PET_BUBBLE_VISIBLE,
  PET_BUBBLE_WIDTH,
  PET_TASK_LIMIT,
  collectPetTasks,
  isPetTaskBubbleKind,
  petBubbleStackHeight,
  petBubbleViewportHeight,
  petTaskPhase,
  petTaskProgress,
  samePetTasks,
  type PetTask,
  type PetTaskPhase,
} from "./petTasks";

export {
  PET_BUBBLE_EDGE_PAD,
  PET_COMPACT_PAD,
  PET_MARK_BOTTOM_PAD,
  petBubbleOffsetX,
  petBubblesEnabled,
  petCompactOverlayHeight,
  petCompactOverlayWidth,
  petOverlayExtent,
  petOverlayHeight,
  petOverlayWidth,
} from "./petBubbleLayout";

export { placePetContextMenu, type PetWorkRect } from "./petMenuPlace";

export {
  clampPetMarkHitRadius,
  expectedPetMarkHitRadius,
  hitChromeCssScale,
  scaleHitLen,
} from "./petHitChrome";

export {
  PET_SETTINGS_HASH,
  PET_SETTINGS_SECTION,
  petSettingsHash,
} from "./petNav";

export { isPetShellHash } from "./petShell";

export {
  PET_DRAG_SLOP,
  fallbackPetOverlayPolicy,
  petDragPassedSlop,
  petPointerStep,
  petShouldManualDrag,
} from "./petDrag";

export {
  PET_COLORS,
  PET_COLOR_SWATCH,
  PET_INK,
  PET_SHAPES,
  PET_SIZES,
  isPetColor,
  isPetEyeColor,
  isPetShape,
  normalizePetEyeColor,
  normalizePetSize,
  resolvePetBodyInk,
  resolvePetEyeInk,
  type PetColor,
  type PetEyeColor,
  type PetShape,
  type PetSizePx,
} from "./petIdentity";

export { petDoneTaskIds, shouldTriggerPetSpin } from "./petCelebrate";
