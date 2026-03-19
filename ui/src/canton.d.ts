interface CantonExtension {
  request: (params: { method: string; params?: unknown }) => Promise<any>;
  requestAccounts: () => Promise<{ party: string; displayName?: string }[]>;
  getBalances: (party: string) => Promise<{ instrument: { id: string; admin: string }; amount: number }[]>;
  submitTransaction: (params: { commands: unknown[]; actAs: string[]; readAs?: string[] }) => Promise<unknown>;
}

interface Window {
  canton?: CantonExtension;
}
