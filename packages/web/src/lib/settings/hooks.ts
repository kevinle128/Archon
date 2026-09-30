import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getConfig, listProviders } from '@/lib/api';
import type { ProviderInfo } from '@/lib/api';
import { getUserAiPrefs, listPiModels, listProviderKeys } from './api';
import { settingsKeys } from './query-keys';
import type { ConfigResponse, PiModelInfo, ProviderKeyList, UserAiPrefs } from './types';

/**
 * Shared read queries for the settings sections. Sections that read the same
 * key share one fetch. Reads that 401 without a web identity disable retries so a
 * solo install does not spam the server.
 */

export function useConfigQuery(): UseQueryResult<ConfigResponse> {
  return useQuery({ queryKey: settingsKeys.config, queryFn: getConfig });
}

export function useProvidersQuery(): UseQueryResult<ProviderInfo[]> {
  return useQuery({
    queryKey: settingsKeys.providers,
    queryFn: listProviders,
    staleTime: 5 * 60 * 1000,
  });
}

/** Per-user prefs; an error (401 without identity) hides the "Just me" scope. */
export function useUserPrefsQuery(): UseQueryResult<UserAiPrefs> {
  return useQuery({ queryKey: settingsKeys.userAiPrefs, queryFn: getUserAiPrefs, retry: false });
}

/** Agent credential matrix; an error means no readiness hints. */
export function useProviderKeysQuery(): UseQueryResult<ProviderKeyList> {
  return useQuery({
    queryKey: settingsKeys.providerConnections,
    queryFn: listProviderKeys,
    retry: false,
  });
}

/** Pi model catalog, best-effort: an error just means no suggestions. */
export function usePiModelsQuery(): UseQueryResult<PiModelInfo[]> {
  return useQuery({
    queryKey: settingsKeys.piModels,
    queryFn: listPiModels,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}
