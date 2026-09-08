const TAG = "$ok" as const;

export type ResultOk<T> = {
  [TAG]: true;
  data: T;
};

export type ResultError = {
  [TAG]: false;
  message?: string;
};

export type Result<T> = ResultOk<T> | ResultError;

export type ResultData<R> = R extends ResultOk<infer T> ? T : never;

export type FlatResult<T extends Result<any>> =
  T extends ResultOk<infer U> ? (U extends Result<any> ? FlatResult<U> : T) : T;

export const isResult = (data?: any): data is Result<any> => {
  return (
    Boolean(data) &&
    typeof data === "object" &&
    (data[TAG] === true || data[TAG] === false)
  );
};

export const isResultOk = (data?: any): data is ResultOk<any> => {
  return isResult(data) && data[TAG];
};

export const isResultError = (data?: any): data is ResultError => {
  return isResult(data) && !data[TAG];
};

/** Folds a nested Result<Result<T>> into a single Result. */
export const flattenResult = <R extends Result<any>>(res: R): FlatResult<R> => {
  let current: Result<any> = res;
  while (isResultOk(current) && isResult(current.data)) {
    current = current.data;
  }
  return current as FlatResult<R>;
};

/** Throws the failure as an Error at the call site. */
export const unwrapResult = <R extends Result<any>>(res: R): ResultData<R> => {
  if (!isResultOk(res)) {
    throw new Error(res.message ?? "Something went wrong");
  }
  return res.data;
};

export const result = {
  ok<T>(data: T): ResultOk<T> {
    return { [TAG]: true, data };
  },
  error(message?: string): ResultError {
    return {
      [TAG]: false,
      message,
    };
  },
};
