import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { logger } from "../logger";
import { isPublicError } from "../public-error";
import { flattenResult, isResultError, type Result, result } from "./result";

/**
 * Error policy shared by `serverAction` and `serverRoute`. PublicError and
 * ZodError messages reach the client; everything else is logged and masked.
 * Next's control-flow throws (redirect, notFound) pass through.
 */
export async function toResult(
  body: () => Promise<unknown>,
): Promise<Result<any>> {
  try {
    return flattenResult(result.ok(await body()));
  } catch (err) {
    unstable_rethrow(err);
    if (isPublicError(err)) return result.error(err.message);
    if (err instanceof ZodError) return result.error(err.issues[0]?.message);
    if (isResultError(err)) return err;
    // The client is told nothing; the terminal is the only place this exists
    logger.error(err);
    return result.error();
  }
}
