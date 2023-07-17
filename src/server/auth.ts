import { type GetServerSidePropsContext } from "next";
import {
  getServerSession,
  type NextAuthOptions,
  type DefaultSession,
} from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      // ...other properties
      // role: UserRole;
    } & DefaultSession["user"];
  }
}

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
export const authOptions: NextAuthOptions = {
  callbacks: {
    jwt: ({ token, user, account, profile, isNewUser }) => {
      // console.log("jwt", { token, user, account, profile, isNewUser });
      if (account) {
        return {
          ...token,
          user,
        };
      }
      return token;
    },
    session: ({ token, session, user }) => {
      // console.log("session", token, session, user);
      return {
        ...session,
        user: {
          ...session.user,
          id: "12345",
        },
      };
    },
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      // `credentials` is used to generate a form on the sign in page.
      // You can specify which fields should be submitted, by adding keys to the `credentials` object.
      // e.g. domain, username, password, 2FA token, etc.
      // You can pass any HTML attribute to the <input> tag through the object.
      credentials: {
        email: {
          label: "Email",
          type: "text",
          placeholder: "name@euri.com",
        },
        password: {
          label: "Password",
          type: "password",
          placeholder: "welcome12345",
        },
      },
      authorize(credentials) {
        const users = [
          {
            id: "1",
            name: "Peter",
            email: "peter@euri.com",
            password: "welcome12345",
          },
          {
            id: "2",
            name: "John",
            email: "john@euri.com",
            password: "welcome12345",
          },
        ];
        const user = users.find(
          (user) =>
            user.email === credentials?.email &&
            user.password === credentials?.password
        );
        if (user) {
          return user;
        }

        // If you return null then an error will be displayed advising the user to check their details.
        return null;
      },
    }),
  ],
};

/**
 * Wrapper for `getServerSession` so that you don't need to import the `authOptions` in every file.
 *
 * @see https://next-auth.js.org/configuration/nextjs
 */
export const getServerAuthSession = (ctx: {
  req: GetServerSidePropsContext["req"];
  res: GetServerSidePropsContext["res"];
}) => {
  return getServerSession(ctx.req, ctx.res, authOptions);
};
