import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { privacyPage } from "./src/privacy-page";

const base = process.env.BASE_PATH || "/";
export default defineConfig({
    base,
    server: { host: "127.0.0.1" },
    plugins: [{
        name: "privacy-static-content",
        transformIndexHtml(html) {
            return html.replace("<!--privacy-content-->", privacyPage(base, undefined, "unknown"));
        },
    }],
    build: {
        rollupOptions: {
            input: {
                main: fileURLToPath(new URL("./index.html", import.meta.url)),
                privacy: fileURLToPath(new URL("./privacy/index.html", import.meta.url)),
            },
        },
    },
});
