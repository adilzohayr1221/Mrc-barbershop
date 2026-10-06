'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface CustomerSession {
  /** Auth check finished (token present and verified). */
  checked: boolean;
  token: string;
  name: string;
}

export const CUSTOMER_TOKEN_KEY = 'mrc_customer_token';
export const CUSTOMER_NAME_KEY = 'mrc_customer_name';

export function customerToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(CUSTOMER_TOKEN_KEY) || '';
}

export function clearCustomerSession() {
  localStorage.removeItem(CUSTOMER_TOKEN_KEY);
  localStorage.removeItem(CUSTOMER_NAME_KEY);
}

/**
 * Guard for customer pages: redirects to /customer/login when there is no
 * valid customer session. Returns { checked, token, name } — render a
 * skeleton until `checked` is true.
 */
export function useCustomerAuth(): CustomerSession {
  const router = useRouter();
  const [state, setState] = useState<CustomerSession>({ checked: false, token: '', name: '' });

  useEffect(() => {
    const token = customerToken();
    if (!token) {
      router.replace('/customer/login');
      return;
    }
    fetch('/api/auth/customer', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (!r.ok) throw new Error('unauthorized');
        return r.json();
      })
      .then((d) => {
        const name = d.customer?.name || localStorage.getItem(CUSTOMER_NAME_KEY) || '';
        setState({ checked: true, token, name });
      })
      .catch(() => {
        clearCustomerSession();
        router.replace('/customer/login');
      });
  }, [router]);

  return state;
}
