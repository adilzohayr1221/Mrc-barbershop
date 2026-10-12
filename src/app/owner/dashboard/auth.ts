export function authHeaders(): HeadersInit {
  const token = localStorage.getItem('mrc_owner_token') || '';
  return { Authorization: `Bearer ${token}` };
}
