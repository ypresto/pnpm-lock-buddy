import { loadModulesYaml } from './dist/core/modules-yaml.js';
import path from 'path';

const modulesYamlPath = path.join(process.env.HOME, 'repo/github.com-private/LayerXcom/layerone-webapps-3/node_modules/.modules.yaml');

console.log('Loading modules.yaml...');
try {
  const modulesYaml = loadModulesYaml(modulesYamlPath);
  console.log('Loaded successfully');
  console.log('Hoisted packages count:', Object.keys(modulesYaml.hoistedDependencies || {}).length);
} catch (error) {
  console.error('Error:', error.message);
}
