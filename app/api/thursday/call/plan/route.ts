import z from "zod";
import {
  followPlanLine,
  tellPlanLine,
} from "@/features/thursday/thursday.plan";
import { serverRoute } from "@/lib/protocol/server-route";

/**
 * A spoken call on the GPT subscription, as its page follows it (thursday.plan): GET is the
 * line's events as a stream, POST what the page says on it, in order. A route rather than a
 * server action because actions run one at a time per client, and a tool's output must not
 * wait behind a turn being saved.
 */

const callOf = (request: Request) =>
  z.string().min(1).parse(new URL(request.url).searchParams.get("call"));

export const GET = serverRoute(async (request) =>
  followPlanLine(callOf(request), request.signal),
);

export const POST = serverRoute(async (request) => {
  const { events } = z
    .object({ events: z.array(z.unknown()).min(1) })
    .parse(await request.json());
  tellPlanLine(callOf(request), events);
});
