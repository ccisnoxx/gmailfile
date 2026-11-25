import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../docs/openapi.json',
  output: 'src/api/generated',
  plugins: [
    '@hey-api/typescript',
    '@hey-api/sdk',
    {
      name: '@hey-api/client-fetch',
      runtimeConfigPath: './src/api/client.ts',
    },
  ],
});
