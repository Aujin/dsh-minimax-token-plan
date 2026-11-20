/**
 * Host half of the MiniMax Token Plan plugin.
 *
 * The whole feature lives in the browser half (`./client.js`): it talks to the
 * MiniMax quota endpoint directly and keeps the API key in an encrypted
 * IndexedDB vault. The host only needs to provide the plugin row so the client
 * bundle is served.
 */
export function apply() {}
