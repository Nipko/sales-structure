const { execFileSync } = require("node:child_process");
const {
  cpSync,
  createReadStream,
  existsSync,
  statSync,
} = require("node:fs");
const { createServer } = require("node:http");
const { extname, resolve, sep } = require("node:path");

const repositoryRoot = resolve(__dirname, "..", "..");
const landingRoot = resolve(repositoryRoot, "apps", "landing", "out");
const dashboardRoot = resolve(repositoryRoot, "apps", "dashboard");
const standaloneRoot = resolve(
  dashboardRoot,
  ".next",
  "standalone",
  "apps",
  "dashboard",
);
const dashboardServer = resolve(standaloneRoot, "server.js");

// Playwright's web server starts before globalSetup. Building here makes a
// plain `npm run test:e2e` work on a fresh checkout and serves the same output
// the production images copy.
execFileSync(
  process.execPath,
  [
    resolve(repositoryRoot, "node_modules", "turbo", "bin", "turbo"),
    "build",
    "--filter=landing",
    "--filter=@parallext/dashboard",
  ],
  { cwd: repositoryRoot, env: process.env, stdio: "inherit" },
);

if (!existsSync(resolve(landingRoot, "index.html"))) {
  throw new Error("Landing export is missing after its build");
}
if (!existsSync(dashboardServer)) {
  throw new Error("Dashboard standalone server is missing after its build");
}

// Match Dockerfile.dashboard: standalone tracing excludes static and public.
cpSync(
  resolve(dashboardRoot, ".next", "static"),
  resolve(standaloneRoot, ".next", "static"),
  { recursive: true },
);
cpSync(resolve(dashboardRoot, "public"), resolve(standaloneRoot, "public"), {
  recursive: true,
});

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function landingTarget(rawUrl) {
  const pathname = decodeURIComponent(
    new URL(rawUrl, "http://127.0.0.1").pathname,
  );
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const candidates = extname(relative)
    ? [relative]
    : [`${relative}.html`, `${relative}/index.html`];

  for (const candidate of candidates) {
    const target = resolve(landingRoot, candidate);
    if (!target.startsWith(`${landingRoot}${sep}`) && target !== landingRoot) {
      continue;
    }
    try {
      if (statSync(target).isFile()) return target;
    } catch {
      // Try the next static-export shape.
    }
  }
  return null;
}

const landingServer = createServer((request, response) => {
  let target = null;
  try {
    target = landingTarget(request.url || "/");
  } catch {
    // Invalid URL encoding is a normal 404, not a process failure.
  }

  if (!target) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentTypes[extname(target)] || "application/octet-stream",
  });
  createReadStream(target).pipe(response);
});

landingServer.listen(3003, "127.0.0.1");

process.env.PORT = "3001";
process.env.HOSTNAME = "127.0.0.1";
require(dashboardServer);
