import { writeFileSync } from 'node:fs';
import { buildOpenApiDocument } from './build-document.js';

// pnpm openapi: 빌드한 뒤 실행되어 apps/server/openapi.json을 다시 쓴다
const document = await buildOpenApiDocument();
const target = new URL('../../openapi.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
console.log(`OpenAPI 문서를 썼습니다: ${target.pathname}`);
