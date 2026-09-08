import { createConsola, LogLevels } from "consola";
import { ColorName, colorize } from "consola/utils";
import { APP_NAME, IS_DEV } from "@/config";

const defaultLog = createConsola({
  level: IS_DEV ? LogLevels.debug : LogLevels.info,
});

export const createLogger = (name: string, color?: ColorName) =>
  defaultLog.withDefaults({
    message: colorize(color || "blackBright", `${name}: `),
  });

export const logger = createLogger(APP_NAME);
