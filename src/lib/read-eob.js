import { EOB_PROMPT } from "./core.js";

/**
 * Outside claude.ai the API call needs two things the artifact got for free:
 * a key, and permission to be called from a browser at all.
 *
 * The key lives in this browser only. It is never bundled and never sent
 * anywhere except Anthropic. If you would rather it not sit in the browser at
 * all, put a one-route proxy in front of this — see README.
 */
const KEY_STORE = "hsa-ledger-api-key";

export const getKey = () => {
  try {
    return window.localStorage.getItem(KEY_STORE) || "";
  } catch (err) {
    return "";
  }
};

export const setKey = (k) => {
  try {
    if (k) window.localStorage.setItem(KEY_STORE, k.trim());
    else window.localStorage.removeItem(KEY_STORE);
  } catch (err) {
    /* private browsing */
  }
};

export const ENDPOINT =
  import.meta.env.VITE_API_PROXY || "https://api.anthropic.com/v1/messages";

const usingProxy = () => ENDPOINT !== "https://api.anthropic.com/v1/messages";

export async function callClaude(content) {
  const key = getKey();
  if (!key && !usingProxy()) {
    throw new Error("Add an Anthropic API key in Setup before reading documents.");
  }

  const headers = { "content-type": "application/json" };
  if (!usingProxy()) {
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
    // Anthropic blocks browser-origin calls unless this is set explicitly.
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{ role: "user", content }],
      }),
    });
  } catch (err) {
    throw new Error("Couldn't reach the reader. Check your connection — importing a spreadsheet still works offline.");
  }

  if (res.status === 401) throw new Error("That API key was rejected. Check it in Setup.");
  if (res.status === 429) throw new Error("Rate limited. Wait a moment and try again.");
  if (!res.ok) throw new Error(`The reader came back with an error (${res.status}).`);

  const payload = await res.json();
  const text = (payload.content || []).map((b) => (b.type === "text" ? b.text : "")).join("\n");
  const arr = text.match(/\[[\s\S]*\]/);
  if (!arr) throw new Error("No claim lines came back. This may be a coverage summary rather than a claims list.");

  let items;
  try {
    items = JSON.parse(arr[0]);
  } catch (err) {
    throw new Error("The reader's response came back malformed. Try again, or enter this one by hand.");
  }
  if (!Array.isArray(items) || !items.length) throw new Error("No claim lines were found in that document.");
  return items;
}

export { EOB_PROMPT };
