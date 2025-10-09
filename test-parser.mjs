import { parsePackageString } from './dist/core/parser.js';

const testCases = [
  'react@18.2.0',
  'react@19.1.1',
  'react-simple-animate@3.5.3(react-dom@18.2.0(react@18.2.0))',
  'react-simple-animate@3.5.3(react-dom@19.1.1(react@19.1.1))',
  'react-dom@18.2.0(react@18.2.0)',
];

console.log('Testing parser:');
for (const testCase of testCases) {
  const parsed = parsePackageString(testCase);
  console.log(`\nInput: ${testCase}`);
  console.log(`  Name: ${parsed.name}`);
  console.log(`  Version: ${parsed.version}`);
  console.log(`  Dependencies: ${JSON.stringify(parsed.dependencies)}`);
}
