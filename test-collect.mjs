import path from 'path';
import { loadLockfile } from './dist/core/lockfile.js';
import { DuplicatesUsecase } from './dist/usecases/duplicates.usecase.js';

const lockfilePath = path.join(process.env.HOME, 'repo/github.com-private/LayerXcom/layerone-webapps-3/pnpm-lock.yaml');

async function test() {
  const lockfile = loadLockfile(lockfilePath);
  const usecase = new DuplicatesUsecase(lockfilePath, lockfile, 10);

  console.log('Testing WITHOUT --hoist...');
  try {
    const dups1 = await usecase.findDuplicates({ showAll: false });
    console.log('Success! Found ' + dups1.length + ' duplicates');
  } catch (error) {
    console.error('Error:', error.message);
  }

  console.log('\nTesting WITH --hoist and --all...');
  try {
    const dups2 = await usecase.findDuplicates({ showAll: true, checkHoist: true });
    console.log('Success! Found ' + dups2.length + ' packages');
  } catch (error) {
    console.error('Error:', error.message);
  }
}

test();
