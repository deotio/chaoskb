# Contributing to ChaosKB

Thanks for your interest in contributing to ChaosKB!

## Getting started

1. Clone the repository:
   ```bash
   git clone https://github.com/de-otio/chaoskb.git
   cd chaoskb
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build all packages:
   ```bash
   npm run build
   ```

4. Run tests:
   ```bash
   npm test
   ```

## Code style

This project uses ESLint and Prettier to enforce consistent code style.

- Run `npm run lint` to check for linting errors.
- Run `npm run format` to auto-format all files.

Please ensure your changes pass both linting and type-checking before submitting a pull request:

```bash
npm run lint
npm run typecheck
```

## Submitting changes

1. Fork the repository and create a feature branch.
2. Make your changes with clear, descriptive commit messages.
3. Ensure all tests pass and linting is clean.
4. Open a pull request against the `main` branch.

## Security vulnerabilities

If you discover a security vulnerability, please do NOT open a public issue. Instead, follow the responsible disclosure process described in [SECURITY.md](SECURITY.md).
