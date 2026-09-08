import type { FlatResult, Result } from "./result";
import { toResult } from "./to-result";

type Fn = (...args: any[]) => Promise<any>;

type Normalize<R> = R extends Result<any> ? FlatResult<R> : Result<R>;

export const serverAction = <A extends Fn>(action: A) => {
  const wrapped = (...args: Parameters<A>) => toResult(() => action(...args));
  return wrapped as (
    ...args: Parameters<A>
  ) => Promise<Normalize<Awaited<ReturnType<A>>>>;
};
