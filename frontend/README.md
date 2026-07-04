# FlowPay Frontend

The Angular "Client Console" for FlowPay — a standalone-components SPA (Angular 22, Angular
Material, signals for local state) that talks to the backend over `/api/v1`.

See the [repository root README](../README.md#frontend-development-without-docker) for the
quickstart, the [Client Console section](../README.md#client-console-frontend) for a walkthrough
and known simplifications, and [CLAUDE.md](../CLAUDE.md) for architecture and conventions.

```bash
npm install
npm start   # ng serve, proxying /api to the backend (see proxy.conf.js)
```

| Command        | Description                                       |
| -------------- | -------------------------------------------------- |
| `npm start`    | `ng serve` with the API proxy                      |
| `npm run lint` | ESLint                                              |
| `npm test`     | Unit tests (Vitest)                                 |
| `npm run build`| Production build to `dist/frontend`                 |
