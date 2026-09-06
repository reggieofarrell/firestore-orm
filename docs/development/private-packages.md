# Private Casadega package access

## Why authentication is required

FlintFire consumes `@casadega-development/ts-repo-tooling` as a private development dependency. It
centralizes SonarQube commands, generated-profile validation, reusable ESLint composition,
formatting defaults, and shared RuleSync policy. The published `flintfire` package does not include
or require this private package at runtime.

The committed `.npmrc` maps the Casadega scope to GitHub Packages and refers to `NODE_AUTH_TOKEN`;
it contains no credential. Local credentials belong in a developer-controlled store, while CI
credentials belong in GitHub Actions secrets.

## Token requirements

Use a classic GitHub personal access token with `read:packages`. The GitHub identity that owns the
token must have access to the private package. If Casadega Development enforces SAML single sign-on,
authorize the token for that organization.

Never commit a package token, put it in an environment file, pass it as a command-line argument, or
print it in a build log. Do not reuse Firebase, npm-publishing, SonarQube, or provider credentials.

## User-level npm configuration

The simplest setup stores the host-scoped GitHub token in `~/.npmrc`. Authenticate interactively so
the token does not enter shell history:

```bash
npm login \
  --scope=@casadega-development \
  --auth-type=legacy \
  --registry=https://npm.pkg.github.com
chmod 600 ~/.npmrc
```

Use the GitHub username as the username and the classic token as the password. Ordinary npm
dependency installation then reads the user-level credential:

```bash
npm install
```

RuleSync's npm-source transport intentionally requires an explicit environment value. Read the same
token interactively for the one command and remove it immediately afterward:

```bash
read -rs NODE_AUTH_TOKEN
export NODE_AUTH_TOKEN
printf '\n'
npm run rules:sync
unset NODE_AUTH_TOKEN
```

## macOS Keychain wrapper

The preferred macOS option stores the token in the login Keychain and injects it only into npm child
processes. Add or update the item; the final value-less `-w` prompts securely:

```bash
security add-generic-password \
  -U \
  -a "YOUR_GITHUB_USERNAME" \
  -s "casadega-github-packages" \
  -l "Casadega GitHub Packages read token" \
  -w
```

Add this convenience function to `~/.zshrc`, not `.zshenv`:

```bash
casadega-npm() {
  local package_token

  package_token="$(
    security find-generic-password \
      -s "casadega-github-packages" \
      -w
  )" || return 1

  NODE_AUTH_TOKEN="${package_token}" npm "$@"
}
```

Use the wrapper for dependency and shared-policy operations:

```bash
casadega-npm install
casadega-npm run rules:install
casadega-npm run rules:sync
```

The function-local value disappears after npm exits and is not inherited by unrelated applications.

## GitHub Actions

This personal repository is outside `Casadega-Development`, so define a repository Actions secret
named `CASADEGA_PACKAGES_TOKEN`. Store a read-only classic token whose GitHub identity can access
the package. Workflows map that purpose-specific secret to npm's conventional `NODE_AUTH_TOKEN` only
on dependency-installation, RuleSync restoration, and shared reusable-workflow boundaries.

The private development dependency means untrusted fork CI cannot install the complete toolchain;
supporting external contributors is intentionally not a design requirement for this repository.

## Updating shared tooling

Adopt shared releases explicitly. Keep these identities synchronized in one reviewed change:

1. the exact `devDependency` and `package-lock.json` version;
2. the exact `ref` in `rulesync.jsonc`;
3. `rulesync-npm.lock.json` and generated agent configuration.

Run `npm run rules:sync` with package credentials after updating the version, then run the complete
release verification gate. Do not edit `.rulesync/**/.curated/` or generated agent files.
