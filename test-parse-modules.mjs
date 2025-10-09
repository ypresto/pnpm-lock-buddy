import { loadModulesYaml } from './dist/core/modules-yaml.js';
import { parsePackageString } from './dist/core/parser.js';
import path from 'path';

const modulesYamlPath = path.join(process.env.HOME, 'repo/github.com-private/LayerXcom/layerone-webapps-3/node_modules/.modules.yaml');

console.log('Loading and parsing...');
const modulesYaml = loadModulesYaml(modulesYamlPath);

let count = 0;
let errorCount = 0;

for (const packageSpec of Object.keys(modulesYaml.hoistedDependencies || {})) {
  try {
    const parsed = parsePackageString(packageSpec);
    count++;
    if (count % 500 === 0) {
      console.log('Parsed ' + count + ' packages...');
    }
  } catch (error) {
    errorCount++;
    if (errorCount < 5) {
      console.log('Failed to parse: ' + packageSpec);
    }
  }
}

console.log('Total parsed: ' + count);
console.log('Total errors: ' + errorCount);
