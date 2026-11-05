import { build } from 'esbuild'
await build({
  entryPoints: ['src/mcp/server.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'out/mcp/server.mjs',
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info'
})
