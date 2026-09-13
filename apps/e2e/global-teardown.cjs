const shutdownUrl = "http://127.0.0.1:3003/__parallly_e2e_shutdown__";

module.exports = async function globalTeardown() {
  try {
    const response = await fetch(shutdownUrl, {
      method: "POST",
      headers: { "x-parallly-e2e-control": "shutdown" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`E2E server shutdown returned HTTP ${response.status}`);
    }
  } catch (error) {
    // A server that already exited needs no cleanup. Other failures should be
    // visible because they otherwise leave CI and local runs hanging.
    if (error && typeof error === "object" && error.cause?.code === "ECONNREFUSED") {
      return;
    }
    throw error;
  }
};
