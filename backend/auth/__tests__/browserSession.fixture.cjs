const bcrypt = require("bcryptjs");
const config = require("../config");
const { STATEMENT } = require("../access");

const ORIGIN = "http://localhost:3100";
const PASSWORD = "test-password-123";
const cookieFrom = (response) => response.headers.getSetCookie().filter((s) => !s.includes("Max-Age=0")).map((s) => s.split(";")[0]).join("; ");

async function fixture() {
  const { createAuth } = await import("../instance.mjs");
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  const data = { users: [], authAccounts: [], authSessions: [], authVerifications: [], authTwoFactors: [] };
  const mails = [];
  const auth = createAuth({
    database: memoryAdapter(data),
    config: { ...config, secret: "test-only-secret-with-at-least-thirty-two-characters", baseURL: ORIGIN, useSecureCookies: false, trustedOrigins: [ORIGIN] },
    statement: STATEMENT,
    hooks: { sessionRefusal: async () => null, checkPasswordBreach: async () => ({ breached: false }), sendEmailCode: async (mail) => mails.push(mail), sendMagicLink: async (mail) => mails.push(mail), sendResetPassword: async () => {} },
  });
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser({ name: "Client", email: "client@example.test", emailVerified: true, role: "user" });
  await ctx.internalAdapter.createAccount({ userId: user.id, accountId: user.id, providerId: "credential", password: bcrypt.hashSync(PASSWORD, 4) });
  const login = () => auth.api.signInEmail({ body: { email: user.email, password: PASSWORD }, asResponse: true });
  const request = (path, body, cookie) => auth.handler(new Request(`${ORIGIN}/api/auth${path}`, { method: body ? "POST" : "GET", headers: { origin: ORIGIN, ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  return { auth, ctx, user, login, request, mails, data };
}

// Shared by the HTTP controller/middleware regression, with no production DB.
const secretFromURI = (uri) => {
  const encoded = new URL(uri).searchParams.get("secret");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...encoded.replace(/=+$/, "")].map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  return Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2))).toString();
};
module.exports = { fixture, cookieFrom, PASSWORD, secretFromURI, ORIGIN };

