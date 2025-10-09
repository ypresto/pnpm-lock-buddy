import { loadModulesYaml, detectHoistConflicts } from './dist/core/modules-yaml.js';
import path from 'path';

const modulesYamlPath = path.join(process.env.HOME, 'repo/github.com-private/LayerXcom/layerone-webapps-3/node_modules/.modules.yaml');

const modulesYaml = loadModulesYaml(modulesYamlPath);

console.log('Total hoisted packages:', Object.keys(modulesYaml.hoistedDependencies || {}).length);

// Test without filter
const allConflicts = detectHoistConflicts(modulesYaml);
console.log('\nAll conflicts:', allConflicts.length);
for (const conflict of allConflicts.slice(0, 5)) {
  console.log(`  ${conflict.packageName}: ${conflict.versions.length} versions`);
}

// Test with @types filter
const typesConflicts = detectHoistConflicts(modulesYaml, ['@types/*']);
console.log('\n@types/* conflicts:', typesConflicts.length);
for (const conflict of typesConflicts.slice(0, 10)) {
  console.log(`  ${conflict.packageName}: ${conflict.versions.map(v => v.version).join(', ')}`);
}

// Test specific package
const reactConflicts = detectHoistConflicts(modulesYaml, ['react']);
console.log('\nreact conflicts:', reactConflicts.length);
for (const conflict of reactConflicts) {
  console.log(`  ${conflict.packageName}: ${conflict.versions.map(v => v.version).join(', ')}`);
}
