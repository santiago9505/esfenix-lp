import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  FresaClientsError,
  fetchActiveClientPages,
  findActiveClient,
  isActiveClientEmail,
  loadActiveClientEmails,
  normalizeEmail,
  resetFresaClientsCache,
} from '../src/catalog/core/fresa-clients.js';

const columns = [
  { key: 'client_active_internal', field_name: 'activo', field_type: 'checkbox' },
  { key: 'client_email_internal', field_name: 'email', field_type: 'email' },
];

function page(records, offset, hasMore, nextOffset) {
  return {
    success: true,
    source: { name: 'Clientes Activos' },
    columns,
    records,
    // `totalCount` stays consistent with the offsets below: the reader stops at
    // the reported total because Fresa answers 500 past the end of a source.
    page: { offset, limit: 250, totalCount: 251, hasMore, nextOffset },
  };
}

afterEach(() => resetFresaClientsCache());

test('reads active client emails across all paginated records', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const offset = Number(new URL(url).searchParams.get('offset'));
    if (offset === 0) {
      return {
        ok: true,
        status: 200,
        json: async () =>
          page(
            [
              { id: 'active-a', fields: { client_active_internal: true, client_email_internal: ' Alice@Example.com ' } },
              { id: 'inactive-b', fields: { client_active_internal: false, client_email_internal: 'inactive@example.com' } },
            ],
            0,
            true,
            250,
          ),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () =>
        page(
          [{ id: 'active-c', fields: { client_active_internal: true, client_email_internal: 'carol@example.com' } }],
          250,
          false,
          null,
        ),
    };
  };

  const emails = await loadActiveClientEmails({
    apiUrl: 'http://fresa.test/api/integrations/catalog',
    apiKey: 'test-key',
    fetchImpl,
  });

  assert.deepEqual([...emails].sort(), ['alice@example.com', 'carol@example.com']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
  assert.equal(new URL(calls[1].url).searchParams.get('offset'), '250');
});

test('validates an email case-insensitively and excludes inactive clients', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => page([
      { id: 'active', fields: { client_active_internal: true, client_email_internal: 'client@example.com' } },
      { id: 'inactive', fields: { client_active_internal: false, client_email_internal: 'old@example.com' } },
    ], 0, false, null),
  });
  const options = { apiUrl: 'http://fresa.test/api/integrations/catalog', apiKey: 'key', fetchImpl };

  assert.equal(normalizeEmail('  CLIENT@Example.com '), 'client@example.com');
  assert.equal(await isActiveClientEmail(' CLIENT@EXAMPLE.COM ', options), true);
  assert.equal(await isActiveClientEmail('old@example.com', options), false);
  assert.equal(await isActiveClientEmail('unknown@example.com', options), false);
});

test('reports authorization failures without treating them as an unknown email', async () => {
  await assert.rejects(
    () =>
      fetchActiveClientPages({
        apiUrl: 'http://fresa.test/api/integrations/catalog',
        apiKey: 'bad-key',
        fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
      }),
    (error) => {
      assert.ok(error instanceof FresaClientsError);
      assert.equal(error.status, 401);
      assert.match(error.message, /invalid or inactive/i);
      return true;
    },
  );
});

test('accepts the top-level records response returned by the active-client source', async () => {
  const result = await fetchActiveClientPages({
    apiUrl: 'http://fresa.test/api/integrations/catalog',
    apiKey: 'key',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        source: { name: 'Clientes Activos' },
        columns,
        records: [],
        page: { offset: 0, limit: 250, totalCount: 0, hasMore: false, nextOffset: null },
      }),
    }),
  });

  assert.equal(result.source.name, 'Clientes Activos');
  assert.deepEqual(result.records, []);
});

test('recognizes Fresa field keys with dynamic suffixes when descriptors are sparse', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      columns: [
        { key: 'activo_mr11h8dn' },
        { key: 'email_mr11h9d6' },
      ],
      records: [
        {
          id: 'active',
          fields: { activo_mr11h8dn: true, email_mr11h9d6: 'active@example.com' },
        },
        {
          id: 'inactive',
          fields: { activo_mr11h8dn: false, email_mr11h9d6: 'inactive@example.com' },
        },
      ],
      page: { offset: 0, limit: 250, totalCount: 2, hasMore: false, nextOffset: null },
    }),
  });

  const emails = await loadActiveClientEmails({
    apiUrl: 'http://fresa.test/api/integrations/catalog',
    apiKey: 'key',
    force: true,
    fetchImpl,
  });

  assert.deepEqual([...emails], ['active@example.com']);
});

