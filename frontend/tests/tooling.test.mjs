import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ESLint } from 'eslint'

test('lint sigue aplicando las reglas de TypeScript a rutas TS y TSX anidadas', async () => {
  const eslint = new ESLint()
  for (const filePath of ['src/features/example.ts', 'src/pages/Example/Example.tsx']) {
    const [result] = await eslint.lintText(
      'export const value = 1; const unused = 2;',
      { filePath },
    )
    assert.ok(result.messages.some((item) => item.ruleId === '@typescript-eslint/no-unused-vars'))
  }
})

test('lint conserva la exclusion de los archivos generados en dist', async () => {
  const eslint = new ESLint()
  assert.equal(await eslint.calculateConfigForFile('dist/assets/generated.tsx'), undefined)
})
