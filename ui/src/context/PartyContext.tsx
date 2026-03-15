import { createContext, useContext, useState, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Party context — holds the current Canton party identifier
// ---------------------------------------------------------------------------

interface PartyContextValue {
  party: string;
  setParty: (p: string) => void;
}

const PartyContext = createContext<PartyContextValue>({
  party: 'app-user::1220placeholder',
  setParty: () => {},
});

export function PartyProvider({ children }: { children: ReactNode }) {
  const [party, setParty] = useState('app-user::1220placeholder');

  return (
    <PartyContext.Provider value={{ party, setParty }}>
      {children}
    </PartyContext.Provider>
  );
}

export function useParty(): PartyContextValue {
  return useContext(PartyContext);
}
