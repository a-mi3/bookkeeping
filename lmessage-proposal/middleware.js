// Basic認証 + noindex を全リクエストに適用する Vercel Routing Middleware
import { next } from '@vercel/edge';

export const config = {
  // 静的ファイルを含むすべてのパスに適用
  matcher: '/:path*',
};

const USER = process.env.BASIC_AUTH_USER || 'missiona';
const PASS = process.env.BASIC_AUTH_PASS || 'kadai';
const ROBOTS = 'noindex, nofollow, noarchive, nosnippet';

function authorized(request) {
  const header = request.headers.get('authorization') || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) return false;
  let decoded = '';
  try {
    // UTF-8として復号（atobはLatin1なので変換する）
    const bin = atob(encoded);
    decoded = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return false;
  }
  const i = decoded.indexOf(':');
  if (i < 0) return false;
  return decoded.slice(0, i) === USER && decoded.slice(i + 1) === PASS;
}

export default function middleware(request) {
  if (!authorized(request)) {
    return new Response('Authentication required', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="L Message Proposal", charset="UTF-8"',
        'X-Robots-Tag': ROBOTS,
        'Cache-Control': 'no-store',
      },
    });
  }
  return next({ headers: { 'X-Robots-Tag': ROBOTS } });
}
