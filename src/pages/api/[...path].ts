/* eslint-disable import/no-anonymous-default-export */
import type { IncomingMessage, ServerResponse } from "http";
import type { NextApiRequest } from "next";
import httpProxy from "http-proxy";
import { getToken } from "next-auth/jwt";

// Make sure that we don't parse JSON bodies on this route:
export const config = {
  api: {
    bodyParser: false,
  },
};

const API_SERVER_URL = process.env.API_SERVER_URL;

const proxy = httpProxy.createProxyServer();

export default async (
  req: NextApiRequest,
  res: ServerResponse<IncomingMessage>
) => {
  const token = await getToken({ req });

  // set authorization header if we have a token
  const headers = token
    ? { authorization: `bearer ${token.accessToken}` }
    : undefined;

  // don't forward cookies
  req.headers.cookie = "";

  // proxy all requests to the API
  return new Promise<void>((resolve, reject) => {
    proxy
      .on("proxyReq", (req) => {
        //   log request
        console.log(
          `proxy: ${req.path} -> ${req.protocol}//${req.host}/${req.path}`
        );
        //   console.log("origin", req.getHeaders());
      })
      .web(
        req,
        res,
        {
          target: API_SERVER_URL,
          changeOrigin: true,
          headers,
        },
        (err) => {
          if (err) {
            return reject(err);
          }
          resolve();
        }
      );
  });
};
