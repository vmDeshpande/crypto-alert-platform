import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

/** @type {import('eslint').Linter.Config[]} */
const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'drizzle/**',
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      /*
       * The dashboard pages are client components that fetch their data in a
       * mount effect. Converting them to server components with client islands
       * is the preferred fix but is tracked separately; until then this rule
       * produces noise on every page rather than surfacing a real defect.
       */
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]

export default config