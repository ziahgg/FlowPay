// Dev-server proxy: the backend does not enable CORS, so /api requests from `ng serve` must be
// proxied rather than called cross-origin. BACKEND_URL lets docker-compose point this at the
// `backend` service name while local (non-Docker) dev defaults to localhost.
const target = process.env['BACKEND_URL'] || 'http://localhost:3000';

module.exports = [
  {
    context: ['/api'],
    target,
    changeOrigin: true,
    logLevel: 'warn',
  },
];
