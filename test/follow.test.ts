import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { followBase, isLocalRequest, parseFollow } from "../src/server/follow.ts";
import { freshConsole, getJson, postJson, type TestConsole } from "./helpers.ts";

/** Follow-along: guests mirror the presenter's page and can look, never change. */
const guest = { incoming: { socket: { remoteAddress: "192.168.1.44" } } };
const host = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const req = (t: TestConsole, path: string, env: unknown, init: RequestInit = {}) => t.app.request(path, init, env as never);
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("follow-along", () => {
  let t: TestConsole;
  beforeAll(() => {
    t = freshConsole();
  });
  afterAll(() => t.cleanup());

  it("only this computer counts as the host; an unreadable connection does not", () => {
    expect(isLocalRequest(host)).toBe(true);
    expect(isLocalRequest({ server: host })).toBe(true);
    expect(isLocalRequest({ incoming: { socket: { remoteAddress: "::1" } } })).toBe(true);
    expect(isLocalRequest(guest)).toBe(false);
    expect(isLocalRequest({ incoming: { socket: {} } })).toBe(false);
    expect(isLocalRequest(undefined)).toBe(true); // the test harness
  });

  it("validates the page a guest is pointed at", () => {
    expect(parseFollow({ path: "/customers/maya-thompson", query: "" })).toBeTruthy();
    expect(parseFollow({ path: "/inbox", query: "tab=approvals" })).toBeTruthy();
    for (const bad of [{ path: "today" }, { path: "/admin" }, { path: "/today/../../x" }, { path: "/customers/<script>" }, { path: "/today", query: "a=<b>" }, { path: 5 }]) expect(parseFollow(bad as never), JSON.stringify(bad)).toBeUndefined();
  });

  it("the host reports a page, guests read it, and a new page is announced on the stream", async () => {
    let seen = 0;
    t.hub.subscribe((e) => {
      if (e.type === "follow") seen++;
    });
    const r = await req(t, "/api/follow", host, post({ path: "/customers/maya-thompson", query: "" }));
    expect(r.status).toBe(200);
    expect((await (await req(t, "/api/follow", guest)).json()).path).toBe("/customers/maya-thompson");
    expect(seen).toBe(1);
    await req(t, "/api/follow", host, post({ path: "/customers/maya-thompson", query: "" })); // the same page again says nothing
    expect(seen).toBe(1);
    expect((await req(t, "/api/follow", host, post({ path: "/nowhere" }))).status).toBe(400);
  });

  it("guests cannot change anything: reports, actions, clock, reset and approvals are all refused", async () => {
    for (const [path, body] of [
      ["/api/follow", { path: "/pilot" }],
      ["/api/customers/maya-thompson/actions", { action: "send_checkin_now" }],
      ["/api/messages/1/approve", {}],
      ["/api/sandbox/reset", {}],
      ["/api/sandbox/advance", {}],
      ["/api/sandbox/inject", { customerId: "maya-thompson", text: "6" }],
    ] as const) {
      const r = await req(t, path, guest, post(body));
      expect(r.status, path).toBe(403);
    }
    expect((await getJson(t, "/api/follow")).path).toBe("/customers/maya-thompson"); // the guest's attempt changed nothing
  });

  it("guests can read everything and can use the public bag page", async () => {
    for (const path of ["/api/today", "/api/pilot", "/api/customers/maya-thompson", "/api/qr"]) expect((await req(t, path, guest)).status, path).toBe(200);
    const lot = (await getJson(t, "/api/qr")).latestLots[0].code as string;
    expect((await req(t, `/api/qr/lots/${lot}`, guest)).status).toBe(200);
    expect((await req(t, "/api/qr/scan", guest, post({ code: lot }))).status).toBe(200);
  });

  it("gives the join address, ending in #/follow", async () => {
    const info = await getJson(t, "/api/follow/info");
    expect(info.followUrl).toBe(`${info.base}/#/follow`);
    expect(info.base).toMatch(/^http:\/\//);
    expect(followBase(8787, "https://demo.example.com/").base).toBe("https://demo.example.com");
  });

  it("the console reports the host's page on every route change", async () => {
    const r = await postJson(t, "/api/follow", { path: "/pilot", query: "" });
    expect(r.status).toBe(200);
    expect((await getJson(t, "/api/follow")).path).toBe("/pilot");
  });
});
