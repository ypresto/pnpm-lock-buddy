import path from 'path';
import { loadLockfile } from './dist/core/lockfile.js';
import { DuplicatesUsecase } from './dist/usecases/duplicates.usecase.js';

const lockfilePath = path.join(process.env.HOME, 'repo/github.com-private/LayerXcom/layerone-webapps-3/pnpm-lock.yaml');

async function test() {
  const lockfile = loadLockfile(lockfilePath);
  const usecase = new DuplicatesUsecase(lockfilePath, lockfile, 10);

  console.log('=== Checking which react versions are ACTUALLY used by docissue-webapp ===');
  const globalDups = await usecase.findDuplicates({
    showAll: true,
    packageFilter: ['react'],
    projectFilter: ['apps/docissue-webapp'],
  });

  for (const dup of globalDups) {
    console.log('\nPackage: ' + dup.packageName);
    console.log('Instances found: ' + dup.instances.length);
    for (const inst of dup.instances) {
      console.log('\n  Instance: ' + inst.id);
      console.log('  Used by projects: ' + inst.projects.join(', '));
      console.log('  Is this used by docissue-webapp? ' +
        (inst.projects.includes('apps/docissue-webapp') ? 'YES' : 'NO'));
    }
  }

  console.log('\n\n=== Now checking what --per-project shows ===');
  const perProjectDups = await usecase.findPerProjectDuplicates({
    showAll: true,  // Show all, not just duplicates
    packageFilter: ['react'],
    projectFilter: ['apps/docissue-webapp'],
  });

  console.log('Per-project results: ' + perProjectDups.length + ' projects');
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
