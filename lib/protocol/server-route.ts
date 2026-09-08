import { isResultOk } from "./result";
import { toResult } from "./to-result";

export type RouteContext<P = Record<string, string>> = {
  params: Promise<P>;
};

type Handler<Ctx> = (request: Request, context: Ctx) => Promise<unknown>;

/**
 * Route-handler twin of `serverAction`: the body is always a serialized `Result`.
 * A handler that returns a `Response` itself takes over (streams, etc.).
 */
export const serverRoute = <Ctx = RouteContext>(handler: Handler<Ctx>) => {
  return async (request: Request, context: Ctx): Promise<Response> => {
    const res = await toResult(() => handler(request, context));
    if (isResultOk(res) && res.data instanceof Response) return res.data;
    return Response.json(res);
  };
};
