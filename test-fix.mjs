import path from 'path';
import { loadLockfile } from './dist/core/lockfile.js';
import { DuplicatesUsecase } from './dist/usecases/duplicates.usecase.js';

const lockfilePath = path.join(process.env.HOME, 'repo/github.com-private/LayerXcom/layerone-webapps-3/pnpm-lock.yaml');

async function test() {
  const lockfile = loadLockfile(lockfilePath);
  const usecase = new DuplicatesUsecase(lockfilePath, lockfile, 10);

  console.log('=== After fix: Global duplicates with --project filter ===');
  const globalDups = await usecase.findDuplicates({
    showAll: false,
    packageFilter: ['react'],
    projectFilter: ['apps/docissue-webapp'],
  });
  console.log('Found ' + globalDups.length + ' packages with duplicates');
  for (const dup of globalDups) {
    console.log('\nPackage: ' + dup.packageName);
    console.log('Instances: ' + dup.instances.length);
    for (const inst of dup.instances) {
      console.log('  - ' + inst.id);
      console.log('    Projects: ' + inst.projects.join(', '));
    }
  }

  console.log('\n\n=== Comparison: --per-project with same filter ===');
  const perProjectDups = await usecase.findPerProjectDuplicates({
    showAll: false,
    packageFilter: ['react'],
    projectFilter: ['apps/docissue-webapp'],
  });
  console.log('Found ' + perProjectDups.length + ' per-project duplicates');
  for (const ppDup of perProjectDups) {
    console.log('\nProject: ' + ppDup.importerPath);
    for (const pkg of ppDup.duplicatePackages) {
      console.log('  Package: ' + pkg.packageName);
      console.log('  Instances: ' + pkg.instances.length);
      for (const inst of pkg.instances) {
        console.log('    - ' + inst.id);
      }
    }
  }
}

test().catch(console.error);
