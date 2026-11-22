import original from '../../vite.config.js';
import path from 'node:path';
export default (env) => {
  const config = original(env);
  return { ...config, configFile: false, root: import.meta.dirname,
    cacheDir: '/tmp/hd-knowledge-layout-vite', logLevel: 'error',
    server: {host:'127.0.0.1',port:0,fs:{allow:[path.resolve(import.meta.dirname,'../../..')]}} };
};
