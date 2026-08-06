/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: __dirname,
  images: {
    domains: ['cdn.casdoor.com'],
  },
  env: {
    CASDOOR_ORG_NAME: process.env.CASDOOR_ORG_NAME || 'ds4-org',
    CASDOOR_APP_NAME: process.env.CASDOOR_APP_NAME || 'ds4-platform',
    CASDOOR_CLIENT_ID: process.env.CASDOOR_CLIENT_ID || '',
    CASDOOR_CLIENT_SECRET: process.env.CASDOOR_CLIENT_SECRET || '',
    CASDOOR_REDIRECT_URI: process.env.CASDOOR_REDIRECT_URI || 'http://localhost:3000/callback',
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL || '',
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN || '',
    DAXPAY_API_URL: process.env.DAXPAY_API_URL || 'http://localhost:8080',
    DAXPAY_APP_ID: process.env.DAXPAY_APP_ID || '',
    DAXPAY_SECRET_KEY: process.env.DAXPAY_SECRET_KEY || '',
  },
}

module.exports = nextConfig
