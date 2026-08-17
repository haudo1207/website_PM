import { PublicClientApplication } from '@azure/msal-browser';
import { getAuthConfig } from '@/lib/api';

let msalPromise: Promise<PublicClientApplication> | null = null;

function getMsalInstance(): Promise<PublicClientApplication> {
  if (!msalPromise) {
    msalPromise = (async () => {
      const config = await getAuthConfig();
      const app = new PublicClientApplication({
        auth: {
          clientId: config.outlook_client_id,
          authority: `https://login.microsoftonline.com/${config.outlook_tenant_id || 'common'}`,
          redirectUri: window.location.origin,
        },
        cache: { cacheLocation: 'localStorage' },
      });
      await app.initialize();
      return app;
    })();
  }
  return msalPromise;
}

export async function initMsal(): Promise<void> {
  const app = await getMsalInstance();
  try {
    const result = await app.handleRedirectPromise();
    if (result && window.opener && window.opener !== window) {
      window.close();
    }
  } catch {
    // ignore redirect handling errors; the interactive flow reports its own errors
  }
}

export async function microsoftLogin(): Promise<string> {
  const app = await getMsalInstance();
  const result = await app.loginPopup({
    scopes: ['openid', 'profile', 'email'],
    prompt: 'select_account',
  });
  if (!result.idToken) throw new Error('No Microsoft ID token returned');
  return result.idToken;
}