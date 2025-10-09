import path from 'path';
import { loadLockfile } from './dist/core/lockfile.js';
import { DuplicatesUsecase } from './dist/usecases/duplicates.usecase.js';

const lockfilePath = path.join(process.env.HOME, 'repo/github.com-private/LayerXcom/layerone-webapps-3/pnpm-lock.yaml');

async function test() {
  const lockfile = loadLockfile(lockfilePath);
  const usecase = new DuplicatesUsecase(lockfilePath, lockfile, 10);

  console.log('=== Detailed check: What happens during filtering ===');
  const globalDups = await usecase.findDuplicates({
    showAll: true,  // Show all to see both instances
    packageFilter: ['react'],
    projectFilter: ['apps/docissue-webapp'],
  });

  for (const dup of globalDups) {
    console.log('\nPackage: ' + dup.packageName);
    console.log('Total instances after filtering: ' + dup.instances.length);
    for (const inst of dup.instances) {
      console.log('\n  Instance ID: ' + inst.id);
      console.log('  Projects count: ' + inst.projects.length);
      console.log('  Projects: ' + (inst.projects.length > 0 ? inst.projects.join(', ') : '(empty)'));
    }
  }
}

test().catch(console.error);
