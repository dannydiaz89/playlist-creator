'use client';
import { createContext, useContext, useState, useCallback } from 'react';

const AnnounceContext = createContext<(msg: string) => void>(() => {});
export const useAnnounce = () => useContext(AnnounceContext);

/** Single polite live region. Async results and validation errors go through it. */
export function AnnounceProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState('');
  const announce = useCallback((msg: string) => {
    setMessage('');
    setTimeout(() => setMessage(msg), 60);
  }, []);
  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div aria-live="polite" aria-atomic="true" className="sr-only">{message}</div>
    </AnnounceContext.Provider>
  );
}
