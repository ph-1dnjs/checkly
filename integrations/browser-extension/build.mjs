import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const name of ['background','content','hook','popup']) await build({entryPoints:[`src/${name}.js`],outfile:`dist/${name}.js`,bundle:true,format:name==='background'?'esm':'iife',target:'chrome120'});
await build({entryPoints:['src/capture.tsx'],outfile:'dist/capture.js',bundle:true,jsx:'automatic',format:'iife',target:'chrome120',loader:{'.woff2':'file','.woff':'file'}});
for(const file of ['capture.html','popup.html','style.css','manifest.json','icon.png']) await copyFile(file,`dist/${file}`);
