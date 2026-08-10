export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    function json(data, status) {
      return new Response(JSON.stringify(data), {
        status: status || 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    function isAuthorized(request) {
      const authHeader = request.headers.get('Authorization') || '';
      const token = authHeader.replace('Bearer ', '');
      return token === env.ADMIN_TOKEN;
    }

    function normalizePhone(phone) {
      // Strips spaces, dashes, parentheses, and a leading + so it matches
      // Meta's expected format (country code + number, digits only).
      return String(phone || '').replace(/[^\d]/g, '');
    }

    const TEMPLATE_MAP = {
      loan_applications: {
        'Under Review': 'loan_under_review',
        'Approved': 'loan_approved',
        'Rejected': 'loan_rejected',
        'Disbursed': 'loan_disbursed',
      },
      partnership_applications: {
        'Under Review': 'partnership_review',
        'Approved': 'partnership_approved',
        'Rejected': 'partnership_rejected',
      },
    };

    async function sendWhatsAppTemplate(phone, templateName, params) {
      if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
        console.log('WhatsApp credentials not configured yet, skipping send.');
        return { skipped: true };
      }

      const url = 'https://graph.facebook.com/v20.0/' + env.WHATSAPP_PHONE_NUMBER_ID + '/messages';
      const body = {
        messaging_product: 'whatsapp',
        to: normalizePhone(phone),
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en' },
          components: [
            {
              type: 'body',
              parameters: params.map((p) => ({ type: 'text', text: String(p) })),
            },
          ],
        },
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + env.WHATSAPP_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const result = await res.json();
      if (!res.ok) {
        console.log('WhatsApp send failed:', JSON.stringify(result));
      }
      return result;
    }

    try {
      // --- Public: receive a loan application ---
      if (url.pathname === '/api/apply' && request.method === 'POST') {
        const data = await request.json();
        await env.DB.prepare(
          `INSERT INTO loan_applications
           (created_at, name, phone, email, dob, residence, amount, term, purpose, income, employment,
            surety_name, surety_phone, surety_address, surety_relation, collateral, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'New')`
        ).bind(
          new Date().toISOString(),
          data.name || '', data.phone || '', data.email || '', data.dob || '',
          data.residence || '', data.amount || 0, data.term || '', data.purpose || '',
          data.income || 0, data.employment || '',
          data.suretyName || '', data.suretyPhone || '', data.suretyAddress || '', data.suretyRelation || '',
          data.collateral || ''
        ).run();
        return json({ success: true });
      }

      // --- Public: receive a partnership application ---
      if (url.pathname === '/api/partner' && request.method === 'POST') {
        const data = await request.json();
        await env.DB.prepare(
          `INSERT INTO partnership_applications
           (created_at, name, phone, email, residence, occupation, shares, total_contribution, payout, payment_method, reason, next_of_kin, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'New')`
        ).bind(
          new Date().toISOString(),
          data.name || '', data.phone || '', data.email || '', data.residence || '',
          data.occupation || '', data.shares || 0, data.totalContribution || 0,
          data.payout || '', data.paymentMethod || '', data.reason || '', data.nextOfKin || ''
        ).run();
        return json({ success: true });
      }

      // --- Admin: list loan applications ---
      if (url.pathname === '/api/admin/applications' && request.method === 'GET') {
        if (!isAuthorized(request)) return json({ error: 'Unauthorized' }, 401);
        const { results } = await env.DB.prepare('SELECT * FROM loan_applications ORDER BY id DESC').all();
        return json(results);
      }

      // --- Admin: list partnership applications ---
      if (url.pathname === '/api/admin/partnerships' && request.method === 'GET') {
        if (!isAuthorized(request)) return json({ error: 'Unauthorized' }, 401);
        const { results } = await env.DB.prepare('SELECT * FROM partnership_applications ORDER BY id DESC').all();
        return json(results);
      }

      // --- Admin: update a status ---
      if (url.pathname === '/api/admin/update-status' && request.method === 'POST') {
        if (!isAuthorized(request)) return json({ error: 'Unauthorized' }, 401);
        const { table, id, status } = await request.json();
        const validTables = ['loan_applications', 'partnership_applications'];
        if (!validTables.includes(table)) return json({ error: 'Invalid table' }, 400);

        await env.DB.prepare(`UPDATE ${table} SET status = ? WHERE id = ?`).bind(status, id).run();

        // Fire off a WhatsApp status update, if a template exists for this status
        // and WhatsApp credentials are configured. Failure here never blocks the
        // status update itself from succeeding.
        const templateName = TEMPLATE_MAP[table] && TEMPLATE_MAP[table][status];
        if (templateName) {
          const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
          if (row && row.phone) {
            const params = table === 'loan_applications'
              ? [row.name, Number(row.amount || 0).toLocaleString()]
              : [row.name];
            try {
              await sendWhatsAppTemplate(row.phone, templateName, params);
            } catch (e) {
              console.log('WhatsApp send error:', e.message);
            }
          }
        }

        return json({ success: true });
      }

      // --- Admin: delete applications ---
      if (url.pathname === '/api/admin/delete' && request.method === 'POST') {
        if (!isAuthorized(request)) return json({ error: 'Unauthorized' }, 401);
        const { table, ids, all } = await request.json();
        const validTables = ['loan_applications', 'partnership_applications'];
        if (!validTables.includes(table)) return json({ error: 'Invalid table' }, 400);

        if (all) {
          await env.DB.prepare(`DELETE FROM ${table}`).run();
          return json({ success: true });
        }

        if (!Array.isArray(ids) || ids.length === 0) {
          return json({ error: 'No ids provided' }, 400);
        }

        const placeholders = ids.map(() => '?').join(',');
        await env.DB.prepare(`DELETE FROM ${table} WHERE id IN (${placeholders})`).bind(...ids).run();
        return json({ success: true });
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  },
};
