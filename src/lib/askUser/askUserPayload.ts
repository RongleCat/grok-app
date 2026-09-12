/**
 * Validation for the live `_x.ai/ask_user_question` payload.
 *
 * Extracted from the `session://ask_user` listener so the rpcId=0 regression
 * (a truthy guard used to drop valid id-0 questions and hang the turn) can be
 * unit-tested in isolation.
 */
import type { AskUserPayload } from "../session";

/**
 * A live ask-user payload is showable when it has an rpc id and at least one
 * question. `rpcId` may legitimately be 0 (JSON-RPC ids start at 0), so the
 * check is an explicit null test — never truthy.
 */
export function isValidAskUserPayload(
  p: Partial<AskUserPayload> | null | undefined,
): p is AskUserPayload {
  return (
    !!p &&
    p.rpcId != null &&
    Array.isArray(p.questions) &&
    p.questions.length > 0
  );
}
