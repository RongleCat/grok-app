/**
 * Shared questionnaire state + auto-cancel clock for the composer gate
 * and the settings demo modal.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { dropAskUserClock, getAskUserClocks } from "@/lib/askUser/askUserClocks";
import {
  askUserBuildAnswers,
  askUserCanSubmit,
  askUserQuestionKey,
} from "@/lib/askUser/askUserForm";
import { askUserTimeoutRemainingSec } from "@/lib/askUser/askUserTimeout";
import { dropGateClock, gateClockKey, resumeGateClock } from "@/lib/gateClock";
import type { AskUserPayload, AskUserQuestionItem } from "@/lib/session";

export function useAskUserQuestionnaire(
  payload: AskUserPayload | null,
  timeoutSec: number,
  onCancel: () => void | Promise<void>,
) {
  const questions = payload?.questions ?? [];
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [countdownSec, setCountdownSec] = useState<number | null>(null);
  const timedOutRef = useRef(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!payload) {
      setSelected({});
      setFreeText({});
      setBusy(false);
      setCountdownSec(null);
      timedOutRef.current = false;
      return;
    }
    setSelected({});
    setFreeText({});
    setBusy(false);
    timedOutRef.current = false;
  }, [payload?.rpcId]);

  const open = Boolean(payload && questions.length > 0);
  useEffect(() => {
    if (!open || !payload || !(timeoutSec > 0)) {
      setCountdownSec(null);
      return;
    }
    const clockKey = gateClockKey(payload.sessionId, payload.rpcId);
    const startedAt = resumeGateClock(getAskUserClocks(), clockKey);
    timedOutRef.current = false;
    setCountdownSec(askUserTimeoutRemainingSec(startedAt, timeoutSec));
    const tick = window.setInterval(() => {
      setCountdownSec(
        askUserTimeoutRemainingSec(startedAt, timeoutSec, Date.now()),
      );
    }, 250);
    const t = window.setTimeout(
      () => {
        if (timedOutRef.current || busyRef.current) return;
        timedOutRef.current = true;
        dropAskUserClock(clockKey);
        void onCancelRef.current();
      },
      Math.max(0, timeoutSec * 1000 - (Date.now() - startedAt)),
    );
    return () => {
      window.clearTimeout(t);
      window.clearInterval(tick);
      setCountdownSec(null);
    };
  }, [open, payload?.sessionId, payload?.rpcId, timeoutSec]);

  const canSubmit = useMemo(
    () => askUserCanSubmit(questions, selected, freeText),
    [questions, selected, freeText],
  );

  const toggleOption = (
    q: AskUserQuestionItem,
    index: number,
    optionId: string,
  ) => {
    const key = askUserQuestionKey(q, index);
    setSelected((prev) => {
      const cur = prev[key] || [];
      if (q.multiSelect) {
        const has = cur.includes(optionId);
        return {
          ...prev,
          [key]: has ? cur.filter((id) => id !== optionId) : [...cur, optionId],
        };
      }
      return { ...prev, [key]: [optionId] };
    });
    setFreeText((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const writeFreeText = (
    key: string,
    value: string,
    clearSingleSelect: boolean,
  ) => {
    setFreeText((prev) => ({ ...prev, [key]: value }));
    if (clearSingleSelect) {
      setSelected((prev) => ({ ...prev, [key]: [] }));
    }
  };

  const dropClock = () => {
    if (!payload) return;
    dropGateClock(
      getAskUserClocks(),
      gateClockKey(payload.sessionId, payload.rpcId),
    );
  };

  const submit = async (
    onSubmit: (answers: Record<string, string>) => void | Promise<void>,
    answers?: Record<string, string>,
  ) => {
    if (busy) return;
    setBusy(true);
    dropClock();
    try {
      await onSubmit(answers ?? askUserBuildAnswers(questions, selected, freeText));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    dropClock();
    await onCancel();
  };

  return {
    questions,
    open,
    selected,
    freeText,
    writeFreeText,
    busy,
    countdownSec,
    canSubmit,
    toggleOption,
    submit,
    cancel,
  };
}
