'use client';

import { useEffect } from 'react';
import { useQueryClient, QueryClient, Query } from '@tanstack/react-query';
import {
  getCustomerProjectVersion,
  getMeetingsVersion,
  DATA_CHANGED_EVENT,
  SyncDomain,
} from './api';

// Per domain: the backend change stamp, and every React Query cache (by first
// key segment) that lists that domain's data. Invalidating only refetches the
// queries currently on screen; the rest are just marked stale.
const DOMAINS: Record<SyncDomain, { fetchVersion: () => Promise<{ version: string }>; keys: Set<string> }> = {
  'customer-project': {
    fetchVersion: getCustomerProjectVersion,
    keys: new Set([
      'customers',
      'customers-by-workspace',
      'project-form-modal-data',
      'workspace-base-data',
      'workspace-projects',
      'project-list',
      'kpi-all-projects',
      'qc-projects',
      'settings-system-categories',
    ]),
  },
  meeting: {
    fetchVersion: getMeetingsVersion,
    keys: new Set(['meetings', 'meeting-insights', 'meeting-attendance-summary']),
  },
};

const POLL_INTERVAL_MS = 10_000;
const CHANNEL_NAME = 'data-sync';

const belongsTo = (domain: SyncDomain) => (q: Query) => DOMAINS[domain].keys.has(String(q.queryKey[0]));

function invalidateDomain(queryClient: QueryClient, domain: SyncDomain) {
  queryClient.invalidateQueries({ predicate: belongsTo(domain) });
}

/** Keeps Customer/Project and Meeting lists fresh without a page reload:
 *  - this tab's own writes → refresh immediately (event from the api.ts interceptor);
 *  - other tabs of the same browser → refresh immediately (BroadcastChannel);
 *  - other users / the meeting bot → refresh within POLL_INTERVAL_MS (version
 *    stamp poll). A domain is only polled while one of its lists is on screen
 *    and the tab is visible, so idle pages cost nothing.
 */
export function useDataSync(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const domains = Object.keys(DOMAINS) as SyncDomain[];
    const lastVersion: Partial<Record<SyncDomain, string | null>> = {};
    let stopped = false;
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      // BroadcastChannel unsupported — polling still covers other tabs.
    }

    // Re-read the stamp so our own (or a sibling tab's) change isn't picked
    // up a second time by the next poll.
    const syncVersion = async (domain: SyncDomain) => {
      try {
        lastVersion[domain] = (await DOMAINS[domain].fetchVersion()).version;
      } catch {
        // Ignore — the next poll retries.
      }
    };

    const poll = async () => {
      if (stopped || document.visibilityState !== 'visible') return;
      for (const domain of domains) {
        const onScreen = queryClient.getQueryCache().findAll({ predicate: belongsTo(domain), type: 'active' }).length > 0;
        if (!onScreen) {
          // Lists refetch on mount anyway, so start a fresh baseline next time.
          lastVersion[domain] = null;
          continue;
        }
        try {
          const { version } = await DOMAINS[domain].fetchVersion();
          const prev = lastVersion[domain];
          if (prev != null && version !== prev) invalidateDomain(queryClient, domain);
          lastVersion[domain] = version;
        } catch {
          // Network/auth hiccup — keep the old stamp and try again later.
        }
      }
    };

    const onLocalChange = (e: Event) => {
      const domain = (e as CustomEvent<SyncDomain>).detail;
      if (!DOMAINS[domain]) return;
      invalidateDomain(queryClient, domain);
      channel?.postMessage(domain);
      syncVersion(domain);
    };
    const onRemoteTabChange = (e: MessageEvent<SyncDomain>) => {
      if (!DOMAINS[e.data]) return;
      invalidateDomain(queryClient, e.data);
      syncVersion(e.data);
    };

    window.addEventListener(DATA_CHANGED_EVENT, onLocalChange);
    if (channel) channel.onmessage = onRemoteTabChange;
    document.addEventListener('visibilitychange', poll);
    const timer = window.setInterval(poll, POLL_INTERVAL_MS);
    poll();

    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener(DATA_CHANGED_EVENT, onLocalChange);
      document.removeEventListener('visibilitychange', poll);
      channel?.close();
    };
  }, [queryClient, enabled]);
}
