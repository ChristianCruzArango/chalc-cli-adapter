// lib/init-testkit.mjs — el kit de pruebas que `chalc init react` deja en el proyecto (spec 025, R12).
// create-vite no trae runner de pruebas, y sin él el flujo Test-First y el portón no arrancan el primer día.
//
// Versiones EXACTAS, como los scaffolders (`npm install` ejecuta código de terceros): con al menos dos
// semanas publicadas y que aceptan el mismo Node que create-vite (^20.19.0 || >=22.12.0). Por eso
// jest-dom 6.9 y jsdom 28: las siguientes ya exigen Node 22. Subirlas es un cambio explícito.
// Excepción a las dos semanas: vitest 4.1.12 (2026-10-15) corrige GHSA-qxg6-89mg-rqv8 y GHSA-xp26-3454-mjgp,
// y es la única 4.x parcheada (la 5.x exige Node 22).
export const REACT_TEST_PACKAGES = [
  'vitest@4.1.12',
  '@testing-library/react@16.3.3',
  '@testing-library/dom@10.4.2',
  '@testing-library/jest-dom@6.9.1',
  'jsdom@28.1.0'
];

export const REACT_TEST_SCRIPT = 'vitest run';

// Lo escribe chalc (no se descarga). La config de Vitest EXTIENDE la de Vite (`mergeConfig`): una config
// paralela perdería el plugin de React y los tests no compilarían igual que la app.
export const REACT_TEST_FILES = {
  'vitest.config.ts': `import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
}))
`,
  'src/test/setup.ts': `import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
`,
  'src/App.test.tsx': `import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders the welcome heading', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
})
`
};
