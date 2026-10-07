import { createRealContext } from './create-context.js';
import { main } from './program.js';

process.exitCode = await main(process.argv, {
  createContext: createRealContext,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  debug: process.env.SENV_DEBUG === '1',
});
