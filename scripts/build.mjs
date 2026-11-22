import {build} from 'esbuild';
import {build as viteBuild} from 'vite';
await build({entryPoints:['services/api/src/index.ts'],outfile:'dist/server.mjs',bundle:true,platform:'node',target:'node22',format:'esm',packages:'external',sourcemap:true});
await viteBuild();