test('returns a recognized contact profile without persisting the source record', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      columns: [
        { key: 'activo_mr11h8dn' },
        { key: 'email_mr11h9d6' },
        { key: 'nombre_contacto_mr11h8z2' },
        { key: 'apellido_contacto_mr11h966' },
        { key: 'telefono_mr11h9kk' },
        { key: 'empresa_mr11h8s7' },
      ],
      records: [{
        id: 'active',
        fields: {
          activo_mr11h8dn: true,
          email_mr11h9d6: 'known@example.com',
          nombre_contacto_mr11h8z2: 'Ana',
          apellido_contacto_mr11h966: 'Flower',
          telefono_mr11h9kk: '+1 555 0100',
          empresa_mr11h8s7: 'Example Flowers',
          envio_direccion_mr11hbov: '123 Flower Street',
          envio_ciudad_mr11hbvq: 'Miami',
          envio_estado_mr11hc9f: 'FL',
          envio_codigo_postal_mr11hcke: '33101',
          envio_pais_mr11hcv8: 'US',
        },
      }],
      page: { offset: 0, limit: 250, totalCount: 1, hasMore: false, nextOffset: null },
    }),
  });

  const profile = await findActiveClient(' KNOWN@EXAMPLE.COM ', {
    apiUrl: 'http://fresa.test/api/integrations/catalog',
    apiKey: 'key',
    fetchImpl,
  });

  assert.deepEqual(profile, {
    email: 'known@example.com',
    firstName: 'Ana',
    lastName: 'Flower',
    phone: '+1 555 0100',
    company: 'Example Flowers',
    shipping: {
      address: '123 Flower Street',
      city: 'Miami',
      state: 'FL',
      zipCode: '33101',
      country: 'US',
    },
  });
});

test('matches an active email even when optional contact fields are empty', async () => {
  const profile = await findActiveClient('known@example.com', {
    apiUrl: 'http://fresa.test/api/integrations/catalog',
    apiKey: 'key',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        columns: [
          { key: 'active', field_name: 'activo', field_type: 'checkbox' },
          { key: 'email', field_name: 'email', field_type: 'email' },
        ],
        records: [{
          id: 'active',
          fields: { active: true, email: 'KNOWN@example.com' },
        }],
        page: { offset: 0, limit: 250, totalCount: 1, hasMore: false, nextOffset: null },
      }),
    }),
  });

  assert.deepEqual(profile, {
    email: 'known@example.com',
    firstName: '',
    lastName: '',
    phone: '',
    company: '',
    shipping: {
      address: '',
      city: '',
      state: '',
      zipCode: '',
      country: '',
    },
  });
});

test('reads common Spanish contact column labels from an active record', async () => {
  const profile = await findActiveClient('known@example.com', {
    apiUrl: 'http://fresa.test/api/integrations/catalog',
    apiKey: 'key',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        columns: [
          { key: 'active', field_name: 'Activo', field_type: 'checkbox' },
          { key: 'email', field_name: 'Correo', field_type: 'email' },
          { key: 'first', field_name: 'Nombre' },
          { key: 'last', field_name: 'Apellido' },
          { key: 'phone', field_name: 'Teléfono' },
          { key: 'company', field_name: 'Empresa' },
        ],
        records: [{
          id: 'active',
          fields: {
            active: true,
            email: 'known@example.com',
            first: 'Ana',
            last: 'Fresa',
            phone: '+1 555 0100',
            company: 'Esfenix',
          },
        }],
        page: { offset: 0, limit: 250, totalCount: 1, hasMore: false, nextOffset: null },
      }),
    }),
  });

  assert.deepEqual(profile, {
    email: 'known@example.com',
    firstName: 'Ana',
    lastName: 'Fresa',
    phone: '+1 555 0100',
    company: 'Esfenix',
    shipping: {
      address: '',
      city: '',
      state: '',
      zipCode: '',
      country: '',
    },
});
});

/**
 * The client directory and the product catalog answer on the same URL with
 * different keys, and Fresa marks the response publicly cacheable without
 * varying on Authorization. These two tests cover the resulting failure: a
 * catalog response replayed from the HTTP cache made every active client look
 * like a new contact.
 */
test('requests the directory outside the shared HTTP cache', async () => {
  const calls = [];
  await fetchActiveClientPages({
    apiUrl: 'http://fresa.test/api/integrations/catalog',
    apiKey: 'key',
    fetchImpl: async (url, options) => {
      calls.push(options);
      return { ok: true, status: 200, json: async () => page([], 0, false, null) };
    },
  });

  assert.equal(calls[0].cache, 'no-store');
});

test('rejects a response that belongs to another Fresa source', async () => {
  await assert.rejects(
    () =>
      fetchActiveClientPages({
        apiUrl: 'http://fresa.test/api/integrations/catalog',
        apiKey: 'key',
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            source: { name: 'Landing Page' },
            columns: [],
            records: [{ id: 'product-1', fields: { nombre: 'Rosa' } }],
            page: { offset: 0, limit: 250, totalCount: 1365, hasMore: true, nextOffset: 250 },
          }),
        }),
      }),
    (error) => {
      assert.ok(error instanceof FresaClientsError);
      assert.match(error.message, /Landing Page/);
      return true;
    },
  );
});

