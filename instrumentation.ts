// Next also builds this file for the Edge runtime and flags any Node API in it,
// so what the server does at boot is imported only on Node.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { boot } = await import("./instrumentation-node");
    await boot();
  }
}
