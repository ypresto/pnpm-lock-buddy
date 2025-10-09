import path from 'path';
import { loadLockfile } from './dist/core/lockfile.js';
import { DuplicatesUsecase } from './dist/usecases/duplicates.usecase.js';

const lockfilePath = path.join(process.env.HOME, 'repo/github.com-private/LayerXcom/layerone-webapps-3/pnpm-lock.yaml');

async function test() {
  const lockfile = loadLockfile(lockfilePath);
  const usecase = new DuplicatesUsecase(lockfilePath, lockfile, 10);

  console.log('=== Checking react-simple-animate ===');
  const globalDups = await usecase.findDuplicates({
    showAll: true,
    packageFilter: ['react-simple-animate'],
  });
  console.log('Found ' + globalDups.length + ' packages');
  for (const dup of globalDups) {
    console.log('\nPackage: ' + dup.packageName);
    console.log('Instances: ' + dup.instances.length);
    for (const inst of dup.instances) {
      console.log('  - ' + inst.id);
      console.log('    Projects: ' + inst.projects.join(', '));
    }
  }

  console.log('\n\n=== Checking if @hookform/devtools pulls in react@19 for docissue-webapp ===');
  const devtoolsDeps = await usecase.findDuplicates({
    showAll: true,
    packageFilter: ['@hookform/devtools'],
    projectFilter: ['apps/docissue-webapp'],
  });
  for (const dup of devtoolsDeps) {
    console.log('\nPackage: ' + dup.packageName);
    for (const inst of dup.instances) {
      console.log('  Instance: ' + inst.id);
      if (inst.dependencyInfo) {
        console.log('  Dependency path:');
        for (const step of inst.dependencyInfo.path) {
          console.log('    ' + step.package);
        }
      }
    }
  }
}

test().catch(console.error);
