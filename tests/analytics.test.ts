// @vitest-environment jsdom
import { expect, it } from "vitest";
import { createAnalytics } from "../src/analytics";
it("同意前與拒絕時不載入 GA，同意後只送白名單事件並移除網址查詢", () => {
    const analytics = createAnalytics("G-TEST123", window);
    analytics.track("view_all");
    expect(document.querySelector("script[src*='googletagmanager']")).toBeNull();
    analytics.setConsent("denied");
    expect(document.querySelector("script[src*='googletagmanager']")).toBeNull();
    analytics.setConsent("granted");
    expect(document.querySelectorAll("script[src*='googletagmanager']")).toHaveLength(1);
    analytics.track("view_all");
    const events = (window as any).dataLayer.map((a: any) => Array.from(a));
    expect(events.filter((a: any) => a[0] === "event").map((a: any) => a[1])).toEqual(["page_view", "view_all"]);
    const count = events.length;
    analytics.setConsent("denied");
    analytics.track("view_all");
    expect((window as any).dataLayer.length).toBe(count);
    expect((window as any)["ga-disable-G-TEST123"]).toBe(true);
    analytics.setConsent("granted");
    expect(document.querySelectorAll("script[src*='googletagmanager']")).toHaveLength(1);
    expect((window as any)["ga-disable-G-TEST123"]).toBe(false);
});
