"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { errorToString } from "@/lib/utils";
import { isResultOk, Result, ResultData, result } from "./result";

type ActionFn = (...args: any[]) => Promise<Result<any>>;

type UseServerActionOptions<Data> = {
  onOk?: (data: Data) => void;
  onError?: (serverMessage?: string) => void;

  /** Success toast. Leave it out for none. */
  okMessage?: string | ((data: Data) => string);

  /** Error toast. Defaults to the server message; `false` turns it off. */
  errorMessage?: string | ((serverMessage?: string) => string) | false;
};

const FALLBACK_ERROR = "Something went wrong";

export function useServerAction<A extends ActionFn>(
  action: A,
  options: UseServerActionOptions<ResultData<Awaited<ReturnType<A>>>> = {},
) {
  const [isPending, setIsPending] = useState(false);
  const [data, setData] = useState<ResultData<Awaited<ReturnType<A>>>>();
  const [error, setError] = useState<string>();

  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Only the most recent call may write state
  const seqRef = useRef(0);

  const run = useCallback(
    async (
      ...args: Parameters<A>
    ): Promise<ResultData<Awaited<ReturnType<A>>>> => {
      const seq = ++seqRef.current;
      const latest = () => seq === seqRef.current;
      setIsPending(true);

      try {
        // Transport failures (network, abort) take the same Result shape
        const res = await action(...args).catch((cause) =>
          result.error(errorToString(cause)),
        );

        const { onOk, onError, okMessage, errorMessage } = optionsRef.current;

        if (isResultOk(res)) {
          if (latest()) {
            setData(res.data);
            setError(undefined);
          }
          const title =
            typeof okMessage === "function" ? okMessage(res.data) : okMessage;
          if (title) toast.add({ type: "success", title });
          onOk?.(res.data);
          return res.data;
        }

        if (latest()) setError(res.message ?? FALLBACK_ERROR);
        if (errorMessage !== false) {
          const title =
            typeof errorMessage === "function"
              ? errorMessage(res.message)
              : (errorMessage ?? res.message ?? FALLBACK_ERROR);
          toast.add({ type: "error", title });
        }
        onError?.(res.message);

        // Reject so an awaiting caller cannot continue down the success path
        throw new Error(res.message ?? FALLBACK_ERROR);
      } finally {
        if (latest()) setIsPending(false);
      }
    },
    [action],
  );

  const execute = useCallback(
    (...args: Parameters<A>) => {
      const promise = run(...args);
      // Most call sites do not await; the hook already toasted, so the
      // rejection is handled here. An awaiting caller still sees it.
      promise.catch(() => {});
      return promise;
    },
    [run],
  );

  const reset = useCallback(() => {
    setData(undefined);
    setError(undefined);
  }, []);

  return [execute, isPending, data, error, reset] as const;
}
