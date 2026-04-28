/**
 * test-setup.ts — Extends vitest's expect with @testing-library/jest-dom
 * matchers (toBeInTheDocument, etc.).
 *
 * Imported conditionally from App.tsx via `import.meta.vitest` guard so it
 * only runs in the vitest test environment, never in production.
 */
import '@testing-library/jest-dom/vitest';
