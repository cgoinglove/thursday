import { listSignIns } from "@/features/signins/signins.query";
import { serverRoute } from "@/lib/protocol/server-route";

export const GET = serverRoute(() => listSignIns());
