import path from 'path';
import { loadLockfile } from './dist/core/lockfile.js';
import { DuplicatesUsecase } from './dist/usecases/duplicates.usecase.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const lockfilePath = path.join(process.env.HOME, 'repo/github.com-private/LayerXcom/layerone-webapps-3/pnpm-lock.yaml');

async function test() {
  const lockfile = loadLockfile(lockfilePath);
  const usecase = new DuplicatesUsecase(lockfilePath, lockfile, 10);

  console.log('=== Global duplicates with project filter ===');
  const globalDups = await usecase.findDuplicates({
    showAll: false,
    packageFilter: ['react'],
    projectFilter: ['apps/docissue-webapp'],
  });
  console.log('Found ' + globalDups.length + ' duplicates');
  for (const dup of globalDups) {
    console.log('\nPackage: ' + dup.packageName);
    console.log('Instances: ' + dup.instances.length);
    for (const inst of dup.instances) {
      console.log('  - ' + inst.id);
      console.log('    Projects: ' + inst.projects.slice(0, 3).join(', '));
    }
  }

  console.log('\n\n=== Per-project duplicates with project filter ===');
  const perProjectDups = await usecase.findPerProjectDuplicates({
    showAll: false,
    packageFilter: ['react'],
    projectFilter: ['apps/docissue-webapp'],
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
