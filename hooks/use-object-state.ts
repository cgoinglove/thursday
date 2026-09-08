import { useMemo, useState } from "react";
import { isFunction } from "../lib/utils";

type SetPartialStateAction<T> = Partial<T> | ((prev: T) => Partial<T>);

type Patch<T> = ((action: SetPartialStateAction<T>) => void) & {
  [K in keyof T]-?: (value: T[K] | ((prev: T[K]) => T[K])) => void;
};

const hasChanged = <T extends object>(prev: T, next: Partial<T>) =>
  (Object.keys(next) as (keyof T)[]).some(
    (key) => !Object.is(prev[key], next[key]),
  );

export const useObjectState = <T extends object>(initial: T | (() => T)) => {
  const [state, setState] = useState<T>(initial);

  const patch = useMemo(() => {
    const apply = (action: SetPartialStateAction<T>) => {
      setState((prev) => {
        const delta = isFunction(action) ? action(prev) : action;
        return hasChanged(prev, delta) ? { ...prev, ...delta } : prev;
      });
    };

    // Cache per-key setters so their identity is stable in deps arrays.
    const cache = new Map<string, (value: unknown) => void>();

    return new Proxy(apply, {
      get(target, p, receiver) {
        if (typeof p === "symbol") return Reflect.get(target, p, receiver);

        let setter = cache.get(p);
        if (!setter) {
          setter = (value) => {
            apply(
              (prev) =>
                ({
                  [p]: isFunction(value) ? value(prev[p as keyof T]) : value,
                }) as Partial<T>,
            );
          };
          cache.set(p, setter);
        }
        return setter;
      },
    }) as Patch<T>;
  }, []);

  return [state, patch] as const;
};