test('stops at the reported total instead of asking for an offset Fresa rejects', async () => {
  const offsets = [];
  const { records } = await fetchActiveClientPages({
    apiUrl: 'http://fresa.test/api/integrations/catalog',
    apiKey: 'key',
    fetchImpl: async (url) => {
      const offset = Number(new URL(url).searchParams.get('offset'));
      offsets.push(offset);
      if (offset >= 2) return { ok: false, status: 500, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          source: { name: 'Clientes Activos' },
          columns,
          records: [{ id: `client-${offset}`, fields: { client_active_internal: true, client_email_internal: `c${offset}@example.com` } }],
          // Fresa keeps `hasMore` true on the last page of this source.
          page: { offset, limit: 250, totalCount: 2, hasMore: true, nextOffset: offset + 2 },
        }),
      };
    },
  });

  assert.deepEqual(offsets, [0]);
  assert.equal(records.length, 1);
});

test('retries a page that fails with a server error', async () => {
  let attempts = 0;
  const emails = await loadActiveClientEmails({
    apiUrl: 'http://fresa.test/api/integrations/catalog',
    apiKey: 'key',
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return { ok: false, status: 503, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () =>
          page([{ id: 'a', fields: { client_active_internal: true, client_email_internal: 'a@example.com' } }], 0, false, null),
      };
    },
  });

  assert.equal(attempts, 2);
  assert.deepEqual([...emails], ['a@example.com']);
});

test('prefers the contact name over the QuickBooks full name', async () => {
  const profile = await findActiveClient('abi@example.com', {
    apiUrl: 'http://fresa.test/api/integrations/catalog',
    apiKey: 'key',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        source: { name: 'Clientes Activos' },
        // `nombre_completo_qb` is listed before `nombre_contacto`, as in the
        // real source. Column order must not win over the alias.
        columns: [
          { key: 'activo_mr11h8dn', field_name: 'activo', field_type: 'checkbox' },
          { key: 'nombre_completo_qb_mr11h8l0', field_name: 'nombre_completo_qb', field_type: 'text' },
          { key: 'empresa_mr11h8s7', field_name: 'empresa', field_type: 'text' },
          { key: 'nombre_contacto_mr11h8z2', field_name: 'nombre_contacto', field_type: 'text' },
          { key: 'apellido_contacto_mr11h966', field_name: 'apellido_contacto', field_type: 'text' },
          { key: 'email_mr11h9d6', field_name: 'email', field_type: 'email' },
        ],
        records: [{
          id: 'abi',
          fields: {
            activo_mr11h8dn: true,
            nombre_completo_qb_mr11h8l0: 'Abigail Rangel',
            empresa_mr11h8s7: '',
            nombre_contacto_mr11h8z2: 'Abigail',
            apellido_contacto_mr11h966: 'Rangel',
            email_mr11h9d6: 'abi@example.com',
          },
        }],
        page: { offset: 0, limit: 250, totalCount: 1, hasMore: false, nextOffset: null },
      }),
    }),
  });

  assert.equal(profile.firstName, 'Abigail');
  assert.equal(profile.lastName, 'Rangel');
});

test('splits the full name when the contact fields are empty', async () => {
  const profile = await findActiveClient('ana@example.com', {
    apiUrl: 'http://fresa.test/api/integrations/catalog',
    apiKey: 'key',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        source: { name: 'Clientes Activos' },
        columns: [
          { key: 'activo_mr11h8dn', field_name: 'activo', field_type: 'checkbox' },
          { key: 'nombre_completo_qb_mr11h8l0', field_name: 'nombre_completo_qb', field_type: 'text' },
          { key: 'nombre_contacto_mr11h8z2', field_name: 'nombre_contacto', field_type: 'text' },
          { key: 'apellido_contacto_mr11h966', field_name: 'apellido_contacto', field_type: 'text' },
          { key: 'email_mr11h9d6', field_name: 'email', field_type: 'email' },
        ],
        records: [{
          id: 'ana',
          fields: {
            activo_mr11h8dn: true,
            nombre_completo_qb_mr11h8l0: 'Ana Lorenzo',
            nombre_contacto_mr11h8z2: '',
            apellido_contacto_mr11h966: '',
            email_mr11h9d6: 'ana@example.com',
          },
        }],
        page: { offset: 0, limit: 250, totalCount: 1, hasMore: false, nextOffset: null },
      }),
    }),
  });

  assert.equal(profile.firstName, 'Ana');
  assert.equal(profile.lastName, 'Lorenzo');
});

test('reads the directory once for repeated lookups', async () => {
  let requests = 0;
  const options = {
    apiUrl: 'http://fresa.test/api/integrations/catalog',
    apiKey: 'key',
    fetchImpl: async () => {
      requests += 1;
      return {
        ok: true,
        status: 200,
        json: async () =>
          page([{ id: 'a', fields: { client_active_internal: true, client_email_internal: 'a@example.com' } }], 0, false, null),
      };
    },
  };

  assert.ok(await findActiveClient('a@example.com', options));
  assert.equal(await findActiveClient('b@example.com', options), null);
  assert.equal(await isActiveClientEmail('a@example.com', options), true);
  assert.equal(requests, 1);
});
