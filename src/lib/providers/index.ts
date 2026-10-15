import { spotifyProvider } from './spotify';
import { youtubeProvider } from './youtube';
import type { MusicProvider, ProviderName } from './types';

/** Neither is primary. The teacher picks and may switch. */
export const PROVIDERS: Record<ProviderName, MusicProvider> = {
  spotify: spotifyProvider,
  youtube: youtubeProvider,
};

export function getProvider(name: ProviderName): MusicProvider {
  const p = PROVIDERS[name];
  if (!p) throw new Error(`Unknown provider: ${name}`);
  return p;
}

export * from './types';
