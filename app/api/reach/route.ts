import { readReachStatus } from "@/features/reach/reach";
import { serverRoute } from "@/lib/protocol/server-route";

export const GET = serverRoute(() => readReachStatus());
