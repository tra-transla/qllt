// Custom client proxy that implements the Supabase client API
// but proxies all requests to our local Express + MySQL/local DB server API.

class FluentQuery {
  private _select: string = '*';
  private _eqs: { [key: string]: any } = {};
  private _gtes: { [key: string]: any } = {};
  private _ltes: { [key: string]: any } = {};
  private _orders: { column: string; ascending: boolean }[] = [];

  constructor(private table: string) {}

  select(fields: string = '*') {
    this._select = fields;
    return this;
  }

  eq(column: string, value: any) {
    this._eqs[column] = value;
    return this;
  }

  gte(column: string, value: any) {
    this._gtes[column] = value;
    return this;
  }

  lte(column: string, value: any) {
    this._ltes[column] = value;
    return this;
  }

  order(column: string, options?: { ascending: boolean }) {
    this._orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  // Make the class 'thenable' so it can be awaited directly as a Promise
  async then(resolve: (value: any) => void, reject?: (reason: any) => void) {
    try {
      const result = await this.executeGet();
      resolve(result);
    } catch (err) {
      if (reject) reject(err);
    }
  }

  private async executeGet() {
    try {
      const params = new URLSearchParams();
      params.set('select', this._select);
      params.set('eqs', JSON.stringify(this._eqs));
      params.set('gtes', JSON.stringify(this._gtes));
      params.set('ltes', JSON.stringify(this._ltes));
      params.set('orders', JSON.stringify(this._orders));

      const res = await fetch(`/api/${this.table}?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        return { data: null, error: { message: data.error || 'Request failed', code: data.code } };
      }
      return { data, error: null };
    } catch (err: any) {
      return { data: null, error: { message: err.message || 'Network error' } };
    }
  }

  insert(values: any[]) {
    const promise = (async () => {
      try {
        const res = await fetch(`/api/${this.table}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values)
        });
        const data = await res.json();
        if (!res.ok) {
          return { data: null, error: { message: data.error || 'Insert failed', code: data.code } };
        }
        return { data, error: null };
      } catch (err: any) {
        return { data: null, error: { message: err.message || 'Insert error' } };
      }
    })();

    // Return both thenable for direct awaiting, and select() builder for chaining
    return {
      then: (resolve: any, reject: any) => {
        promise.then(resolve, reject);
      },
      select: () => ({
        then: (resolve: any, reject: any) => {
          promise.then(resolve, reject);
        }
      })
    };
  }

  update(values: any) {
    const runUpdate = async (eqs: any) => {
      try {
        const res = await fetch(`/api/${this.table}?eqs=${encodeURIComponent(JSON.stringify(eqs))}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values)
        });
        const data = await res.json();
        if (!res.ok) {
          return { data: null, error: { message: data.error || 'Update failed', code: data.code } };
        }
        return { data, error: null };
      } catch (err: any) {
        return { data: null, error: { message: err.message || 'Update error' } };
      }
    };

    return {
      eq: (column: string, value: any) => {
        this._eqs[column] = value;
        return {
          then: async (resolve: any) => {
            const result = await runUpdate(this._eqs);
            resolve(result);
          }
        };
      }
    };
  }

  delete() {
    const runDelete = async (eqs: any) => {
      try {
        const res = await fetch(`/api/${this.table}?eqs=${encodeURIComponent(JSON.stringify(eqs))}`, {
          method: 'DELETE'
        });
        const data = await res.json();
        if (!res.ok) {
          return { data: null, error: { message: data.error || 'Delete failed', code: data.code } };
        }
        return { data, error: null };
      } catch (err: any) {
        return { data: null, error: { message: err.message || 'Delete error' } };
      }
    };

    return {
      eq: (column: string, value: any) => {
        this._eqs[column] = value;
        return {
          then: async (resolve: any) => {
            const result = await runDelete(this._eqs);
            resolve(result);
          }
        };
      }
    };
  }
}

export const supabase: any = {
  auth: {
    getSession: async () => {
      try {
        const res = await fetch('/api/auth/session');
        const data = await res.json();
        if (!res.ok) return { data: { session: null }, error: { message: data.error || 'Session failed' } };
        return { data, error: null };
      } catch (err: any) {
        return { data: { session: null }, error: { message: err.message } };
      }
    },
    onAuthStateChange: (cb: any) => {
      const listener = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        cb(detail.event, detail.session);
      };
      
      window.addEventListener('auth-state-change', listener);

      // Fetch initial session and invoke callback
      fetch('/api/auth/session')
        .then(res => res.json())
        .then(data => {
          cb('INITIAL_SESSION', data?.session || null);
        })
        .catch(() => {
          cb('INITIAL_SESSION', null);
        });

      return {
        data: {
          subscription: {
            unsubscribe: () => {
              window.removeEventListener('auth-state-change', listener);
            }
          }
        }
      };
    },
    signInWithPassword: async ({ email, password }: any) => {
      try {
        const username = email.split('@')[0];
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) {
          return { data: null, error: { message: data.error || 'Đăng nhập thất bại' } };
        }

        window.dispatchEvent(new CustomEvent('auth-state-change', {
          detail: { event: 'SIGNED_IN', session: data.session }
        }));

        return { data, error: null };
      } catch (err: any) {
        return { data: null, error: { message: err.message } };
      }
    },
    signOut: async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.dispatchEvent(new CustomEvent('auth-state-change', {
          detail: { event: 'SIGNED_OUT', session: null }
        }));
        return { error: null };
      } catch (err: any) {
        return { error: { message: err.message } };
      }
    },
    signUp: async ({ email, password }: any) => {
      try {
        const username = email.split('@')[0];
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) {
          return { data: null, error: { message: data.error || 'Tạo tài khoản thất bại' } };
        }
        return { data: { user: data.user }, error: null };
      } catch (err: any) {
        return { data: null, error: { message: err.message } };
      }
    }
  },
  from: (table: string) => {
    return new FluentQuery(table);
  }
};
