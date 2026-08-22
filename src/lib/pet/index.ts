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
  mergeHeldPetTasks,
  petBubbleStackHeight,
  petBubbleViewportHeight,
  petTaskPhase,
  petTaskProgress,
  samePetTasks,
  stripHeldPetTasks,
  type HeldPetTask,
  type PetTask,
  type PetTaskPhase,
} from "./petTasks";

export {
  PET_BUBBLE_DISMISS_DEFAULT,
  PET_BUBBLE_DISMISS_MAX,
  PET_BUBBLE_DISMISS_MIN,
  PET_BUBBLE_SHAPES,
  PET_BUBBLE_STYLES,
  isPetBubbleShape,
  isPetBubbleStyle,
  normalizePetBubbleDismissSec,
  normalizePetBubbleShape,
  normalizePetBubbleStyle,
  petBubbleDismissMs,
  petProgressBarEnabled,
  type PetBubbleShape,
  type PetBubbleStyle,
} from "./petBubbleChrome";

export { PET_DBLCLICK_MS, petMarkClickIntent } from "./petClick";

export {
  petStageSnippetStore,
  type PetStageStreamChunk,
} from "./petStageSnippets";

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
  petOverlayOriginForSize,
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
  PET_PICKER_SHAPES,
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
  type PetPickerShape,
  type PetShape,
  type PetSizePx,
} from "./petIdentity";

export {
  PET_COMPOSING_HOLD_MS,
  PET_EXPRESSIONS,
  bloubNotifFill,
  bloubShapeId,
  isPetExpression,
  normalizePetExpression,
  petIsComposing,
  petVerbForComposer,
  resolveBloubPlay,
  type PetExpression,
} from "./bloubPlay";

export { petDoneTaskIds, shouldTriggerPetSpin } from "./petCelebrate";

export {
  petLookIsNear,
  petPaintMinMs,
} from "./petMarkPaint";

export {
  petMarkScreenCenter,
  petNormXOnWorkArea,
  petShouldMirrorFace,
} from "./petFaceMirror";

export {
  PET_HOVER_LISTEN_MS,
  PET_REST_MOODS,
  isPetRestMood,
  pickRestEmote,
  resolveLivingMood,
  type LivingMoodInput,
  type PetRestMood,
} from "./petMood";
