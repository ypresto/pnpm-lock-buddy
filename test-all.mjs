import path from 'path';
import { loadLockfile } from './dist/core/lockfile.js';
import { DuplicatesUsecase } from './dist/usecases/duplicates.usecase.js';

const lockfilePath = path.join(process.env.HOME, 'repo/github.com-private/LayerXcom/layerone-webapps-3/pnpm-lock.yaml');

async function test() {
  const lockfile = loadLockfile(lockfilePath);
  const usecase = new DuplicatesUsecase(lockfilePath, lockfile, 10);

  console.log('=== Per-project duplicates for react (no project filter) ===');
  const perProjectDups = await usecase.findPerProjectDuplicates({
    showAll: false,
    packageFilter: ['react'],
  });
  console.log('Found ' + perProjectDups.length + ' per-project duplicates');
  for (const ppDup of perProjectDups) {
    console.log('\nImporter: ' + ppDup.importerPath);
    console.log('Duplicate packages: ' + ppDup.duplicatePackages.length);
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
