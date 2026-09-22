export type Consent = "granted" | "denied" | "unknown";
export const CONSENT_KEY = "neiwan.analytics.v1";
const allowedEvents = new Set(["view_all", "open_settings", "open_privacy"]);

export function createAnalytics(measurementId: string | undefined, win: Window) {
    const id = /^G-[A-Z0-9]+$/.test(measurementId ?? "") ? measurementId! : "";
    const globals = win as unknown as Record<string, any>;
    let consent: Consent = "unknown";
    let initialized = false;
    const fixed = () => ({ page_location: `${win.location.origin}${win.location.pathname}`, page_title: "內灣線轉乘攻略", page_referrer: "" });
    function command(...args: unknown[]) { globals.dataLayer.push(arguments); }
    function track(event: string) {
        if (consent !== "granted" || !id || !allowedEvents.has(event)) return;
        command("event", event, fixed());
    }
    function setConsent(value: Consent) {
        consent = value;
        if (!id) return;
        globals[`ga-disable-${id}`] = value !== "granted";
        if (value !== "granted") {
            initialized = false;
            win.document.getElementById("neiwan-ga")?.remove();
            for (const cookie of win.document.cookie.split(";")) {
                const name = cookie.trim().split("=")[0];
                if (!name.startsWith("_ga")) continue;
                const host = win.location.hostname.split(".");
                win.document.cookie = `${name}=; Max-Age=0; path=/`;
                for (let i = 0; i < host.length - 1; i++) win.document.cookie = `${name}=; Max-Age=0; path=/; domain=.${host.slice(i).join(".")}`;
            }
            return;
        }
        if (initialized) return;
        initialized = true;
        globals.dataLayer = [];
        globals.gtag = command;
        command("js", new Date());
        command("config", id, { ...fixed(), send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
        command("event", "page_view", fixed());
        const script = win.document.createElement("script");
        script.id = "neiwan-ga";
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
        win.document.head.append(script);
    }
    return { setConsent, track, configured: Boolean(id) };
}
