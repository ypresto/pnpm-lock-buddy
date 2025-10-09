import path from 'path';
import { loadLockfile } from './dist/core/lockfile.js';
import { DuplicatesUsecase } from './dist/usecases/duplicates.usecase.js';

const lockfilePath = path.join(process.env.HOME, 'repo/github.com-private/LayerXcom/layerone-webapps-3/pnpm-lock.yaml');

async function test() {
  const lockfile = loadLockfile(lockfilePath);
  const usecase = new DuplicatesUsecase(lockfilePath, lockfile, 10);

  console.log('Testing with --hoist option...');
  try {
    const dups = await usecase.findDuplicates({
      showAll: false,
      checkHoist: true,
    });
    console.log('Found ' + dups.length + ' duplicates');
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }
}

test();
