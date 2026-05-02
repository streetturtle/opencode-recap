# Publishing Checklist

## One-time setup

```sh
npm login
```

## Release steps

```sh
npm install
npm run build
npm pack --dry-run
npm version patch
npm publish
```

## Quick verification

```sh
opencode plugin opencode-recap
```

Then restart OpenCode and verify the **Recap** button appears in the sidebar.
