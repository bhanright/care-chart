// Prints a fresh key pair for Web Push reminders. Run once, then store both as secrets (README, "Dose reminders").
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
console.log(`VAPID_PUBLIC_KEY=${b64url(publicRaw)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
