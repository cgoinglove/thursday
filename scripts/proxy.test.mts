import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// The file route resolves the workspace from the data folder as it loads: keep it off anyone's own
const home = await mkdtemp(join(tmpdir(), "thursday-proxy-"));
process.env.THURSDAY_HOME = home;
after(() => rm(home, { recursive: true, force: true }));

const { NextRequest } = await import("next/server");
const { proxy } = await import("../proxy.ts");
const { GET } = await import("../app/api/file/[...path]/route.ts");
const { WORKSPACE } = await import("../features/workspace/workspace.ts");

const passes = (response: Response) =>
  response.headers.get("x-middleware-next") === "1";

const request = (
  url: string,
  headers: Record<string, string> = {},
  method = "GET",
) => {
  const { host } = new URL(url);
  return new NextRequest(url, { method, headers: { host, ...headers } });
};

test("a request under any name but this computer's is refused", () => {
  assert.equal(
    proxy(request("http://127.0.0.1:3000/", { host: "example.test:3000" }))
      .status,
    421,
  );
  for (const url of [
    "http://127.0.0.1:3000/",
    "http://localhost:3000/",
    "http://[::1]:3000/",
  ])
    assert.ok(passes(proxy(request(url))), url);
});

test("a write another site sends is refused, and the app's own and a local tool's go through", () => {
  const url = "http://127.0.0.1:3000/api/thursday/tool-call";
  const from = (headers: Record<string, string>) =>
    proxy(request(url, headers, "POST"));
  assert.equal(from({ "sec-fetch-site": "cross-site" }).status, 403);
  assert.equal(from({ "sec-fetch-site": "same-site" }).status, 403);
  assert.equal(from({ origin: "http://example.test" }).status, 403);
  // A page the app serves is sandboxed, so it has no origin of its own to send
  assert.equal(from({ origin: "null" }).status, 403);
  assert.ok(
    passes(
      from({
        "sec-fetch-site": "same-origin",
        origin: "http://127.0.0.1:3000",
      }),
    ),
  );
  assert.ok(passes(from({})));
  // Reading is left alone: another site gets no answer it can read
  assert.ok(
    passes(
      proxy(
        request(url.replace("tool-call", "x"), {
          "sec-fetch-site": "cross-site",
        }),
      ),
    ),
  );
});

test("a page or a drawing is served sandboxed, and a picture is not", async () => {
  await mkdir(join(WORKSPACE, "artifacts", "Tester"), { recursive: true });
  const serve = async (name: string, body: string) => {
    await writeFile(join(WORKSPACE, "artifacts", "Tester", name), body);
    const path = ["artifacts", "Tester", name];
    return GET(
      new Request(`http://127.0.0.1:3000/api/file/${path.join("/")}`),
      { params: Promise.resolve({ path }) },
    );
  };
  for (const name of ["page.html", "old.htm", "drawing.svg"]) {
    const policy = (await serve(name, "<p>hi</p>")).headers.get(
      "content-security-policy",
    );
    assert.match(policy ?? "", /^sandbox allow-scripts /, name);
    assert.doesNotMatch(policy ?? "", /allow-same-origin/, name);
    assert.match(policy ?? "", /frame-ancestors 'self'/, name);
  }
  assert.equal(
    (await serve("shot.png", "png")).headers.get("content-security-policy"),
    null,
  );
});
