export const logger = {
  info: (msg: string, meta?: any) => {
    console.log(`\x1b[32m[INFO]\x1b[0m ${msg}`, meta || "");
  },
  warn: (msg: string, meta?: any) => {
    console.warn(`\x1b[33m[WARN]\x1b[0m ${msg}`, meta || "");
  },
  error: (msg: string, meta?: any) => {
    console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`, meta || "");
  },
  debug: (msg: string, meta?: any) => {
    if (process.env.DEBUG === "true") {
      console.debug(`\x1b[90m[DEBUG]\x1b[0m ${msg}`, meta || "");
    }
  },
};
