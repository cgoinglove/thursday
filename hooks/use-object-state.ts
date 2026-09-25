import { useCallback, useState } from "react";
import { isFunction } from "../lib/utils";

type SetPartialStateAction<T> = Partial<T> | ((prev: T) => Partial<T>);

const hasChanged = <T extends object>(prev: T, next: Partial<T>) =>
  (Object.keys(next) as (keyof T)[]).some(
    (key) => !Object.is(prev[key], next[key]),
  );

export const useObjectState = <T extends object>(initial: T | (() => T)) => {
  const [state, setState] = useState<T>(initial);

  const patch = useCallback((action: SetPartialStateAction<T>) => {
    setState((prev) => {
      const delta = isFunction(action) ? action(prev) : action;
      return hasChanged(prev, delta) ? { ...prev, ...delta } : prev;
    });
  }, []);

  return [state, patch] as const;
};
