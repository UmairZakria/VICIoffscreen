const fs = require('fs');
const path = require('path');

const portalDir = path.resolve(__dirname, '..', '..', 'dnc-portal');

// 1. Write src/middleware.js
const middlewarePath = path.join(portalDir, 'src', 'middleware.js');
const middlewareContent = `import { NextResponse } from 'next/server';

export function middleware(request) {
  if (request.nextUrl.pathname.startsWith('/api')) {
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const response = NextResponse.next();
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
`;

fs.writeFileSync(middlewarePath, middlewareContent.trim() + '\n', 'utf8');
console.log('Created middleware:', middlewarePath);

// 2. Also write middleware at root if nextjs expects it there
const rootMiddlewarePath = path.join(portalDir, 'middleware.js');
fs.writeFileSync(rootMiddlewarePath, middlewareContent.trim() + '\n', 'utf8');
console.log('Created root middleware:', rootMiddlewarePath);

// 3. Update next.config.mjs
const nextConfigPath = path.join(portalDir, 'next.config.mjs');
const nextConfigContent = `/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS, PATCH' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization, X-Requested-With, Accept' },
        ],
      },
    ];
  },
};

export default nextConfig;
`;
fs.writeFileSync(nextConfigPath, nextConfigContent.trim() + '\n', 'utf8');
console.log('Updated next.config.mjs:', nextConfigPath);

// 4. Update src/app/api/auth/login/route.js to include OPTIONS export and CORS headers on JSON response
const loginRoutePath = path.join(portalDir, 'src', 'app', 'api', 'auth', 'login', 'route.js');
let loginRouteContent = fs.readFileSync(loginRoutePath, 'utf8');

const corsHeadersStr = `
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}
`;

if (!loginRouteContent.includes('OPTIONS()')) {
  loginRouteContent = corsHeadersStr + '\n' + loginRouteContent;
  fs.writeFileSync(loginRoutePath, loginRouteContent, 'utf8');
  console.log('Added OPTIONS to login route');
}

// 5. Update src/app/api/auth/me/route.js
const meRoutePath = path.join(portalDir, 'src', 'app', 'api', 'auth', 'me', 'route.js');
if (fs.existsSync(meRoutePath)) {
  let meRouteContent = fs.readFileSync(meRoutePath, 'utf8');
  if (!meRouteContent.includes('OPTIONS()')) {
    meRouteContent = corsHeadersStr + '\n' + meRouteContent;
    fs.writeFileSync(meRoutePath, meRouteContent, 'utf8');
    console.log('Added OPTIONS to me route');
  }
}

// 6. Update src/app/api/lookup/consume/route.js
const consumeRoutePath = path.join(portalDir, 'src', 'app', 'api', 'lookup', 'consume', 'route.js');
if (fs.existsSync(consumeRoutePath)) {
  let consumeRouteContent = fs.readFileSync(consumeRoutePath, 'utf8');
  if (!consumeRouteContent.includes('OPTIONS()')) {
    consumeRouteContent = corsHeadersStr + '\n' + consumeRouteContent;
    fs.writeFileSync(consumeRoutePath, consumeRouteContent, 'utf8');
    console.log('Added OPTIONS to consume route');
  }
}

console.log('All CORS updates applied successfully.');
