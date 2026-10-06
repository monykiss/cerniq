'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
  startTransition,
} from 'react';
import {
  apiClient,
  buildLoginRedirectUrl,
  getApiErrorMessage,
  isAuthError,
  isPlatformAccessError,
} from '@/lib/api';
import { ACCESS_REQUIRED_ROUTE } from '@/lib/access';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';

interface Institution {
  id: string;
  name: string;
  type: string;
  totalAssets: number;
  currency?: string;
  reportingDate?: string;
}

interface ALMContextType {
  institutions: Institution[];
  selectedId: string;
  institution: Institution | null;
  loading: boolean;
  authRedirecting: boolean;
  bootstrapError: string | null;
  setSelectedId: (id: string) => void;
  selectInstitution: (id: string) => void;
  refresh: () => Promise<void>;
}

const ALMContext = createContext<ALMContextType>({
  institutions: [],
  selectedId: '',
  institution: null,
  loading: true,
  authRedirecting: false,
  bootstrapError: null,
  setSelectedId: () => {},
  selectInstitution: () => {},
  refresh: async () => {},
});

export function useALM() {
  return useContext(ALMContext);
}

export default function ALMProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const urlId = searchParams.get('id') || '';

  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [selectedId, setSelectedIdState] = useState(urlId);
  const [loading, setLoading] = useState(true);
  const [authRedirecting, setAuthRedirecting] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const redirectToLogin = useCallback(() => {
    router.replace(
      buildLoginRedirectUrl(
        pathname,
        searchParamsString ? `?${searchParamsString}` : '',
      ),
    );
  }, [pathname, router, searchParamsString]);

  const setSelectedId = useCallback(
    (id: string) => {
      setSelectedIdState(id);
      const params = new URLSearchParams(searchParamsString);
      if (id) {
        params.set('id', id);
      } else {
        params.delete('id');
      }
      const nextQuery = params.toString();
      startTransition(() => {
        router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
      });
    },
    [pathname, router, searchParamsString],
  );

  const fetchInstitutions = useCallback(async () => {
    setLoading(true);
    setAuthRedirecting(false);
    setBootstrapError(null);

    try {
      const data = await apiClient.getInstitutions();
      setInstitutions(data);
      if (data.length > 0) {
        const match = data.find((d: Institution) => d.id === urlId);
        if (match) {
          setSelectedIdState(match.id);
        } else if (!urlId) {
          setSelectedIdState((currentSelectedId) => {
            if (currentSelectedId) {
              return currentSelectedId;
            }
            return data[0].id;
          });
        }
      }
    } catch (error: unknown) {
      setInstitutions([]);
      setSelectedIdState('');

      if (isAuthError(error)) {
        setAuthRedirecting(true);
        redirectToLogin();
        return;
      }

      if (isPlatformAccessError(error)) {
        router.replace(ACCESS_REQUIRED_ROUTE);
        return;
      }

      setBootstrapError(
        getApiErrorMessage(
          error,
          'ALM data is unavailable right now. Please retry once the backend is responding.',
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [redirectToLogin, router, urlId]);

  useEffect(() => {
    fetchInstitutions();
  }, [fetchInstitutions]);

  useEffect(() => {
    if (!selectedId || selectedId === urlId) {
      return;
    }

    const params = new URLSearchParams(searchParamsString);
    params.set('id', selectedId);

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  }, [pathname, router, searchParamsString, selectedId, urlId]);

  const institution = institutions.find((i) => i.id === selectedId) || null;

  return (
    <ALMContext.Provider
      value={{
        institutions,
        selectedId,
        institution,
        loading,
        authRedirecting,
        bootstrapError,
        setSelectedId,
        selectInstitution: setSelectedId,
        refresh: fetchInstitutions,
      }}
    >
      {children}
    </ALMContext.Provider>
  );
}
