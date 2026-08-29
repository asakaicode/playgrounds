import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['public/src/waiting-room.ts', 'public/src/admin.ts'],
  bundle: true,
  outdir: 'public/dist',
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('esbuild watching for changes...');
} else {
  await esbuild.build(options);
}
