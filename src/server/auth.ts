import type { GetServerSidePropsContext } from "next";
import {
  getServerSession,
  type NextAuthOptions,
  type DefaultSession,
  type Session,
} from "next-auth";
import AzureProvider from "next-auth/providers/azure-ad";
import { type JWT } from "next-auth/jwt";

import { env } from "@/env.mjs";

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */

declare module "next" {
  /**
   * Used with withAuth helper is applied to a NextApiHandler
   */
  interface NextApiRequest {
    nextauth: {
      token: JWT;
      session: Session;
    };
  }
}

declare module "next-auth/jwt" {
  /**
   * Returned by the `jwt` callback and `getToken`, when using JWT sessions
   */
  interface JWT {
    // default
    name?: string | null;
    email?: string | null;
    picture?: string | null;
    sub?: string;

    // extended
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
    roles: string[];
    oid: string;
    iat: number;
    exp: number;
    jti: string;
  }
}

declare module "next-auth" {
  /**
   * Returned by `useSession`, `getSession` and received as a prop
   * on the `SessionProvider` React Context
   */
  interface Session extends DefaultSession {
    tokenExpiresAt: string;
    tokenExpiresIn: string;
    user: {
      id: string;
      email: string;
      name: string;
      roles: string[];
    };
  }

  /** Azure AD Account */
  interface Account {
    provider: string;
    providerAccountId: string;
    token_type: "Bearer";
    scope: string;
    expires_at: number;
    ext_expires_in: number;
    access_token: string;
    id_token: string;
    session_state: string;
  }

  /** Azure AD Profile (id_token payload) */
  interface Profile {
    aud: string;
    iss: string; // https://login.microsoftonline.com/0b53d2c1-bc55-4ab3-a161-927d289257f2/v2.0
    iat: number;
    nbf: number;
    exp: number;
    aio: string;
    oid: string;
    preferred_username: string;
    rh: string;
    roles: string[];
    tid: string;
    uti: string;
    ver: "2.0";
  }
}

type RefreshTokenPayload =
  | {
      token_type: "Bearer";
      scope: string;
      expires_in: number;
      ext_expires_in: number;
      refresh_token: string;
      access_token: string;
      id_token: string;
    }
  | {
      error: string;
      error_description: string;
      error_codes: number[];
      error_uri: string;
    };

/**
 * Takes a token, and returns a new token with updated
 * `accessToken` and `expiresAt`.
 */
const refreshAccessToken = async (token: JWT): Promise<JWT> => {
  try {
    if (!token.refreshToken) {
      console.warn("No refresh token available, skip refresh");
      throw new Error("No refresh token available.");
    }

    const response = await fetch(
      `https://login.microsoftonline.com/${env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`,
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: env.AZURE_AD_CLIENT_ID,
          client_secret: env.AZURE_AD_CLIENT_SECRET,
          refresh_token: token.refreshToken,
          scope: "openid profile email offline_access",
        }),
        method: "POST",
      }
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const data: RefreshTokenPayload = await response.json();
    if ("error" in data) {
      throw new Error(`Failed to refresh accessToken: ${data.error}`);
    }
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    console.info(">>>>>>>>>>>> REFRESH TOKEN >>>>>>");
    console.info(data);
    console.info(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>");
    return {
      ...token,
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      refreshToken: data.refresh_token,
    };
  } catch (error) {
    if (error instanceof Error) {
      console.error("Failed to refresh token: %s", error.message);
    }

    // throwing the error will cause the session to be invalidated
    // and the user must re-login
    throw error;
  }
};

/**
 * Options for NextAuth.js
 * Used in pages/api/auth/[...nextauth].ts
 *
 * @see https://next-auth.js.org/configuration/options
 */
export const authOptions: NextAuthOptions = {
  debug: false,
  // pages: {
  //   // Change the default behavior to use `/login` as the path for the sign-in page
  //   signIn: "/signIn",
  // },
  session: {
    maxAge: 1 * 24 * 60 * 60, // 24h - should be the same as the refresh token lifetime
  },
  providers: [
    AzureProvider({
      clientId: env.AZURE_AD_CLIENT_ID,
      clientSecret: env.AZURE_AD_CLIENT_SECRET,
      tenantId: env.AZURE_AD_TENANT_ID,
      // idToken: true,
      checks: ["pkce"], // to prevent CSRF and authorization code injection attacks.
      authorization: {
        params: {
          scope: "openid profile email offline_access",
        },
      },
    }),
  ],
  callbacks: {
    jwt({ token, account, user, profile }) {
      console.debug("jwt: %o", { token });
      // Initial sign in
      if (profile && account) {
        console.info("jwt: %o", {
          accessToken: account?.access_token,
          refreshToken: account?.refresh_token,
        });
        delete user?.image; // lets keep auth cookie small
        const clockSkew = 60 * 10 * 1000; // 10 minutes
        const expiresAt = account.expires_at * 1000 - clockSkew; // ms
        return {
          expiresAt,
          oid: profile.oid,
          iat: token.iat,
          exp: token.exp,
          jti: token.jti,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          roles: profile.roles,
          ...user,
        };
      }

      console.debug(
        "Validate token for: %s, expires at %d",
        token.name,
        token.expiresAt
      );

      // Return previous token if the access token has not expired yet
      if (Date.now() < token.expiresAt) {
        return token;
      }

      // Access token has expired, try to update it
      return refreshAccessToken(token);
    },
    session({ session, token }) {
      console.debug("session %o", { session });
      if (session.user) {
        // get time span until token expires
        const date = new Date(0);
        date.setMilliseconds(token.expiresAt - Date.now());
        const timeSpanUntilExpires = date.toISOString().substring(11, 19);
        const roles = token.roles || [];

        // create session object
        session.user.id = token.oid;
        session.user.name = token.name || "";
        session.user.email = token.email || "";
        session.user.roles = roles;
        session.tokenExpiresAt = new Date(token.expiresAt).toISOString();
        session.tokenExpiresIn = timeSpanUntilExpires;
      }
      return session;
    },
  },
};

export type Role = "admin" | "manager" | "consultant" | "user";

export const userIsInRole = (
  user: Session["user"] | undefined,
  role: Role | Role[]
) => {
  const userRoles = user?.roles || [];
  if (Array.isArray(role)) {
    return role.some((r) => userRoles.includes(r));
  }
  return userRoles.includes(role);
};

/**
 * Wrapper for `getServerSession` so that you don't need to import the `authOptions` in every file.
 *
 * @see https://next-auth.js.org/configuration/nextjs
 */
export const getServerAuthSession = async (ctx: {
  req: GetServerSidePropsContext["req"];
  res: GetServerSidePropsContext["res"];
}) => {
  const session = await getServerSession(ctx.req, ctx.res, authOptions);
  if (session && "image" in session.user) delete session.user.image;
  return session;
};
