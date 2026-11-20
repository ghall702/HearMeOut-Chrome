// Generates manifest.json. Origins are injected so the e2e build can target a local mock server.
// `key` pins the extension ID for unpacked installs (the same ID in every Chrome profile), which
// lets the backend allow-list it via HMO_EXTENSION_IDS. Remove `key` before uploading to the
// Chrome Web Store — the store assigns its own.
export const EXTENSION_ID = "lphpbndpbbdgoglbgglgeckecbeilpjn";
const KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2YpgWIEv4n+GtB35YR06b3edPAqjpw3B0pswI7mmnc8UoGflgE6d8EEjBB4P0YpPrBDn5K90XpEZ69I5jxaGyGFw6+3uJC3/EVNc1P8nwksdp5vp9GcBhecNdcZeeP78zCI+ohW/hQxqbtyi1AQeY76Al3zFb97AJ3ctewn+bD9cJVQt8x23yVch69nKgashv4bFHlPIcFBkB78gav1YRaErJo1WaKZ583sh8fDktZ6OA8iPwpHgVmbFM03hJ371FDFj/Vvbo9QpOSkXAhlMrYnBPepWqSGBPV0gcxh2dXkJEocZkDlSr9L4EXibw/IAwVw4ZmsOb6yNpzlHpZgQQwIDAQAB";

export function buildManifest({ version, hmoOrigin, mediaOrigin, includeKey = true }) {
  return {
    manifest_version: 3,
    name: "Hear Me Out",
    short_name: "Hear Me Out",
    description: "Record a voice note from any tab and share it in the format that suits the website you're on.",
    version,
    minimum_chrome_version: "116",
    ...(includeKey ? { key: KEY } : {}),
    action: {
      default_title: "Hear Me Out",
      default_popup: "popup.html",
      default_icon: { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" },
    },
    icons: { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" },
    background: { service_worker: "background.js", type: "module" },
    permissions: ["storage", "unlimitedStorage", "offscreen", "identity", "alarms", "notifications", "activeTab", "scripting", "clipboardWrite"],
    host_permissions: [`${hmoOrigin}/*`, `${mediaOrigin}/*`],
    commands: {
      _execute_action: { suggested_key: { default: "Alt+Shift+H", mac: "Alt+Shift+H" }, description: "Open Hear Me Out" },
      "toggle-recording": { suggested_key: { default: "Alt+Shift+R", mac: "Alt+Shift+R" }, description: "Start or stop recording" },
      "copy-latest": { suggested_key: { default: "Alt+Shift+C", mac: "Alt+Shift+C" }, description: "Copy the latest voice note in the recommended format" },
      "open-hearmeout": { description: "Open the Hear Me Out website" },
    },
  };
}
