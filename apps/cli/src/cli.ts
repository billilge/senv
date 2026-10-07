import { Command } from 'commander';

// 명령 연결은 마지막 CLI 기능에서 한다. 지금은 빌드 진입점만 둔다
const program = new Command('senv').description('Stream Env Control CLI').version('0.1.0');

await program.parseAsync(process.argv);
