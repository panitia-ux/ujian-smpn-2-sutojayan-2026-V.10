import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Guard JSON.stringify against circular structures (e.g., Firestore WebChannel Y2/Ka objects or DOM events)
const origJsonStringify = JSON.stringify;
if (!(JSON.stringify as any).__circularSafe) {
  const safeStringify = function (this: any, value: any, replacer?: any, space?: any): string {
    try {
      return origJsonStringify.call(JSON, value, replacer, space);
    } catch (err) {
      if (err instanceof TypeError) {
        const seen = new WeakSet();
        return origJsonStringify.call(
          JSON,
          value,
          function (this: any, key: string, val: any) {
            if (typeof val === 'object' && val !== null) {
              if (seen.has(val)) return '[Circular]';
              seen.add(val);
            }
            return typeof replacer === 'function' ? replacer.call(this, key, val) : val;
          },
          space
        );
      }
      throw err;
    }
  };
  (safeStringify as any).__circularSafe = true;
  JSON.stringify = safeStringify as typeof JSON.stringify;
}

// Intercept benign @firebase/firestore internal state assertions & Quota Exceeded errors so they don't break app flow
if (typeof window !== 'undefined') {
  const isIgnorableFirestoreError = (raw: unknown): boolean => {
    const text = String(
      (raw as any)?.message ||
      (raw as any)?.reason?.message ||
      (raw as any)?.reason ||
      (raw as any)?.error?.message ||
      (raw as any)?.error ||
      raw ||
      ''
    ).toLowerCase();

    return (
      text.includes('internal assertion failed') ||
      text.includes('unexpected state') ||
      text.includes('quota') ||
      text.includes('resource-exhausted') ||
      text.includes('resource_exhausted') ||
      text.includes('free daily read units') ||
      text.includes('free tier database') ||
      text.includes('firestore_quota_exhausted')
    );
  };

  window.addEventListener(
    'error',
    (event) => {
      if (isIgnorableFirestoreError(event.error || event.message)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
          sessionStorage.setItem('smpn2_firestore_quota_exhausted_until', String(Date.now() + 60 * 60 * 1000));
        } catch (e) {}
      }
    },
    true
  );
  window.addEventListener(
    'unhandledrejection',
    (event) => {
      if (isIgnorableFirestoreError(event.reason)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
          sessionStorage.setItem('smpn2_firestore_quota_exhausted_until', String(Date.now() + 60 * 60 * 1000));
        } catch (e) {}
      }
    },
    true
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
